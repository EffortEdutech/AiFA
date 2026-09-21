-- Sprint 65 -- Domain Binding
-- Implements Architecture.md §2.4 (docs/aifa-platform/Architecture.md).
--
-- domains: custom domain -> business_id binding + DNS TXT verification state.
-- Custom-domain-only for v1 (ontology's confirmed decision -- no aifa.my
-- fallback subdomain).

create table public.domains (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  domain text not null,
  verification_token text not null default ('aifa-verify=' || encode(gen_random_bytes(16), 'hex')),
  verification_status text not null default 'pending' check (verification_status in ('pending', 'verified')),
  ssl_status text not null default 'pending' check (ssl_status in ('pending', 'active', 'failed')),
  verified_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.domains is
  'Sprint 65 (Architecture §2.4) -- custom domain to business_id binding for the Public Surface. verification_token is the value the owner must publish as a DNS TXT record on their own domain to prove control; verification_status flips to verified only after a live DNS check confirms it (see verify-domain edge function). Custom-domain-only for v1 -- no aifa.my fallback subdomain, per the ontology''s confirmed decision.';

create index idx_domains_business_id on public.domains (business_id);
create unique index idx_domains_domain_lower on public.domains (lower(domain));

alter table public.domains enable row level security;

-- Members can view their own business's domain(s) -- same is_active_member()
-- gate every other business-scoped table in this schema uses.
create policy "Members can view their own business's domains"
  on public.domains
  for select
  using (is_active_member(business_id));

-- No direct INSERT/UPDATE/DELETE policy for any role -- writes go through
-- add_domain() (SECURITY DEFINER, settings:configure-gated) for inserts, and
-- the verify-domain edge function (service role, bypasses RLS) for the
-- verification-status flip -- same SECURITY DEFINER RPC / service-role-only
-- write convention this schema already uses for public_site_content and
-- publish_site_content().

create or replace function public.add_domain(
  p_business_id uuid,
  p_domain text
) returns public.domains
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_domain text;
  v_row public.domains;
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

  v_domain := lower(btrim(p_domain));
  v_domain := regexp_replace(v_domain, '^https?://', '');
  v_domain := regexp_replace(v_domain, '/$', '');

  if v_domain = '' then
    raise exception 'invalid_domain';
  end if;

  begin
    insert into public.domains (business_id, domain)
    values (p_business_id, v_domain)
    returning * into v_row;
  exception
    when unique_violation then
      raise exception 'domain_already_claimed';
  end;

  return v_row;
end;
$$;

grant execute on function public.add_domain(uuid, text) to authenticated;

-- Routing primitive for the Host-header resolution layer (Architecture
-- §2.4): "resolves the incoming Host header -> domains row -> business_id".
-- Callable by anon -- an incoming request has no auth at all -- but only
-- ever returns a business_id for a VERIFIED domain; a pending/unverified
-- domain resolves to nothing, so this cannot be used to probe unverified
-- ownership claims. The actual reverse-proxy/edge-routing wiring that calls
-- this on every request is Sprint 66's own scope (alongside the homepage
-- renderer it serves) -- this sprint ships and live-verifies the resolution
-- primitive itself.
create or replace function public.resolve_domain(p_domain text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select business_id
  from public.domains
  where lower(domain) = lower(btrim(p_domain))
    and verification_status = 'verified'
  limit 1;
$$;

grant execute on function public.resolve_domain(text) to anon, authenticated;
