-- AIFA backend schema — Phase 1 (Vol 11_0 Section 5, Vol 8_1).
-- Run this in the Supabase SQL editor after creating the project.
-- Supabase's built-in `auth.users` table handles authentication itself;
-- this file only adds the minimal application-level tables Phase 1 needs.

-- One row per business, one business per user in Phase 1 (Vol 8_1: single-user,
-- team roles are Phase 2). Kept intentionally minimal — most business data
-- lives locally on-device (Vol 4_4) and only reaches the backend as an
-- encrypted backup blob, not as queryable Postgres rows.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  business_name text,
  industry text,
  pka_version text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Encrypted backup blobs (Vol 8_4 Section 2). The actual encryption happens
-- client-side before upload — this table only stores opaque, already-encrypted
-- payloads plus enough metadata to find the latest one. Built out fully in
-- Sprint 9; the table is created now so Sprint 9 has a stable target.
create table if not exists public.backups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null,
  created_at timestamptz not null default now()
);

alter table public.backups enable row level security;

create policy "Users can view their own backups"
  on public.backups for select
  using (auth.uid() = user_id);

create policy "Users can insert their own backups"
  on public.backups for insert
  with check (auth.uid() = user_id);

-- Sprint 9: the actual encrypted blob storage (public.backups above only
-- stores a pointer). Path convention enforced by both the app
-- (backupService.ts) and these policies: "<user_id>/<filename>" -- the
-- policies check that the first path segment equals the caller's own
-- auth.uid(), which is what actually prevents one user from reading or
-- overwriting another user's backup blobs (the `backups` table's RLS
-- above only protects the pointer row, not the object storage itself).
insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do nothing;

create policy "Users can upload their own backup blobs"
  on storage.objects for insert
  with check (
    bucket_id = 'backups'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can read their own backup blobs"
  on storage.objects for select
  using (
    bucket_id = 'backups'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete their own backup blobs"
  on storage.objects for delete
  using (
    bucket_id = 'backups'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- Sprint 14 — Cloud Data Model & Key Management (Vol 12_1 §4, ADR-002).
--
-- Additive only: does not alter or drop public.profiles or public.backups
-- (Phase 1 backup/restore is untouched). Nothing reads or writes this
-- table yet — that's Sprint 16 — this migration exists so the schema is
-- live and RLS-verified before anything is built on top of it.
--
-- business_id design decision (Sprint 14, resolving a gap flagged since
-- Sprint 2 — see packages/core/src/sync/businessIdentity.ts's file
-- comment for the full rationale): business_id here IS the signed-in
-- Supabase user's auth.uid(), identical to public.profiles.id. Phase 1/2
-- is single-user-per-business (Vol 8_1 §4), so this reuses the identity
-- Supabase already manages rather than inventing a separate "business"
-- concept and its own ownership table. RLS below follows directly from
-- that: a row's owner is auth.uid() = business_id, exactly like
-- public.profiles's own policies above.
-- ============================================================
create table if not exists public.sync_envelopes (
  envelope_id text primary key,
  business_id uuid not null references auth.users (id) on delete cascade,
  device_id text not null,
  device_seq bigint not null,
  server_seq bigserial not null,
  entity_type text not null check (
    entity_type in (
      'business_event',
      'business_data',
      'ledger_entry',
      'document',
      'ai_interpretation',
      'business_event_status_transition',
      'business_knowledge_entry',
      'app_settings'
    )
  ),
  op text not null check (op in ('insert', 'status_transition', 'upsert')),
  payload_ciphertext bytea not null,
  payload_iv bytea not null,
  server_received_at timestamptz not null default now()
);

-- Pull queries (Sprint 16): "everything for this business since watermark
-- N," ordered by the real ordering column.
create index if not exists idx_sync_envelopes_business_server_seq
  on public.sync_envelopes (business_id, server_seq);

-- Idempotency checks (Sprint 16): "has this device's envelope N already
-- been applied," per Vol 12_1 §6.3.
create index if not exists idx_sync_envelopes_business_device_seq
  on public.sync_envelopes (business_id, device_id, device_seq);

alter table public.sync_envelopes enable row level security;

create policy "Users can view their own business's envelopes"
  on public.sync_envelopes for select
  using (auth.uid() = business_id);

create policy "Users can insert their own business's envelopes"
  on public.sync_envelopes for insert
  with check (auth.uid() = business_id);

-- No update/delete policy: envelopes are append-only (Vol 12_1 §2 "most
-- things are inserts"; even a status_transition or upsert op is itself a
-- new inserted row, never a mutation of an existing one) — so there is
-- deliberately no UPDATE or DELETE policy at all. RLS defaults to denying
-- an operation with no matching policy, so this is enforced by omission,
-- not by an explicit "using (false)" policy.

-- AIFA backend schema — Sprint 15 (Vol 12_1 §5a, §6a; ADR-003, ADR-004).
--
-- Device Registry + Active-Device Lock. Additive only: does not alter
-- public.profiles, public.backups, or public.sync_envelopes.
--
-- Design decisions made this sprint (not fully specified in Vol 12_1's
-- prose — see the Sprint 15 runbook for full rationale):
--
-- 1. Ordinary request_activation() uses optimistic concurrency (a
--    p_expected_lock_token compare-and-swap) so that two genuinely
--    concurrent activation requests resolve to exactly one success and
--    one clean rejection, rather than "both succeed, last commit wins"
--    (which would still leave the lock in a valid final state, but
--    violates Sprint 15's explicit DoD: "confirm exactly one succeeds
--    and the other receives a clear rejection, never both succeeding").
--    Vol 12_1 §6a.2 does not spell out this CAS mechanism explicitly;
--    it is a necessary refinement to make "genuinely impossible for two
--    devices to both think they can write" (§5a.2) hold under real
--    concurrent timing, not just sequential-looking manual tests.
-- 2. request_primary_takeover() deliberately has NO compare-and-swap —
--    per ADR-004 / §6a.5, primary always wins regardless of current
--    lock holder, so it is not subject to losing a race the way the
--    ordinary path is.
-- 3. Both activation paths share the identical sync-before-write
--    precondition (p_last_applied_server_seq must equal the true
--    current max server_seq for the business) — §6a.5 is explicit that
--    ADR-004 does not waive this for primary.
-- 4. Every mutating operation is serialized per-business via
--    pg_advisory_xact_lock(hashtext(business_id)), so the concurrency
--    test's outcome is deterministic and repeatable rather than
--    depending on incidental transaction timing.

create table if not exists public.devices (
  device_id text primary key,
  business_id uuid not null references auth.users (id) on delete cascade,
  device_label text not null,
  platform text not null check (platform in ('ios', 'android', 'web')),
  registered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_synced_server_seq bigint not null default 0,
  is_primary boolean not null default false,
  revoked_at timestamptz
);

-- Enforced correctness invariant (Sprint 15 DoD): exactly one primary
-- device per business is impossible to violate at the DB level, not
-- just discouraged by application code. "Exactly one" = "at most one"
-- here (zero is valid transiently — see Vol 12_1 §5a.4's revocation
-- note — and momentarily before the first device ever registers).
create unique index if not exists devices_one_primary_per_business
  on public.devices (business_id)
  where is_primary = true;

create index if not exists idx_devices_business_id
  on public.devices (business_id)
  where revoked_at is null;

create table if not exists public.active_device_lock (
  business_id uuid primary key references auth.users (id) on delete cascade,
  active_device_id text not null references public.devices (device_id),
  lock_token uuid not null,
  acquired_at timestamptz not null default now()
);

alter table public.devices enable row level security;
alter table public.active_device_lock enable row level security;

-- Read-only for the owner's own rows. All mutation happens exclusively
-- through the SECURITY DEFINER functions below (Vol 12_1 §5a.2: "a
-- single row, mutated only through one atomic server-side operation...
-- not a plain client-side update") — deliberately no INSERT/UPDATE/
-- DELETE policy for the authenticated role on either table.
create policy "Users can view their own business's devices"
  on public.devices for select
  using (auth.uid() = business_id);

create policy "Users can view their own business's active device lock"
  on public.active_device_lock for select
  using (auth.uid() = business_id);

-- ============================================================
-- register_device: onboards a new device (Vol 12_1 §5a.3).
-- First device ever registered for a business is auto-primary and
-- auto-active (nothing to hand off from). Every subsequent device
-- registers read-only, non-primary.
-- ============================================================
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
  v_business_id uuid := auth.uid();
  v_is_first boolean;
  v_row public.devices;
  v_lock_token uuid;
begin
  if v_business_id is null then
    raise exception 'not authenticated';
  end if;

  -- Serialize registration per-business so two near-simultaneous
  -- registrations can never both believe they are "the first device".
  perform pg_advisory_xact_lock(hashtext(v_business_id::text));

  select not exists (
    select 1 from public.devices
    where business_id = v_business_id and revoked_at is null
  ) into v_is_first;

  insert into public.devices (
    device_id, business_id, device_label, platform,
    registered_at, last_seen_at, last_synced_server_seq, is_primary
  ) values (
    p_device_id, v_business_id, p_device_label, p_platform,
    now(), now(), 0, v_is_first
  )
  returning * into v_row;

  if v_is_first then
    v_lock_token := gen_random_uuid();
    insert into public.active_device_lock (business_id, active_device_id, lock_token, acquired_at)
    values (v_business_id, p_device_id, v_lock_token, now());
  end if;

  return v_row;
end;
$$;

grant execute on function public.register_device(text, text, text) to authenticated;

-- ============================================================
-- request_activation: ordinary handoff (Vol 12_1 §6a.1-6a.4).
-- Any registered, non-revoked, caught-up device may activate itself.
-- Uses an expected-lock-token compare-and-swap so that of two
-- concurrent requests, exactly one succeeds.
-- ============================================================
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
  v_business_id uuid := auth.uid();
  v_true_max_seq bigint;
  v_new_token uuid;
  v_row public.active_device_lock;
begin
  if v_business_id is null then
    raise exception 'not authenticated';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_business_id::text));

  if not exists (
    select 1 from public.devices
    where device_id = p_device_id and business_id = v_business_id and revoked_at is null
  ) then
    raise exception 'device_not_registered_or_revoked';
  end if;

  select coalesce(max(server_seq), 0) into v_true_max_seq
  from public.sync_envelopes
  where business_id = v_business_id;

  if p_last_applied_server_seq <> v_true_max_seq then
    raise exception 'not_caught_up: device reports %, true max is %', p_last_applied_server_seq, v_true_max_seq;
  end if;

  v_new_token := gen_random_uuid();

  update public.active_device_lock
  set active_device_id = p_device_id,
      lock_token = v_new_token,
      acquired_at = now()
  where business_id = v_business_id
    and lock_token is not distinct from p_expected_lock_token
  returning * into v_row;

  if not found then
    raise exception 'lock_conflict: the active-device lock changed since you last observed it — refresh and retry';
  end if;

  return v_row;
end;
$$;

grant execute on function public.request_activation(text, bigint, uuid) to authenticated;

-- ============================================================
-- request_primary_takeover: forced takeover (Vol 12_1 §6a.5, ADR-004).
-- Same sync-before-write precondition as the ordinary path; NO
-- compare-and-swap — the primary device always wins regardless of
-- current lock holder.
-- ============================================================
create or replace function public.request_primary_takeover(
  p_device_id text,
  p_last_applied_server_seq bigint
) returns public.active_device_lock
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_business_id uuid := auth.uid();
  v_true_max_seq bigint;
  v_new_token uuid;
  v_row public.active_device_lock;
begin
  if v_business_id is null then
    raise exception 'not authenticated';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_business_id::text));

  if not exists (
    select 1 from public.devices
    where device_id = p_device_id
      and business_id = v_business_id
      and revoked_at is null
      and is_primary = true
  ) then
    raise exception 'device_not_primary_or_revoked';
  end if;

  select coalesce(max(server_seq), 0) into v_true_max_seq
  from public.sync_envelopes
  where business_id = v_business_id;

  if p_last_applied_server_seq <> v_true_max_seq then
    raise exception 'not_caught_up: device reports %, true max is %', p_last_applied_server_seq, v_true_max_seq;
  end if;

  v_new_token := gen_random_uuid();

  -- No CAS: primary always wins, unconditionally (ADR-004).
  update public.active_device_lock
  set active_device_id = p_device_id,
      lock_token = v_new_token,
      acquired_at = now()
  where business_id = v_business_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.request_primary_takeover(text, bigint) to authenticated;

-- ============================================================
-- set_primary_device: atomic primary reassignment (Vol 12_1 §5a.4).
-- ============================================================
create or replace function public.set_primary_device(
  p_new_primary_device_id text
) returns public.devices
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_business_id uuid := auth.uid();
  v_row public.devices;
begin
  if v_business_id is null then
    raise exception 'not authenticated';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_business_id::text));

  if not exists (
    select 1 from public.devices
    where device_id = p_new_primary_device_id and business_id = v_business_id and revoked_at is null
  ) then
    raise exception 'device_not_registered_or_revoked';
  end if;

  update public.devices
  set is_primary = false
  where business_id = v_business_id and is_primary = true;

  update public.devices
  set is_primary = true
  where device_id = p_new_primary_device_id and business_id = v_business_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.set_primary_device(text) to authenticated;

-- ============================================================
-- touch_device_heartbeat: Sprint 17 (Vol 12_1 Section 6a.1/6a.5's
-- "genuinely in use" / last_seen_at signal). Sprint 15 only ever set
-- devices.last_seen_at once, at registration -- with nothing updating it
-- afterward, the handoff protocol's "is the current active device
-- genuinely in use right now" check would be meaningless (a device
-- registered weeks ago would look permanently idle regardless of actual
-- use). This is the minimal heartbeat that keeps it meaningful: called
-- once per successful sync cycle from the mobile client (app/src's
-- syncService.ts), not on every keystroke -- a sync-cycle cadence is
-- "genuinely active" enough for a lightweight in-use signal and avoids
-- a write on every read screen view.
-- ============================================================
create or replace function public.touch_device_heartbeat(
  p_device_id text,
  p_last_synced_server_seq bigint
) returns public.devices
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_business_id uuid := auth.uid();
  v_row public.devices;
begin
  if v_business_id is null then
    raise exception 'not authenticated';
  end if;

  update public.devices
  set last_seen_at = now(),
      last_synced_server_seq = p_last_synced_server_seq
  where device_id = p_device_id
    and business_id = v_business_id
    and revoked_at is null
  returning * into v_row;

  if not found then
    raise exception 'device_not_registered_or_revoked';
  end if;

  return v_row;
end;
$$;

grant execute on function public.touch_device_heartbeat(text, bigint) to authenticated;

-- ============================================================
-- rename_device: Sprint 19 (Vol 12_1 Section 8, "Rename" action).
-- No CAS/concurrency concern here (a label is not a safety-critical
-- field the way the active lock or primary flag are) -- a plain
-- SECURITY DEFINER update scoped to the caller's own business, same
-- auth.uid() pattern every other RPC in this file uses.
-- ============================================================
create or replace function public.rename_device(
  p_device_id text,
  p_new_device_label text
) returns public.devices
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_business_id uuid := auth.uid();
  v_row public.devices;
begin
  if v_business_id is null then
    raise exception 'not authenticated';
  end if;

  if p_new_device_label is null or btrim(p_new_device_label) = '' then
    raise exception 'device_label_required';
  end if;

  update public.devices
  set device_label = p_new_device_label
  where device_id = p_device_id
    and business_id = v_business_id
    and revoked_at is null
  returning * into v_row;

  if not found then
    raise exception 'device_not_registered_or_revoked';
  end if;

  return v_row;
end;
$$;

grant execute on function public.rename_device(text, text) to authenticated;

-- ============================================================
-- revoke_device: Sprint 19 (Vol 12_1 Section 8, "Revoke" action).
-- Sprint 15 built the `revoked_at` column and every other RPC's
-- `revoked_at is null` guard, but stubbed the actual revocation flow
-- itself as backend-only/not-yet-built -- this is that RPC.
--
-- Vol 12_1 Section 8 describes three things a revoke must do: (1) set
-- revoked_at, (2) force-sign-out that device's Supabase session, (3) if
-- the revoked device was active, require the owner to immediately
-- activate a replacement (defaulting to the primary device if it
-- exists and isn't the one being revoked).
--
-- (2) is NOT implemented here, and is a real, disclosed gap rather than
-- a silent omission -- see the Sprint 19 runbook Section on revocation
-- for the full reasoning. Short version: this app's auth model is one
-- Supabase user (auth.uid()) per BUSINESS, shared identically across
-- every device that business has ever registered -- there is no
-- per-device Supabase session to selectively invalidate without a new
-- layer of session-to-device tracking this schema does not have.
-- Deleting rows from Supabase's own internal auth.sessions/
-- auth.refresh_tokens tables from inside a SECURITY DEFINER function
-- was considered and rejected: those are undocumented internals of a
-- vendor-managed schema, not a stable contract this project should
-- depend on (the same reasoning that has kept this codebase away from
-- other undocumented-internals dependencies throughout). What this RPC
-- DOES guarantee, immediately and unconditionally, the same way every
-- other RPC in this file does: a revoked device_id can never again pass
-- the `revoked_at is null` check in request_activation,
-- request_primary_takeover, set_primary_device, or
-- touch_device_heartbeat -- so it can never become or remain the writer,
-- full stop, regardless of what its still-valid Supabase session can
-- still technically call. Full decrypt-level revocation still needs DEK
-- rotation, same top-priority open item Vol 12_1 Section 12 already
-- names for a related reason.
--
-- (3) IS implemented: if the device being revoked currently holds the
-- active lock, the caller MUST pass p_new_active_device_id (a caller
-- that omits it gets a clear must_designate_replacement_active_device
-- error, not a silently-orphaned lock) -- reassignment here is a direct,
-- unconditional grant (no CAS, no sync-precondition check) since this
-- is an owner-driven administrative action, not a live handoff race
-- between two normally-operating devices, and leaving the business with
-- an active lock pointing at a now-revoked device would be worse than a
-- slightly less ceremonious reassignment. If the revoked device is also
-- currently primary, the caller MUST similarly pass
-- p_new_primary_device_id (must_designate_new_primary_device) -- Section
-- 8's text does not explicitly say what happens to primary status on
-- revocation, so this RPC takes the more conservative reading: never
-- silently leave a business with zero primary device, require an
-- explicit decision same as the active-lock case.
-- ============================================================
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
  v_business_id uuid := auth.uid();
  v_was_active boolean;
  v_was_primary boolean;
  v_new_lock_token uuid;
  v_row public.devices;
begin
  if v_business_id is null then
    raise exception 'not authenticated';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_business_id::text));

  if not exists (
    select 1 from public.devices
    where device_id = p_device_id and business_id = v_business_id and revoked_at is null
  ) then
    raise exception 'device_not_registered_or_revoked';
  end if;

  select
    exists (
      select 1 from public.active_device_lock
      where business_id = v_business_id and active_device_id = p_device_id
    ),
    is_primary
  into v_was_active, v_was_primary
  from public.devices
  where device_id = p_device_id and business_id = v_business_id;

  if v_was_active and p_new_active_device_id is null then
    raise exception 'must_designate_replacement_active_device';
  end if;

  if v_was_primary and p_new_primary_device_id is null then
    raise exception 'must_designate_new_primary_device';
  end if;

  if p_new_active_device_id is not null and not exists (
    select 1 from public.devices
    where device_id = p_new_active_device_id
      and business_id = v_business_id
      and revoked_at is null
      and device_id <> p_device_id
  ) then
    raise exception 'replacement_active_device_not_registered_or_revoked';
  end if;

  if p_new_primary_device_id is not null and not exists (
    select 1 from public.devices
    where device_id = p_new_primary_device_id
      and business_id = v_business_id
      and revoked_at is null
      and device_id <> p_device_id
  ) then
    raise exception 'replacement_primary_device_not_registered_or_revoked';
  end if;

  update public.devices
  set revoked_at = now()
  where device_id = p_device_id and business_id = v_business_id
  returning * into v_row;

  if p_new_active_device_id is not null then
    v_new_lock_token := gen_random_uuid();
    update public.active_device_lock
    set active_device_id = p_new_active_device_id,
        lock_token = v_new_lock_token,
        acquired_at = now()
    where business_id = v_business_id;
  end if;

  if p_new_primary_device_id is not null then
    update public.devices
    set is_primary = false
    where business_id = v_business_id and is_primary = true;

    update public.devices
    set is_primary = true
    where device_id = p_new_primary_device_id and business_id = v_business_id;
  end if;

  return v_row;
end;
$$;

grant execute on function public.revoke_device(text, text, text) to authenticated;

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
-- ==============================================================
-- AIFA backend schema — Sprint 25 (Vol 13_1 §5-6; Vol 13_2 full;
-- Vol 13_3 §3's solo_self_resolved extension).
--
-- Delegated, SoD-Aware Approval Engine & Role-Gated Capture. This is
-- the generic ApprovalTask resolution engine every future Vol 13_0
-- module sprint (starting Sprint 26) depends on, plus the capture
-- attribution/permission gate and Segregation-of-Duties policy layer
-- Vol 13_2 requires now that capture is no longer owner-only.
--
-- A genuine architecture note, disclosed up front rather than
-- discovered mid-migration: `ApprovalTask` did not exist as a real
-- table before this sprint — Vol 13_0 §3.3 and Vol 13_1 §6 only ever
-- specified its shape on paper. This migration creates it fresh from
-- Vol 13_1 §6's revised spec; "revised" in that section's own title
-- refers to superseding the *paper* design, not an existing table.
--
-- A second, more consequential architecture note: `BusinessEvent`
-- (Vol 13_2 §2) is likewise not a standalone Postgres table today — it
-- is one of `sync_envelopes.entity_type`'s encrypted payload shapes
-- (Vol 13_1 §8's Path A local-first model), so its fields normally
-- live inside `payload_ciphertext`, unreadable server-side by design.
-- Vol 13_2 §2's two new fields (`captured_by_membership_id`,
-- `capture_channel`) are exactly the fields Section 4's
-- Segregation-of-Duties control and Section 5's audit trail need to
-- read server-side without decrypting anything — so this migration
-- adds them to `sync_envelopes` as plaintext metadata columns
-- (entity_type = 'business_event' rows only), the same treatment
-- `business_id`/`device_id` already get alongside the same ciphertext
-- payload. This is additive and forward-compatible: whenever a future
-- sprint gives `BusinessEvent` its own first-class table, these two
-- columns carry over unchanged. The capture-permission gate (Section
-- 3) is correspondingly implemented as a pipeline-side RPC
-- (`check_capture_permission`, called by `capturePipeline.ts` before
-- an event is even encrypted) rather than a DB constraint on
-- ciphertext, matching how Vol 13_2 §3 itself describes the gate
-- ("today, any input reaching capturePipeline.ts is processed
-- unconditionally" — a pipeline-stage problem, not an RLS one).
--
-- Owner decision recorded (3 September 2026, this sprint): a solo
-- (one-person) business's payroll runs resolve via
-- `solo_self_resolved` exactly like every other domain — Vol 13_0
-- §10's "payroll never auto-approves" rule targets AI-confidence
-- bypass (Section 8 below still hard-bars that path unconditionally),
-- not a sole owner's own act of capturing-and-confirming their own
-- payroll run, which Vol 13_3 §3 requires to stay byte-for-byte
-- identical to pre-Series-13 behaviour.
-- ==============================================================

-- ------------------------------------------------------------
-- 1. public.approval_delegations (Vol 13_1 §5).
-- ------------------------------------------------------------
create table if not exists public.approval_delegations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  delegator_membership_id uuid not null references public.business_memberships (id),
  delegate_membership_id uuid not null references public.business_memberships (id),
  domain_scope text check (domain_scope in (
    'sales', 'pricing', 'expense', 'inventory', 'accounting_reports',
    'tax_compliance', 'payroll', 'hr_attendance_leave', 'commission',
    'legal_contract', 'settings'
  )),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  reason text,
  created_by_membership_id uuid not null references public.business_memberships (id),
  status text not null default 'active' check (status in ('active', 'expired', 'revoked')),
  constraint approval_delegations_not_self check (delegator_membership_id <> delegate_membership_id),
  constraint approval_delegations_valid_window check (ends_at is null or ends_at > starts_at)
);

create index if not exists idx_approval_delegations_delegator_active
  on public.approval_delegations (delegator_membership_id)
  where status = 'active';

create index if not exists idx_approval_delegations_business
  on public.approval_delegations (business_id);

alter table public.approval_delegations enable row level security;

create policy "Active members can view their business's delegations"
  on public.approval_delegations for select
  using (public.is_active_member(business_id));

-- ------------------------------------------------------------
-- 2. public.segregation_of_duties_policies (Vol 13_2 §4.3).
-- ------------------------------------------------------------
create table if not exists public.segregation_of_duties_policies (
  business_id uuid not null references public.businesses (id) on delete cascade,
  domain text not null check (domain in (
    'sales', 'pricing', 'expense', 'inventory', 'accounting_reports',
    'tax_compliance', 'payroll', 'hr_attendance_leave', 'commission',
    'legal_contract', 'settings'
  )),
  enforce_maker_checker boolean not null default true,
  amount_threshold_myr numeric(14, 2),
  allow_self_approval_if_sole_eligible boolean not null default true,
  primary key (business_id, domain)
);

alter table public.segregation_of_duties_policies enable row level security;

create policy "Active members can view their business's SoD policies"
  on public.segregation_of_duties_policies for select
  using (public.is_active_member(business_id));

-- Owner-adjustable per §4.3's own text ("owner-adjustable afterward via
-- the settings domain configure capability") — same authorization
-- pattern as set_access_model_override/invite_member.
create or replace function public.set_sod_policy(
  p_business_id uuid,
  p_domain text,
  p_enforce_maker_checker boolean,
  p_amount_threshold_myr numeric,
  p_allow_self_approval_if_sole_eligible boolean
) returns public.segregation_of_duties_policies
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_membership record;
  v_can_configure boolean;
  v_row public.segregation_of_duties_policies;
begin
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

  insert into public.segregation_of_duties_policies (
    business_id, domain, enforce_maker_checker, amount_threshold_myr,
    allow_self_approval_if_sole_eligible
  ) values (
    p_business_id, p_domain, p_enforce_maker_checker, p_amount_threshold_myr,
    p_allow_self_approval_if_sole_eligible
  )
  on conflict (business_id, domain) do update set
    enforce_maker_checker = excluded.enforce_maker_checker,
    amount_threshold_myr = excluded.amount_threshold_myr,
    allow_self_approval_if_sole_eligible = excluded.allow_self_approval_if_sole_eligible
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.set_sod_policy(uuid, text, boolean, numeric, boolean) to authenticated;

-- Seeding — fires exactly once, at the moment identified by Sprint 24's
-- own transition-log hook (business_access_model_transitions,
-- trigger_reason = 'membership_accepted', transitioned_to = 'team'),
-- the first time it happens for a business. §4.3's resolved defaults:
-- expense RM 500 / sales RM 2,000 thresholds, enforce_maker_checker
-- true for sales/expense/payroll/legal_contract (payroll/legal_contract
-- with no threshold — every transaction gated), false for
-- hr_attendance_leave/inventory. The remaining domains (pricing,
-- accounting_reports, tax_compliance, commission, settings) are not
-- named in §4.3's worked examples; seeded here with the same
-- control-first default (`enforce_maker_checker = true`, no threshold)
-- the table's own column default already uses, so every domain has an
-- explicit, owner-visible, owner-adjustable row rather than an implicit
-- gap for the five unnamed ones.
create or replace function public.seed_sod_policies_on_first_team_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.transitioned_to = 'team' and not exists (
    select 1 from public.business_access_model_transitions
    where business_id = new.business_id
      and transitioned_to = 'team'
      and id <> new.id
  ) then
    insert into public.segregation_of_duties_policies (
      business_id, domain, enforce_maker_checker, amount_threshold_myr,
      allow_self_approval_if_sole_eligible
    )
    select new.business_id, v.domain, v.enforce, v.threshold, true
    from (values
      ('sales', true, 2000.00),
      ('expense', true, 500.00),
      ('payroll', true, null::numeric),
      ('legal_contract', true, null::numeric),
      ('hr_attendance_leave', false, null::numeric),
      ('inventory', false, null::numeric),
      ('pricing', true, null::numeric),
      ('accounting_reports', true, null::numeric),
      ('tax_compliance', true, null::numeric),
      ('commission', true, null::numeric),
      ('settings', true, null::numeric)
    ) as v(domain, enforce, threshold)
    on conflict (business_id, domain) do nothing;
  end if;
  return new;
end;
$$;

create trigger trg_seed_sod_policies_on_first_team_transition
  after insert on public.business_access_model_transitions
  for each row execute function public.seed_sod_policies_on_first_team_transition();

-- ------------------------------------------------------------
-- 3. public.approval_tasks (Vol 13_1 §6, revised/created fresh — see
-- header note). `resolved_via` gains two values beyond Vol 13_1 §6's
-- own four: `solo_self_resolved` (Vol 13_3 §3, this sprint's own
-- extension) and `blocked_awaiting_reviewer` (this sprint's own
-- addition — Vol 13_2 §4.3's escape valve names the *behaviour*
-- "blocks the transaction entirely until a second person is added"
-- but Vol 13_1 §6 was written before that blocking outcome existed as
-- a case to represent; disclosed here rather than silently folded into
-- an existing value it doesn't actually match).
-- ------------------------------------------------------------
create table if not exists public.approval_tasks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  domain text not null check (domain in (
    'sales', 'pricing', 'expense', 'inventory', 'accounting_reports',
    'tax_compliance', 'payroll', 'hr_attendance_leave', 'commission',
    'legal_contract', 'settings'
  )),
  subject_type text not null,
  subject_id uuid not null,
  amount numeric(14, 2),
  ai_draft_summary text,
  ai_confidence numeric(5, 4),
  captured_by_membership_id uuid references public.business_memberships (id),
  assigned_membership_id uuid references public.business_memberships (id),
  resolved_via text not null check (resolved_via in (
    'direct_permission', 'delegation', 'escalation', 'auto_approved',
    'solo_self_resolved', 'blocked_awaiting_reviewer'
  )),
  delegated_from_membership_id uuid references public.business_memberships (id),
  status text not null default 'pending_approval' check (status in (
    'pending_approval', 'approved', 'rejected', 'auto_approved'
  )),
  decided_by_membership_id uuid references public.business_memberships (id),
  decided_at timestamptz,
  next_action text,
  self_approved_via_escape_valve boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_approval_tasks_business_status
  on public.approval_tasks (business_id, status);

create index if not exists idx_approval_tasks_assigned
  on public.approval_tasks (assigned_membership_id)
  where status = 'pending_approval';

alter table public.approval_tasks enable row level security;

-- Visibility: any active member can see every task in their business
-- (matches Section 7/§5's "a report over this table" framing — the
-- fine-grained "who should see this in their queue today" filter is a
-- UI concern layered on top of this broad read policy, not an RLS
-- concern; no ApprovalTask/approval UI exists yet, same disclosed
-- deferral Sprint 24 recorded for Team/Roles screens).
create policy "Active members can view their business's approval tasks"
  on public.approval_tasks for select
  using (public.is_active_member(business_id));

-- No direct insert/update policy: every row is created and mutated
-- exclusively through the SECURITY DEFINER functions below, the same
-- convention business_memberships/devices already established.

-- ------------------------------------------------------------
-- 4. BusinessEvent capture attribution (Vol 13_2 §2) — see header note
-- on why these land on sync_envelopes rather than a standalone table.
-- ------------------------------------------------------------
alter table public.sync_envelopes
  add column if not exists captured_by_membership_id uuid references public.business_memberships (id);

alter table public.sync_envelopes
  add column if not exists capture_channel text
    check (capture_channel in ('mobile_app', 'web_app', 'api'));

create index if not exists idx_sync_envelopes_captured_by
  on public.sync_envelopes (captured_by_membership_id)
  where captured_by_membership_id is not null;

-- Defense in depth: even though payload_ciphertext can't be validated
-- server-side, this plaintext attribution metadata can be — a caller
-- cannot stamp an envelope as captured by a membership that isn't
-- their own active membership on this business (no forging capture
-- attribution for someone else).
create or replace function public.enforce_own_capture_attribution()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.captured_by_membership_id is not null then
    if not exists (
      select 1 from public.business_memberships bm
      where bm.id = new.captured_by_membership_id
        and bm.business_id = new.business_id
        and bm.user_id = auth.uid()
        and bm.status = 'active'
    ) then
      raise exception 'captured_by_membership_id_must_be_callers_own_active_membership';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_enforce_own_capture_attribution
  before insert on public.sync_envelopes
  for each row execute function public.enforce_own_capture_attribution();

-- ------------------------------------------------------------
-- 5. Capture-permission gate (Vol 13_2 §3) — a pipeline-callable RPC,
-- run before capturePipeline.ts's AI pipeline processes anything.
-- Resolves the caller's own active membership internally (same
-- established pattern as the devices RPCs), maps domain_hint -> Domain
-- per §3's table, and raises a clear, specific error rather than
-- silently swallowing the request.
-- ------------------------------------------------------------
create or replace function public.map_domain_hint(p_domain_hint text)
returns text
language sql
immutable
as $$
  select case p_domain_hint
    when 'sale' then 'sales'
    when 'purchase' then 'purchase'
    when 'expense' then 'expense'
    when 'banking' then 'accounting_reports'
    else null
  end;
$$;

create or replace function public.check_capture_permission(
  p_business_id uuid,
  p_domain_hint text
) returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_membership record;
  v_domain text;
  v_can_capture boolean;
begin
  select bm.id as membership_id, bm.role_id as role_id into v_membership
  from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if v_membership.membership_id is null then
    raise exception 'no_active_membership_for_this_business';
  end if;

  v_domain := public.map_domain_hint(p_domain_hint);

  if v_domain is null then
    raise exception 'unclassified_domain_hint_cannot_be_captured: %', p_domain_hint;
  end if;

  select exists (
    select 1 from public.role_permissions rp
    where rp.role_id = v_membership.role_id
      and rp.domain = v_domain and rp.capability = 'capture'
  ) into v_can_capture;

  if not v_can_capture then
    raise exception 'not_authorized_to_capture: no capture access to %', v_domain;
  end if;

  return v_membership.membership_id;
end;
$$;

grant execute on function public.check_capture_permission(uuid, text) to authenticated;
grant execute on function public.map_domain_hint(text) to authenticated;

-- ------------------------------------------------------------
-- 6. Resolution engine (Vol 13_1 §6.1, Vol 13_2 §4.1/§4.3, Vol 13_3
-- §3). `resolve_approval_task` is the pure resolver — safe to call
-- repeatedly against a still-`pending_approval` task (re-run when a
-- relevant delegation starts/ends, per §6.1's own instruction).
-- `create_approval_task` is the entry point every future module sprint
-- calls once, at task creation.
-- ------------------------------------------------------------
create or replace function public.resolve_approval_task(p_task_id uuid)
returns public.approval_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.approval_tasks;
  v_business_id uuid;
  v_access_model text;
  v_policy public.segregation_of_duties_policies;
  v_sod_applies boolean := false;
  v_excluded_id uuid := null;
  v_owner_membership_id uuid;
  v_eligible_raw uuid[];
  v_eligible_filtered uuid[];
  v_delegate_candidates uuid[];
  v_delegated_from uuid;
  v_candidates uuid[];
  v_resolved_via text;
  v_assigned uuid;
  v_next_action text := null;
  v_escape_valve_invoked boolean := false;
begin
  select * into v_task from public.approval_tasks where id = p_task_id for update;
  if not found then
    raise exception 'approval_task_not_found: %', p_task_id;
  end if;
  if v_task.status <> 'pending_approval' then
    -- Already decided or otherwise terminal — nothing to (re-)resolve.
    return v_task;
  end if;

  v_business_id := v_task.business_id;
  v_access_model := public.effective_access_model(v_business_id);

  -- Vol 13_3 §3: a solo business resolves and confirms in the same
  -- transaction, no separate review step, in every domain including
  -- payroll (owner decision, 3 September 2026 — see this file's header).
  if v_access_model = 'solo' then
    update public.approval_tasks set
      resolved_via = 'solo_self_resolved',
      assigned_membership_id = v_task.captured_by_membership_id,
      status = 'approved',
      decided_by_membership_id = v_task.captured_by_membership_id,
      decided_at = now(),
      self_approved_via_escape_valve = false
    where id = p_task_id
    returning * into v_task;
    return v_task;
  end if;

  select id into v_owner_membership_id
  from public.business_memberships
  where business_id = v_business_id
    and status = 'active'
    and role_id = '00000000-0000-0000-0000-000000000001';

  -- Vol 13_2 §4.1/§4.3: does SoD's maker-exclusion apply to this
  -- domain/amount right now?
  select * into v_policy
  from public.segregation_of_duties_policies
  where business_id = v_business_id and domain = v_task.domain;

  if found and v_policy.enforce_maker_checker
     and v_task.captured_by_membership_id is not null
     and (v_task.amount is null or v_policy.amount_threshold_myr is null
          or v_task.amount >= v_policy.amount_threshold_myr) then
    v_sod_applies := true;
    v_excluded_id := v_task.captured_by_membership_id;
  end if;

  -- Step 1: eligible-by-permission-and-limit set.
  select coalesce(array_agg(bm.id), array[]::uuid[]) into v_eligible_raw
  from public.business_memberships bm
  join public.role_permissions rp on rp.role_id = bm.role_id
  where bm.business_id = v_business_id
    and bm.status = 'active'
    and rp.domain = v_task.domain
    and rp.capability = 'approve'
    and (
      v_task.amount is null
      or coalesce(bm.approval_limit_myr, (select r.default_approval_limit_myr from public.roles r where r.id = bm.role_id)) is null
      or coalesce(bm.approval_limit_myr, (select r.default_approval_limit_myr from public.roles r where r.id = bm.role_id)) >= v_task.amount
    );

  if v_sod_applies then
    select coalesce(array_agg(x), array[]::uuid[]) into v_eligible_filtered
    from unnest(v_eligible_raw) as x where x <> v_excluded_id;
  else
    v_eligible_filtered := v_eligible_raw;
  end if;

  if array_length(v_eligible_filtered, 1) > 0 then
    v_resolved_via := 'direct_permission';
    v_candidates := v_eligible_filtered;
  elsif v_sod_applies and array_length(v_eligible_raw, 1) = 1 and v_eligible_raw[1] = v_excluded_id then
    -- Vol 13_2 §4.2/§4.3: the maker was the *only* eligible approver.
    -- The escape valve decides self-approval vs. block.
    if v_policy.allow_self_approval_if_sole_eligible then
      v_resolved_via := 'direct_permission';
      v_candidates := array[v_excluded_id];
      v_escape_valve_invoked := true;
    else
      v_resolved_via := 'blocked_awaiting_reviewer';
      v_candidates := array[]::uuid[];
      v_next_action := 'Blocked: excluding the capturer leaves no eligible approver for ' || v_task.domain ||
        '. Ask an Owner to add a second approver, raise the SoD threshold, or enable self-approval for this domain.';
    end if;
  else
    -- Step 2: delegation lookup among members ineligible purely by
    -- limit (they have approve on this domain, just not a high enough
    -- one) — Vol 13_1 §6.1 Step 2.
    select coalesce(array_agg(d.delegate_membership_id), array[]::uuid[]) into v_delegate_candidates
    from public.business_memberships bm
    join public.role_permissions rp on rp.role_id = bm.role_id
    join public.approval_delegations d
      on d.delegator_membership_id = bm.id
      and d.status = 'active'
      and now() >= d.starts_at
      and (d.ends_at is null or now() < d.ends_at)
      and (d.domain_scope is null or d.domain_scope = v_task.domain)
    -- The delegate is NOT required to independently hold `approve` on
    -- this domain via their own role — Vol 13_1 §5 is explicit that
    -- delegation moves *whose queue* a task lands in, exercising the
    -- delegator's own permission grant, narrowed only by domain_scope
    -- and by whichever of the two has the lower approval_limit_myr. A
    -- delegate who happens to also hold their own approve grant on the
    -- domain is not treated any differently.
    join public.business_memberships delegate_bm on delegate_bm.id = d.delegate_membership_id
    where bm.business_id = v_business_id
      and bm.status = 'active'
      and rp.domain = v_task.domain
      and rp.capability = 'approve'
      and v_task.amount is not null
      and coalesce(bm.approval_limit_myr, (select r.default_approval_limit_myr from public.roles r where r.id = bm.role_id)) is not null
      and coalesce(bm.approval_limit_myr, (select r.default_approval_limit_myr from public.roles r where r.id = bm.role_id)) < v_task.amount
      and delegate_bm.status = 'active'
      and (
        v_task.amount is null
        or coalesce(delegate_bm.approval_limit_myr, (select r.default_approval_limit_myr from public.roles r where r.id = delegate_bm.role_id)) is null
        or coalesce(delegate_bm.approval_limit_myr, (select r.default_approval_limit_myr from public.roles r where r.id = delegate_bm.role_id)) >= v_task.amount
      )
      and (not v_sod_applies or d.delegate_membership_id <> v_excluded_id);

    if array_length(v_delegate_candidates, 1) > 0 then
      v_resolved_via := 'delegation';
      v_candidates := v_delegate_candidates;
      if array_length(v_delegate_candidates, 1) = 1 then
        select d.delegator_membership_id into v_delegated_from
        from public.approval_delegations d
        where d.delegate_membership_id = v_delegate_candidates[1]
          and d.status = 'active'
          and now() >= d.starts_at and (d.ends_at is null or now() < d.ends_at)
          and (d.domain_scope is null or d.domain_scope = v_task.domain)
        limit 1;
      end if;
    else
      -- Step 3: escalate to Owner — "never leave a task with nowhere
      -- to go" (Vol 13_1 §6.1 Step 3), exempt from SoD exclusion, since
      -- the Owner fallback is the guaranteed-to-exist last resort.
      if v_owner_membership_id is null then
        raise exception 'no_active_owner_membership_to_escalate_to: %', v_business_id;
      end if;
      v_resolved_via := 'escalation';
      v_candidates := array[v_owner_membership_id];
      if v_sod_applies and v_owner_membership_id = v_task.captured_by_membership_id then
        -- SoD wanted to exclude the maker, but the guaranteed Owner
        -- fallback (Step 3) landed right back on them — still an
        -- escape-valve outcome, just reached via escalation rather
        -- than the explicit sole-eligible branch above.
        v_escape_valve_invoked := true;
      end if;
    end if;
  end if;

  if array_length(v_candidates, 1) = 1 then
    v_assigned := v_candidates[1];
  else
    v_assigned := null;
  end if;

  update public.approval_tasks set
    resolved_via = v_resolved_via,
    assigned_membership_id = v_assigned,
    delegated_from_membership_id = case when v_resolved_via = 'delegation' then v_delegated_from else null end,
    next_action = v_next_action,
    -- Vol 13_2 §5: flag set only when the escape valve mechanism was
    -- actually what let this resolve to self-approval (SoD wanted to
    -- exclude the maker, and either the sole-eligible branch or the
    -- Owner-escalation fallback put it right back on them) — NOT for
    -- the ordinary case of a maker who is simply, unexceptionally,
    -- also a valid approver (e.g. below SoD's amount_threshold_myr, or
    -- no SoD policy in force for this domain at all), which is not an
    -- escape-valve outcome and would mislabel every routine below-
    -- threshold self-approval as a control exception if flagged blindly.
    self_approved_via_escape_valve = v_escape_valve_invoked
  where id = p_task_id
  returning * into v_task;

  return v_task;
end;
$$;

grant execute on function public.resolve_approval_task(uuid) to authenticated;

-- create_approval_task: the entry point every future module sprint
-- calls. p_auto_approved is Vol 13_0 §3.3's existing AI-confidence
-- shortcut (unchanged, Vol 13_1 §6.1 Step 5) — bypasses the resolution
-- algorithm entirely, EXCEPT payroll, which this function hard-bars
-- from that path unconditionally (Vol 13_0 §10, reaffirmed every
-- sprint this has come up) — a DB-level backstop behind whatever
-- caller-side check already exists, the same belt-and-braces pattern
-- as enforce_sole_owner_membership.
create or replace function public.create_approval_task(
  p_business_id uuid,
  p_domain text,
  p_subject_type text,
  p_subject_id uuid,
  p_amount numeric,
  p_ai_draft_summary text,
  p_ai_confidence numeric,
  p_captured_by_membership_id uuid,
  p_auto_approved boolean default false
) returns public.approval_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.approval_tasks;
begin
  if p_auto_approved and p_domain = 'payroll' then
    raise exception 'payroll_never_auto_approves: Vol 13_0 §10 bars payroll from resolved_via = auto_approved regardless of AI confidence';
  end if;

  if p_auto_approved then
    insert into public.approval_tasks (
      business_id, domain, subject_type, subject_id, amount,
      ai_draft_summary, ai_confidence, captured_by_membership_id,
      resolved_via, status, decided_at
    ) values (
      p_business_id, p_domain, p_subject_type, p_subject_id, p_amount,
      p_ai_draft_summary, p_ai_confidence, p_captured_by_membership_id,
      'auto_approved', 'auto_approved', now()
    )
    returning * into v_row;
    return v_row;
  end if;

  insert into public.approval_tasks (
    business_id, domain, subject_type, subject_id, amount,
    ai_draft_summary, ai_confidence, captured_by_membership_id,
    resolved_via, status
  ) values (
    p_business_id, p_domain, p_subject_type, p_subject_id, p_amount,
    p_ai_draft_summary, p_ai_confidence, p_captured_by_membership_id,
    'escalation', -- placeholder, overwritten by resolve_approval_task below
    'pending_approval'
  )
  returning * into v_row;

  return public.resolve_approval_task(v_row.id);
end;
$$;

grant execute on function public.create_approval_task(uuid, text, text, uuid, numeric, text, numeric, uuid, boolean) to authenticated;

-- decide_approval_task: the approve/reject action. Callable by the
-- assigned member, or — for an open shared queue (assigned_membership_id
-- is null) — by any currently-eligible member; the first to act wins,
-- per §6.1 Step 4's "shared queue" behaviour, and a losing racer gets a
-- clear "already actioned by X" error rather than a stale button.
create or replace function public.decide_approval_task(
  p_task_id uuid,
  p_decision text
) returns public.approval_tasks
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_task public.approval_tasks;
  v_caller_membership_id uuid;
  v_can_approve boolean;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid_decision: must be approved or rejected';
  end if;

  select * into v_task from public.approval_tasks where id = p_task_id for update;
  if not found then
    raise exception 'approval_task_not_found: %', p_task_id;
  end if;
  if v_task.status <> 'pending_approval' then
    raise exception 'already_actioned_by_another_approver: current status %', v_task.status;
  end if;

  select bm.id into v_caller_membership_id
  from public.business_memberships bm
  where bm.business_id = v_task.business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if v_caller_membership_id is null then
    raise exception 'no_active_membership_for_this_business';
  end if;

  if v_task.assigned_membership_id is not null then
    if v_caller_membership_id <> v_task.assigned_membership_id then
      raise exception 'not_the_assigned_approver';
    end if;
  else
    -- Open queue: caller must actually be eligible right now (re-derive
    -- the same permission+limit check resolve_approval_task uses,
    -- rather than trusting the client).
    select exists (
      select 1 from public.role_permissions rp
      where rp.role_id = (select role_id from public.business_memberships where id = v_caller_membership_id)
        and rp.domain = v_task.domain and rp.capability = 'approve'
    ) into v_can_approve;
    if not v_can_approve then
      raise exception 'not_eligible_to_decide_this_task';
    end if;
  end if;

  update public.approval_tasks set
    status = p_decision,
    decided_by_membership_id = v_caller_membership_id,
    decided_at = now(),
    assigned_membership_id = coalesce(assigned_membership_id, v_caller_membership_id)
  where id = p_task_id
  returning * into v_task;

  return v_task;
end;
$$;

grant execute on function public.decide_approval_task(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 7. Delegation lifecycle RPCs (Vol 13_1 §5) — self-service for one's
-- own membership (a member covering their own leave), or configure-on-
-- settings for arranging someone else's (e.g. an Owner covering a
-- Bookkeeper's leave). Creating/revoking a delegation re-runs
-- resolution on every still-pending task the change could affect, per
-- §6.1's own instruction ("re-run if it is still pending_approval when
-- a relevant ApprovalDelegation starts or ends").
-- ------------------------------------------------------------
create or replace function public.create_approval_delegation(
  p_business_id uuid,
  p_delegator_membership_id uuid,
  p_delegate_membership_id uuid,
  p_domain_scope text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text
) returns public.approval_delegations
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_can_configure boolean;
  v_row public.approval_delegations;
begin
  select bm.id into v_caller_membership_id
  from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if v_caller_membership_id is null then
    raise exception 'no_active_membership_for_this_business';
  end if;

  if v_caller_membership_id <> p_delegator_membership_id then
    select exists (
      select 1 from public.role_permissions rp
      where rp.role_id = (select role_id from public.business_memberships where id = v_caller_membership_id)
        and rp.domain = 'settings' and rp.capability = 'configure'
    ) into v_can_configure;
    if not v_can_configure then
      raise exception 'not_authorized: can only delegate your own authority, unless you have configure on settings';
    end if;
  end if;

  insert into public.approval_delegations (
    business_id, delegator_membership_id, delegate_membership_id, domain_scope,
    starts_at, ends_at, reason, created_by_membership_id, status
  ) values (
    p_business_id, p_delegator_membership_id, p_delegate_membership_id, p_domain_scope,
    coalesce(p_starts_at, now()), p_ends_at, p_reason, v_caller_membership_id, 'active'
  )
  returning * into v_row;

  perform public.resolve_approval_task(t.id)
  from public.approval_tasks t
  where t.business_id = p_business_id
    and t.status = 'pending_approval'
    and (p_domain_scope is null or t.domain = p_domain_scope);

  return v_row;
end;
$$;

grant execute on function public.create_approval_delegation(uuid, uuid, uuid, text, timestamptz, timestamptz, text) to authenticated;

create or replace function public.revoke_approval_delegation(
  p_delegation_id uuid
) returns public.approval_delegations
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_delegation public.approval_delegations;
  v_caller_membership_id uuid;
  v_can_configure boolean;
begin
  select * into v_delegation from public.approval_delegations where id = p_delegation_id;
  if not found then
    raise exception 'delegation_not_found: %', p_delegation_id;
  end if;

  select bm.id into v_caller_membership_id
  from public.business_memberships bm
  where bm.business_id = v_delegation.business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if v_caller_membership_id is null then
    raise exception 'no_active_membership_for_this_business';
  end if;

  if v_caller_membership_id <> v_delegation.delegator_membership_id then
    select exists (
      select 1 from public.role_permissions rp
      where rp.role_id = (select role_id from public.business_memberships where id = v_caller_membership_id)
        and rp.domain = 'settings' and rp.capability = 'configure'
    ) into v_can_configure;
    if not v_can_configure then
      raise exception 'not_authorized: can only revoke your own delegation, unless you have configure on settings';
    end if;
  end if;

  update public.approval_delegations set status = 'revoked'
  where id = p_delegation_id
  returning * into v_delegation;

  perform public.resolve_approval_task(t.id)
  from public.approval_tasks t
  where t.business_id = v_delegation.business_id
    and t.status = 'pending_approval'
    and (v_delegation.domain_scope is null or t.domain = v_delegation.domain_scope);

  return v_delegation;
end;
$$;

grant execute on function public.revoke_approval_delegation(uuid) to authenticated;

-- End of Sprint 25 migration.
-- ==============================================================
-- AIFA backend schema — Sprint 26 (Vol 13_0 §3.1 Party, §3.2 Document
-- header/line pattern, §3.4 Document numbering, §8 Chart of Accounts;
-- Vol 11_1 §4/§4.1 Phase 1 Financial Data).
--
-- Party, Document Numbering & Chart-of-Accounts Migration — the shared
-- foundation every Sub-phase 3b-3e module builds on.
--
-- A GENUINE ARCHITECTURE DISCOVERY, surfaced and put to the owner before
-- any schema was written (3 September 2026): Vol 13_0 §8's own text
-- describes migrating "LedgerEntry.account (free string) to a foreign
-- key against ChartOfAccounts.id" as an additive-column-then-cleanup
-- ALTER TABLE. Checking the real schema, `ledger_entry` is not a
-- Postgres table at all — like `BusinessEvent` before Sprint 25, it is
-- one of `sync_envelopes`'s encrypted payload shapes, living only in
-- each device's local SQLite store (`packages/core/src/db/
-- ledgerRepository.ts`) under Vol 4_4/Vol 12_1's local-first model.
-- There is no server-side column to ALTER, and historical ledger data
-- cannot be server-side-backfilled at all — only a client holding the
-- Business DEK can decrypt it.
--
-- OWNER DECISION (3 September 2026): rather than defer the ledger
-- migration (as Sprint 25 deferred BusinessEvent's fields to plaintext
-- metadata columns alongside its still-encrypted payload), the owner
-- chose to follow `ApprovalTask`'s own Sprint 25 precedent — Vol 13_1
-- §8's Path A model explicitly anticipates non-sensitive, team-shared
-- entities moving to "the cloud (Postgres) as the actual multi-user
-- source of truth" — and give `LedgerEntry` a real server-side table
-- now, `public.ledger_entries`, built fresh with `chart_of_accounts_id`
-- as a proper foreign key from day one (there is no old free-string
-- column to migrate away from on a brand-new table, which is itself
-- the resolution of Section 8's "additive, not destructive" caution).
--
-- SCOPE BOUNDARY, disclosed rather than silently narrowed: this
-- migration builds `public.ledger_entries` as the real, RLS-protected,
-- multi-user-queryable destination table and its posting RPC
-- (`post_ledger_entries`). It does NOT rewire the existing, working,
-- tested client-side pipeline (`ledgerRepository.ts` + the encrypted
-- sync-envelope path in `applyEnvelope.ts`/`envelope.ts`/
-- `reconciliation.ts`) to post here instead, and it does NOT attempt to
-- decrypt and migrate any business's historical local ledger data into
-- this table — that decryption can only happen client-side, and
-- rewriting a working, tested sync/crypto pipeline blind, in the same
-- pass as new schema work, is exactly the kind of change this project
-- has consistently given its own dedicated review pass (Sprint 22's
-- crypto review; the Path B gate at Sprint 34-35). Cutting the client
-- over to `public.ledger_entries` (and a client-side decrypt-and-
-- backfill step for each business's existing local ledger) is flagged
-- here as necessary follow-on work — recommended as its own reviewed
-- step, the same way Vol 13_0 §14 Open Item 7 flagged this very
-- migration for Sprint 26 rather than folding it into Sprint 28. See
-- this sprint's own doc Outcomes section for the full disclosure.
-- ==============================================================

-- ------------------------------------------------------------
-- 0. Small reusable helper: does the CALLER's own active membership on
-- a business hold a given (domain, capability)? Generalizes the
-- role_permissions-lookup pattern every Sprint 24/25 RPC has been
-- hand-rolling inline — introduced here since Party's own RLS (Section
-- 2 below) is the first table that needs it at the ROW-VISIBILITY
-- level (a policy predicate), not just inside a function body.
-- ------------------------------------------------------------
create or replace function public.caller_has_capability(
  p_business_id uuid,
  p_domain text,
  p_capability text
) returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.business_memberships bm
    join public.role_permissions rp on rp.role_id = bm.role_id
    where bm.business_id = p_business_id
      and bm.user_id = auth.uid()
      and bm.status = 'active'
      and rp.domain = p_domain
      and rp.capability = p_capability
  );
$$;

grant execute on function public.caller_has_capability(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
-- 1. Generic document numbering (Vol 13_0 §3.4). One row per
-- (business, document_type); `next_document_number` is the single
-- shared entry point every future module sprint calls — Party's own
-- "PTY-NNNNNN" numbers (Section 2) reuse this exact mechanism with
-- document_type = 'party', proving the generic design rather than
-- hand-rolling a second counter.
-- ------------------------------------------------------------
create table if not exists public.document_number_sequences (
  business_id uuid not null references public.businesses (id) on delete cascade,
  document_type text not null,
  prefix text not null,
  next_number integer not null default 1,
  reset_period text not null default 'never' check (reset_period in ('never', 'yearly', 'monthly')),
  last_reset_key text,
  primary key (business_id, document_type)
);

alter table public.document_number_sequences enable row level security;

create policy "Active members can view their business's document sequences"
  on public.document_number_sequences for select
  using (public.is_active_member(business_id));

-- Owner-adjustable (Vol 13_0 §3.4: "an owner's own invoice/quotation/DO/
-- PV numbering is configurable rather than hardcoded") — `configure` on
-- `settings`, same authorization pattern as set_access_model_override.
create or replace function public.configure_document_sequence(
  p_business_id uuid,
  p_document_type text,
  p_prefix text,
  p_reset_period text
) returns public.document_number_sequences
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row public.document_number_sequences;
begin
  if not public.caller_has_capability(p_business_id, 'settings', 'configure') then
    raise exception 'not_authorized: requires configure on settings';
  end if;
  if p_reset_period not in ('never', 'yearly', 'monthly') then
    raise exception 'invalid_reset_period: must be never, yearly, or monthly';
  end if;

  insert into public.document_number_sequences (business_id, document_type, prefix, reset_period)
  values (p_business_id, p_document_type, p_prefix, p_reset_period)
  on conflict (business_id, document_type) do update set
    prefix = excluded.prefix,
    reset_period = excluded.reset_period
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.configure_document_sequence(uuid, text, text, text) to authenticated;

-- next_document_number: atomically allocates and formats the next
-- number for (business, document_type), auto-provisioning a sequence
-- row with a sensible default prefix on first use so a future module
-- sprint never needs a separate setup step. Serialized per
-- (business, document_type) via pg_advisory_xact_lock, the same
-- convention every per-business-serialized operation in this schema
-- already uses (devices, business_memberships).
create or replace function public.next_document_number(
  p_business_id uuid,
  p_document_type text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.document_number_sequences;
  v_reset_key text;
  v_formatted text;
begin
  perform pg_advisory_xact_lock(hashtext(p_business_id::text || ':' || p_document_type));

  select * into v_row
  from public.document_number_sequences
  where business_id = p_business_id and document_type = p_document_type
  for update;

  if not found then
    insert into public.document_number_sequences (business_id, document_type, prefix, reset_period)
    values (p_business_id, p_document_type, upper(left(p_document_type, 3)), 'never')
    returning * into v_row;
  end if;

  v_reset_key := case v_row.reset_period
    when 'yearly' then to_char(now(), 'YYYY')
    when 'monthly' then to_char(now(), 'YYYYMM')
    else null
  end;

  if v_row.reset_period <> 'never' and (v_row.last_reset_key is distinct from v_reset_key) then
    v_row.next_number := 1;
  end if;

  v_formatted := case v_row.reset_period
    when 'never' then v_row.prefix || '-' || lpad(v_row.next_number::text, 6, '0')
    else v_row.prefix || '-' || v_reset_key || '-' || lpad(v_row.next_number::text, 4, '0')
  end;

  update public.document_number_sequences
  set next_number = v_row.next_number + 1,
      last_reset_key = v_reset_key
  where business_id = p_business_id and document_type = p_document_type;

  return v_formatted;
end;
$$;

grant execute on function public.next_document_number(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 2. public.parties (Vol 13_0 §3.1) — customer/supplier/employee/agent/
-- dropship_partner is one table, not five. `id` stays the schema-wide
-- uuid convention (matching business_memberships.party_id, already
-- added as a bare uuid column in Sprint 23 precisely so this sprint
-- would not need a second migration of that table); the volume's own
-- "PTY-NNNNNN" format is delivered as `party_no`, a separate
-- human-readable display identifier generated through Section 1's
-- shared numbering mechanism — this is a deliberate, disclosed
-- adaptation to keep Party's primary key consistent with every other
-- foreign-keyable table in this schema rather than a literal deviation
-- from the volume's own text.
-- ------------------------------------------------------------
create table if not exists public.parties (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  party_no text not null,
  display_name text not null,
  legal_name text,
  party_types text[] not null,
  registration_no text,
  tin text,
  sst_reg_no text,
  contact_phone text,
  contact_email text,
  billing_address text,
  -- PriceType (Vol 13_0 §5) does not exist until Sprint 27 — no FK yet,
  -- same "column now, FK later" treatment party_id itself got in
  -- Sprint 23.
  price_type_id uuid,
  credit_limit numeric(14, 2),
  credit_terms_days integer,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now(),
  constraint parties_party_types_valid check (
    party_types <@ array['customer', 'supplier', 'employee', 'agent', 'dropship_partner']::text[]
    and array_length(party_types, 1) > 0
  ),
  unique (business_id, party_no)
);

create index if not exists idx_parties_business on public.parties (business_id);

alter table public.parties enable row level security;

-- Visibility follows Vol 13_0 §3.1's own party-type split: an employee
-- record needs `view` on `hr_attendance_leave`; every other party type
-- (customer/supplier/agent/dropship_partner) needs `view` on `sales` —
-- `configure` on `settings` (the Owner template, always) sees
-- everything regardless, the same administrative catch-all
-- set_access_model_override/invite_member already use.
create policy "Members see parties per their sales/hr view grant"
  on public.parties for select
  using (
    public.is_active_member(business_id)
    and (
      public.caller_has_capability(business_id, 'settings', 'configure')
      or (
        'employee' = any(party_types)
        and public.caller_has_capability(business_id, 'hr_attendance_leave', 'view')
      )
      or (
        (party_types && array['customer', 'supplier', 'agent', 'dropship_partner']::text[])
        and public.caller_has_capability(business_id, 'sales', 'view')
      )
    )
  );

-- create_party / update_party: capture-gated per party type, the same
-- split as the select policy above (an `employee` party needs `capture`
-- on `hr_attendance_leave`; every other type needs `capture` on
-- `sales`) — mirrors Vol 13_2 §3's capture-permission-gate posture
-- (checked before the row exists, a clear rejection, not a swallowed
-- request), applied here to Party instead of BusinessEvent.
create or replace function public.create_party(
  p_business_id uuid,
  p_display_name text,
  p_legal_name text,
  p_party_types text[],
  p_registration_no text,
  p_tin text,
  p_sst_reg_no text,
  p_contact_phone text,
  p_contact_email text,
  p_billing_address text,
  p_credit_limit numeric,
  p_credit_terms_days integer
) returns public.parties
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_party_no text;
  v_row public.parties;
begin
  select bm.id into v_caller_membership_id
  from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if v_caller_membership_id is null then
    raise exception 'no_active_membership_for_this_business';
  end if;

  if p_party_types is null or array_length(p_party_types, 1) is null then
    raise exception 'party_types_required';
  end if;

  if 'employee' = any(p_party_types) and not public.caller_has_capability(p_business_id, 'hr_attendance_leave', 'capture') then
    raise exception 'not_authorized_to_capture: no capture access to hr_attendance_leave';
  end if;

  if (p_party_types && array['customer', 'supplier', 'agent', 'dropship_partner']::text[])
     and not public.caller_has_capability(p_business_id, 'sales', 'capture') then
    raise exception 'not_authorized_to_capture: no capture access to sales';
  end if;

  -- Party's own numbering format, Vol 13_0 §3.1's literal "PTY-NNNNNN"
  -- example, differs from next_document_number's generic
  -- upper(left(document_type,3)) auto-provisioned default ('party' ->
  -- 'PAR') — so ensure the 'party' sequence exists with the correct
  -- prefix before ever calling it, on first use only (idempotent).
  insert into public.document_number_sequences (business_id, document_type, prefix, reset_period)
  values (p_business_id, 'party', 'PTY', 'never')
  on conflict (business_id, document_type) do nothing;

  v_party_no := public.next_document_number(p_business_id, 'party');

  insert into public.parties (
    business_id, party_no, display_name, legal_name, party_types, registration_no, tin,
    sst_reg_no, contact_phone, contact_email, billing_address, credit_limit, credit_terms_days,
    created_by_membership_id
  ) values (
    p_business_id, v_party_no, p_display_name, p_legal_name, p_party_types, p_registration_no, p_tin,
    p_sst_reg_no, p_contact_phone, p_contact_email, p_billing_address, p_credit_limit, p_credit_terms_days,
    v_caller_membership_id
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_party(uuid, text, text, text[], text, text, text, text, text, text, numeric, integer) to authenticated;

-- ------------------------------------------------------------
-- 3. public.chart_of_accounts (Vol 13_0 §8) — replaces Vol 11_1 §4.1's
-- fixed 7-bucket subset. `is_system` rows are seeded automatically for
-- every business (backfilled for existing businesses in Section 3b
-- below, and auto-seeded for every future one via the trigger in
-- Section 3c) and can never be deleted or have their account_type
-- changed — Section 8's own "the owner cannot delete" carried through
-- as a real guard, not just a documented convention.
-- ------------------------------------------------------------
create table if not exists public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  account_code text not null,
  account_name text not null,
  account_type text not null check (account_type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  parent_account_id uuid references public.chart_of_accounts (id),
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (business_id, account_code)
);

create index if not exists idx_chart_of_accounts_business ON public.chart_of_accounts (business_id);

alter table public.chart_of_accounts enable row level security;

create policy "Active members can view their business's chart of accounts"
  on public.chart_of_accounts for select
  using (public.is_active_member(business_id));

create or replace function public.enforce_system_account_immutability()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'DELETE' and OLD.is_system then
    raise exception 'cannot_delete_system_account: %', OLD.account_code;
  end if;
  if TG_OP = 'UPDATE' and OLD.is_system and (
    NEW.account_type <> OLD.account_type or NEW.account_code <> OLD.account_code or NEW.is_system <> OLD.is_system
  ) then
    raise exception 'cannot_modify_system_account_type_or_code: %', OLD.account_code;
  end if;
  return coalesce(NEW, OLD);
end;
$$;

create trigger trg_enforce_system_account_immutability
  before update or delete on public.chart_of_accounts
  for each row execute function public.enforce_system_account_immutability();

-- create_chart_of_account: an owner adding a custom (non-system)
-- account — `configure` on `accounting_reports`, matching how a
-- Bookkeeper's own template already carries that capability.
create or replace function public.create_chart_of_account(
  p_business_id uuid,
  p_account_code text,
  p_account_name text,
  p_account_type text,
  p_parent_account_id uuid
) returns public.chart_of_accounts
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row public.chart_of_accounts;
begin
  if not public.caller_has_capability(p_business_id, 'accounting_reports', 'configure') then
    raise exception 'not_authorized: requires configure on accounting_reports';
  end if;
  if p_account_type not in ('asset', 'liability', 'equity', 'revenue', 'expense') then
    raise exception 'invalid_account_type: %', p_account_type;
  end if;

  insert into public.chart_of_accounts (business_id, account_code, account_name, account_type, parent_account_id, is_system)
  values (p_business_id, p_account_code, p_account_name, p_account_type, p_parent_account_id, false)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_chart_of_account(uuid, text, text, text, uuid) to authenticated;

-- 3a. The Vol 11_1 §4.1 Phase 1 seed set, exact 1:1 mapping, as its own
-- reusable function (called both by the one-time backfill in 3b and
-- the on-insert trigger in 3c, so there is exactly one place this list
-- is written, not two copies that could drift).
create or replace function public.seed_phase1_chart_of_accounts(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opex_id uuid;
begin
  insert into public.chart_of_accounts (business_id, account_code, account_name, account_type, is_system)
  values
    (p_business_id, '1000', 'Cash / Bank', 'asset', true),
    (p_business_id, '1100', 'Accounts Receivable', 'asset', true),
    (p_business_id, '2000', 'Accounts Payable', 'liability', true),
    (p_business_id, '3000', 'Owner''s Equity / Drawings', 'equity', true),
    (p_business_id, '4000', 'Sales Revenue', 'revenue', true),
    (p_business_id, '5000', 'Cost of Goods Sold', 'expense', true)
  on conflict (business_id, account_code) do nothing;

  insert into public.chart_of_accounts (business_id, account_code, account_name, account_type, is_system)
  values (p_business_id, '6000', 'Operating Expenses', 'expense', true)
  on conflict (business_id, account_code) do nothing;

  select id into v_opex_id from public.chart_of_accounts
  where business_id = p_business_id and account_code = '6000';

  insert into public.chart_of_accounts (business_id, account_code, account_name, account_type, parent_account_id, is_system)
  values
    (p_business_id, '6100', 'Supplies', 'expense', v_opex_id, true),
    (p_business_id, '6200', 'Rent', 'expense', v_opex_id, true),
    (p_business_id, '6300', 'Utilities', 'expense', v_opex_id, true),
    (p_business_id, '6400', 'Marketing', 'expense', v_opex_id, true),
    (p_business_id, '6900', 'Other', 'expense', v_opex_id, true)
  on conflict (business_id, account_code) do nothing;
end;
$$;

-- 3b. One-time backfill — every existing business gets the Phase 1 set.
do $$
declare
  v_business record;
begin
  for v_business in select id from public.businesses loop
    perform public.seed_phase1_chart_of_accounts(v_business.id);
  end loop;
end;
$$;

-- 3c. Every future business gets the same set automatically, the
-- moment its row is created — no separate onboarding step needed.
create or replace function public.seed_chart_of_accounts_on_business_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_phase1_chart_of_accounts(new.id);
  return new;
end;
$$;

create trigger trg_seed_chart_of_accounts_on_business_insert
  after insert on public.businesses
  for each row execute function public.seed_chart_of_accounts_on_business_insert();

-- ------------------------------------------------------------
-- 4. public.bank_accounts / public.bank_statement_lines (Vol 13_0 §8) —
-- reconciliation support, paired with ChartOfAccounts.
-- ------------------------------------------------------------
create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  account_name text not null,
  ledger_account_id uuid not null references public.chart_of_accounts (id),
  opening_balance numeric(14, 2) not null default 0,
  created_at timestamptz not null default now()
);

alter table public.bank_accounts enable row level security;

create policy "Active members can view their business's bank accounts"
  on public.bank_accounts for select
  using (public.is_active_member(business_id));

create or replace function public.create_bank_account(
  p_business_id uuid,
  p_account_name text,
  p_ledger_account_id uuid,
  p_opening_balance numeric
) returns public.bank_accounts
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row public.bank_accounts;
begin
  if not public.caller_has_capability(p_business_id, 'accounting_reports', 'configure') then
    raise exception 'not_authorized: requires configure on accounting_reports';
  end if;
  if not exists (
    select 1 from public.chart_of_accounts
    where id = p_ledger_account_id and business_id = p_business_id
  ) then
    raise exception 'ledger_account_not_found_for_this_business: %', p_ledger_account_id;
  end if;

  insert into public.bank_accounts (business_id, account_name, ledger_account_id, opening_balance)
  values (p_business_id, p_account_name, p_ledger_account_id, coalesce(p_opening_balance, 0))
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_bank_account(uuid, text, uuid, numeric) to authenticated;

create table if not exists public.bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.bank_accounts (id) on delete cascade,
  statement_date date not null,
  description text,
  amount numeric(14, 2) not null,
  matched_ledger_entry_id uuid,
  match_status text not null default 'unmatched' check (match_status in ('unmatched', 'matched', 'ignored')),
  created_at timestamptz not null default now()
);

create index if not exists idx_bank_statement_lines_account
  on public.bank_statement_lines (bank_account_id);

alter table public.bank_statement_lines enable row level security;

create policy "Active members can view their business's bank statement lines"
  on public.bank_statement_lines for select
  using (
    exists (
      select 1 from public.bank_accounts ba
      where ba.id = bank_statement_lines.bank_account_id
        and public.is_active_member(ba.business_id)
    )
  );

-- ------------------------------------------------------------
-- 5. public.ledger_entries (Vol 11_1 §4, Vol 13_0 §8's foreign-key
-- target) — see this file's header for why this is a brand-new,
-- real Postgres table rather than an ALTER of an existing one, and for
-- the explicit scope boundary on the client-side cutover.
-- `matched_ledger_entry_id` above deliberately has no FK to this table
-- yet — bank_statement_lines was designed before this decision point
-- and adding the FK now is a one-line follow-up, not a blocker; noted
-- rather than silently done, since it's a genuine ordering artifact of
-- how this migration was written top-to-bottom.
-- ------------------------------------------------------------
create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  -- BusinessData (Vol 4_0) is still local-first/encrypted, same as
  -- BusinessEvent was before Sprint 25 — no FK yet, same "column now,
  -- FK later" treatment as business_memberships.party_id.
  business_data_id uuid,
  chart_of_accounts_id uuid not null references public.chart_of_accounts (id),
  direction text not null check (direction in ('debit', 'credit')),
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null default 'MYR',
  posted_at timestamptz not null default now(),
  reversal_of uuid references public.ledger_entries (id),
  posted_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now()
);

create index if not exists idx_ledger_entries_business_account
  on public.ledger_entries (business_id, chart_of_accounts_id);

create index if not exists idx_ledger_entries_business_data
  on public.ledger_entries (business_data_id)
  where business_data_id is not null;

alter table public.ledger_entries enable row level security;

create policy "Members with accounting_reports view can see the ledger"
  on public.ledger_entries for select
  using (public.caller_has_capability(business_id, 'accounting_reports', 'view'));

-- post_ledger_entries: the single entry point for posting — takes a
-- JSONB array so a caller posts a whole balanced batch atomically
-- (Vol 2_2 §6: every posted entry must balance before acceptance), the
-- same invariant the client-side ledgerRepository.ts header comment
-- already documents ("always posted as a balanced debit/credit pair by
-- the caller"), now enforced server-side by construction rather than
-- only by caller discipline. `configure` on `accounting_reports` —
-- ledger posting is a bookkeeping-privileged action (the Bookkeeper
-- template already carries this capability), not an ordinary capture
-- action any role performs directly; future modules that need to post
-- automatically (e.g. an approved Invoice posting to the ledger) call
-- this from their own SECURITY DEFINER function, which is unaffected
-- by this RLS-style check since it runs as its own privileged context.
create or replace function public.post_ledger_entries(
  p_business_id uuid,
  p_business_data_id uuid,
  p_entries jsonb
) returns setof public.ledger_entries
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_entry jsonb;
  v_debit_total numeric(14, 2) := 0;
  v_credit_total numeric(14, 2) := 0;
  v_direction text;
  v_amount numeric(14, 2);
  v_new_row public.ledger_entries;
  v_ids uuid[] := array[]::uuid[];
begin
  if not public.caller_has_capability(p_business_id, 'accounting_reports', 'configure') then
    raise exception 'not_authorized: requires configure on accounting_reports';
  end if;

  select bm.id into v_caller_membership_id
  from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if p_entries is null or jsonb_array_length(p_entries) = 0 then
    raise exception 'no_entries_supplied';
  end if;

  for v_entry in select * from jsonb_array_elements(p_entries) loop
    v_direction := v_entry ->> 'direction';
    v_amount := (v_entry ->> 'amount')::numeric;
    if v_direction not in ('debit', 'credit') then
      raise exception 'invalid_direction: %', v_direction;
    end if;
    if v_amount is null or v_amount <= 0 then
      raise exception 'invalid_amount: entries must have a positive amount';
    end if;
    if v_direction = 'debit' then
      v_debit_total := v_debit_total + v_amount;
    else
      v_credit_total := v_credit_total + v_amount;
    end if;
  end loop;

  if v_debit_total <> v_credit_total then
    raise exception 'unbalanced_ledger_entry_batch: debits % != credits %', v_debit_total, v_credit_total;
  end if;

  for v_entry in select * from jsonb_array_elements(p_entries) loop
    insert into public.ledger_entries (
      business_id, business_data_id, chart_of_accounts_id, direction, amount, currency,
      reversal_of, posted_by_membership_id
    ) values (
      p_business_id,
      p_business_data_id,
      (v_entry ->> 'chart_of_accounts_id')::uuid,
      v_entry ->> 'direction',
      (v_entry ->> 'amount')::numeric,
      coalesce(v_entry ->> 'currency', 'MYR'),
      nullif(v_entry ->> 'reversal_of', '')::uuid,
      v_caller_membership_id
    )
    returning * into v_new_row;
    v_ids := v_ids || v_new_row.id;
  end loop;

  return query select * from public.ledger_entries where id = any(v_ids) order by created_at asc;
end;
$$;

grant execute on function public.post_ledger_entries(uuid, uuid, jsonb) to authenticated;

-- End of Sprint 26 migration.
