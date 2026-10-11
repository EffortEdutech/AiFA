-- Sprint 68a -- Customer Requests: intake hardening, tracking link, slug
-- aliases (Architecture §2.3 requests/request_status_events, §2.5; design
-- doc "AiFA Client Requests -- QR to Public Site to Owner Inbox").
--
-- Scope of THIS migration (phase A, public half only):
--   1. requests: new columns (reference code, tracking token, customer
--      fields, source tag, consent, timestamps, quotation link) + status
--      check. Existing rows are backfilled so nothing is lost.
--   2. request_status_events: the timeline the customer's tracking page
--      and (phase B) the owner's inbox both read.
--   3. slug_aliases: an old slug keeps resolving after a rename, so
--      printed QR codes never break.
--   4. request_throttle: hashed-IP counters for database-enforced rate
--      limits (the public form is anon-callable).
--   5. submit_public_request_v2() and get_request_tracking(): the ONLY two
--      things an anonymous visitor can call. No anonymous table access.
--   6. Customer details become readable only by members holding the
--      sales:view capability (was: any active member).
--
-- Phase B (owner inbox RPCs: list/open/reply/status/notes/quotation link)
-- is a separate migration, 00000000000022.
--
-- Deliberately plaintext (Architecture §2.3): these tables are the Public
-- Surface, outside the end-to-end-encrypted books.
--
-- Run order: apply this migration, THEN deploy web-public. The old
-- submit_public_request(uuid, text, jsonb) is left in place (and still
-- works, now with generated codes) so the currently deployed contact form
-- keeps working until the new web-public is live. Step 9 at the bottom
-- (commented out) closes it afterwards.

begin;

-- ------------------------------------------------------------------
-- 0. Small helpers
-- ------------------------------------------------------------------

-- Does the signed-in caller hold <capability> on 'sales' for this business?
-- Same join the other settings/sales gates in this schema use.
create or replace function public._has_sales_capability(p_business_id uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.business_memberships bm
    join public.role_permissions rp on rp.role_id = bm.role_id
    where bm.business_id = p_business_id
      and bm.user_id = auth.uid()
      and bm.status = 'active'
      and rp.domain = 'sales'
      and rp.capability = p_capability
  )
$$;

grant execute on function public._has_sales_capability(uuid, text) to authenticated;

-- Short human reference, e.g. RQ-7K3F9X. Not a secret: it only lets the
-- owner and the customer talk about the same request on the phone. It never
-- grants access to anything. No ambiguous characters (0/O, 1/I).
create or replace function public._new_reference_code()
returns text
language plpgsql
volatile
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text := '';
  i int;
begin
  for i in 1..6 loop
    v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
  end loop;
  return 'RQ-' || v_code;
end;
$$;

-- Long unguessable tracking token: two random UUIDs, hyphens removed
-- (64 hex characters, about 244 random bits). Single purpose: it is the
-- tracking page's only credential (Architecture §5).
create or replace function public._new_tracking_token()
returns text
language sql
volatile
as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
$$;

-- ------------------------------------------------------------------
-- 1. requests: extend the Sprint 66 table
-- ------------------------------------------------------------------

alter table public.requests
  add column if not exists reference_code text,
  add column if not exists tracking_token text,
  add column if not exists customer_name text,
  add column if not exists customer_phone text,
  add column if not exists customer_email text,
  add column if not exists source text,
  add column if not exists consent_at timestamptz,
  add column if not exists seen_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists quotation_id uuid references public.quotations (id) on delete set null;

-- Backfill rows created by the Sprint 66 contact form: give each a code
-- and a token, and lift name/email out of the payload so they can be listed.
do $$
declare
  r record;
  v_code text;
begin
  for r in select id, payload from public.requests where reference_code is null or tracking_token is null loop
    loop
      v_code := public._new_reference_code();
      exit when not exists (select 1 from public.requests where reference_code = v_code);
    end loop;
    update public.requests
       set reference_code = coalesce(reference_code, v_code),
           tracking_token = coalesce(tracking_token, public._new_tracking_token()),
           customer_name = coalesce(customer_name, nullif(btrim(r.payload ->> 'name'), '')),
           customer_email = coalesce(customer_email, nullif(btrim(r.payload ->> 'email'), ''))
     where id = r.id;
  end loop;
end;
$$;

-- Defaults keep the old submit_public_request() working until it is closed.
alter table public.requests
  alter column reference_code set default public._new_reference_code(),
  alter column tracking_token set default public._new_tracking_token(),
  alter column reference_code set not null,
  alter column tracking_token set not null;

create unique index if not exists requests_reference_code_key on public.requests (reference_code);
create unique index if not exists requests_tracking_token_key on public.requests (tracking_token);
create index if not exists idx_requests_business_status_created
  on public.requests (business_id, status, created_at desc);

alter table public.requests drop constraint if exists requests_status_check;
alter table public.requests
  add constraint requests_status_check
  check (status in ('new', 'seen', 'replied', 'quoted', 'closed', 'spam'));

comment on column public.requests.request_type is
  'contact = a general enquiry (the screens call it Enquiry; kept as the stored value so no rows need rewriting); rfq = request for quotation; po is reserved.';
comment on column public.requests.tracking_token is
  'Sprint 68a -- the customer tracking page''s only credential. Long, random, single-purpose; never derived from the reference code, slug or id.';

-- Customer contact details are personal data: readable only by members
-- who hold sales:view (the Owner role holds every capability). Replaces
-- the Sprint 66 policy that let any active member read them.
drop policy if exists "Members can view their own business's requests" on public.requests;
create policy "Sales members can view their business's requests"
  on public.requests
  for select
  using (public._has_sales_capability(business_id, 'view'));

-- ------------------------------------------------------------------
-- 2. request_status_events: the timeline
-- ------------------------------------------------------------------

create table if not exists public.request_status_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null check (kind in ('received', 'seen', 'status', 'reply', 'note', 'quotation')),
  status text,
  body text,
  is_public boolean not null default false,
  actor_user_id uuid,
  created_at timestamptz not null default now()
);

comment on table public.request_status_events is
  'Sprint 68a -- timeline for one request. is_public = shown on the customer tracking page; private notes and internal events are not. actor_user_id is empty for system and customer events. Written only by SECURITY DEFINER functions.';

create index if not exists idx_request_status_events_request on public.request_status_events (request_id, created_at);
create index if not exists idx_request_status_events_business on public.request_status_events (business_id);

alter table public.request_status_events enable row level security;

create policy "Sales members can view their business's request events"
  on public.request_status_events
  for select
  using (public._has_sales_capability(business_id, 'view'));

-- Existing rows get a 'received' event so their timelines are not empty.
insert into public.request_status_events (request_id, business_id, kind, status, is_public, created_at)
select r.id, r.business_id, 'received', 'new', true, r.created_at
from public.requests r
where not exists (select 1 from public.request_status_events e where e.request_id = r.id);

-- ------------------------------------------------------------------
-- 3. slug_aliases: renamed slugs keep working (printed QR codes)
-- ------------------------------------------------------------------

create table if not exists public.slug_aliases (
  slug text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint slug_aliases_slug_format check (slug ~ '^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$')
);

comment on table public.slug_aliases is
  'Sprint 68a -- every slug a business has used before. resolve_business_slug() falls back to this table so a QR code printed before a rename keeps working. A slug held as an alias by one business cannot be claimed by another.';

create index if not exists idx_slug_aliases_business on public.slug_aliases (business_id);

-- No policies: reached only through SECURITY DEFINER functions.
alter table public.slug_aliases enable row level security;

-- Remember the old slug whenever it changes.
create or replace function public._remember_old_slug()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.slug is distinct from new.slug then
    insert into public.slug_aliases (slug, business_id)
    values (old.slug, old.id)
    on conflict (slug) do nothing;
    -- Renaming back to an earlier slug: it is current again, not an alias.
    delete from public.slug_aliases where slug = new.slug and business_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_remember_old_slug on public.businesses;
create trigger trg_remember_old_slug
  after update of slug on public.businesses
  for each row execute function public._remember_old_slug();

-- Another business may not claim a slug that is someone else's alias
-- (that would redirect their printed QR codes to a stranger).
create or replace function public._guard_slug_not_aliased()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.slug_aliases a
    where a.slug = new.slug and a.business_id <> new.id
  ) then
    raise exception 'slug_already_taken';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_slug_not_aliased on public.businesses;
create trigger trg_guard_slug_not_aliased
  before insert or update of slug on public.businesses
  for each row execute function public._guard_slug_not_aliased();

-- Auto-generated slugs for new businesses must also skip aliases.
create or replace function public._assign_business_slug()
returns trigger
language plpgsql
as $$
declare
  base text;
  candidate text;
  suffix int;
begin
  if new.slug is not null then
    return new;
  end if;
  base := coalesce(public._slugify(new.legal_name), 'business');
  if length(base) > 60 then
    base := substring(base from 1 for 60);
  end if;
  candidate := base;
  suffix := 1;
  while exists (select 1 from public.businesses where slug = candidate)
     or exists (select 1 from public.slug_aliases where slug = candidate) loop
    suffix := suffix + 1;
    candidate := base || '-' || suffix::text;
  end loop;
  new.slug := candidate;
  return new;
end;
$$;

-- resolve_business_slug(): current slug first, then an alias.
create or replace function public.resolve_business_slug(p_slug text)
returns uuid
language sql
stable
security definer
set search_path = 'public'
as $$
  select coalesce(
    (select id from public.businesses where slug = lower(btrim(p_slug))),
    (select business_id from public.slug_aliases where slug = lower(btrim(p_slug)))
  );
$$;

grant execute on function public.resolve_business_slug(text) to anon, authenticated, service_role;

-- Public pages need the CURRENT slug for an alias hit, so they can show
-- the canonical link. Returns null when the slug is unknown.
create or replace function public.get_current_business_slug(p_slug text)
returns text
language sql
stable
security definer
set search_path = 'public'
as $$
  select b.slug
  from public.businesses b
  where b.id = public.resolve_business_slug(p_slug)
$$;

grant execute on function public.get_current_business_slug(text) to anon, authenticated, service_role;

-- ------------------------------------------------------------------
-- 4. request_throttle: database-enforced rate limits
-- ------------------------------------------------------------------

create table if not exists public.request_throttle (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  ip_hash text not null,
  created_at timestamptz not null default now()
);

comment on table public.request_throttle is
  'Sprint 68a -- one row per accepted public submission: a salted hash of the sender''s IP (never the IP itself) and the business, used only to count recent submissions. Rows older than a day are deleted on each submission.';

create index if not exists idx_request_throttle_lookup on public.request_throttle (business_id, ip_hash, created_at);
create index if not exists idx_request_throttle_created on public.request_throttle (created_at);

alter table public.request_throttle enable row level security;
-- No policies: written and read only by submit_public_request_v2().

-- ------------------------------------------------------------------
-- 5. submit_public_request_v2: the only way a visitor creates a request
-- ------------------------------------------------------------------
--
-- Every rule is enforced here, not only in the web layer:
--   * request type: contact (enquiry) or rfq (po is reserved)
--   * name 2-100, phone 9-15 digits (the web layer normalises to the
--     international form), email optional and shaped like one, message
--     10-2000, at most 2 links in the message
--   * rfq: 1-10 items {description <= 200, quantity <= 20 chars}, optional
--     needed-by date (not in the past), optional delivery area <= 200
--   * explicit consent
--   * rate limits: 5 per hashed IP per business per hour, 30 per business
--     per hour
-- An unknown business and an over-limit sender both fail with a generic
-- message so the form cannot be used to probe which businesses exist.
-- Returns only the reference code and tracking token.

create or replace function public.submit_public_request_v2(
  p_business_id uuid,
  p_request_type text,
  p_fields jsonb,
  p_ip_hash text,
  p_source text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_phone text;
  v_email text;
  v_message text;
  v_needed_by date;
  v_delivery text;
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_item_desc text;
  v_item_qty text;
  v_source text;
  v_payload jsonb;
  v_row public.requests;
  v_code text;
  v_link_count int;
  v_ip_recent int;
  v_biz_recent int;
begin
  if p_business_id is null or not exists (select 1 from public.businesses where id = p_business_id) then
    raise exception 'request_failed';
  end if;

  if p_request_type not in ('contact', 'rfq') then
    raise exception 'invalid_request_type';
  end if;

  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'invalid_fields';
  end if;

  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'request_failed';
  end if;

  v_name := btrim(coalesce(p_fields ->> 'name', ''));
  if char_length(v_name) < 2 or char_length(v_name) > 100 then
    raise exception 'invalid_name';
  end if;

  v_phone := regexp_replace(coalesce(p_fields ->> 'phone', ''), '[^0-9]', '', 'g');
  if v_phone !~ '^[0-9]{9,15}$' then
    raise exception 'invalid_phone';
  end if;

  v_email := nullif(btrim(coalesce(p_fields ->> 'email', '')), '');
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^\s@<>"'']+@[^\s@<>"'']+\.[^\s@<>"'']+$') then
    raise exception 'invalid_email';
  end if;

  v_message := btrim(coalesce(p_fields ->> 'message', ''));
  if char_length(v_message) < 10 or char_length(v_message) > 2000 then
    raise exception 'invalid_message';
  end if;

  select count(*) into v_link_count
  from regexp_matches(lower(v_message), 'https?://|www\.', 'g');
  if v_link_count > 2 then
    raise exception 'too_many_links';
  end if;

  if coalesce(p_fields ->> 'consent', 'false') <> 'true' then
    raise exception 'consent_required';
  end if;

  if p_request_type = 'rfq' then
    -- coalesce: jsonb_typeof(NULL) is NULL, which would let a request with
    -- no items key slip past this check.
    if coalesce(jsonb_typeof(p_fields -> 'items'), '') <> 'array'
       or jsonb_array_length(p_fields -> 'items') < 1
       or jsonb_array_length(p_fields -> 'items') > 10 then
      raise exception 'invalid_items';
    end if;

    for v_item in select * from jsonb_array_elements(p_fields -> 'items') loop
      if jsonb_typeof(v_item) <> 'object' then
        raise exception 'invalid_items';
      end if;
      v_item_desc := btrim(coalesce(v_item ->> 'description', ''));
      v_item_qty := btrim(coalesce(v_item ->> 'quantity', ''));
      if char_length(v_item_desc) < 2 or char_length(v_item_desc) > 200 or char_length(v_item_qty) > 20 then
        raise exception 'invalid_items';
      end if;
      v_items := v_items || jsonb_build_array(
        jsonb_build_object('description', v_item_desc, 'quantity', v_item_qty)
      );
    end loop;

    if nullif(btrim(coalesce(p_fields ->> 'needed_by', '')), '') is not null then
      begin
        v_needed_by := (p_fields ->> 'needed_by')::date;
      exception when others then
        raise exception 'invalid_needed_by';
      end;
      if v_needed_by < current_date then
        raise exception 'invalid_needed_by';
      end if;
    end if;

    v_delivery := nullif(btrim(coalesce(p_fields ->> 'delivery_area', '')), '');
    if v_delivery is not null and char_length(v_delivery) > 200 then
      raise exception 'invalid_delivery_area';
    end if;
  end if;

  v_source := lower(btrim(coalesce(p_source, '')));
  if v_source !~ '^[a-z0-9_-]{1,40}$' then
    v_source := null;
  end if;

  -- Rate limits (counted before this submission is recorded).
  delete from public.request_throttle where created_at < now() - interval '1 day';

  select count(*) into v_ip_recent
  from public.request_throttle
  where business_id = p_business_id and ip_hash = p_ip_hash and created_at > now() - interval '1 hour';

  select count(*) into v_biz_recent
  from public.request_throttle
  where business_id = p_business_id and created_at > now() - interval '1 hour';

  if v_ip_recent >= 5 or v_biz_recent >= 30 then
    raise exception 'rate_limited';
  end if;

  v_payload := jsonb_build_object('message', v_message);
  if p_request_type = 'rfq' then
    v_payload := v_payload || jsonb_build_object('items', v_items);
    if v_needed_by is not null then
      v_payload := v_payload || jsonb_build_object('needed_by', v_needed_by);
    end if;
    if v_delivery is not null then
      v_payload := v_payload || jsonb_build_object('delivery_area', v_delivery);
    end if;
  end if;

  -- Reference code collisions are rare; retry a few times.
  for i in 1..5 loop
    v_code := public._new_reference_code();
    begin
      insert into public.requests (
        business_id, request_type, payload, status,
        reference_code, customer_name, customer_phone, customer_email,
        source, consent_at
      ) values (
        p_business_id, p_request_type, v_payload, 'new',
        v_code, v_name, v_phone, v_email,
        v_source, now()
      ) returning * into v_row;
      exit;
    exception when unique_violation then
      if i = 5 then
        raise exception 'request_failed';
      end if;
    end;
  end loop;

  insert into public.request_status_events (request_id, business_id, kind, status, is_public)
  values (v_row.id, v_row.business_id, 'received', 'new', true);

  insert into public.request_throttle (business_id, ip_hash) values (p_business_id, p_ip_hash);

  return jsonb_build_object(
    'reference_code', v_row.reference_code,
    'tracking_token', v_row.tracking_token
  );
end;
$$;

revoke all on function public.submit_public_request_v2(uuid, text, jsonb, text, text) from public;
grant execute on function public.submit_public_request_v2(uuid, text, jsonb, text, text) to anon, authenticated;

-- ------------------------------------------------------------------
-- 6. get_request_tracking: the customer's read-only view, by token
-- ------------------------------------------------------------------
--
-- Returns the request summary and PUBLIC events only. Never lists or
-- searches: a token reveals exactly one request. A spam-marked request
-- behaves as if it does not exist. Private notes, the customer's phone and
-- email, and internal events are never returned.

create or replace function public.get_request_tracking(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.requests;
  v_business_name text;
  v_business_slug text;
  v_events jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select * into v_row
  from public.requests
  where tracking_token = p_token and status <> 'spam';

  if not found then
    return null;
  end if;

  select b.legal_name, b.slug into v_business_name, v_business_slug
  from public.businesses b where b.id = v_row.business_id;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'kind', e.kind,
             'status', e.status,
             'body', e.body,
             'created_at', e.created_at
           ) order by e.created_at, e.id
         ), '[]'::jsonb)
    into v_events
  from public.request_status_events e
  where e.request_id = v_row.id and e.is_public;

  return jsonb_build_object(
    'reference_code', v_row.reference_code,
    'request_type', v_row.request_type,
    'status', v_row.status,
    'created_at', v_row.created_at,
    'business_name', v_business_name,
    'business_slug', v_business_slug,
    'customer_name', v_row.customer_name,
    'message', v_row.payload ->> 'message',
    'items', coalesce(v_row.payload -> 'items', '[]'::jsonb),
    'needed_by', v_row.payload ->> 'needed_by',
    'delivery_area', v_row.payload ->> 'delivery_area',
    'events', v_events
  );
end;
$$;

revoke all on function public.get_request_tracking(text) from public;
grant execute on function public.get_request_tracking(text) to anon, authenticated;

commit;

-- ------------------------------------------------------------------
-- 9. RUN LATER, after web-public with the new request form is live:
--    close the old unbounded anonymous write path. Left commented so the
--    currently deployed contact form keeps working until then.
-- ------------------------------------------------------------------
-- revoke execute on function public.submit_public_request(uuid, text, jsonb) from anon, authenticated;
