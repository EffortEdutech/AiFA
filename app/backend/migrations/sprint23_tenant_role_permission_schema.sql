-- ============================================================
-- Sprint 23 — Tenant, Role & Permission Schema + RLS Redesign
-- (Vol 13_1 §2 Tenant Model, §3 Permission Catalog, §4 Roles & Membership,
--  §10 RLS Conceptual Redesign; Vol 12_1 §5b Team-Mode Write-Lock Amendment)
--
-- Additive + migrating. Does not drop or rename any existing table.
-- `public.profiles` and `public.backups` are NOT touched by this
-- migration — both are keyed by a person's own auth.uid() (their own
-- account profile, their own backup pointer rows), which is already
-- correct under multi-role and needs no membership-lookup rewrite. The
-- original Sprint 23 plan listed them alongside sync_envelopes/devices/
-- active_device_lock for migration; on inspection this sprint found
-- that was not accurate, and records the correction here rather than
-- doing an unneeded change for the sake of matching the plan literally.
--
-- Everything that IS business-shared (sync_envelopes, devices,
-- active_device_lock) migrates from `auth.uid() = business_id` to a
-- membership-lookup check per Vol 13_1 §10.
--
-- Ordering matters below: businesses -> permissions -> roles ->
-- role_permissions -> business_memberships (backfill) -> RLS migration
-- -> active_device_lock/devices re-scoping (Vol 12_1 §5b).
-- ============================================================

-- ------------------------------------------------------------
-- 1. public.businesses (Vol 13_1 §2)
--
-- id is NOT a fresh surrogate key: for every business that already
-- exists, id keeps the exact same uuid value the owner's auth.uid()
-- already used as business_id everywhere in this schema (Sprint 14's
-- comment: "business_id here IS the signed-in Supabase user's
-- auth.uid()"). This is what makes the migration additive rather than
-- a data rewrite — every existing foreign key to "business_id" already
-- points at a valid businesses.id the moment this table is backfilled
-- (Section 4 below), with zero value changes required anywhere else.
-- owner_user_id is stored explicitly (not just implied by id) because
-- Section 2's own model treats "the tenant" and "who owns it" as
-- conceptually distinct facts, even though they hold the same value for
-- every business today.
-- ------------------------------------------------------------
create table if not exists public.businesses (
  id uuid primary key references auth.users (id) on delete cascade,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  legal_name text,
  industry text,
  pka_version text,
  created_at timestamptz not null default now()
);

alter table public.businesses enable row level security;

-- Visibility follows membership, defined below once business_memberships
-- exists (see Section 6). No policy is created here yet — businesses
-- has zero readable rows until that policy is added, which is fine
-- since nothing queries it directly before Section 6 runs in the same
-- migration.

-- ------------------------------------------------------------
-- 2. public.permissions (Vol 13_1 §3) — fixed catalog, 11 domains x 4
-- capabilities = 44 rows, seeded once, never owner-editable. Roles grant
-- a subset of these; nothing ever inserts a permission outside this
-- seed list.
-- ------------------------------------------------------------
create table if not exists public.permissions (
  domain text not null check (domain in (
    'sales', 'pricing', 'expense', 'inventory', 'accounting_reports',
    'tax_compliance', 'payroll', 'hr_attendance_leave', 'commission',
    'legal_contract', 'settings'
  )),
  capability text not null check (capability in (
    'view', 'capture', 'approve', 'configure'
  )),
  primary key (domain, capability)
);

insert into public.permissions (domain, capability)
select d.domain, c.capability
from unnest(array[
  'sales', 'pricing', 'expense', 'inventory', 'accounting_reports',
  'tax_compliance', 'payroll', 'hr_attendance_leave', 'commission',
  'legal_contract', 'settings'
]) as d(domain)
cross join unnest(array['view', 'capture', 'approve', 'configure']) as c(capability)
on conflict (domain, capability) do nothing;

alter table public.permissions enable row level security;

-- Permissions are the same fixed catalog for every business — readable
-- by any authenticated user, not business-scoped (there is nothing
-- business-specific in "does the 'sales' + 'approve' combination
-- exist," only in which role grants it).
create policy "Any authenticated user can view the fixed permission catalog"
  on public.permissions for select
  using (auth.role() = 'authenticated');

-- ------------------------------------------------------------
-- 3. public.roles (Vol 13_1 §4) — six system templates (business_id
-- null) seeded below, plus room for a business's own cloned/customised
-- roles (business_id not null) from a later sprint's UI. Template rows
-- are never edited in place; a business clones one into its own row
-- instead (Vol 13_1 §4.1's own statement — enforced by convention here,
-- not yet by a DB trigger, since no clone flow exists until a later
-- sprint builds it).
--
-- default_approval_limit_myr is Section 6.1's role-default approval
-- limit (e.g. the Approver/Supervisor template's RM 2,000 example) — a
-- BusinessMembership row (Section 5) may override this per member;
-- null here means "no default cap," not "zero."
-- ------------------------------------------------------------
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  -- Note: the six system templates seeded in Section 5 below use fixed,
  -- well-known uuids (not gen_random_uuid()) specifically so that
  -- business_memberships_one_active_owner's partial index (Section 6)
  -- can reference the Owner template's id as a literal constant —
  -- Postgres partial-index predicates cannot contain a subquery, so a
  -- dynamic "look up the Owner role's id" predicate is not possible.
  business_id uuid references public.businesses (id) on delete cascade,
  name text not null,
  is_system_template boolean not null default false,
  description text,
  default_approval_limit_myr numeric(14, 2),
  created_at timestamptz not null default now()
);

-- Template names are unique among templates (business_id is null);
-- a business's own custom role names only need to be unique within
-- that business, not globally.
create unique index if not exists roles_unique_template_name
  on public.roles (name)
  where business_id is null;

create unique index if not exists roles_unique_business_role_name
  on public.roles (business_id, name)
  where business_id is not null;

alter table public.roles enable row level security;

create policy "Any authenticated user can view system role templates"
  on public.roles for select
  using (business_id is null);

-- ------------------------------------------------------------
-- 4. public.role_permissions (Vol 13_1 §4) — join table, a role's
-- actual granted access.
-- ------------------------------------------------------------
create table if not exists public.role_permissions (
  role_id uuid not null references public.roles (id) on delete cascade,
  domain text not null,
  capability text not null,
  primary key (role_id, domain, capability),
  foreign key (domain, capability) references public.permissions (domain, capability)
);

alter table public.role_permissions enable row level security;

create policy "Any authenticated user can view template role_permissions"
  on public.role_permissions for select
  using (
    exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.business_id is null
    )
    -- Custom-role visibility (business_id is not null) is added once
    -- business_memberships exists — see the combined policy in Section 6.
  );

-- ------------------------------------------------------------
-- 5. Seed the six system role templates + their permission grants
-- (Vol 13_1 §4.1's table, verbatim).
-- ------------------------------------------------------------
insert into public.roles (id, name, business_id, is_system_template, description, default_approval_limit_myr)
values
  ('00000000-0000-0000-0000-000000000001', 'Owner', null, true, 'All domains, all capabilities, always, non-revocable, unlimited approval.', null),
  ('00000000-0000-0000-0000-000000000002', 'Bookkeeper / Accountant', null, true, 'Full accounting_reports control; view+approve on sales/expense/inventory/pricing; full tax_compliance except configure; payroll view only (Vol 6_7 §5 sensitivity).', null),
  ('00000000-0000-0000-0000-000000000003', 'Sales Agent', null, true, 'Capture on sales/pricing; view own commission records; nothing else.', null),
  ('00000000-0000-0000-0000-000000000004', 'Warehouse Staff', null, true, 'Capture on inventory; view on sales (linked Delivery Orders); nothing else.', null),
  ('00000000-0000-0000-0000-000000000005', 'Payroll Admin', null, true, 'Full control of payroll and hr_attendance_leave; nothing else.', null),
  ('00000000-0000-0000-0000-000000000006', 'Approver (Supervisor)', null, true, 'Approve only on expense/sales, role-default approval limit; no capture/configure.', 2000.00)
on conflict (id) do nothing;

-- Owner: every domain, every capability.
insert into public.role_permissions (role_id, domain, capability)
select r.id, p.domain, p.capability
from public.roles r
cross join public.permissions p
where r.name = 'Owner' and r.business_id is null
on conflict do nothing;

-- Bookkeeper / Accountant.
insert into public.role_permissions (role_id, domain, capability)
select r.id, v.domain, v.capability
from public.roles r
cross join (values
  ('accounting_reports', 'view'), ('accounting_reports', 'configure'),
  ('sales', 'view'), ('sales', 'approve'),
  ('expense', 'view'), ('expense', 'approve'),
  ('inventory', 'view'), ('inventory', 'approve'),
  ('pricing', 'view'), ('pricing', 'approve'),
  ('tax_compliance', 'view'), ('tax_compliance', 'capture'), ('tax_compliance', 'approve'),
  ('payroll', 'view')
) as v(domain, capability)
where r.name = 'Bookkeeper / Accountant' and r.business_id is null
on conflict do nothing;

-- Sales Agent.
insert into public.role_permissions (role_id, domain, capability)
select r.id, v.domain, v.capability
from public.roles r
cross join (values
  ('sales', 'view'), ('sales', 'capture'),
  ('pricing', 'view'), ('pricing', 'capture'),
  ('commission', 'view')
) as v(domain, capability)
where r.name = 'Sales Agent' and r.business_id is null
on conflict do nothing;

-- Warehouse Staff.
insert into public.role_permissions (role_id, domain, capability)
select r.id, v.domain, v.capability
from public.roles r
cross join (values
  ('inventory', 'view'), ('inventory', 'capture'),
  ('sales', 'view')
) as v(domain, capability)
where r.name = 'Warehouse Staff' and r.business_id is null
on conflict do nothing;

-- Payroll Admin.
insert into public.role_permissions (role_id, domain, capability)
select r.id, v.domain, v.capability
from public.roles r
cross join (values
  ('payroll', 'view'), ('payroll', 'capture'), ('payroll', 'approve'), ('payroll', 'configure'),
  ('hr_attendance_leave', 'view'), ('hr_attendance_leave', 'capture'),
  ('hr_attendance_leave', 'approve'), ('hr_attendance_leave', 'configure')
) as v(domain, capability)
where r.name = 'Payroll Admin' and r.business_id is null
on conflict do nothing;

-- Approver (Supervisor).
insert into public.role_permissions (role_id, domain, capability)
select r.id, v.domain, v.capability
from public.roles r
cross join (values
  ('expense', 'approve'),
  ('sales', 'approve')
) as v(domain, capability)
where r.name = 'Approver (Supervisor)' and r.business_id is null
on conflict do nothing;

-- ------------------------------------------------------------
-- 6. public.business_memberships (Vol 13_1 §4)
--
-- party_id (Vol 13_0 §3.1's Party record) has no FK constraint yet —
-- Party does not exist as a table until its own future module sprint
-- builds it; the column is included now so that sprint does not need a
-- second migration of this table just to add it.
-- ------------------------------------------------------------
create table if not exists public.business_memberships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role_id uuid not null references public.roles (id),
  party_id uuid,
  approval_limit_myr numeric(14, 2),
  status text not null check (status in ('invited', 'active', 'suspended', 'removed')),
  invited_by_membership_id uuid references public.business_memberships (id),
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  removed_at timestamptz
);

-- A person's login is scoped to at most one *active or invited*
-- membership per business (re-inviting an already-removed member
-- creates a new row rather than resurrecting the old one, preserving
-- the old row's history) — prevents duplicate concurrent memberships
-- for the same (business, person) pair.
create unique index if not exists business_memberships_one_live_per_person
  on public.business_memberships (business_id, user_id)
  where status in ('invited', 'active', 'suspended');

-- Enforced correctness invariant (mirrors devices_one_primary_per_business,
-- Sprint 15): at most one ACTIVE Owner-role membership per business at
-- the DB level. This alone does not prevent removing the sole Owner
-- (see the trigger below for that half of the guarantee).
create unique index if not exists business_memberships_one_active_owner
  on public.business_memberships (business_id)
  where status = 'active' and role_id = '00000000-0000-0000-0000-000000000001';

create index if not exists idx_business_memberships_business_active
  on public.business_memberships (business_id)
  where status = 'active';

create index if not exists idx_business_memberships_user_active
  on public.business_memberships (user_id)
  where status = 'active';

-- Sole-Owner-never-removable guarantee, the half a unique index cannot
-- express on its own: block any update that would leave a business
-- with zero active Owner memberships. Sprint 24 also enforces this at
-- the operation/UX level (a clear error before the update is even
-- attempted) — this trigger is the DB-level backstop, the same
-- belt-and-braces relationship devices_one_primary_per_business has to
-- the RPCs that manage it.
create or replace function public.enforce_sole_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Fixed, well-known id for the Owner system template — same constant
  -- Section 5's seed and Section 6's business_memberships_one_active_owner
  -- partial index use, so all three stay trivially in agreement.
  v_owner_role_id constant uuid := '00000000-0000-0000-0000-000000000001';
  v_remaining_active_owners integer;
begin
  if old.role_id = v_owner_role_id and old.status = 'active'
     and (new.status <> 'active' or new.role_id <> v_owner_role_id) then
    select count(*) into v_remaining_active_owners
    from public.business_memberships
    where business_id = old.business_id
      and status = 'active'
      and role_id = v_owner_role_id
      and id <> old.id;

    if v_remaining_active_owners = 0 then
      raise exception 'cannot_remove_sole_owner: business % must always have exactly one active Owner membership', old.business_id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_sole_owner_membership on public.business_memberships;
create trigger trg_enforce_sole_owner_membership
  before update on public.business_memberships
  for each row execute function public.enforce_sole_owner_membership();

alter table public.business_memberships enable row level security;

-- ------------------------------------------------------------
-- is_active_member: the shared membership check every policy below
-- uses, instead of inlining the subquery directly. This is not a style
-- choice — a bare `exists (select 1 from business_memberships ...)`
-- inline in business_memberships' OWN select policy causes Postgres to
-- recurse infinitely (evaluating the policy requires re-evaluating the
-- same policy on the same table for the subquery's scan), and the same
-- recursion cascades into every OTHER table's policy that queries
-- business_memberships, since evaluating those subqueries requires
-- applying business_memberships' RLS too. A SECURITY DEFINER function
-- breaks the cycle: Postgres does not re-apply the calling role's RLS
-- inside a SECURITY DEFINER function body (the same reason every
-- mutating RPC in this schema — register_device, revoke_device, etc. —
-- can already read/write devices and active_device_lock despite those
-- tables having no INSERT/UPDATE policy for `authenticated` at all).
-- Found and fixed during this sprint's own local-Postgres verification
-- pass (mirroring Sprint 14's RLS verification method) before this
-- migration was considered done.
-- ------------------------------------------------------------
create or replace function public.is_active_member(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.business_memberships bm
    where bm.business_id = p_business_id
      and bm.user_id = auth.uid()
      and bm.status = 'active'
  )
$$;

grant execute on function public.is_active_member(uuid) to authenticated;

-- SELECT-only here, deliberately: no INSERT/UPDATE/DELETE policy is
-- added for businesses, roles, or business_memberships in this sprint.
-- Every existing mutable table in this schema (devices,
-- active_device_lock) is already mutated exclusively through SECURITY
-- DEFINER RPCs, never bare client-side table writes — the invite/
-- accept/suspend/remove operations Vol 13_1 §4 describes are Sprint
-- 24's own scope (its Task Breakdown builds the membership lifecycle),
-- and will follow that same RPC pattern rather than needing raw RLS
-- write policies here. This backfill migration writes these tables
-- directly because it runs with elevated (migration-time) privileges,
-- not through the `authenticated` role RLS governs.
create policy "Members can view their own business's memberships"
  on public.business_memberships for select
  using (public.is_active_member(business_id));

-- Now that business_memberships exists, add the deferred visibility
-- policies for businesses (Section 1) and custom role_permissions
-- (Section 4).
create policy "Members can view their own business"
  on public.businesses for select
  using (public.is_active_member(id));

create policy "Members can view their own business's custom roles"
  on public.roles for select
  using (business_id is not null and public.is_active_member(business_id));

create policy "Members can view their own business's custom role_permissions"
  on public.role_permissions for select
  using (
    exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.business_id is not null
        and public.is_active_member(r.business_id)
    )
  );

-- ------------------------------------------------------------
-- 7. Backfill — every existing business gets exactly one active Owner
-- membership pointing at its original owner. Because Phase 1/2's
-- business_id literally equals the owner's auth.uid() (Sprint 14's
-- documented design decision), this is a 1:1 mechanical mapping over
-- public.profiles with no ambiguity — every profiles row IS an
-- existing business's original owner.
-- ------------------------------------------------------------
insert into public.businesses (id, owner_user_id, legal_name, pka_version, created_at)
select p.id, p.id, p.business_name, p.pka_version, p.created_at
from public.profiles p
on conflict (id) do nothing;

insert into public.business_memberships (business_id, user_id, role_id, status, invited_at, accepted_at)
select b.id, b.owner_user_id, r.id, 'active', b.created_at, b.created_at
from public.businesses b
cross join public.roles r
where r.name = 'Owner' and r.business_id is null
on conflict do nothing;

-- ------------------------------------------------------------
-- 8. RLS migration — sync_envelopes, from auth.uid() = business_id to
-- membership lookup (Vol 13_1 §10). Domain/capability-specific policies
-- are explicitly NOT added here: sync_envelopes' entity_type values
-- (business_event, business_data, ledger_entry, ...) are Phase 1/2's
-- generic sync payloads, not Vol 13_0's future module-specific tables —
-- per this sprint's own "Safe to Carry Over" note, that finer-grained
-- policy set belongs to each module's own future sprint, once those
-- tables exist.
-- ------------------------------------------------------------
drop policy if exists "Users can view their own business's envelopes" on public.sync_envelopes;
drop policy if exists "Users can insert their own business's envelopes" on public.sync_envelopes;

create policy "Active members can view their business's envelopes"
  on public.sync_envelopes for select
  using (public.is_active_member(business_id));

create policy "Active members can insert their business's envelopes"
  on public.sync_envelopes for insert
  with check (public.is_active_member(business_id));

-- ------------------------------------------------------------
-- 9. Ad-hoc (added 2 September 2026, from Sprint 22's review): re-scope
-- devices / active_device_lock to per-membership, per Vol 12_1 Version
-- 1.4 §5b. Folded into this sprint's own devices/active_device_lock RLS
-- migration task rather than a later sprint, so these tables are only
-- migrated once.
-- ------------------------------------------------------------
alter table public.devices
  add column if not exists business_membership_id uuid references public.business_memberships (id);

-- Backfill: every existing device belongs to its business's (sole,
-- just-backfilled) Owner membership.
update public.devices d
set business_membership_id = bm.id
from public.business_memberships bm
where bm.business_id = d.business_id
  and bm.status = 'active'
  and d.business_membership_id is null;

alter table public.devices
  alter column business_membership_id set not null;

-- Replaces devices_one_primary_per_business (Sprint 15): "exactly one
-- primary device" is now a per-membership guarantee, not a per-business
-- one — Vol 12_1 §5b's whole point is that different members' devices
-- no longer contend with each other at all.
drop index if exists devices_one_primary_per_business;
create unique index if not exists devices_one_primary_per_membership
  on public.devices (business_membership_id)
  where is_primary = true;

create index if not exists idx_devices_business_membership
  on public.devices (business_membership_id)
  where revoked_at is null;

drop policy if exists "Users can view their own business's devices" on public.devices;
create policy "Active members can view their business's devices"
  on public.devices for select
  using (public.is_active_member(business_id));

-- active_device_lock: primary key moves from business_id to
-- business_membership_id — "exactly one active device" is now a
-- per-membership guarantee (Vol 12_1 §5b), not a per-business one.
-- business_id is kept as a denormalized, not-null column (set only by
-- the RPCs below, always kept equal to the owning membership's
-- business_id) purely so the visibility policy below can stay a simple
-- membership-of-this-business check without an extra join.
alter table public.active_device_lock
  add column if not exists business_membership_id uuid references public.business_memberships (id);

update public.active_device_lock l
set business_membership_id = bm.id
from public.business_memberships bm
where bm.business_id = l.business_id
  and bm.status = 'active'
  and l.business_membership_id is null;

alter table public.active_device_lock
  alter column business_membership_id set not null;

alter table public.active_device_lock drop constraint if exists active_device_lock_pkey;
alter table public.active_device_lock add primary key (business_membership_id);

drop policy if exists "Users can view their own business's active device lock" on public.active_device_lock;
create policy "Active members can view their business's active device locks"
  on public.active_device_lock for select
  using (public.is_active_member(business_id));

-- ------------------------------------------------------------
-- 10. Re-scoped device-lock RPCs (Sprint 15/17/19 originals, rewritten
-- for Vol 12_1 §5b). No RPC parameter signatures change — every one of
-- these still takes exactly the arguments the existing mobile/web
-- client code already passes (packages/core/src/sync/supabaseTransport.ts
-- is untouched by this sprint). Each function now resolves the caller's
-- own active business_membership_id from auth.uid() internally, then
-- scopes the lock/primary-device logic to that membership instead of to
-- business_id directly. Because multi-business-per-owner is out of
-- scope (Vol 13_1 §11 Open Item 4), a given auth.uid() maps to at most
-- one active membership, so this resolution is unambiguous — no new
-- "which business" parameter is needed.
--
-- Business-wide facts (the sync-envelope catch-up precondition) stay
-- business-wide, not membership-wide: all members share one envelope
-- stream (Vol 12_1 §5b), so "are you caught up" must still mean caught
-- up with the whole business, not just your own membership's prior
-- activity.
-- ------------------------------------------------------------

create or replace function public.register_device(
  p_device_id text,
  p_platform text,
  p_device_label text
) returns public.devices
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_membership record;
  v_is_first boolean;
  v_row public.devices;
  v_lock_token uuid;
begin
  select bm.id as membership_id, bm.business_id as business_id
    into v_membership
  from public.business_memberships bm
  where bm.user_id = auth.uid() and bm.status = 'active'
  limit 1;

  if v_membership.membership_id is null then
    raise exception 'no_active_membership';
  end if;

  -- Serialize registration per-membership (was per-business through
  -- Sprint 19) so two near-simultaneous registrations by the same
  -- person can never both believe they are "this membership's first
  -- device" — unrelated to, and no longer contending with, any other
  -- member's own registrations.
  perform pg_advisory_xact_lock(hashtext(v_membership.membership_id::text));

  select not exists (
    select 1 from public.devices
    where business_membership_id = v_membership.membership_id and revoked_at is null
  ) into v_is_first;

  insert into public.devices (
    device_id, business_id, business_membership_id, device_label, platform,
    registered_at, last_seen_at, last_synced_server_seq, is_primary
  ) values (
    p_device_id, v_membership.business_id, v_membership.membership_id, p_device_label, p_platform,
    now(), now(), 0, v_is_first
  )
  returning * into v_row;

  if v_is_first then
    v_lock_token := gen_random_uuid();
    insert into public.active_device_lock (business_membership_id, business_id, active_device_id, lock_token, acquired_at)
    values (v_membership.membership_id, v_membership.business_id, p_device_id, v_lock_token, now());
  end if;

  return v_row;
end;
$$;

grant execute on function public.register_device(text, text, text) to authenticated;

create or replace function public.request_activation(
  p_device_id text,
  p_last_applied_server_seq bigint,
  p_expected_lock_token uuid
) returns public.active_device_lock
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_membership record;
  v_true_max_seq bigint;
  v_new_token uuid;
  v_row public.active_device_lock;
begin
  select bm.id as membership_id, bm.business_id as business_id
    into v_membership
  from public.business_memberships bm
  where bm.user_id = auth.uid() and bm.status = 'active'
  limit 1;

  if v_membership.membership_id is null then
    raise exception 'no_active_membership';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_membership.membership_id::text));

  if not exists (
    select 1 from public.devices
    where device_id = p_device_id
      and business_membership_id = v_membership.membership_id
      and revoked_at is null
  ) then
    raise exception 'device_not_registered_or_revoked';
  end if;

  -- Business-wide catch-up check (unchanged in spirit from Sprint 15):
  -- all members share one envelope stream.
  select coalesce(max(server_seq), 0) into v_true_max_seq
  from public.sync_envelopes
  where business_id = v_membership.business_id;

  if p_last_applied_server_seq <> v_true_max_seq then
    raise exception 'not_caught_up: device reports %, true max is %', p_last_applied_server_seq, v_true_max_seq;
  end if;

  v_new_token := gen_random_uuid();

  update public.active_device_lock
  set active_device_id = p_device_id,
      lock_token = v_new_token,
      acquired_at = now()
  where business_membership_id = v_membership.membership_id
    and lock_token is not distinct from p_expected_lock_token
  returning * into v_row;

  if not found then
    raise exception 'lock_conflict: the active-device lock changed since you last observed it — refresh and retry';
  end if;

  return v_row;
end;
$$;

grant execute on function public.request_activation(text, bigint, uuid) to authenticated;

create or replace function public.request_primary_takeover(
  p_device_id text,
  p_last_applied_server_seq bigint
) returns public.active_device_lock
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_membership record;
  v_true_max_seq bigint;
  v_new_token uuid;
  v_row public.active_device_lock;
begin
  select bm.id as membership_id, bm.business_id as business_id
    into v_membership
  from public.business_memberships bm
  where bm.user_id = auth.uid() and bm.status = 'active'
  limit 1;

  if v_membership.membership_id is null then
    raise exception 'no_active_membership';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_membership.membership_id::text));

  if not exists (
    select 1 from public.devices
    where device_id = p_device_id
      and business_membership_id = v_membership.membership_id
      and revoked_at is null
      and is_primary = true
  ) then
    raise exception 'device_not_primary_or_revoked';
  end if;

  select coalesce(max(server_seq), 0) into v_true_max_seq
  from public.sync_envelopes
  where business_id = v_membership.business_id;

  if p_last_applied_server_seq <> v_true_max_seq then
    raise exception 'not_caught_up: device reports %, true max is %', p_last_applied_server_seq, v_true_max_seq;
  end if;

  v_new_token := gen_random_uuid();

  update public.active_device_lock
  set active_device_id = p_device_id,
      lock_token = v_new_token,
      acquired_at = now()
  where business_membership_id = v_membership.membership_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.request_primary_takeover(text, bigint) to authenticated;

create or replace function public.set_primary_device(
  p_new_primary_device_id text
) returns public.devices
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_membership record;
  v_row public.devices;
begin
  select bm.id as membership_id
    into v_membership
  from public.business_memberships bm
  where bm.user_id = auth.uid() and bm.status = 'active'
  limit 1;

  if v_membership.membership_id is null then
    raise exception 'no_active_membership';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_membership.membership_id::text));

  if not exists (
    select 1 from public.devices
    where device_id = p_new_primary_device_id
      and business_membership_id = v_membership.membership_id
      and revoked_at is null
  ) then
    raise exception 'device_not_registered_or_revoked';
  end if;

  update public.devices
  set is_primary = false
  where business_membership_id = v_membership.membership_id and is_primary = true;

  update public.devices
  set is_primary = true
  where device_id = p_new_primary_device_id and business_membership_id = v_membership.membership_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.set_primary_device(text) to authenticated;

create or replace function public.touch_device_heartbeat(
  p_device_id text,
  p_last_synced_server_seq bigint
) returns public.devices
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_membership_id uuid;
  v_row public.devices;
begin
  select bm.id into v_membership_id
  from public.business_memberships bm
  where bm.user_id = auth.uid() and bm.status = 'active'
  limit 1;

  if v_membership_id is null then
    raise exception 'no_active_membership';
  end if;

  update public.devices
  set last_seen_at = now(),
      last_synced_server_seq = p_last_synced_server_seq
  where device_id = p_device_id
    and business_membership_id = v_membership_id
    and revoked_at is null
  returning * into v_row;

  if not found then
    raise exception 'device_not_registered_or_revoked';
  end if;

  return v_row;
end;
$$;

grant execute on function public.touch_device_heartbeat(text, bigint) to authenticated;

create or replace function public.rename_device(
  p_device_id text,
  p_new_device_label text
) returns public.devices
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_membership_id uuid;
  v_row public.devices;
begin
  select bm.id into v_membership_id
  from public.business_memberships bm
  where bm.user_id = auth.uid() and bm.status = 'active'
  limit 1;

  if v_membership_id is null then
    raise exception 'no_active_membership';
  end if;

  if p_new_device_label is null or btrim(p_new_device_label) = '' then
    raise exception 'device_label_required';
  end if;

  update public.devices
  set device_label = p_new_device_label
  where device_id = p_device_id
    and business_membership_id = v_membership_id
    and revoked_at is null
  returning * into v_row;

  if not found then
    raise exception 'device_not_registered_or_revoked';
  end if;

  return v_row;
end;
$$;

grant execute on function public.rename_device(text, text) to authenticated;

-- revoke_device: unlike the RPCs above, this one deliberately is NOT
-- limited to "your own membership's devices" — Vol 13_1's Owner/
-- Payroll-Admin-style "configure on settings" grant is precisely the
-- capability that lets an Owner revoke a Bookkeeper's lost phone, a
-- cross-membership action by design. Two authorization paths, either
-- is sufficient: (a) the device belongs to the caller's own active
-- membership (self-service, unchanged from Sprint 19's original
-- behaviour), or (b) the caller's own active membership's role grants
-- (settings, configure) — a business-wide device-management grant, only
-- the Owner template has this by default (Vol 13_1 §4.1's table).
create or replace function public.revoke_device(
  p_device_id text,
  p_new_active_device_id text default null,
  p_new_primary_device_id text default null
) returns public.devices
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_membership record;
  v_target_membership_id uuid;
  v_can_configure_settings boolean;
  v_was_active boolean;
  v_was_primary boolean;
  v_new_lock_token uuid;
  v_row public.devices;
begin
  select bm.id as membership_id, bm.business_id as business_id, bm.role_id as role_id
    into v_membership
  from public.business_memberships bm
  where bm.user_id = auth.uid() and bm.status = 'active'
  limit 1;

  if v_membership.membership_id is null then
    raise exception 'no_active_membership';
  end if;

  select d.business_membership_id into v_target_membership_id
  from public.devices d
  where d.device_id = p_device_id and d.revoked_at is null;

  if v_target_membership_id is null then
    raise exception 'device_not_registered_or_revoked';
  end if;

  select exists (
    select 1 from public.role_permissions rp
    where rp.role_id = v_membership.role_id
      and rp.domain = 'settings' and rp.capability = 'configure'
  ) into v_can_configure_settings;

  if v_target_membership_id <> v_membership.membership_id and not v_can_configure_settings then
    raise exception 'not_authorized_to_revoke_this_device';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_target_membership_id::text));

  select
    exists (
      select 1 from public.active_device_lock
      where business_membership_id = v_target_membership_id and active_device_id = p_device_id
    ),
    is_primary
  into v_was_active, v_was_primary
  from public.devices
  where device_id = p_device_id and business_membership_id = v_target_membership_id;

  if v_was_active and p_new_active_device_id is null then
    raise exception 'must_designate_replacement_active_device';
  end if;

  if v_was_primary and p_new_primary_device_id is null then
    raise exception 'must_designate_new_primary_device';
  end if;

  if p_new_active_device_id is not null and not exists (
    select 1 from public.devices
    where device_id = p_new_active_device_id
      and business_membership_id = v_target_membership_id
      and revoked_at is null
      and device_id <> p_device_id
  ) then
    raise exception 'replacement_active_device_not_registered_or_revoked';
  end if;

  if p_new_primary_device_id is not null and not exists (
    select 1 from public.devices
    where device_id = p_new_primary_device_id
      and business_membership_id = v_target_membership_id
      and revoked_at is null
      and device_id <> p_device_id
  ) then
    raise exception 'replacement_primary_device_not_registered_or_revoked';
  end if;

  update public.devices
  set revoked_at = now()
  where device_id = p_device_id and business_membership_id = v_target_membership_id
  returning * into v_row;

  if p_new_active_device_id is not null then
    v_new_lock_token := gen_random_uuid();
    update public.active_device_lock
    set active_device_id = p_new_active_device_id,
        lock_token = v_new_lock_token,
        acquired_at = now()
    where business_membership_id = v_target_membership_id;
  end if;

  if p_new_primary_device_id is not null then
    update public.devices
    set is_primary = false
    where business_membership_id = v_target_membership_id and is_primary = true;

    update public.devices
    set is_primary = true
    where device_id = p_new_primary_device_id and business_membership_id = v_target_membership_id;
  end if;

  return v_row;
end;
$$;

grant execute on function public.revoke_device(text, text, text) to authenticated;

-- ============================================================
-- End of Sprint 23 migration.
-- ============================================================
