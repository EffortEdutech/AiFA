-- ============================================================
-- Sprint 24 — Team Membership Lifecycle & Growth-Adaptive Access Model
-- (Vol 13_1 §4 Membership; Vol 13_3 full — Growth-Adaptive Access Model)
--
-- Additive + one schema correction to Sprint 23's business_memberships
-- (Section 1 below), applied before the lifecycle RPCs that depend on
-- it. Builds on Sprint 23's businesses/permissions/roles/role_permissions/
-- business_memberships/devices/active_device_lock, already live.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Schema correction: business_memberships must support inviting
-- someone who does not have a Supabase auth account YET (Vol 13_1 §4's
-- "the invited person's login" assumed one already exists; Sprint 24's
-- own Task Breakdown — "Invitation creation... an email link or in-app
-- code is enough" — makes clear the invite has to work before that's
-- true). user_id becomes nullable; invited_email carries the invite
-- until the invitee signs up (if needed) and accepts, at which point
-- user_id is filled in and invited_email is kept as a historical record,
-- not cleared.
--
-- Owner decision (3 September 2026): a person may hold at most ONE
-- live (invited/active/suspended) membership across ALL businesses, not
-- just within one — chosen specifically because Sprint 23's device-lock
-- RPCs (register_device, request_activation, request_primary_takeover,
-- set_primary_device, touch_device_heartbeat, revoke_device) already
-- resolve "the caller's own active membership" with a plain
-- `limit 1`, which silently picks an arbitrary one of several if a
-- person ever held more than one — this constraint is what keeps that
-- resolution correct, not just usually correct. A freelance bookkeeper
-- serving several client businesses is a real, deliberately out-of-scope
-- case for now (one login per business they work for), not an oversight.
-- ------------------------------------------------------------
alter table public.business_memberships
  alter column user_id drop not null;

alter table public.business_memberships
  add column if not exists invited_email text;

alter table public.business_memberships
  add constraint business_memberships_shape_check
  check (
    (status = 'invited' and user_id is null and invited_email is not null)
    or (status in ('active', 'suspended', 'removed') and user_id is not null)
  );

-- Replaces Sprint 23's business_memberships_one_live_per_person
-- (business_id, user_id) — that was already the right SHAPE of
-- guarantee, just scoped one business too narrowly for the "one login,
-- one business" decision above. A single global partial-unique index on
-- user_id (ignoring the now-possible null rows, which Postgres unique
-- indexes never compare as equal to each other) is the whole
-- enforcement: at most one live membership row per person, anywhere.
drop index if exists business_memberships_one_live_per_person;
create unique index if not exists business_memberships_one_live_globally
  on public.business_memberships (user_id)
  where status in ('invited', 'active', 'suspended');

-- The email-side half of the same guarantee, for the window before an
-- invited person has signed up (user_id still null): the same email
-- cannot be invited to two different pending invitations at once. Case-
-- folded so "Bookkeeper@x.com" and "bookkeeper@x.com" are treated as the
-- one invitation they actually are.
create unique index if not exists business_memberships_one_pending_invite_per_email
  on public.business_memberships (lower(invited_email))
  where status = 'invited' and user_id is null;

-- ------------------------------------------------------------
-- 2. Vol 13_3 §2 — access_model_override on businesses, and the
-- computed (never stored) effective_access_model.
-- ------------------------------------------------------------
alter table public.businesses
  add column if not exists access_model_override text
  check (access_model_override in ('forced_solo', 'forced_team'));

-- Returns exactly 'solo' or 'team', always — Vol 13_3 §2 defines
-- effective_access_model as one of those two values; access_model_override
-- is the MECHANISM that forces which one, not a third possible return
-- value. (Caught by this sprint's own verification: an override value
-- of 'forced_team' was originally returned verbatim, which broke the
-- transition log's solo/team check constraint the first time an
-- override was set — fixed here by normalizing forced_solo -> 'solo'
-- and forced_team -> 'team' before returning.)
create or replace function public.effective_access_model(p_business_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when (select access_model_override from public.businesses where id = p_business_id) = 'forced_solo' then 'solo'
    when (select access_model_override from public.businesses where id = p_business_id) = 'forced_team' then 'team'
    when (
      select count(*) from public.business_memberships
      where business_id = p_business_id and status = 'active'
    ) > 1
    then 'team'
    else 'solo'
  end
$$;

grant execute on function public.effective_access_model(uuid) to authenticated;

-- ------------------------------------------------------------
-- 3. Vol 13_3 §9 — the access-model transition log. This is Sprint 24's
-- concrete answer to its own Task Breakdown's "SegregationOfDutiesPolicy
-- seeding (owned by Sprint 25, stubbed here) has a hook to fire at this
-- exact moment": an append-only record of every solo<->team transition,
-- written by the lifecycle RPCs below whenever effective_access_model
-- actually changes. Sprint 25 can seed SoD policy the first time a
-- 'team' row appears for a business, rather than this sprint inventing
-- a fake no-op stub function that would just be deleted and replaced
-- once Sprint 25 exists — a real, queryable table is more honest and no
-- more work.
-- ------------------------------------------------------------
create table if not exists public.business_access_model_transitions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  transitioned_to text not null check (transitioned_to in ('solo', 'team')),
  trigger_reason text not null check (trigger_reason in (
    'membership_accepted', 'membership_removed', 'override_set', 'override_cleared'
  )),
  occurred_at timestamptz not null default now()
);

create index if not exists idx_access_model_transitions_business
  on public.business_access_model_transitions (business_id, occurred_at);

alter table public.business_access_model_transitions enable row level security;

create policy "Active members can view their business's access model history"
  on public.business_access_model_transitions for select
  using (public.is_active_member(business_id));

-- Records a transition row only when effective_access_model actually
-- changed as a result of the caller's action — never logs a no-op (e.g.
-- accepting a 3rd, 4th, ... membership when already 'team').
create or replace function public.record_access_model_transition_if_changed(
  p_business_id uuid,
  p_before text,
  p_trigger_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_after text;
begin
  v_after := public.effective_access_model(p_business_id);
  if v_after is distinct from p_before then
    insert into public.business_access_model_transitions (business_id, transitioned_to, trigger_reason)
    values (p_business_id, v_after, p_trigger_reason);
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 4. set_access_model_override (Vol 13_3 §7) — forced_solo/forced_team/
-- clear-to-auto, `configure` on `settings`-gated (Vol 13_1 §3), same
-- authorization pattern revoke_device (Sprint 23) already established
-- for a business-wide administrative action.
-- ------------------------------------------------------------
create or replace function public.set_access_model_override(
  p_business_id uuid,
  p_override text
) returns public.businesses
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_membership record;
  v_can_configure boolean;
  v_before text;
  v_row public.businesses;
begin
  if p_override is not null and p_override not in ('forced_solo', 'forced_team') then
    raise exception 'invalid_override_value: must be forced_solo, forced_team, or null';
  end if;

  select bm.id as membership_id, bm.role_id as role_id into v_membership
  from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if v_membership.membership_id is null then
    raise exception 'no_active_membership_for_this_business';
  end if;

  select exists (
    select 1 from public.role_permissions rp
    where rp.role_id = v_membership.role_id
      and rp.domain = 'settings' and rp.capability = 'configure'
  ) into v_can_configure;

  if not v_can_configure then
    raise exception 'not_authorized: requires configure on settings';
  end if;

  v_before := public.effective_access_model(p_business_id);

  update public.businesses
  set access_model_override = p_override
  where id = p_business_id
  returning * into v_row;

  perform public.record_access_model_transition_if_changed(
    p_business_id, v_before,
    case when p_override is null then 'override_cleared' else 'override_set' end
  );

  return v_row;
end;
$$;

grant execute on function public.set_access_model_override(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 5. invite_member (Vol 13_1 §4, Vol 13_3 §4 — "role already assigned
-- at invite time, not deferred"). `configure` on `settings`-gated, same
-- pattern as Section 4 above.
--
-- If the email already belongs to a registered auth user, this checks
-- up front whether that user already holds a live membership elsewhere
-- and rejects clearly rather than letting them discover it only at
-- accept time (Section 1's one-login-one-business decision) — a real,
-- disclosed limitation of that check: if the invitee has NOT signed up
-- yet, this sprint cannot look ahead, so that case is only caught when
-- they actually try to accept (Section 6), by the same unique index,
-- with the same clear error.
-- ------------------------------------------------------------
create or replace function public.invite_member(
  p_business_id uuid,
  p_invited_email text,
  p_role_id uuid
) returns public.business_memberships
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_membership record;
  v_can_configure boolean;
  v_normalized_email text := lower(btrim(p_invited_email));
  v_existing_user_id uuid;
  v_row public.business_memberships;
begin
  if v_normalized_email is null or v_normalized_email = '' or v_normalized_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email';
  end if;

  select bm.id as membership_id, bm.role_id as role_id into v_membership
  from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if v_membership.membership_id is null then
    raise exception 'no_active_membership_for_this_business';
  end if;

  select exists (
    select 1 from public.role_permissions rp
    where rp.role_id = v_membership.role_id
      and rp.domain = 'settings' and rp.capability = 'configure'
  ) into v_can_configure;

  if not v_can_configure then
    raise exception 'not_authorized: requires configure on settings';
  end if;

  if not exists (
    select 1 from public.roles r
    where r.id = p_role_id and (r.business_id is null or r.business_id = p_business_id)
  ) then
    raise exception 'role_not_available_to_this_business';
  end if;

  select id into v_existing_user_id from auth.users where lower(email) = v_normalized_email;

  if v_existing_user_id is not null and exists (
    select 1 from public.business_memberships
    where user_id = v_existing_user_id and status in ('invited', 'active', 'suspended')
  ) then
    raise exception 'invitee_already_has_a_live_membership_elsewhere';
  end if;

  insert into public.business_memberships (
    business_id, user_id, role_id, invited_email, status,
    invited_by_membership_id, invited_at
  ) values (
    p_business_id, null, p_role_id, v_normalized_email, 'invited',
    v_membership.membership_id, now()
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.invite_member(uuid, text, uuid) to authenticated;

-- ------------------------------------------------------------
-- 6. accept_membership_invitation (Vol 13_1 §4, Vol 13_3 §4 — the
-- growth trigger fires here, "not at invitation, at acceptance"). The
-- caller must already be authenticated as the invited person; their own
-- auth.users.email is matched against the pending invite's
-- invited_email, so no separate invitation token/secret is needed for
-- this minimal-viable channel (Sprint 24's own Task Breakdown: "an
-- email link or in-app code is enough, polish is out of scope") — the
-- email link this sprint anticipates simply directs the invitee to sign
-- in/sign up with that exact email, then call this.
-- ------------------------------------------------------------
create or replace function public.accept_membership_invitation(
  p_business_id uuid
) returns public.business_memberships
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller_email text;
  v_before text;
  v_row public.business_memberships;
begin
  select email into v_caller_email from auth.users where id = auth.uid();
  if v_caller_email is null then
    raise exception 'not_authenticated';
  end if;

  v_before := public.effective_access_model(p_business_id);

  update public.business_memberships
  set user_id = auth.uid(),
      status = 'active',
      accepted_at = now()
  where business_id = p_business_id
    and status = 'invited'
    and user_id is null
    and lower(invited_email) = lower(v_caller_email)
  returning * into v_row;

  if not found then
    raise exception 'no_matching_pending_invitation';
  end if;

  perform public.record_access_model_transition_if_changed(
    p_business_id, v_before, 'membership_accepted'
  );

  return v_row;
end;
$$;

grant execute on function public.accept_membership_invitation(uuid) to authenticated;

-- ------------------------------------------------------------
-- 7. suspend_membership / remove_membership (Vol 13_1 §4). Sole-Owner
-- guard is enforced twice, deliberately: the trigger from Sprint 23
-- (`enforce_sole_owner_membership`) is the DB-level backstop that can
-- never be bypassed, and the explicit checks below give a clear,
-- operation-level error BEFORE that trigger would even fire — Sprint
-- 24's own Objectives line asks for exactly this ("enforced here at the
-- operation level, not just the constraint level").
--
-- remove_membership also does the device cleanup Sprint 23 flagged as
-- its own known gap: it revokes every one of the removed membership's
-- devices directly (never calling revoke_device, whose replacement-
-- device requirement is specifically wrong here — there is no
-- replacement, the whole membership is leaving) and deletes that
-- membership's active_device_lock row outright, rather than leaving it
-- pointing at a now-revoked device.
-- ------------------------------------------------------------
create or replace function public.suspend_membership(
  p_target_membership_id uuid
) returns public.business_memberships
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller record;
  v_can_configure boolean;
  v_target record;
  v_owner_role_id constant uuid := '00000000-0000-0000-0000-000000000001';
  v_remaining_active_owners integer;
  v_row public.business_memberships;
begin
  select bm.id as membership_id, bm.business_id as business_id, bm.role_id as role_id into v_caller
  from public.business_memberships bm
  where bm.user_id = auth.uid() and bm.status = 'active';

  if v_caller.membership_id is null then
    raise exception 'no_active_membership';
  end if;

  select id, business_id, role_id into v_target
  from public.business_memberships
  where id = p_target_membership_id;

  if v_target.id is null or v_target.business_id <> v_caller.business_id then
    raise exception 'membership_not_found_in_your_business';
  end if;

  select exists (
    select 1 from public.role_permissions rp
    where rp.role_id = v_caller.role_id and rp.domain = 'settings' and rp.capability = 'configure'
  ) into v_can_configure;

  if not v_can_configure and v_target.id <> v_caller.membership_id then
    raise exception 'not_authorized: requires configure on settings to suspend another member';
  end if;

  if v_target.role_id = v_owner_role_id then
    select count(*) into v_remaining_active_owners
    from public.business_memberships
    where business_id = v_target.business_id and status = 'active'
      and role_id = v_owner_role_id and id <> v_target.id;
    if v_remaining_active_owners = 0 then
      raise exception 'cannot_suspend_sole_owner';
    end if;
  end if;

  update public.business_memberships
  set status = 'suspended'
  where id = p_target_membership_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.suspend_membership(uuid) to authenticated;

create or replace function public.remove_membership(
  p_target_membership_id uuid
) returns public.business_memberships
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller record;
  v_can_configure boolean;
  v_target record;
  v_owner_role_id constant uuid := '00000000-0000-0000-0000-000000000001';
  v_remaining_active_owners integer;
  v_before text;
  v_row public.business_memberships;
begin
  select bm.id as membership_id, bm.business_id as business_id, bm.role_id as role_id into v_caller
  from public.business_memberships bm
  where bm.user_id = auth.uid() and bm.status = 'active';

  if v_caller.membership_id is null then
    raise exception 'no_active_membership';
  end if;

  select id, business_id, role_id, status into v_target
  from public.business_memberships
  where id = p_target_membership_id;

  if v_target.id is null or v_target.business_id <> v_caller.business_id then
    raise exception 'membership_not_found_in_your_business';
  end if;

  select exists (
    select 1 from public.role_permissions rp
    where rp.role_id = v_caller.role_id and rp.domain = 'settings' and rp.capability = 'configure'
  ) into v_can_configure;

  -- Unlike suspend, removal of one's own membership is never
  -- self-service here (leaving a business is a real, disclosed gap this
  -- sprint does not build — Vol 13_1 does not describe a self-removal
  -- flow, only an Owner/configure-gated administrative one).
  if not v_can_configure then
    raise exception 'not_authorized: requires configure on settings';
  end if;

  if v_target.role_id = v_owner_role_id and v_target.status = 'active' then
    select count(*) into v_remaining_active_owners
    from public.business_memberships
    where business_id = v_target.business_id and status = 'active'
      and role_id = v_owner_role_id and id <> v_target.id;
    if v_remaining_active_owners = 0 then
      raise exception 'cannot_remove_sole_owner';
    end if;
  end if;

  v_before := public.effective_access_model(v_target.business_id);

  update public.business_memberships
  set status = 'removed', removed_at = now()
  where id = p_target_membership_id
  returning * into v_row;

  -- Device cleanup (Sprint 23's flagged gap, closed here): revoke every
  -- device this membership held, and drop its active_device_lock row
  -- entirely rather than leaving it pointing at a revoked device or
  -- forcing a replacement that cannot exist.
  update public.devices
  set revoked_at = now()
  where business_membership_id = p_target_membership_id and revoked_at is null;

  delete from public.active_device_lock
  where business_membership_id = p_target_membership_id;

  perform public.record_access_model_transition_if_changed(
    v_target.business_id, v_before, 'membership_removed'
  );

  return v_row;
end;
$$;

grant execute on function public.remove_membership(uuid) to authenticated;

-- ============================================================
-- End of Sprint 24 migration.
-- ============================================================
