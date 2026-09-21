-- One-off manual bootstrap for a test account that already signed up but
-- has no businesses/business_memberships row (see the disclosed gap: no
-- trigger or RPC creates these for a sign-up after Sprint 26's one-time
-- migration backfill -- see Claude's chat explanation for the full trace).
--
-- Targets the MOST RECENTLY CREATED auth user. If you have more than one
-- test account in this local database, replace the `select id into
-- v_user_id ...` line with:
--   select id into v_user_id from auth.users where email = 'you@example.com';

do $$
declare
  v_user_id uuid;
  v_owner_role_id constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  select id into v_user_id from auth.users order by created_at desc limit 1;

  if v_user_id is null then
    raise exception 'No auth.users row found -- sign up in the app first, then re-run this.';
  end if;

  insert into public.businesses (id, owner_user_id, legal_name, created_at)
  values (v_user_id, v_user_id, 'Test Business', now())
  on conflict (id) do nothing;

  insert into public.business_memberships (business_id, user_id, role_id, status, invited_at, accepted_at)
  values (v_user_id, v_user_id, v_owner_role_id, 'active', now(), now())
  on conflict do nothing;

  raise notice 'Bootstrapped business/membership for auth user %', v_user_id;
end $$;
