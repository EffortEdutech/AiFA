-- Sprint 70 -- Default AiFA-Hosted Landing Page via Business Slug
-- (Architecture §2.4 rescope, owner decision 21 September 2026).
--
-- Corrects a premise mismatch found live: Sprint 65/66 were built to an
-- earlier documented decision ("Custom-domain-only for v1 ... no aifa.my
-- fallback subdomain") that made a bound custom domain the ONLY way to
-- reach a Client Business's public site. The owner's actual product intent
-- is the opposite: every Client Business gets a working, AiFA-hosted
-- landing page immediately (reachable as e.g. aifa.com/site/<slug>, or via
-- a link/QR shared from inside the AiFA app) with zero DNS setup; a bound
-- custom domain (Sprint 65's `domains` table) becomes an optional, rare
-- add-on that the Platform Operator configures on request -- not something
-- every Client Business must do to have any public presence at all.
--
-- This migration adds the `slug` identity every business needs for that
-- default hosted path, following this project's own established
-- convention of RPC-only access (no direct service-role table grants) --
-- the same convention Sprint 65/66's edge functions were the first to
-- accidentally bypass, per the Sprint 66 addendum in Checklist_Master.md.

alter table public.businesses
  add column if not exists slug text;

-- Slug format: lowercase letters, digits, hyphens; 3-63 chars; no leading/
-- trailing hyphen. Deliberately permissive on collisions -- handled by a
-- numeric suffix, never a hard failure, so existing rows always backfill.
create or replace function public._slugify(p_input text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      regexp_replace(lower(btrim(p_input)), '[^a-z0-9]+', '-', 'g'),
      '(^-+)|(-+$)', '', 'g'
    ),
    ''
  )
$$;

-- Backfill existing rows with a unique slug derived from legal_name (or a
-- generic fallback when legal_name is blank), appending -2, -3, ... on
-- collision so every business ends up with exactly one slug.
do $$
declare
  r record;
  base text;
  candidate text;
  suffix int;
begin
  for r in select id, legal_name from public.businesses where slug is null order by created_at loop
    base := coalesce(public._slugify(r.legal_name), 'business');
    if length(base) > 60 then
      base := substring(base from 1 for 60);
    end if;
    candidate := base;
    suffix := 1;
    while exists (select 1 from public.businesses where slug = candidate) loop
      suffix := suffix + 1;
      candidate := base || '-' || suffix::text;
    end loop;
    update public.businesses set slug = candidate where id = r.id;
  end loop;
end;
$$;

alter table public.businesses
  alter column slug set not null,
  add constraint businesses_slug_unique unique (slug),
  add constraint businesses_slug_format check (
    slug ~ '^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$'
  );

-- Auto-assign a unique slug on insert for any future business row created
-- without one supplied (mirrors the backfill logic above).
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
  while exists (select 1 from public.businesses where slug = candidate) loop
    suffix := suffix + 1;
    candidate := base || '-' || suffix::text;
  end loop;
  new.slug := candidate;
  return new;
end;
$$;

drop trigger if exists trg_assign_business_slug on public.businesses;
create trigger trg_assign_business_slug
  before insert on public.businesses
  for each row execute function public._assign_business_slug();

-- resolve_business_slug(): the default hosting routing primitive, parallel
-- to Sprint 65's resolve_domain() but with no verification gate -- a
-- business's own AiFA-hosted slug is trusted the moment it exists, unlike
-- a claimed-but-unproven custom domain. anon-callable: a website visitor
-- has no account.
create or replace function public.resolve_business_slug(p_slug text)
returns uuid
language sql
stable
security definer
set search_path = 'public'
as $$
  select id from public.businesses where slug = lower(btrim(p_slug));
$$;

grant execute on function public.resolve_business_slug(text) to anon, authenticated, service_role;

-- update_business_slug(): lets an Owner (settings:configure) customize
-- their business's slug away from the auto-generated default. Same
-- membership/capability gate as add_domain() (Sprint 65), for consistency.
create or replace function public.update_business_slug(p_business_id uuid, p_slug text)
returns businesses
language plpgsql
security definer
set search_path = 'public', 'auth'
as $$
declare
  v_slug text;
  v_row public.businesses;
begin
  if not is_active_member(p_business_id) then
    raise exception 'not_a_member_of_this_business';
  end if;

  if not exists (
    select 1
    from public.business_memberships bm
    join public.role_permissions rp on rp.role_id = bm.role_id
    where bm.business_id = p_business_id
      and bm.user_id = auth.uid()
      and bm.status = 'active'
      and rp.domain = 'settings'
      and rp.capability = 'configure'
  ) then
    raise exception 'requires_settings_configure';
  end if;

  v_slug := lower(btrim(p_slug));
  if v_slug !~ '^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$' then
    raise exception 'invalid_slug_format';
  end if;

  begin
    update public.businesses set slug = v_slug where id = p_business_id returning * into v_row;
  exception
    when unique_violation then
      raise exception 'slug_already_taken';
  end;

  return v_row;
end;
$$;

grant execute on function public.update_business_slug(uuid, text) to authenticated;

comment on column public.businesses.slug is
  'URL-safe identifier used for the default AiFA-hosted landing page path (e.g. aifa.com/site/<slug>). Auto-generated from legal_name on insert; Owner-editable via update_business_slug() (settings:configure gated). Independent of the optional domains table (Sprint 65, now Operator-configured only) -- every business has a slug, only some request a custom domain.';
