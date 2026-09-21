-- Member identity (Vol 13_1 §4 follow-on) — closes the gap disclosed in
-- web/src/lib/membership.ts's own header comment: once an invitation is
-- accepted, there is no RLS-readable source anywhere in this schema for
-- that member's name (business_memberships.invited_email is populated
-- only for a still-pending invite; public.profiles only lets a user read
-- their OWN row). The UI's fallback, describeMembership(), was printing
-- a bare "Member #xxxxxxxx" for any accepted, non-self member — not
-- usable as a spoken/written name for a voice- or text-driven assistant
-- to address someone by.
--
-- Two names are captured, deliberately kept separate:
--   - profiles.display_name — the member's OWN name, self-set via the
--     new set_my_display_name() RPC below, NOT a direct client-side
--     table write. profiles DOES carry "Users can view/update/insert
--     their own profile" RLS policies that would appear to cover this,
--     but table grants and RLS are independent layers in Postgres, and
--     00000000000001_grant_authenticated_select.sql only ever granted
--     `authenticated` plain SELECT on every table (deliberately, on the
--     documented assumption that every write goes through a SECURITY
--     DEFINER RPC) — a live check against this schema (Sprint 50)
--     confirmed a direct upsert fails closed with a bare Postgres
--     `permission denied for table profiles`, RLS never even reached.
--     set_my_display_name() keeps this consistent with every other
--     mutation in this schema instead of adding a one-off table grant.
--     No profiles row is auto-created on signup, so it upserts.
--   - business_memberships.owner_label — an optional per-business
--     override/nickname the Owner can set for any member (e.g. a role
--     label), independent of that member's own account name. Owner-only,
--     mutated only via set_member_label(), following this schema's
--     existing rule that every mutable table beyond the initial
--     migration-time backfill is written through a SECURITY DEFINER RPC,
--     never a bare client-side table write (see this file's own
--     precedent: invite_member/suspend_membership/remove_membership).
--
-- list_member_identities() is the read side: a SECURITY DEFINER RPC,
-- mirroring is_active_member()'s own gating pattern, that resolves every
-- member of a business to one display name — coalesce(owner_label,
-- profiles.display_name, invited_email-for-a-still-pending-invite) — so
-- a caller never has to re-derive that fallback chain client-side.

alter table public.profiles
  add column if not exists display_name text;

alter table public.business_memberships
  add column if not exists owner_label text;

-- ------------------------------------------------------------
-- set_member_label — Owner-only (configure on settings, same check
-- invite_member already uses), relabels one membership in this business.
-- Pass null/empty to clear back to the member's own name.
-- ------------------------------------------------------------
create or replace function public.set_member_label(
  p_membership_id uuid,
  p_label text
) returns public.business_memberships
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_target public.business_memberships;
  v_caller_membership record;
  v_can_configure boolean;
  v_row public.business_memberships;
begin
  select * into v_target from public.business_memberships where id = p_membership_id;
  if not found then
    raise exception 'membership_not_found: %', p_membership_id;
  end if;

  select bm.id as membership_id, bm.role_id as role_id into v_caller_membership
  from public.business_memberships bm
  where bm.business_id = v_target.business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if v_caller_membership.membership_id is null then
    raise exception 'no_active_membership_for_this_business';
  end if;

  select exists (
    select 1 from public.role_permissions rp
    where rp.role_id = v_caller_membership.role_id
      and rp.domain = 'settings' and rp.capability = 'configure'
  ) into v_can_configure;

  if not v_can_configure then
    raise exception 'not_authorized: requires configure on settings';
  end if;

  update public.business_memberships
  set owner_label = nullif(btrim(p_label), '')
  where id = p_membership_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.set_member_label(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- set_my_display_name — self-service only (auth.uid() is the target,
-- never a parameter, so there is no way to name anyone but yourself).
-- Upserts because no profiles row is auto-created on signup. Pass
-- null/empty to clear back to unset (list_member_identities then falls
-- through to owner_label or, for a pending invite, invited_email).
-- ------------------------------------------------------------
create or replace function public.set_my_display_name(
  p_display_name text
) returns public.profiles
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row public.profiles;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  insert into public.profiles (id, display_name)
  values (auth.uid(), nullif(btrim(p_display_name), ''))
  on conflict (id) do update set display_name = excluded.display_name
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.set_my_display_name(text) to authenticated;

-- ------------------------------------------------------------
-- list_member_identities — any active member of the business can resolve
-- every member's display name (same visibility RLS already grants on
-- business_memberships itself, Sprint 24's own "Active member of the
-- same business, not just their own row" policy) — this just adds the
-- one join (profiles) that plain RLS can't give a non-self caller.
-- ------------------------------------------------------------
create or replace function public.list_member_identities(
  p_business_id uuid
) returns table (
  membership_id uuid,
  display_name text
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    bm.id as membership_id,
    coalesce(
      nullif(btrim(bm.owner_label), ''),
      nullif(btrim(p.display_name), ''),
      case when bm.status = 'invited' then bm.invited_email end
    ) as display_name
  from public.business_memberships bm
  left join public.profiles p on p.id = bm.user_id
  where bm.business_id = p_business_id
    and public.is_active_member(p_business_id);
$$;

grant execute on function public.list_member_identities(uuid) to authenticated;
