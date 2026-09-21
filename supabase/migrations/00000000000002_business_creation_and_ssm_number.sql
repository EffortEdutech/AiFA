-- Business creation (Vol 13_4) + SSM registration number.
--
-- Closes the onboarding gap disclosed since before Phase 4 and restated
-- through Sprint 49: nothing let a new user create their own first
-- business. `businesses`/`business_memberships` (Vol 13_1 §2, §4) and
-- `invite_member`/`accept_membership_invitation` (Vol 13_1 §4/§6) already
-- fully support everything AFTER a business exists; only creation itself
-- was missing. See docs/architecture/v2.0/Series_13_Accounting_Compliance_
-- Operations/Vol_13_4_Business_Onboarding_And_Creation.md for the full
-- design and open items.
--
-- ssm_registration_number: a plain nullable text column, added alongside
-- create_business because both seed businesses this closes the gap for
-- (NHL Global Solution, Art Angkut Enterprise) are real SSM-registered
-- entities. No format validation is applied here — SSM registration
-- number formats vary by entity type (enterprise vs Sdn Bhd vs LLP) and
-- validating that is explicitly out of scope for this migration (Vol
-- 13_4 §4).

alter table public.businesses
  add column if not exists ssm_registration_number text;

-- id is deliberately the creating user's own auth.uid() (Vol 13_1 §2's
-- own design, unchanged here) -- one login owns at most one business,
-- by construction (businesses.id is a primary key referencing
-- auth.users(id)), matching Vol 13_1 §5's explicit multi-business-per-
-- owner-is-out-of-scope note. seed_chart_of_accounts_on_business_insert
-- (existing trigger, unchanged) fires on the insert below with zero
-- changes needed here.
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
begin
  if p_legal_name is null or btrim(p_legal_name) = '' then
    raise exception 'legal_name_required';
  end if;

  if exists (select 1 from public.businesses where id = auth.uid()) then
    raise exception 'business_already_exists_for_this_login';
  end if;

  insert into public.businesses (
    id, owner_user_id, legal_name, industry, ssm_registration_number, pka_version
  )
  values (
    auth.uid(), auth.uid(), btrim(p_legal_name), nullif(btrim(p_industry), ''),
    nullif(btrim(p_ssm_registration_number), ''), 'v2.0'
  )
  returning * into v_row;

  insert into public.business_memberships (
    business_id, user_id, role_id, status, invited_at, accepted_at
  ) values (
    auth.uid(), auth.uid(), v_owner_role_id, 'active', now(), now()
  );

  return v_row;
end;
$$;

grant execute on function public.create_business(text, text, text) to authenticated;
