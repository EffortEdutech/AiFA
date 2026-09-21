-- Sprint 63 — Workspace Resolution & Multi-Business-Per-Owner
-- Implements Architecture.md §2.2 (docs/aifa-platform/Architecture.md).
--
-- Replaces create_business (Vol 13_4) so a login can own more than one
-- Client Business:
--   - businesses.id is now a fresh, independently-generated UUID for every
--     NEW business (gen_random_uuid()), no longer forced to equal the
--     creating login's auth.uid().
--   - The single-business-per-login guard
--     (`business_already_exists_for_this_login`) is removed entirely —
--     the same login may call this RPC again for a second, third, ...
--     Client Business.
--   - owner_user_id still points at the creating login, and exactly one
--     Owner business_membership is still auto-created, unchanged.
--
-- Existing rows are NOT touched by this migration — every business that
-- exists today keeps its current id (which happens to already equal its
-- owner's auth.uid()). Only businesses created from this point forward
-- get a fresh id.
create or replace function public.create_business(
  p_legal_name text,
  p_industry text default null,
  p_ssm_registration_number text default null
) returns public.businesses
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row public.businesses;
  v_owner_role_id constant uuid := '00000000-0000-0000-0000-000000000001';
  v_new_business_id uuid := gen_random_uuid();
begin
  if p_legal_name is null or btrim(p_legal_name) = '' then
    raise exception 'legal_name_required';
  end if;

  insert into public.businesses (
    id, owner_user_id, legal_name, industry, ssm_registration_number, pka_version
  )
  values (
    v_new_business_id, auth.uid(), btrim(p_legal_name), nullif(btrim(p_industry), ''),
    nullif(btrim(p_ssm_registration_number), ''), 'v2.0'
  )
  returning * into v_row;

  insert into public.business_memberships (
    business_id, user_id, role_id, status, invited_at, accepted_at
  ) values (
    v_new_business_id, auth.uid(), v_owner_role_id, 'active', now(), now()
  );

  return v_row;
end;
$$;

grant execute on function public.create_business(text, text, text) to authenticated;

-- New: list every Client Business the calling login has an ACTIVE
-- business_membership in, for Sprint 63's Workspace Resolution
-- (Architecture §2.1). SECURITY DEFINER, same is_active_member() gating
-- pattern already used elsewhere in this schema, so it needs no new RLS
-- policy and cannot leak another login's memberships (auth.uid() only).
create or replace function public.list_my_businesses()
returns table (
  business_id uuid,
  legal_name text,
  role_id uuid,
  membership_status text
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select b.id, b.legal_name, bm.role_id, bm.status
  from public.business_memberships bm
  join public.businesses b on b.id = bm.business_id
  where bm.user_id = auth.uid()
    and bm.status = 'active'
  order by bm.invited_at asc;
$$;

grant execute on function public.list_my_businesses() to authenticated;
