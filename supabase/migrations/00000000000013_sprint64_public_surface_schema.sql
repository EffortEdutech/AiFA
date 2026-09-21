-- Sprint 64 -- Public Surface Schema & Publish Pipeline
-- Implements Architecture.md §2.3 / §4 (docs/aifa-platform/Architecture.md).
--
-- Two new tables, deliberately NOT end-to-end encrypted (Architecture
-- §2.3's own fork from the local-first encryption model): plaintext by
-- design, because their content only ever exists here because an Owner
-- explicitly chose to publish or send it.
--
-- public_site_content: one row per Client Business, the Public Site
-- homepage content an Owner edits from Business Settings > Website and
-- publishes with one click. Publicly readable by design (no auth, no
-- DEK) -- Sprint 66 renders it on the bound custom domain.
--
-- public_documents: schema only this sprint (populated starting Sprint
-- 67's publish-on-send flow) -- migrated now per Sprint_Plan.md's own
-- Sprint 64 scope so Sprint 67 does not need a further schema change.

create table public.public_site_content (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  hero_headline text,
  hero_subtext text,
  services jsonb not null default '[]'::jsonb,
  contact_email text,
  contact_phone text,
  accent_color text,
  published_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.public_site_content is
  'Sprint 64 (Architecture §2.3) -- Public Site homepage content per Client Business. Deliberately plaintext: written only via publish_site_content(), never decrypted server-side because it was never encrypted -- the Owner chose to make it public.';

alter table public.public_site_content enable row level security;

-- Publicly readable by design -- this is the whole point of a Public
-- Surface table (Architecture §2.3): a browser with no DEK must be able
-- to read it directly, same as any other public marketing page.
create policy "Anyone can read published site content"
  on public.public_site_content
  for select
  using (true);

-- No direct INSERT/UPDATE/DELETE policy for any role -- every write goes
-- through publish_site_content() (SECURITY DEFINER), which enforces the
-- settings:configure gate below. This matches this schema's own
-- established convention (membership.ts's header: "every write path...
-- goes through a SECURITY DEFINER RPC").

create table public.public_documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  doc_type text not null check (doc_type in ('invoice', 'quotation', 'e_signature')),
  source_id uuid,
  access_token text not null unique,
  status text not null default 'sent',
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.public_documents is
  'Sprint 64 (Architecture §2.3/§4) -- schema only this sprint. Populated starting Sprint 67''s publish-on-send flow: a point-in-time plaintext snapshot of one invoice/quotation/e-signature document, created when an Owner''s device sends it to an External Party. access_token is the no-login pay/sign/track link''s only credential -- long, random, single-purpose per Architecture §5.';

create index idx_public_documents_business_id on public.public_documents (business_id);

alter table public.public_documents enable row level security;

-- Sprint 64 scope is schema-only for this table -- no anon read policy
-- yet. The actual no-login read path (by access_token, never by
-- business_id) is Sprint 67's own RPC, added alongside the code that
-- populates this table. A business's own active members can already see
-- their own documents via the same is_active_member() gate every other
-- business-scoped table in this schema uses.
create policy "Members can view their own business's public documents"
  on public.public_documents
  for select
  using (is_active_member(business_id));

-- Publish RPC: Owner's device decrypts the real, encrypted Business
-- Settings locally as always, then calls this with plaintext content.
-- Nothing here is decrypted server-side -- it is written in plaintext
-- because the Owner chose to make it public (Architecture §2.3).
create or replace function public.publish_site_content(
  p_business_id uuid,
  p_hero_headline text,
  p_hero_subtext text,
  p_services jsonb,
  p_contact_email text,
  p_contact_phone text,
  p_accent_color text
) returns public.public_site_content
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row public.public_site_content;
begin
  if not is_active_member(p_business_id) then
    raise exception 'not_a_member_of_this_business';
  end if;

  -- Same settings:configure gate BusinessSettingsPage.tsx already applies
  -- client-side (getGrantedCapabilitiesForDomain) -- enforced here too,
  -- server-side, since this RPC is a public write surface. The Owner
  -- system role is granted every domain/capability at the data level, so
  -- solo Owners are never blocked by this check.
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

  insert into public.public_site_content (
    business_id, hero_headline, hero_subtext, services,
    contact_email, contact_phone, accent_color, published_at, updated_at
  )
  values (
    p_business_id, nullif(btrim(p_hero_headline), ''), nullif(btrim(p_hero_subtext), ''),
    coalesce(p_services, '[]'::jsonb), nullif(btrim(p_contact_email), ''),
    nullif(btrim(p_contact_phone), ''), nullif(btrim(p_accent_color), ''), now(), now()
  )
  on conflict (business_id) do update set
    hero_headline = excluded.hero_headline,
    hero_subtext = excluded.hero_subtext,
    services = excluded.services,
    contact_email = excluded.contact_email,
    contact_phone = excluded.contact_phone,
    accent_color = excluded.accent_color,
    published_at = now(),
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.publish_site_content(uuid, text, text, jsonb, text, text, text) to authenticated;
