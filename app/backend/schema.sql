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

-- ==============================================================
-- AIFA backend schema — Sprint 27 (Vol 13_0 §5 Harga & Kos Jualan;
-- §7's ProductImportBatch, pulled forward per this sprint's own plan).
--
-- Pricing & Product Catalog — products, price types, the price-list
-- resolution rule (PRICE-001) Sprint 28's Invoice/Quotation module
-- depends on, and a staging-first Excel product import.
--
-- SCOPE NOTE on Excel import, disclosed rather than silently assumed:
-- this sprint's own Risks table calls for a real sample file from the
-- owner before finalising the parser; none was available while writing
-- this migration. The staging schema below (product_import_batches /
-- product_import_rows) is real, tested, and format-agnostic — raw_data
-- is kept as JSONB per row precisely so it isn't locked to one column
-- layout — but the client-side header-matching parser
-- (packages/core/src/catalog/productImportParser.ts) uses conventional
-- header names (SKU/Product Code, Name/Description, Unit/UOM, Cost) as
-- a reasonable starting guess, not something validated against the
-- owner's actual product list. Flagged in this sprint's own doc
-- Outcomes as needing that validation pass once a real file exists —
-- same "time-box, small additive refinement expected" discipline this
-- sprint's own Risks table already names for document numbering in
-- Sprint 28.
-- ==============================================================

-- ------------------------------------------------------------
-- 1. public.price_types (Vol 13_0 §5). The first PriceType a business
-- creates becomes its default automatically (a business cannot have
-- zero default price types once it has any) — `set_default_price_type`
-- is how an owner changes which one later.
-- ------------------------------------------------------------
create table if not exists public.price_types (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (business_id, name)
);

-- At most one default per business — mirrors business_memberships_one_
-- active_owner's own partial-unique-index pattern.
create unique index if not exists price_types_one_default_per_business
  on public.price_types (business_id)
  where is_default;

alter table public.price_types enable row level security;

create policy "Active members with pricing view can see price types"
  on public.price_types for select
  using (public.caller_has_capability(business_id, 'pricing', 'view'));

create or replace function public.create_price_type(
  p_business_id uuid,
  p_name text
) returns public.price_types
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row public.price_types;
  v_is_first boolean;
begin
  if not public.caller_has_capability(p_business_id, 'pricing', 'capture') then
    raise exception 'not_authorized: requires capture on pricing';
  end if;

  select not exists (select 1 from public.price_types where business_id = p_business_id) into v_is_first;

  insert into public.price_types (business_id, name, is_default)
  values (p_business_id, p_name, v_is_first)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_price_type(uuid, text) to authenticated;

create or replace function public.set_default_price_type(
  p_business_id uuid,
  p_price_type_id uuid
) returns public.price_types
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row public.price_types;
begin
  if not public.caller_has_capability(p_business_id, 'pricing', 'capture') then
    raise exception 'not_authorized: requires capture on pricing';
  end if;
  if not exists (select 1 from public.price_types where id = p_price_type_id and business_id = p_business_id) then
    raise exception 'price_type_not_found_for_this_business: %', p_price_type_id;
  end if;

  update public.price_types set is_default = false where business_id = p_business_id and is_default;
  update public.price_types set is_default = true where id = p_price_type_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.set_default_price_type(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 1a. Now that PriceType exists, give business_memberships... no —
-- `parties.price_type_id` (added Sprint 26, deliberately without an FK
-- since PriceType didn't exist yet) gets its foreign key now.
-- ------------------------------------------------------------
alter table public.parties
  add constraint parties_price_type_id_fkey
  foreign key (price_type_id) references public.price_types (id);

create or replace function public.set_party_price_type(
  p_party_id uuid,
  p_price_type_id uuid
) returns public.parties
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_business_id uuid;
  v_row public.parties;
begin
  select business_id into v_business_id from public.parties where id = p_party_id;
  if v_business_id is null then
    raise exception 'party_not_found: %', p_party_id;
  end if;
  if not public.caller_has_capability(v_business_id, 'pricing', 'capture') then
    raise exception 'not_authorized: requires capture on pricing';
  end if;
  if p_price_type_id is not null and not exists (
    select 1 from public.price_types where id = p_price_type_id and business_id = v_business_id
  ) then
    raise exception 'price_type_not_found_for_this_business: %', p_price_type_id;
  end if;

  update public.parties set price_type_id = p_price_type_id
  where id = p_party_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.set_party_price_type(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 2. public.products (Vol 13_0 §5). `cost_source = 'auto_from_purchase'`
-- is in the CHECK constraint (schema is forward-compatible the moment
-- the Purchase module addendum ships) but `create_product` rejects it
-- server-side this sprint — a backstop behind "hide the option in UI
-- entirely" (this sprint's own Risks table), not a substitute for it.
-- ------------------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  sku text,
  name text not null,
  unit_of_measure text not null,
  default_cost numeric(14, 2),
  cost_source text not null default 'manual' check (cost_source in ('manual', 'auto_from_purchase')),
  track_inventory boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now(),
  unique (business_id, sku)
);

create index if not exists idx_products_business on public.products (business_id);

alter table public.products enable row level security;

create policy "Active members with pricing view can see products"
  on public.products for select
  using (public.caller_has_capability(business_id, 'pricing', 'view'));

create or replace function public.create_product(
  p_business_id uuid,
  p_sku text,
  p_name text,
  p_unit_of_measure text,
  p_default_cost numeric,
  p_cost_source text,
  p_track_inventory boolean
) returns public.products
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_row public.products;
begin
  if not public.caller_has_capability(p_business_id, 'pricing', 'capture') then
    raise exception 'not_authorized: requires capture on pricing';
  end if;

  select bm.id into v_caller_membership_id
  from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if coalesce(p_cost_source, 'manual') = 'auto_from_purchase' then
    raise exception 'auto_from_purchase_not_yet_available: Purchase module addendum has not shipped (Vol 13_0 §5) — use manual for now';
  end if;

  insert into public.products (
    business_id, sku, name, unit_of_measure, default_cost, cost_source, track_inventory,
    created_by_membership_id
  ) values (
    p_business_id, nullif(p_sku, ''), p_name, p_unit_of_measure, p_default_cost,
    coalesce(p_cost_source, 'manual'), coalesce(p_track_inventory, false), v_caller_membership_id
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_product(uuid, text, text, text, numeric, text, boolean) to authenticated;

-- ------------------------------------------------------------
-- 3. public.price_list_entries (Vol 13_0 §5).
-- ------------------------------------------------------------
create table if not exists public.price_list_entries (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  price_type_id uuid not null references public.price_types (id),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  effective_from date not null default current_date,
  effective_to date,
  promo_note text,
  created_at timestamptz not null default now(),
  constraint price_list_entries_valid_window check (effective_to is null or effective_to >= effective_from)
);

create index if not exists idx_price_list_entries_product_type
  on public.price_list_entries (product_id, price_type_id, effective_from);

alter table public.price_list_entries enable row level security;

create policy "Active members with pricing view can see price list entries"
  on public.price_list_entries for select
  using (
    exists (
      select 1 from public.products p
      where p.id = price_list_entries.product_id
        and public.caller_has_capability(p.business_id, 'pricing', 'view')
    )
  );

create or replace function public.create_price_list_entry(
  p_product_id uuid,
  p_price_type_id uuid,
  p_unit_price numeric,
  p_effective_from date,
  p_effective_to date,
  p_promo_note text
) returns public.price_list_entries
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_business_id uuid;
  v_row public.price_list_entries;
begin
  select business_id into v_business_id from public.products where id = p_product_id;
  if v_business_id is null then
    raise exception 'product_not_found: %', p_product_id;
  end if;
  if not public.caller_has_capability(v_business_id, 'pricing', 'capture') then
    raise exception 'not_authorized: requires capture on pricing';
  end if;
  if not exists (select 1 from public.price_types where id = p_price_type_id and business_id = v_business_id) then
    raise exception 'price_type_not_found_for_this_business: %', p_price_type_id;
  end if;

  insert into public.price_list_entries (
    product_id, price_type_id, unit_price, effective_from, effective_to, promo_note
  ) values (
    p_product_id, p_price_type_id, p_unit_price, coalesce(p_effective_from, current_date), p_effective_to, p_promo_note
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_price_list_entry(uuid, uuid, numeric, date, date, text) to authenticated;

-- ------------------------------------------------------------
-- 4. Governed rule PRICE-001 (Vol 13_0 §5) — implemented as a
-- deterministic SQL function, the same "recorded for governance/audit
-- provenance, applied deterministically" treatment
-- pka/accounting_rules.json's own BANK-001 entry already gives a rule
-- that isn't run through the AI-confidence classification pipeline.
-- PRICE-001's own JSON entry (packages/core/pka/accounting_rules.json)
-- cross-references this function by name so the rule's prose and its
-- runtime implementation don't drift apart.
--
-- Resolution order, matching Vol 13_0 §5 exactly for the "party has no
-- price type set" case, PLUS one disclosed extension: if the party's
-- own price type has no currently-effective PriceListEntry for this
-- product, this also falls back to the business default price type's
-- entry (rather than raising immediately) — the volume's text only
-- states the fallback for "customer has none set", not for "customer's
-- price type exists but this specific product has no entry for it";
-- erroring outright in that second case seemed a worse default than
-- falling back the same way, so it is called out here rather than left
-- to be discovered as a surprise.
-- ------------------------------------------------------------
create or replace function public.resolve_price(
  p_business_id uuid,
  p_product_id uuid,
  p_party_id uuid
) returns table (
  unit_price numeric,
  price_type_id uuid,
  price_list_entry_id uuid,
  used_business_default boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_party_price_type_id uuid;
  v_default_price_type_id uuid;
  v_row record;
begin
  if p_party_id is not null then
    select pty.price_type_id into v_party_price_type_id
    from public.parties pty
    where pty.id = p_party_id and pty.business_id = p_business_id;
  end if;

  if v_party_price_type_id is not null then
    select ple.unit_price as up, ple.price_type_id as pt, ple.id as id into v_row
    from public.price_list_entries ple
    where ple.product_id = p_product_id
      and ple.price_type_id = v_party_price_type_id
      and ple.effective_from <= current_date
      and (ple.effective_to is null or ple.effective_to >= current_date)
    order by ple.effective_from desc
    limit 1;

    if found then
      return query select v_row.up, v_row.pt, v_row.id, false;
      return;
    end if;
  end if;

  select id into v_default_price_type_id
  from public.price_types
  where business_id = p_business_id and is_default;

  if v_default_price_type_id is not null then
    select ple.unit_price as up, ple.price_type_id as pt, ple.id as id into v_row
    from public.price_list_entries ple
    where ple.product_id = p_product_id
      and ple.price_type_id = v_default_price_type_id
      and ple.effective_from <= current_date
      and (ple.effective_to is null or ple.effective_to >= current_date)
    order by ple.effective_from desc
    limit 1;

    if found then
      return query select v_row.up, v_row.pt, v_row.id, true;
      return;
    end if;
  end if;

  raise exception 'no_price_resolvable: no effective PriceListEntry for product % under the party''s price type or the business default', p_product_id;
end;
$$;

grant execute on function public.resolve_price(uuid, uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 5. Product import staging (Vol 13_0 §7, pulled forward). Parse ->
-- validate -> owner review -> commit, same "never silently guess a bad
-- row" discipline Vol 0_1 §7 already applies to OCR failure. `raw_data`
-- is kept as JSONB per row deliberately (see this file's header) so the
-- staging schema itself isn't locked to one column layout even though
-- the client-side parser currently is.
-- ------------------------------------------------------------
create table if not exists public.product_import_batches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  source_file_ref text not null,
  status text not null default 'parsed' check (status in ('parsed', 'applied', 'failed')),
  row_count integer not null default 0,
  error_count integer not null default 0,
  created_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now()
);

alter table public.product_import_batches enable row level security;

create policy "Active members with pricing view can see import batches"
  on public.product_import_batches for select
  using (public.caller_has_capability(business_id, 'pricing', 'view'));

create table if not exists public.product_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.product_import_batches (id) on delete cascade,
  row_no integer not null,
  raw_data jsonb not null,
  parsed_sku text,
  parsed_name text,
  parsed_unit_of_measure text,
  parsed_default_cost numeric(14, 2),
  parse_status text not null check (parse_status in ('ok', 'error')),
  error_message text,
  created_product_id uuid references public.products (id),
  unique (batch_id, row_no)
);

create index if not exists idx_product_import_rows_batch on public.product_import_rows (batch_id);

alter table public.product_import_rows enable row level security;

create policy "Active members with pricing view can see import rows"
  on public.product_import_rows for select
  using (
    exists (
      select 1 from public.product_import_batches b
      where b.id = product_import_rows.batch_id
        and public.caller_has_capability(b.business_id, 'pricing', 'view')
    )
  );

-- create_product_import_batch: stages a whole parsed file's rows in one
-- call (the client does the actual Excel parsing — see this file's
-- header — and hands over already-parsed rows plus their raw source
-- data for audit). Every row lands as either parse_status='ok' or
-- 'error' with a message; nothing is silently dropped, and error rows
-- never create a product.
create or replace function public.create_product_import_batch(
  p_business_id uuid,
  p_source_file_ref text,
  p_rows jsonb
) returns public.product_import_batches
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_batch public.product_import_batches;
  v_row jsonb;
  v_row_no integer := 0;
  v_error_count integer := 0;
  v_row_count integer := 0;
begin
  if not public.caller_has_capability(p_business_id, 'pricing', 'capture') then
    raise exception 'not_authorized: requires capture on pricing';
  end if;

  select bm.id into v_caller_membership_id
  from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    raise exception 'no_rows_supplied';
  end if;

  insert into public.product_import_batches (business_id, source_file_ref, status, created_by_membership_id)
  values (p_business_id, p_source_file_ref, 'parsed', v_caller_membership_id)
  returning * into v_batch;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_row_no := v_row_no + 1;
    v_row_count := v_row_count + 1;
    if (v_row ->> 'parse_status') = 'error' then
      v_error_count := v_error_count + 1;
    end if;
    insert into public.product_import_rows (
      batch_id, row_no, raw_data, parsed_sku, parsed_name, parsed_unit_of_measure,
      parsed_default_cost, parse_status, error_message
    ) values (
      v_batch.id,
      v_row_no,
      coalesce(v_row -> 'raw_data', v_row),
      nullif(v_row ->> 'sku', ''),
      nullif(v_row ->> 'name', ''),
      nullif(v_row ->> 'unit_of_measure', ''),
      nullif(v_row ->> 'default_cost', '')::numeric,
      coalesce(v_row ->> 'parse_status', 'error'),
      v_row ->> 'error_message'
    );
  end loop;

  update public.product_import_batches
  set row_count = v_row_count, error_count = v_error_count,
      status = case when v_error_count = v_row_count then 'failed' else 'parsed' end
  where id = v_batch.id
  returning * into v_batch;

  return v_batch;
end;
$$;

grant execute on function public.create_product_import_batch(uuid, text, jsonb) to authenticated;

-- apply_product_import_batch: owner-review commit step — only 'ok' rows
-- that don't already have a created_product_id get turned into real
-- Product rows; 'error' rows are left exactly as they are (never
-- silently dropped, never silently guessed into a product) for the
-- owner to correct and re-stage in a follow-up batch. Re-running this
-- on an already-applied batch is a safe no-op for rows already linked
-- to a product.
create or replace function public.apply_product_import_batch(
  p_batch_id uuid
) returns public.product_import_batches
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_batch public.product_import_batches;
  v_row record;
  v_new_product public.products;
begin
  select * into v_batch from public.product_import_batches where id = p_batch_id;
  if not found then
    raise exception 'import_batch_not_found: %', p_batch_id;
  end if;
  if not public.caller_has_capability(v_batch.business_id, 'pricing', 'capture') then
    raise exception 'not_authorized: requires capture on pricing';
  end if;

  for v_row in
    select * from public.product_import_rows
    where batch_id = p_batch_id and parse_status = 'ok' and created_product_id is null
  loop
    insert into public.products (business_id, sku, name, unit_of_measure, cost_source, track_inventory)
    values (v_batch.business_id, v_row.parsed_sku, v_row.parsed_name, v_row.parsed_unit_of_measure, 'manual', false)
    returning * into v_new_product;

    update public.product_import_rows set created_product_id = v_new_product.id where id = v_row.id;
  end loop;

  update public.product_import_batches set status = 'applied' where id = p_batch_id
  returning * into v_batch;

  return v_batch;
end;
$$;

grant execute on function public.apply_product_import_batch(uuid) to authenticated;

-- End of Sprint 27 migration.

-- ==============================================================
-- AIFA backend schema — Sprint 28 (Vol 13_0 §4 Module A: Invois &
-- Quotation, §4.1 WhatsApp send). First real exercise of Sprint 25's
-- ApprovalTask engine against real domain data (quotations), and the
-- first module built on the full Sprint 21-27 foundation.
--
-- SCOPE NOTES (disclosed):
--
-- 1. DocumentHeader.business_event_id (Vol 13_0 §3.2) is omitted.
--    Like `ledger_entry` before Sprint 26, `BusinessEvent` (Vol 4_0)
--    has no real server-side table — it exists only as an encrypted
--    sync_envelopes payload shape under the local-first model. There
--    is nothing server-side for this column to reference. Sprint
--    25/26's own convention (captured_by_membership_id) is used for
--    capture attribution instead, same as approval_tasks and parties.
--
-- 2. DocumentHeader.created_by (Vol 13_0 §3.2, "ai" | party/user id)
--    is likewise replaced by captured_by_membership_id, for the same
--    reason approval_tasks uses it rather than a free-form string —
--    a real FK is more useful and auditable than a tagged string.
--
-- 3. Invoice.delivery_order_id (Vol 13_0 §4) is included as a plain
--    nullable uuid column with NO foreign key yet — `DeliveryOrder`
--    doesn't exist until Sprint 31 (Module D). Same disclosed pattern
--    Sprint 26 used for bank_statement_lines.matched_ledger_entry_id.
--
-- 4. Quotation.status deliberately matches Vol 13_0 §4's literal enum
--    (draft | sent | accepted | rejected | expired |
--    converted_to_invoice) with no invented "approved" value. The
--    "internally approved, ready to send" state lives on the linked
--    ApprovalTask row instead (subject_type='quotation'), which is
--    exactly what Vol 13_0 §3.3 designed ApprovalTask to be: the one
--    shared gate every module reuses, not a status value duplicated
--    into each subject table. build_whatsapp_quotation_link checks
--    the ApprovalTask's status directly rather than a mirrored
--    quotation.status value.
--
--    A quotation's own `status = 'rejected'` is used for BOTH "the
--    internal approver declined to send this" (via the trigger below)
--    and "the customer declined the quote" (via
--    mark_quotation_rejected) — Vol 13_0's literal enum doesn't
--    distinguish the two, and this migration doesn't invent a new
--    status value to split them. Disclosed as a Phase 1 simplification,
--    not a silent conflation.
--
-- 5. Outstanding_balance (Vol 13_0 §4's Invoice shape) is set once, at
--    invoice creation, equal to grand_total, and never updated by
--    this migration — `public.payments` doesn't exist until Sprint 29
--    (Vol 13_0 §4's own Payment table), so there is nothing yet to
--    net it against. Disclosed, not silently left half-implemented.
--
-- 6. `Invoice.due_date` uses Party.credit_terms_days when set; Vol
--    13_0 doesn't specify a default when it's null, so this migration
--    defaults to 0 days (due on issue) — disclosed choice, easy to
--    revisit once a real owner preference is known.
--
-- 7. Ledger posting (SALE-001, "debit AR / credit Sales Revenue" —
--    Vol 13_0's own domain-flow text: "same posting rule SALE-001
--    already governs... no change to that PKA rule, only its trigger
--    point") is done via a direct, hand-balanced insert into
--    ledger_entries inside convert_quotation_to_invoice, NOT by
--    calling Sprint 26's public.post_ledger_entries. That RPC is
--    gated on 'configure' on accounting_reports — appropriate for a
--    human directly posting a manual journal entry, but wrong here:
--    the caller converting a quotation is a Sales Agent (capture on
--    sales only), and the posting is an automatic system consequence
--    of an already-authorized sales action, not a separate manual
--    entry they are choosing to make. Reusing post_ledger_entries's
--    RPC entry point would have made every such conversion fail for
--    the exact role this module is built for. The same table and the
--    same balanced-batch invariant are used either way (debit total
--    trivially equals credit total here, by construction — one debit
--    line, one credit line, both grand_total); this is a disclosed,
--    deliberate choice of entry point, not silent duplication.
--
-- 8. Two real, disclosed bug fixes to existing Sprint 25/27 code,
--    found while building on top of them (Sprint 28's own risk note
--    anticipated exactly this — "first real exercise... surfaces a
--    schema gap... fix it here, don't treat it as scope failure"):
--
--    a) public.resolve_price (Sprint 27) had NO authorization check
--       at all — SECURITY DEFINER with no caller_has_capability call,
--       meaning any authenticated user, even a non-member of the
--       business, could read pricing data for any business_id/
--       product_id/party_id triple. Sprint 27's own test suite never
--       caught this because it only exercised RLS-covered SELECTs on
--       the underlying tables, not this SECURITY DEFINER function
--       directly. Fixed here by adding a
--       caller_has_capability(business_id, 'pricing', 'view') check.
--
--    b) public.create_approval_task (Sprint 25) accepted no
--       "what should fire once this is approved" input, and
--       public.resolve_approval_task unconditionally overwrites
--       `next_action` on every resolve (it's reused there for a
--       different purpose — the blocked-awaiting-reviewer routing
--       message) — so Vol 13_0 §3.3's own field description ("next_
--       action: what fires automatically once approved, e.g. 'send
--       WhatsApp'") was never actually persisted by anything. Fixed
--       by adding a separate `on_approval_action` column that
--       create_approval_task now accepts and persists, left untouched
--       by resolve_approval_task's own next_action management.
-- ==============================================================

-- ------------------------------------------------------------
-- 0. Bug fixes to Sprint 25/27 code (see header notes 8a, 8b).
-- ------------------------------------------------------------

alter table public.approval_tasks
  add column if not exists on_approval_action text;

create or replace function public.create_approval_task(
  p_business_id uuid,
  p_domain text,
  p_subject_type text,
  p_subject_id uuid,
  p_amount numeric,
  p_ai_draft_summary text,
  p_ai_confidence numeric,
  p_captured_by_membership_id uuid,
  p_auto_approved boolean default false,
  p_on_approval_action text default null
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
      resolved_via, status, decided_at, on_approval_action
    ) values (
      p_business_id, p_domain, p_subject_type, p_subject_id, p_amount,
      p_ai_draft_summary, p_ai_confidence, p_captured_by_membership_id,
      'auto_approved', 'auto_approved', now(), p_on_approval_action
    )
    returning * into v_row;
    return v_row;
  end if;

  insert into public.approval_tasks (
    business_id, domain, subject_type, subject_id, amount,
    ai_draft_summary, ai_confidence, captured_by_membership_id,
    resolved_via, status, on_approval_action
  ) values (
    p_business_id, p_domain, p_subject_type, p_subject_id, p_amount,
    p_ai_draft_summary, p_ai_confidence, p_captured_by_membership_id,
    'escalation', -- placeholder, overwritten by resolve_approval_task below
    'pending_approval', p_on_approval_action
  )
  returning * into v_row;

  return public.resolve_approval_task(v_row.id);
end;
$$;

grant execute on function public.create_approval_task(uuid, text, text, uuid, numeric, text, numeric, uuid, boolean, text) to authenticated;

create or replace function public.resolve_price(
  p_business_id uuid, p_product_id uuid, p_party_id uuid
) returns table (unit_price numeric, price_type_id uuid, price_list_entry_id uuid, used_business_default boolean)
language plpgsql stable security definer set search_path = public, auth
as $$
declare v_party_price_type_id uuid; v_default_price_type_id uuid; v_row record;
begin
  if not public.caller_has_capability(p_business_id, 'pricing', 'view') then
    raise exception 'not_authorized: requires view on pricing';
  end if;

  if p_party_id is not null then
    select pty.price_type_id into v_party_price_type_id from public.parties pty
    where pty.id = p_party_id and pty.business_id = p_business_id;
  end if;
  if v_party_price_type_id is not null then
    select ple.unit_price as up, ple.price_type_id as pt, ple.id as id into v_row
    from public.price_list_entries ple
    where ple.product_id = p_product_id and ple.price_type_id = v_party_price_type_id
      and ple.effective_from <= current_date and (ple.effective_to is null or ple.effective_to >= current_date)
    order by ple.effective_from desc limit 1;
    if found then return query select v_row.up, v_row.pt, v_row.id, false; return; end if;
  end if;
  select id into v_default_price_type_id from public.price_types where business_id = p_business_id and is_default;
  if v_default_price_type_id is not null then
    select ple.unit_price as up, ple.price_type_id as pt, ple.id as id into v_row
    from public.price_list_entries ple
    where ple.product_id = p_product_id and ple.price_type_id = v_default_price_type_id
      and ple.effective_from <= current_date and (ple.effective_to is null or ple.effective_to >= current_date)
    order by ple.effective_from desc limit 1;
    if found then return query select v_row.up, v_row.pt, v_row.id, true; return; end if;
  end if;
  raise exception 'no_price_resolvable: no effective PriceListEntry for product % under the party''s price type or the business default', p_product_id;
end; $$;

grant execute on function public.resolve_price(uuid, uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 1. public.quotations / public.quotation_lines (Vol 13_0 §4, §3.2)
-- ------------------------------------------------------------
create table if not exists public.quotations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  quotation_no text not null,
  party_id uuid not null references public.parties (id),
  status text not null default 'draft' check (status in (
    'draft', 'sent', 'accepted', 'rejected', 'expired', 'converted_to_invoice'
  )),
  issue_date date not null default current_date,
  valid_until date,
  currency text not null default 'MYR',
  subtotal numeric(14, 2) not null default 0,
  tax_total numeric(14, 2) not null default 0,
  grand_total numeric(14, 2) not null default 0,
  notes text,
  converted_invoice_id uuid,
  captured_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now(),
  unique (business_id, quotation_no)
);
create index if not exists idx_quotations_business on public.quotations (business_id);
alter table public.quotations enable row level security;
create policy "Active members with sales view can see quotations"
  on public.quotations for select using (public.caller_has_capability(business_id, 'sales', 'view'));

create table if not exists public.quotation_lines (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations (id) on delete cascade,
  line_no integer not null,
  product_id uuid references public.products (id),
  description text not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  unit_cost numeric(14, 2),
  tax_code text,
  discount_amount numeric(14, 2) not null default 0,
  line_total numeric(14, 2) not null,
  unique (quotation_id, line_no)
);
create index if not exists idx_quotation_lines_quotation on public.quotation_lines (quotation_id);
alter table public.quotation_lines enable row level security;
create policy "Active members with sales view can see quotation lines"
  on public.quotation_lines for select using (
    exists (select 1 from public.quotations q where q.id = quotation_lines.quotation_id
      and public.caller_has_capability(q.business_id, 'sales', 'view'))
  );

-- ------------------------------------------------------------
-- 2. public.invoices / public.invoice_lines (Vol 13_0 §4, §3.2)
-- ------------------------------------------------------------
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  invoice_no text not null,
  party_id uuid not null references public.parties (id),
  status text not null default 'issued' check (status in (
    'draft', 'issued', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled'
  )),
  issue_date date not null default current_date,
  due_date date not null,
  currency text not null default 'MYR',
  subtotal numeric(14, 2) not null default 0,
  tax_total numeric(14, 2) not null default 0,
  grand_total numeric(14, 2) not null default 0,
  notes text,
  source_quotation_id uuid references public.quotations (id),
  delivery_order_id uuid, -- no FK yet: public.delivery_orders doesn't exist until Sprint 31 (see header note 3)
  e_invoice_status text not null default 'not_applicable' check (e_invoice_status in (
    'not_applicable', 'pending', 'validated', 'rejected'
  )),
  outstanding_balance numeric(14, 2) not null default 0, -- see header note 5
  captured_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now(),
  unique (business_id, invoice_no)
);
create index if not exists idx_invoices_business on public.invoices (business_id);
alter table public.invoices enable row level security;
create policy "Active members with sales view can see invoices"
  on public.invoices for select using (public.caller_has_capability(business_id, 'sales', 'view'));

alter table public.quotations
  add constraint quotations_converted_invoice_id_fkey
  foreign key (converted_invoice_id) references public.invoices (id);

create table if not exists public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  line_no integer not null,
  product_id uuid references public.products (id),
  description text not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  unit_cost numeric(14, 2),
  tax_code text,
  discount_amount numeric(14, 2) not null default 0,
  line_total numeric(14, 2) not null,
  unique (invoice_id, line_no)
);
create index if not exists idx_invoice_lines_invoice on public.invoice_lines (invoice_id);
alter table public.invoice_lines enable row level security;
create policy "Active members with sales view can see invoice lines"
  on public.invoice_lines for select using (
    exists (select 1 from public.invoices i where i.id = invoice_lines.invoice_id
      and public.caller_has_capability(i.business_id, 'sales', 'view'))
  );

-- ------------------------------------------------------------
-- 3. create_quotation: drafts a Quotation + lines, resolving each
-- line's price via PRICE-001 (Sprint 27's resolve_price) unless the
-- caller supplies an explicit override, then routes the whole thing
-- through the real ApprovalTask engine (domain='sales',
-- subject_type='quotation', on_approval_action='send WhatsApp').
-- p_lines: jsonb array of {product_id, description, quantity,
-- unit_price (optional override), discount_amount (optional)}.
-- ------------------------------------------------------------
create or replace function public.create_quotation(
  p_business_id uuid,
  p_party_id uuid,
  p_valid_until date,
  p_notes text,
  p_lines jsonb,
  p_ai_draft_summary text default null,
  p_auto_approved boolean default false
) returns public.quotations
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_quotation_no text;
  v_quotation public.quotations;
  v_line jsonb;
  v_line_no integer := 0;
  v_product_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_discount numeric;
  v_line_total numeric;
  v_subtotal numeric := 0;
  v_resolved record;
begin
  if not public.caller_has_capability(p_business_id, 'sales', 'capture') then
    raise exception 'not_authorized: requires capture on sales';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'no_lines_supplied';
  end if;
  if not exists (select 1 from public.parties where id = p_party_id and business_id = p_business_id) then
    raise exception 'party_not_found_for_this_business: %', p_party_id;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.document_number_sequences (business_id, document_type, prefix, reset_period)
  values (p_business_id, 'quotation', 'QTN', 'never')
  on conflict (business_id, document_type) do nothing;
  v_quotation_no := public.next_document_number(p_business_id, 'quotation');

  insert into public.quotations (
    business_id, quotation_no, party_id, valid_until, notes, captured_by_membership_id
  ) values (
    p_business_id, v_quotation_no, p_party_id, p_valid_until, p_notes, v_caller_membership_id
  ) returning * into v_quotation;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_line_no := v_line_no + 1;
    v_product_id := nullif(v_line ->> 'product_id', '')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_discount := coalesce((v_line ->> 'discount_amount')::numeric, 0);

    if v_line ? 'unit_price' and (v_line ->> 'unit_price') is not null then
      v_unit_price := (v_line ->> 'unit_price')::numeric;
    elsif v_product_id is not null then
      select r.unit_price into v_unit_price from public.resolve_price(p_business_id, v_product_id, p_party_id) r;
    else
      raise exception 'line_%_needs_either_product_id_or_an_explicit_unit_price', v_line_no;
    end if;

    v_line_total := (v_quantity * v_unit_price) - v_discount;
    v_subtotal := v_subtotal + v_line_total;

    insert into public.quotation_lines (
      quotation_id, line_no, product_id, description, quantity, unit_price, discount_amount, line_total
    ) values (
      v_quotation.id, v_line_no, v_product_id, v_line ->> 'description', v_quantity, v_unit_price, v_discount, v_line_total
    );
  end loop;

  update public.quotations set subtotal = v_subtotal, tax_total = 0, grand_total = v_subtotal
  where id = v_quotation.id
  returning * into v_quotation;

  perform public.create_approval_task(
    p_business_id, 'sales', 'quotation', v_quotation.id, v_quotation.grand_total,
    coalesce(p_ai_draft_summary, 'Quotation ' || v_quotation_no || ' for ' || v_quotation.grand_total || ' ' || v_quotation.currency),
    null, v_caller_membership_id, p_auto_approved, 'send WhatsApp'
  );

  return v_quotation;
end;
$$;

grant execute on function public.create_quotation(uuid, uuid, date, text, jsonb, text, boolean) to authenticated;

-- ------------------------------------------------------------
-- 4. Sync trigger: an internally-rejected ApprovalTask propagates to
-- the quotation's own status (see header note 4 on why the reverse —
-- "approved" — deliberately does NOT propagate).
-- ------------------------------------------------------------
create or replace function public.sync_quotation_status_on_task_rejection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.subject_type = 'quotation' and new.status = 'rejected' and old.status is distinct from new.status then
    update public.quotations set status = 'rejected'
    where id = new.subject_id and status = 'draft';
  end if;
  return new;
end;
$$;

create trigger trg_sync_quotation_status_on_task_rejection
  after update on public.approval_tasks
  for each row execute function public.sync_quotation_status_on_task_rejection();

-- ------------------------------------------------------------
-- 5. WhatsApp click-to-chat (Vol 13_0 §4.1, owner's Sprint 21 choice).
-- Deterministic message/link generation — a lookup + template, not an
-- AI classification, same posture as BANK-001/PRICE-001.
-- ------------------------------------------------------------
create or replace function public.build_whatsapp_quotation_link(p_quotation_id uuid)
returns table (phone_e164 text, message_text text, wa_link text)
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_quotation public.quotations;
  v_party public.parties;
  v_task_status text;
  v_digits text;
  v_message text;
begin
  select * into v_quotation from public.quotations where id = p_quotation_id;
  if not found then raise exception 'quotation_not_found: %', p_quotation_id; end if;
  if not public.caller_has_capability(v_quotation.business_id, 'sales', 'capture') then
    raise exception 'not_authorized: requires capture on sales';
  end if;

  select status into v_task_status from public.approval_tasks
  where subject_type = 'quotation' and subject_id = p_quotation_id
  order by created_at desc limit 1;
  if v_task_status is null or v_task_status not in ('approved', 'auto_approved') then
    raise exception 'quotation_not_yet_approved: current approval status %', coalesce(v_task_status, 'none');
  end if;

  select * into v_party from public.parties where id = v_quotation.party_id;
  if v_party.contact_phone is null or btrim(v_party.contact_phone) = '' then
    raise exception 'party_has_no_contact_phone: %', v_party.id;
  end if;

  v_digits := regexp_replace(v_party.contact_phone, '[^0-9]', '', 'g');
  v_message := format(
    'Hi %s, here is your quotation %s from us, total %s %s. Valid until %s. Thank you!',
    v_party.display_name, v_quotation.quotation_no, v_quotation.currency, v_quotation.grand_total,
    coalesce(v_quotation.valid_until::text, 'further notice')
  );

  return query select v_digits, v_message, 'https://wa.me/' || v_digits || '?text=' || replace(replace(v_message, ' ', '%20'), E'\n', '%0A');
end;
$$;

grant execute on function public.build_whatsapp_quotation_link(uuid) to authenticated;

-- mark_quotation_sent: the owner's own confirmation that they tapped
-- Send in WhatsApp (Vol 13_0 §4.1 — "not 'AiFA sends it,' the owner
-- does" — the server has no way to observe this externally, so this
-- is deliberately a self-reported action, not an inferred one).
create or replace function public.mark_quotation_sent(p_quotation_id uuid)
returns public.quotations language plpgsql security definer set search_path = public, auth
as $$
declare v_quotation public.quotations; v_task_status text;
begin
  select * into v_quotation from public.quotations where id = p_quotation_id;
  if not found then raise exception 'quotation_not_found: %', p_quotation_id; end if;
  if not public.caller_has_capability(v_quotation.business_id, 'sales', 'capture') then
    raise exception 'not_authorized: requires capture on sales';
  end if;
  if v_quotation.status <> 'draft' then
    raise exception 'quotation_not_in_draft_status: current status %', v_quotation.status;
  end if;
  select status into v_task_status from public.approval_tasks
  where subject_type = 'quotation' and subject_id = p_quotation_id
  order by created_at desc limit 1;
  if v_task_status is null or v_task_status not in ('approved', 'auto_approved') then
    raise exception 'quotation_not_yet_approved: current approval status %', coalesce(v_task_status, 'none');
  end if;
  update public.quotations set status = 'sent' where id = p_quotation_id returning * into v_quotation;
  return v_quotation;
end;
$$;

grant execute on function public.mark_quotation_sent(uuid) to authenticated;

create or replace function public.mark_quotation_accepted(p_quotation_id uuid)
returns public.quotations language plpgsql security definer set search_path = public, auth
as $$
declare v_quotation public.quotations;
begin
  select * into v_quotation from public.quotations where id = p_quotation_id;
  if not found then raise exception 'quotation_not_found: %', p_quotation_id; end if;
  if not public.caller_has_capability(v_quotation.business_id, 'sales', 'capture') then
    raise exception 'not_authorized: requires capture on sales';
  end if;
  if v_quotation.status <> 'sent' then
    raise exception 'quotation_not_in_sent_status: current status %', v_quotation.status;
  end if;
  update public.quotations set status = 'accepted' where id = p_quotation_id returning * into v_quotation;
  return v_quotation;
end;
$$;

grant execute on function public.mark_quotation_accepted(uuid) to authenticated;

create or replace function public.mark_quotation_rejected(p_quotation_id uuid)
returns public.quotations language plpgsql security definer set search_path = public, auth
as $$
declare v_quotation public.quotations;
begin
  select * into v_quotation from public.quotations where id = p_quotation_id;
  if not found then raise exception 'quotation_not_found: %', p_quotation_id; end if;
  if not public.caller_has_capability(v_quotation.business_id, 'sales', 'capture') then
    raise exception 'not_authorized: requires capture on sales';
  end if;
  if v_quotation.status <> 'sent' then
    raise exception 'quotation_not_in_sent_status: current status %', v_quotation.status;
  end if;
  update public.quotations set status = 'rejected' where id = p_quotation_id returning * into v_quotation;
  return v_quotation;
end;
$$;

grant execute on function public.mark_quotation_rejected(uuid) to authenticated;

-- ------------------------------------------------------------
-- 6. convert_quotation_to_invoice: copies lines, computes due_date
-- from Party.credit_terms_days (see header note 6), links both ways,
-- and posts SALE-001's ledger entries (see header note 7).
-- ------------------------------------------------------------
create or replace function public.convert_quotation_to_invoice(p_quotation_id uuid)
returns public.invoices
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_quotation public.quotations;
  v_party public.parties;
  v_caller_membership_id uuid;
  v_invoice_no text;
  v_invoice public.invoices;
  v_due_date date;
  v_ar_account_id uuid;
  v_revenue_account_id uuid;
  v_line record;
begin
  select * into v_quotation from public.quotations where id = p_quotation_id for update;
  if not found then raise exception 'quotation_not_found: %', p_quotation_id; end if;
  if not public.caller_has_capability(v_quotation.business_id, 'sales', 'capture') then
    raise exception 'not_authorized: requires capture on sales';
  end if;
  if v_quotation.status <> 'accepted' then
    raise exception 'quotation_not_accepted: current status %', v_quotation.status;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = v_quotation.business_id and bm.user_id = auth.uid() and bm.status = 'active';

  select * into v_party from public.parties where id = v_quotation.party_id;
  v_due_date := current_date + coalesce(v_party.credit_terms_days, 0);

  insert into public.document_number_sequences (business_id, document_type, prefix, reset_period)
  values (v_quotation.business_id, 'invoice', 'INV', 'never')
  on conflict (business_id, document_type) do nothing;
  v_invoice_no := public.next_document_number(v_quotation.business_id, 'invoice');

  insert into public.invoices (
    business_id, invoice_no, party_id, status, due_date, currency,
    subtotal, tax_total, grand_total, notes, source_quotation_id,
    outstanding_balance, captured_by_membership_id
  ) values (
    v_quotation.business_id, v_invoice_no, v_quotation.party_id, 'issued', v_due_date, v_quotation.currency,
    v_quotation.subtotal, v_quotation.tax_total, v_quotation.grand_total, v_quotation.notes, v_quotation.id,
    v_quotation.grand_total, v_caller_membership_id
  ) returning * into v_invoice;

  for v_line in select * from public.quotation_lines where quotation_id = v_quotation.id order by line_no loop
    insert into public.invoice_lines (
      invoice_id, line_no, product_id, description, quantity, unit_price, unit_cost, tax_code, discount_amount, line_total
    ) values (
      v_invoice.id, v_line.line_no, v_line.product_id, v_line.description, v_line.quantity, v_line.unit_price,
      v_line.unit_cost, v_line.tax_code, v_line.discount_amount, v_line.line_total
    );
  end loop;

  update public.quotations set status = 'converted_to_invoice', converted_invoice_id = v_invoice.id
  where id = v_quotation.id;

  -- SALE-001: debit Accounts Receivable, credit Sales Revenue — see
  -- header note 7 for why this is a direct insert rather than a call
  -- to post_ledger_entries.
  if v_invoice.grand_total > 0 then
    select id into v_ar_account_id from public.chart_of_accounts
    where business_id = v_quotation.business_id and account_code = '1100';
    select id into v_revenue_account_id from public.chart_of_accounts
    where business_id = v_quotation.business_id and account_code = '4000';
    if v_ar_account_id is null or v_revenue_account_id is null then
      raise exception 'chart_of_accounts_missing_expected_accounts: business % is missing 1100/4000', v_quotation.business_id;
    end if;
    insert into public.ledger_entries (business_id, chart_of_accounts_id, direction, amount, currency, posted_by_membership_id)
    values
      (v_quotation.business_id, v_ar_account_id, 'debit', v_invoice.grand_total, v_invoice.currency, v_caller_membership_id),
      (v_quotation.business_id, v_revenue_account_id, 'credit', v_invoice.grand_total, v_invoice.currency, v_caller_membership_id);
  end if;

  return v_invoice;
end;
$$;

grant execute on function public.convert_quotation_to_invoice(uuid) to authenticated;

-- End of Sprint 28 migration.

-- ==============================================================
-- AIFA backend schema — Sprint 29 (Vol 13_0 §4: Payment, CreditNote,
-- Invoice.status lifecycle, real AR ageing). Closes the sales cycle
-- Sprint 28 opened.
--
-- SCOPE NOTES (disclosed):
--
-- 1. `overdue` is NEVER written to invoices.status. Per this sprint's
--    own risk note ("computed, not cached", same discipline Vol 13_3
--    §2 applies to effective_access_model), `overdue` is a derived
--    read-time overlay via public.invoice_effective_status(), not a
--    stored value — a business that hasn't opened the app in days
--    never has a stale status. The column's CHECK constraint (Sprint
--    28) still lists 'overdue' as a legal value for schema
--    completeness/future-proofing, but no function in this migration
--    writes it.
--
-- 2. CreditNote is implemented as a single-amount document (grand_
--    total reduces the linked invoice's balance), not a full
--    DocumentHeader/DocumentLine pair with per-line credit
--    allocation. Vol 13_0 §4's schema block lists CreditNote as
--    ": DocumentHeader" with only source_invoice_id as its own field
--    and never mentions a CreditNoteLine table anywhere in the
--    volume; this sprint's own DoD only requires "reduces balance
--    correctly and is approval-gated," not line-level allocation.
--    Building a full line-item credit note was judged out of
--    proportion to what's actually asked for — disclosed here rather
--    than silently built to a narrower shape than the header text
--    implies.
--
-- 3. Credit note ledger posting reuses Sales Revenue (4000) as the
--    debit side (credit Accounts Receivable) rather than a dedicated
--    "Sales Returns & Allowances" contra-revenue account, because no
--    such account exists in Vol 11_1 §4.1's Phase 1 seed set (the
--    same 12-row set Sprint 26 seeds verbatim) and this migration
--    does not add a new system account outside that set. A cleaner
--    contra-revenue treatment is a reasonable future refinement, not
--    attempted here.
--
-- 4. Payment and credit-note issuance are gated on EITHER `capture`
--    on `sales` OR `configure` on `accounting_reports` — Vol 13_0
--    doesn't assign Payment/CreditNote a single domain, and neither
--    fixed role template alone covers the realistic range of who
--    actually records a payment: a Sales Agent marking a sale paid on
--    the spot (capture on sales), or a Bookkeeper reconciling it
--    later against a bank statement (configure on accounting_reports,
--    the same grant that already lets them post_ledger_entries
--    directly). Requiring only one of the two would have made this
--    module unusable for whichever role wasn't picked. Disclosed
--    design choice, not implied by the volume's text.
--
-- 5. A payment that would push total-paid above the invoice's
--    grand_total is rejected outright (`payment_exceeds_outstanding_
--    balance`) rather than silently allowed to go negative — Vol
--    13_0 doesn't specify overpayment handling, and this is the
--    conservative default; a credit-balance/refund flow is future
--    work if a real overpayment case comes up.
-- ==============================================================

-- ------------------------------------------------------------
-- 1. public.payments (Vol 13_0 §4)
-- ------------------------------------------------------------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id),
  amount numeric(14, 2) not null check (amount > 0),
  method text not null check (method in ('cash', 'bank_transfer', 'cheque', 'card', 'e_wallet')),
  received_at date not null default current_date,
  reference text,
  recorded_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now()
);
create index if not exists idx_payments_invoice on public.payments (invoice_id);
create index if not exists idx_payments_business on public.payments (business_id);
alter table public.payments enable row level security;
create policy "Active members with sales view can see payments"
  on public.payments for select using (public.caller_has_capability(business_id, 'sales', 'view'));

-- ------------------------------------------------------------
-- 2. public.credit_notes (Vol 13_0 §4 — see header note 2 on shape)
-- ------------------------------------------------------------
create table if not exists public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  credit_note_no text not null,
  party_id uuid not null references public.parties (id),
  source_invoice_id uuid not null references public.invoices (id),
  status text not null default 'draft' check (status in ('draft', 'issued', 'rejected', 'cancelled')),
  issue_date date not null default current_date,
  currency text not null default 'MYR',
  grand_total numeric(14, 2) not null check (grand_total > 0),
  reason text,
  captured_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now(),
  unique (business_id, credit_note_no)
);
create index if not exists idx_credit_notes_business on public.credit_notes (business_id);
create index if not exists idx_credit_notes_invoice on public.credit_notes (source_invoice_id);
alter table public.credit_notes enable row level security;
create policy "Active members with sales view can see credit notes"
  on public.credit_notes for select using (public.caller_has_capability(business_id, 'sales', 'view'));

-- ------------------------------------------------------------
-- 3. invoice_effective_status: the "computed, not cached" overlay
-- (see header note 1). Real stored transitions (draft/issued/sent/
-- partially_paid/paid/cancelled) still live on invoices.status;
-- 'overdue' only ever appears here, derived at query time.
-- ------------------------------------------------------------
create or replace function public.invoice_effective_status(p_invoice_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when i.status in ('issued', 'sent', 'partially_paid')
         and i.due_date < current_date
         and i.outstanding_balance > 0
    then 'overdue'
    else i.status
  end
  from public.invoices i
  where i.id = p_invoice_id
$$;

grant execute on function public.invoice_effective_status(uuid) to authenticated;

-- ------------------------------------------------------------
-- 4. recompute_invoice_balance: shared by record_payment and credit
-- note issuance — nets grand_total against total paid + total
-- credited, sets outstanding_balance and the real (non-'overdue')
-- status.
-- ------------------------------------------------------------
create or replace function public.recompute_invoice_balance(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices;
  v_total_paid numeric(14, 2);
  v_total_credited numeric(14, 2);
  v_outstanding numeric(14, 2);
  v_new_status text;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice_not_found: %', p_invoice_id;
  end if;

  select coalesce(sum(amount), 0) into v_total_paid from public.payments where invoice_id = p_invoice_id;
  select coalesce(sum(grand_total), 0) into v_total_credited
    from public.credit_notes where source_invoice_id = p_invoice_id and status = 'issued';

  v_outstanding := v_invoice.grand_total - v_total_paid - v_total_credited;
  if v_outstanding < 0 then
    v_outstanding := 0;
  end if;

  if v_invoice.status in ('cancelled') then
    v_new_status := v_invoice.status; -- terminal, never reopened by a payment/credit
  elsif v_outstanding = 0 then
    v_new_status := 'paid';
  elsif v_total_paid > 0 or v_total_credited > 0 then
    v_new_status := 'partially_paid';
  else
    v_new_status := v_invoice.status;
  end if;

  update public.invoices set outstanding_balance = v_outstanding, status = v_new_status
  where id = p_invoice_id
  returning * into v_invoice;

  return v_invoice;
end;
$$;

grant execute on function public.recompute_invoice_balance(uuid) to authenticated;

-- ------------------------------------------------------------
-- 5. record_payment: records a Payment, posts the ledger (debit
-- Cash/Bank 1000, credit Accounts Receivable 1100), and recomputes
-- the invoice's balance/status. See header note 4 for the gating
-- choice and note 5 for the overpayment guard.
-- ------------------------------------------------------------
create or replace function public.record_payment(
  p_business_id uuid,
  p_invoice_id uuid,
  p_amount numeric,
  p_method text,
  p_received_at date,
  p_reference text
) returns public.payments
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_invoice public.invoices;
  v_total_paid_so_far numeric(14, 2);
  v_total_credited numeric(14, 2);
  v_cash_account_id uuid;
  v_ar_account_id uuid;
  v_row public.payments;
begin
  if not (
    public.caller_has_capability(p_business_id, 'sales', 'capture')
    or public.caller_has_capability(p_business_id, 'accounting_reports', 'configure')
  ) then
    raise exception 'not_authorized: requires capture on sales, or configure on accounting_reports';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id and business_id = p_business_id for update;
  if not found then
    raise exception 'invoice_not_found_for_this_business: %', p_invoice_id;
  end if;
  if v_invoice.status = 'cancelled' then
    raise exception 'invoice_is_cancelled: %', p_invoice_id;
  end if;

  select coalesce(sum(amount), 0) into v_total_paid_so_far from public.payments where invoice_id = p_invoice_id;
  select coalesce(sum(grand_total), 0) into v_total_credited
    from public.credit_notes where source_invoice_id = p_invoice_id and status = 'issued';

  if v_total_paid_so_far + v_total_credited + p_amount > v_invoice.grand_total then
    raise exception 'payment_exceeds_outstanding_balance: invoice % has % outstanding, payment of % would exceed it',
      p_invoice_id, v_invoice.grand_total - v_total_paid_so_far - v_total_credited, p_amount;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.payments (
    business_id, invoice_id, amount, method, received_at, reference, recorded_by_membership_id
  ) values (
    p_business_id, p_invoice_id, p_amount, p_method, coalesce(p_received_at, current_date), p_reference, v_caller_membership_id
  ) returning * into v_row;

  select id into v_cash_account_id from public.chart_of_accounts where business_id = p_business_id and account_code = '1000';
  select id into v_ar_account_id from public.chart_of_accounts where business_id = p_business_id and account_code = '1100';
  if v_cash_account_id is null or v_ar_account_id is null then
    raise exception 'chart_of_accounts_missing_expected_accounts: business % is missing 1000/1100', p_business_id;
  end if;
  insert into public.ledger_entries (business_id, chart_of_accounts_id, direction, amount, currency, posted_by_membership_id)
  values
    (p_business_id, v_cash_account_id, 'debit', p_amount, v_invoice.currency, v_caller_membership_id),
    (p_business_id, v_ar_account_id, 'credit', p_amount, v_invoice.currency, v_caller_membership_id);

  perform public.recompute_invoice_balance(p_invoice_id);

  return v_row;
end;
$$;

grant execute on function public.record_payment(uuid, uuid, numeric, text, date, text) to authenticated;

-- ------------------------------------------------------------
-- 6. create_credit_note: drafts a CreditNote and routes it through
-- the real ApprovalTask engine (domain='sales', no separate approval
-- mechanism, per this sprint's own Task Breakdown).
-- ------------------------------------------------------------
create or replace function public.create_credit_note(
  p_business_id uuid,
  p_source_invoice_id uuid,
  p_grand_total numeric,
  p_reason text,
  p_ai_draft_summary text default null,
  p_auto_approved boolean default false
) returns public.credit_notes
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_invoice public.invoices;
  v_credit_note_no text;
  v_row public.credit_notes;
  v_total_paid numeric(14, 2);
  v_total_credited numeric(14, 2);
begin
  if not (
    public.caller_has_capability(p_business_id, 'sales', 'capture')
    or public.caller_has_capability(p_business_id, 'accounting_reports', 'configure')
  ) then
    raise exception 'not_authorized: requires capture on sales, or configure on accounting_reports';
  end if;
  if p_grand_total is null or p_grand_total <= 0 then
    raise exception 'invalid_grand_total: must be positive';
  end if;

  select * into v_invoice from public.invoices where id = p_source_invoice_id and business_id = p_business_id;
  if not found then
    raise exception 'invoice_not_found_for_this_business: %', p_source_invoice_id;
  end if;

  select coalesce(sum(amount), 0) into v_total_paid from public.payments where invoice_id = p_source_invoice_id;
  select coalesce(sum(grand_total), 0) into v_total_credited
    from public.credit_notes where source_invoice_id = p_source_invoice_id and status = 'issued';
  if v_total_paid + v_total_credited + p_grand_total > v_invoice.grand_total then
    raise exception 'credit_note_exceeds_outstanding_balance: invoice % has % remaining, credit note of % would exceed it',
      p_source_invoice_id, v_invoice.grand_total - v_total_paid - v_total_credited, p_grand_total;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.document_number_sequences (business_id, document_type, prefix, reset_period)
  values (p_business_id, 'credit_note', 'CN', 'never')
  on conflict (business_id, document_type) do nothing;
  v_credit_note_no := public.next_document_number(p_business_id, 'credit_note');

  insert into public.credit_notes (
    business_id, credit_note_no, party_id, source_invoice_id, grand_total, reason, captured_by_membership_id
  ) values (
    p_business_id, v_credit_note_no, v_invoice.party_id, p_source_invoice_id, p_grand_total, p_reason, v_caller_membership_id
  ) returning * into v_row;

  perform public.create_approval_task(
    p_business_id, 'sales', 'credit_note', v_row.id, v_row.grand_total,
    coalesce(p_ai_draft_summary, 'Credit note ' || v_credit_note_no || ' for ' || v_row.grand_total || ' ' || v_row.currency
      || ' against invoice ' || v_invoice.invoice_no),
    null, v_caller_membership_id, p_auto_approved, 'post credit note'
  );

  return v_row;
end;
$$;

grant execute on function public.create_credit_note(uuid, uuid, numeric, text, text, boolean) to authenticated;

-- ------------------------------------------------------------
-- 7. Sync trigger: an ApprovalTask decision for a credit_note posts
-- it (issued, ledger entries, balance recompute) or marks it rejected
-- — fully automatic either way, unlike a Quotation's WhatsApp send
-- (there is no external "owner taps send" step for a credit note).
-- ------------------------------------------------------------
create or replace function public.sync_credit_note_on_task_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credit_note public.credit_notes;
  v_revenue_account_id uuid;
  v_ar_account_id uuid;
begin
  if new.subject_type <> 'credit_note' or old.status is not distinct from new.status then
    return new;
  end if;

  select * into v_credit_note from public.credit_notes where id = new.subject_id and status = 'draft' for update;
  if not found then
    return new; -- already processed, or not a credit note task
  end if;

  if new.status in ('approved', 'auto_approved') then
    select id into v_revenue_account_id from public.chart_of_accounts
      where business_id = v_credit_note.business_id and account_code = '4000';
    select id into v_ar_account_id from public.chart_of_accounts
      where business_id = v_credit_note.business_id and account_code = '1100';
    if v_revenue_account_id is null or v_ar_account_id is null then
      raise exception 'chart_of_accounts_missing_expected_accounts: business % is missing 4000/1100', v_credit_note.business_id;
    end if;

    insert into public.ledger_entries (business_id, chart_of_accounts_id, direction, amount, currency, posted_by_membership_id)
    values
      (v_credit_note.business_id, v_revenue_account_id, 'debit', v_credit_note.grand_total, v_credit_note.currency, new.decided_by_membership_id),
      (v_credit_note.business_id, v_ar_account_id, 'credit', v_credit_note.grand_total, v_credit_note.currency, new.decided_by_membership_id);

    update public.credit_notes set status = 'issued' where id = v_credit_note.id;
    perform public.recompute_invoice_balance(v_credit_note.source_invoice_id);
  elsif new.status = 'rejected' then
    update public.credit_notes set status = 'rejected' where id = v_credit_note.id;
  end if;

  return new;
end;
$$;

create trigger trg_sync_credit_note_on_task_decision
  after update on public.approval_tasks
  for each row execute function public.sync_credit_note_on_task_decision();

-- ------------------------------------------------------------
-- 8. ar_ageing_detail: real bucketed AR ageing per open invoice,
-- replacing the flat outstanding-list Vol 6_1 §6 flagged as a gap.
-- Uses invoice_effective_status so a stale 'issued' row that has
-- actually gone overdue is correctly bucketed, without ever writing
-- 'overdue' back to the row (see header note 1).
-- ------------------------------------------------------------
create or replace function public.ar_ageing_detail(p_business_id uuid)
returns table (
  invoice_id uuid,
  invoice_no text,
  party_id uuid,
  due_date date,
  outstanding_balance numeric,
  days_overdue integer,
  ageing_bucket text
)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.caller_has_capability(p_business_id, 'accounting_reports', 'view') then
    raise exception 'not_authorized: requires view on accounting_reports';
  end if;

  return query
  select
    i.id,
    i.invoice_no,
    i.party_id,
    i.due_date,
    i.outstanding_balance,
    greatest(0, current_date - i.due_date) as days_overdue,
    case
      when current_date <= i.due_date then 'current'
      when current_date - i.due_date <= 30 then '1-30'
      when current_date - i.due_date <= 60 then '31-60'
      when current_date - i.due_date <= 90 then '61-90'
      else '90+'
    end as ageing_bucket
  from public.invoices i
  where i.business_id = p_business_id
    and i.outstanding_balance > 0
    and i.status not in ('draft', 'cancelled', 'paid')
  order by i.due_date asc;
end;
$$;

grant execute on function public.ar_ageing_detail(uuid) to authenticated;

-- End of Sprint 29 migration.


-- ==============================================================
-- Sprint 30 append (Payment Vouchers, Expense & Cash Book/P&L)
-- ==============================================================

-- ==============================================================
-- AIFA backend schema — Sprint 30 (Vol 13_0 §6 Module C: Payment
-- Voucher, plus §8's Cash Book / P&L pulled forward for this
-- module's own reporting needs). Closes Sub-phase 3b.
--
-- SCOPE NOTES (disclosed):
--
-- 1. `public.documents` is a NEW, minimal, forward-only table. Vol
--    13_0 §6's `PaymentVoucher.document_id_receipt` is a foreign key
--    to "Document (Vol 11_1 §5)," and the Task Breakdown says
--    "via the existing Document table... no new document storage" —
--    but, like `BusinessEvent`/`LedgerEntry` before Sprints 25/26,
--    `Document` has no real server-side table today; it's a
--    local-first/encrypted concept only. Unlike those two cases,
--    this gap has no historical-data-migration dimension — a receipt
--    attachment is inherently forward-only (a PV either has one from
--    creation or gets one attached later; there's nothing to
--    backfill) — so this migration builds a real, minimal
--    `public.documents` table (an opaque storage reference + content
--    type, not a full document-management system) rather than
--    escalating this as an owner decision the way Sprint 26's
--    LedgerEntry fork was. This table does NOT handle actual file
--    upload/storage — that's a separate integration (e.g. Supabase
--    Storage) the client wires up; `storage_ref` is whatever URI/path
--    that layer produces.
--
-- 2. PaymentVoucher is implemented as a single-amount document (one
--    `grand_total`), matching CreditNote's own Sprint 29 precedent —
--    Vol 13_0 §6 gives PaymentVoucher no line-item table either.
--
-- 3. `expense_category` stores a `chart_of_accounts.account_name`
--    value directly (e.g. 'Supplies', not the PKA JSON's compound
--    'Operating Expenses:Supplies' label) — `create_payment_voucher`
--    resolves the posting account by looking up
--    (business_id, account_name) case-insensitively among expense-
--    type accounts. This keeps the mapping real and testable without
--    inventing a translation table between the PKA category label
--    format and chart_of_accounts rows; a business's own custom
--    expense accounts (via create_chart_of_account, Sprint 26) work
--    here exactly the same way as the seeded ones.
--
-- 4. `payment_method` on PaymentVoucher matches Vol 13_0 §6's OWN
--    literal enum (cash | bank_transfer | cheque) — narrower than
--    Sprint 29's Payment.method (which also allows card/e_wallet).
--    This is the volume's own stated list for this specific document
--    type, not an oversight.
--
-- 5. PaymentVoucher.status gets a 'rejected' value ADDED to Vol
--    13_0 §6's literal three-value enum (draft | approved | paid).
--    The volume names no rejection outcome at all for this document
--    type, but a real ApprovalTask can genuinely be rejected — the
--    same situation Sprint 25 already handled by adding
--    `blocked_awaiting_reviewer` beyond Vol 13_1 §6's original four
--    `resolved_via` values. Same disclosed precedent, not a silent
--    enum change.
--
-- 6. 'approved' and 'paid' are two REAL, distinct posting moments,
--    not collapsed the way CreditNote's single-step issuance was in
--    Sprint 29: approval is authorization only (no ledger posting);
--    `mark_payment_voucher_paid` — a separate, explicit call, mirroring
--    Quotation's `mark_quotation_sent` self-reported-external-event
--    pattern from Sprint 28 — is what actually posts EXP-001's rule
--    (debit the resolved expense account, credit Cash/Bank 1000) and
--    moves status to 'paid'. This matches how a real payment voucher
--    works: it's authorized before the money actually leaves.
--
-- 7. BUG CAUGHT DURING THIS SPRINT'S OWN TESTING (not inherited from
--    an earlier sprint): `cash_book_detail`'s opening-balance
--    calculation originally referenced bare `direction`/`amount`
--    columns from `public.ledger_entries`, which Postgres could not
--    disambiguate from the function's own `RETURNS TABLE(...,
--    direction text, amount numeric, ...)` OUT parameters of the
--    same names — `psycopg2.errors.AmbiguousColumn` at call time
--    (not a DDL-time error, since it's a runtime PL/pgSQL ambiguity).
--    Fixed by table-qualifying that subquery (`le.direction`,
--    `le.amount` against `from public.ledger_entries le`), matching
--    the qualification already used correctly elsewhere in the same
--    function's `in_range` CTE and final `select`. Disclosed here for
--    the same transparency reasons every other sprint's bug fixes
--    are — even though this one is new code, not existing code being
--    exercised for the first time.
-- ==============================================================

-- ------------------------------------------------------------
-- 1. public.documents (see header note 1)
-- ------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  storage_ref text not null,
  content_type text,
  uploaded_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now()
);
create index if not exists idx_documents_business on public.documents (business_id);
alter table public.documents enable row level security;
create policy "Active members with expense view can see documents"
  on public.documents for select using (public.caller_has_capability(business_id, 'expense', 'view'));

create or replace function public.create_document(
  p_business_id uuid, p_storage_ref text, p_content_type text
) returns public.documents
language plpgsql security definer set search_path = public, auth
as $$
declare v_caller_membership_id uuid; v_row public.documents;
begin
  if not (
    public.caller_has_capability(p_business_id, 'expense', 'capture')
    or public.caller_has_capability(p_business_id, 'accounting_reports', 'configure')
  ) then
    raise exception 'not_authorized: requires capture on expense, or configure on accounting_reports';
  end if;
  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';
  insert into public.documents (business_id, storage_ref, content_type, uploaded_by_membership_id)
  values (p_business_id, p_storage_ref, p_content_type, v_caller_membership_id)
  returning * into v_row;
  return v_row;
end;
$$;

grant execute on function public.create_document(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
-- 2. public.payment_vouchers (Vol 13_0 §6)
-- ------------------------------------------------------------
create table if not exists public.payment_vouchers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  pv_no text not null,
  payee_party_id uuid not null references public.parties (id),
  status text not null default 'draft' check (status in ('draft', 'approved', 'rejected', 'paid')), -- see header note 5
  expense_category text not null, -- see header note 3
  document_id_receipt uuid references public.documents (id),
  payment_method text not null check (payment_method in ('cash', 'bank_transfer', 'cheque')), -- see header note 4
  issue_date date not null default current_date,
  currency text not null default 'MYR',
  grand_total numeric(14, 2) not null check (grand_total > 0),
  notes text,
  captured_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now(),
  unique (business_id, pv_no)
);
create index if not exists idx_payment_vouchers_business on public.payment_vouchers (business_id);
alter table public.payment_vouchers enable row level security;
create policy "Active members with expense view can see payment vouchers"
  on public.payment_vouchers for select using (public.caller_has_capability(business_id, 'expense', 'view'));

create or replace function public.create_payment_voucher(
  p_business_id uuid,
  p_payee_party_id uuid,
  p_expense_category text,
  p_payment_method text,
  p_grand_total numeric,
  p_notes text default null,
  p_document_id_receipt uuid default null,
  p_ai_draft_summary text default null,
  p_auto_approved boolean default false
) returns public.payment_vouchers
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_pv_no text;
  v_row public.payment_vouchers;
  v_account_id uuid;
begin
  if not public.caller_has_capability(p_business_id, 'expense', 'capture') then
    raise exception 'not_authorized: requires capture on expense';
  end if;
  if p_grand_total is null or p_grand_total <= 0 then
    raise exception 'invalid_grand_total: must be positive';
  end if;
  if not exists (select 1 from public.parties where id = p_payee_party_id and business_id = p_business_id) then
    raise exception 'payee_party_not_found_for_this_business: %', p_payee_party_id;
  end if;

  -- Resolve the posting account now, so a bad category is caught at
  -- creation time rather than surfacing as a confusing failure later
  -- when the PV is actually paid.
  select id into v_account_id from public.chart_of_accounts
  where business_id = p_business_id and account_type = 'expense' and lower(account_name) = lower(p_expense_category);
  if v_account_id is null then
    raise exception 'expense_category_not_found_in_chart_of_accounts: % (expected an existing expense account_name)', p_expense_category;
  end if;

  if p_document_id_receipt is not null and not exists (
    select 1 from public.documents where id = p_document_id_receipt and business_id = p_business_id
  ) then
    raise exception 'document_not_found_for_this_business: %', p_document_id_receipt;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.document_number_sequences (business_id, document_type, prefix, reset_period)
  values (p_business_id, 'payment_voucher', 'PV', 'never')
  on conflict (business_id, document_type) do nothing;
  v_pv_no := public.next_document_number(p_business_id, 'payment_voucher');

  insert into public.payment_vouchers (
    business_id, pv_no, payee_party_id, expense_category, payment_method,
    grand_total, notes, document_id_receipt, captured_by_membership_id
  ) values (
    p_business_id, v_pv_no, p_payee_party_id, p_expense_category, p_payment_method,
    p_grand_total, p_notes, p_document_id_receipt, v_caller_membership_id
  ) returning * into v_row;

  perform public.create_approval_task(
    p_business_id, 'expense', 'payment_voucher', v_row.id, v_row.grand_total,
    coalesce(p_ai_draft_summary, 'Payment voucher ' || v_pv_no || ' to payee for ' || v_row.grand_total || ' ' || v_row.currency
      || ' (' || p_expense_category || ')'),
    null, v_caller_membership_id, p_auto_approved, 'mark as paid'
  );

  return v_row;
end;
$$;

grant execute on function public.create_payment_voucher(uuid, uuid, text, text, numeric, text, uuid, text, boolean) to authenticated;

-- Attaching/replacing a receipt is not restricted by approval status —
-- it's evidentiary, not a financial mutation.
create or replace function public.attach_payment_voucher_receipt(p_payment_voucher_id uuid, p_document_id uuid)
returns public.payment_vouchers
language plpgsql security definer set search_path = public, auth
as $$
declare v_pv public.payment_vouchers;
begin
  select * into v_pv from public.payment_vouchers where id = p_payment_voucher_id;
  if not found then raise exception 'payment_voucher_not_found: %', p_payment_voucher_id; end if;
  if not public.caller_has_capability(v_pv.business_id, 'expense', 'capture') then
    raise exception 'not_authorized: requires capture on expense';
  end if;
  if not exists (select 1 from public.documents where id = p_document_id and business_id = v_pv.business_id) then
    raise exception 'document_not_found_for_this_business: %', p_document_id;
  end if;
  update public.payment_vouchers set document_id_receipt = p_document_id where id = p_payment_voucher_id
  returning * into v_pv;
  return v_pv;
end;
$$;

grant execute on function public.attach_payment_voucher_receipt(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 3. Sync trigger: an ApprovalTask decision for a payment_voucher
-- moves it draft -> approved/rejected. Unlike CreditNote (Sprint 29),
-- approval does NOT post the ledger here — see header note 6.
-- ------------------------------------------------------------
create or replace function public.sync_payment_voucher_on_task_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.subject_type <> 'payment_voucher' or old.status is not distinct from new.status then
    return new;
  end if;
  if new.status in ('approved', 'auto_approved') then
    update public.payment_vouchers set status = 'approved' where id = new.subject_id and status = 'draft';
  elsif new.status = 'rejected' then
    update public.payment_vouchers set status = 'rejected' where id = new.subject_id and status = 'draft';
  end if;
  return new;
end;
$$;

create trigger trg_sync_payment_voucher_on_task_decision
  after update on public.approval_tasks
  for each row execute function public.sync_payment_voucher_on_task_decision();

-- ------------------------------------------------------------
-- 4. mark_payment_voucher_paid: the actual cash-movement moment (see
-- header note 6) — posts EXP-001 (debit the resolved expense account,
-- credit Cash/Bank 1000).
-- ------------------------------------------------------------
create or replace function public.mark_payment_voucher_paid(p_payment_voucher_id uuid)
returns public.payment_vouchers
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_pv public.payment_vouchers;
  v_caller_membership_id uuid;
  v_expense_account_id uuid;
  v_cash_account_id uuid;
begin
  select * into v_pv from public.payment_vouchers where id = p_payment_voucher_id for update;
  if not found then raise exception 'payment_voucher_not_found: %', p_payment_voucher_id; end if;
  if not (
    public.caller_has_capability(v_pv.business_id, 'expense', 'capture')
    or public.caller_has_capability(v_pv.business_id, 'accounting_reports', 'configure')
  ) then
    raise exception 'not_authorized: requires capture on expense, or configure on accounting_reports';
  end if;
  if v_pv.status <> 'approved' then
    raise exception 'payment_voucher_not_approved: current status %', v_pv.status;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = v_pv.business_id and bm.user_id = auth.uid() and bm.status = 'active';

  select id into v_expense_account_id from public.chart_of_accounts
  where business_id = v_pv.business_id and account_type = 'expense' and lower(account_name) = lower(v_pv.expense_category);
  select id into v_cash_account_id from public.chart_of_accounts
  where business_id = v_pv.business_id and account_code = '1000';
  if v_expense_account_id is null or v_cash_account_id is null then
    raise exception 'chart_of_accounts_missing_expected_accounts: business % is missing the % account or 1000', v_pv.business_id, v_pv.expense_category;
  end if;

  insert into public.ledger_entries (business_id, chart_of_accounts_id, direction, amount, currency, posted_by_membership_id)
  values
    (v_pv.business_id, v_expense_account_id, 'debit', v_pv.grand_total, v_pv.currency, v_caller_membership_id),
    (v_pv.business_id, v_cash_account_id, 'credit', v_pv.grand_total, v_pv.currency, v_caller_membership_id);

  update public.payment_vouchers set status = 'paid' where id = p_payment_voucher_id
  returning * into v_pv;

  return v_pv;
end;
$$;

grant execute on function public.mark_payment_voucher_paid(uuid) to authenticated;

-- ------------------------------------------------------------
-- 5. Cash Book: a bank-account-filtered ledger view with running
-- balance (Vol 13_0 §8, minimal — full Bank Reconciliation is
-- Sprint 32).
-- ------------------------------------------------------------
create or replace function public.cash_book_detail(
  p_business_id uuid, p_bank_account_id uuid, p_date_from date, p_date_to date
) returns table (
  entry_id uuid,
  posted_at timestamptz,
  direction text,
  amount numeric,
  running_balance numeric
)
language plpgsql security definer set search_path = public
as $$
declare
  v_ledger_account_id uuid;
  v_opening_balance numeric(14, 2);
  v_opening_movement numeric(14, 2);
begin
  if not public.caller_has_capability(p_business_id, 'accounting_reports', 'view') then
    raise exception 'not_authorized: requires view on accounting_reports';
  end if;

  select ba.ledger_account_id, ba.opening_balance into v_ledger_account_id, v_opening_balance
  from public.bank_accounts ba where ba.id = p_bank_account_id and ba.business_id = p_business_id;
  if v_ledger_account_id is null then
    raise exception 'bank_account_not_found_for_this_business: %', p_bank_account_id;
  end if;

  select coalesce(sum(case when le.direction = 'debit' then le.amount else -le.amount end), 0) into v_opening_movement
  from public.ledger_entries le
  where le.chart_of_accounts_id = v_ledger_account_id and le.posted_at < p_date_from;

  return query
  with in_range as (
    select le.id, le.posted_at, le.direction, le.amount
    from public.ledger_entries le
    where le.chart_of_accounts_id = v_ledger_account_id
      and le.posted_at >= p_date_from and le.posted_at < (p_date_to + 1)
    order by le.posted_at asc
  )
  select
    r.id,
    r.posted_at,
    r.direction,
    r.amount,
    v_opening_balance + v_opening_movement + sum(case when r.direction = 'debit' then r.amount else -r.amount end)
      over (order by r.posted_at rows between unbounded preceding and current row)
  from in_range r;
end;
$$;

grant execute on function public.cash_book_detail(uuid, uuid, date, date) to authenticated;

-- ------------------------------------------------------------
-- 6. Profit & Loss summary (Vol 13_0 §6/§8) — a read model over the
-- chart of accounts, no new schema beyond what Sprint 26/28/29
-- already post to.
-- ------------------------------------------------------------
create or replace function public.profit_and_loss_summary(
  p_business_id uuid, p_date_from date, p_date_to date
) returns table (total_revenue numeric, total_expense numeric, net_profit numeric)
language plpgsql security definer set search_path = public
as $$
declare v_revenue numeric(14, 2); v_expense numeric(14, 2);
begin
  if not public.caller_has_capability(p_business_id, 'accounting_reports', 'view') then
    raise exception 'not_authorized: requires view on accounting_reports';
  end if;

  select coalesce(sum(case when le.direction = 'credit' then le.amount else -le.amount end), 0) into v_revenue
  from public.ledger_entries le
  join public.chart_of_accounts coa on coa.id = le.chart_of_accounts_id
  where coa.business_id = p_business_id and coa.account_type = 'revenue'
    and le.posted_at >= p_date_from and le.posted_at < (p_date_to + 1);

  select coalesce(sum(case when le.direction = 'debit' then le.amount else -le.amount end), 0) into v_expense
  from public.ledger_entries le
  join public.chart_of_accounts coa on coa.id = le.chart_of_accounts_id
  where coa.business_id = p_business_id and coa.account_type = 'expense'
    and le.posted_at >= p_date_from and le.posted_at < (p_date_to + 1);

  return query select v_revenue, v_expense, v_revenue - v_expense;
end;
$$;

grant execute on function public.profit_and_loss_summary(uuid, date, date) to authenticated;

-- Cost/expense percentage breakdown by category (Vol 13_0 §6's
-- explicit "peratusan kos ... paling tinggi" requirement) — ranked
-- highest-share first.
create or replace function public.expense_category_breakdown(
  p_business_id uuid, p_date_from date, p_date_to date
) returns table (
  account_code text,
  account_name text,
  amount numeric,
  pct_of_total_expense numeric
)
language plpgsql security definer set search_path = public
as $$
declare v_total_expense numeric(14, 2);
begin
  if not public.caller_has_capability(p_business_id, 'accounting_reports', 'view') then
    raise exception 'not_authorized: requires view on accounting_reports';
  end if;

  select coalesce(sum(case when le.direction = 'debit' then le.amount else -le.amount end), 0) into v_total_expense
  from public.ledger_entries le
  join public.chart_of_accounts coa on coa.id = le.chart_of_accounts_id
  where coa.business_id = p_business_id and coa.account_type = 'expense'
    and le.posted_at >= p_date_from and le.posted_at < (p_date_to + 1);

  return query
  select
    coa.account_code,
    coa.account_name,
    sum(case when le.direction = 'debit' then le.amount else -le.amount end) as amount,
    case when v_total_expense > 0
      then round(100.0 * sum(case when le.direction = 'debit' then le.amount else -le.amount end) / v_total_expense, 2)
      else 0
    end as pct_of_total_expense
  from public.ledger_entries le
  join public.chart_of_accounts coa on coa.id = le.chart_of_accounts_id
  where coa.business_id = p_business_id and coa.account_type = 'expense'
    and le.posted_at >= p_date_from and le.posted_at < (p_date_to + 1)
  group by coa.account_code, coa.account_name
  having sum(case when le.direction = 'debit' then le.amount else -le.amount end) <> 0
  order by amount desc;
end;
$$;

grant execute on function public.expense_category_breakdown(uuid, date, date) to authenticated;

-- End of Sprint 30 migration.


-- ==============================================================
-- Sprint 31 append (Inventory & Delivery Order)
-- ==============================================================

-- ==============================================================
-- AIFA backend schema — Sprint 31 (Vol 13_0 §7 Module D:
-- Penghantaran & Inventori / Delivery & Inventory, extends Vol 6_5).
-- Opens Sub-phase 3c.
--
-- SCOPE NOTES (disclosed):
--
-- 1. `business_id` is added directly to `stock_levels` and
--    `stock_movements`, even though Vol 13_0 §7's own schema block
--    lists neither column on those two tables (only `product_id`/
--    `warehouse_id`, from which a business is technically derivable
--    via a join). Every RLS-scoped table in this schema carries its
--    own `business_id` for direct, indexable policy checks rather
--    than a join-through — the same convention already applied
--    without exception to every table since Sprint 22; this is that
--    convention, not a new decision.
--
-- 2. `delivery_orders.status` gets a `'rejected'` value ADDED to Vol
--    13_0 §7's literal three-value enum (draft | dispatched |
--    delivered). The volume names no rejection outcome for this
--    document type, but a real ApprovalTask can genuinely be
--    rejected — the same disclosed precedent already used for
--    ApprovalTask.resolved_via's `blocked_awaiting_reviewer`
--    (Sprint 25), and reused for PaymentVoucher.status (Sprint 30).
--
-- 3. Deliberately NOT added: an `'approved'` value on
--    `delivery_orders.status`. Unlike PaymentVoucher (Sprint 30),
--    which genuinely needed a stored "authorized but not yet paid"
--    state, this migration follows Quotation's own Sprint 28
--    precedent (its header note 4) instead: approval state lives on
--    the linked ApprovalTask row alone, and `dispatch_delivery_order`
--    checks it directly (`select status from approval_tasks where
--    subject_type='delivery_order' ... order by created_at desc
--    limit 1`) — the exact idiom `mark_quotation_sent` and
--    `convert_quotation_to_invoice` already use, not a new one.
--
-- 4. Warehouse creation is gated on `configure` on `inventory` (a
--    setup-level action, same posture as `create_bank_account`'s
--    `configure` gate on `accounting_reports` and
--    `configure_document_sequence`'s gate on `settings`) — only the
--    Owner holds `configure` on `inventory` among the six system role
--    templates today. Day-to-day inventory actions (opening stock
--    entry, delivery order creation/dispatch/delivered, stock takes)
--    are gated on `capture` on `inventory` instead, matching Warehouse
--    Staff's actual role grant (`view` + `capture` on `inventory`,
--    no `configure`) — Warehouse Staff can run every day-to-day
--    inventory action but cannot stand up a new warehouse location.
--
-- 5. A non-stock-tracked product (`track_inventory = false`, e.g. a
--    service line) may still appear on a Delivery Order line for
--    documentation purposes, but generates no `StockMovement` and
--    touches no `StockLevel` row — Product.track_inventory already
--    exists (Sprint 27) precisely to make this distinction, and
--    silently skipping stock posting for such lines is the natural
--    reading of it, not a new design decision being introduced here.
--
-- 6. `invoices.delivery_order_id` (declared in Sprint 28 as a plain
--    nullable uuid with no FK yet — see that migration's own header
--    note 3) gets its real foreign key added now that
--    `public.delivery_orders` exists. Because that column is a single
--    scalar FK, not an array, a given Invoice can link to at most ONE
--    DeliveryOrder — matching Vol 13_0 §4's own literal shape.
--    `create_delivery_order` raises `invoice_already_has_a_delivery_order`
--    if called against an invoice that already has one linked; genuine
--    multi-shipment/partial-delivery-per-invoice is out of scope this
--    sprint, a limitation of the volume's own schema, not something
--    silently narrowed here.
--
-- 7. Purchase-Side Cost Auto-Calc (this sprint's own Task Breakdown
--    item) is explicitly DEFERRED, per that same item's own wording
--    ("if not ready, this stays deferred and flagged explicitly
--    rather than silently skipped"). The Sprint 21 Purchase
--    Operations addendum (Vol 13_0 §4a) remains a design stub only —
--    no `public.purchase_invoices` table has been built in any sprint
--    to date, and `create_product` (Sprint 27) already hard-rejects
--    `cost_source = 'auto_from_purchase'` for exactly this reason.
--    There is nothing for this migration to wire up; flagged here
--    rather than silently omitted.
--
-- 8. Concurrency (this sprint's own named risk): `dispatch_delivery_order`
--    and stock-take completion both lock the specific `stock_levels`
--    row via `select ... for update` before reading or decrementing
--    it — the same per-row-locking discipline already used elsewhere
--    in this schema (e.g. `mark_payment_voucher_paid`'s own-row lock),
--    verified directly in this sprint's own test against a genuine
--    concurrent-dispatch scenario, not assumed safe.
--
-- 9. `mark_delivery_order_delivered` is added to complete the
--    volume's own literal three-state lifecycle (draft → dispatched →
--    delivered) even though the Definition of Done doesn't explicitly
--    require it. It's a self-reported external event — the server
--    cannot observe a physical delivery happening — mirroring the
--    same pattern Sprint 28's `mark_quotation_sent` and Sprint 30's
--    `mark_payment_voucher_paid` already established.
--
-- 10. A DeliveryOrder's own lines (product_id + quantity) are NOT
--     cross-validated against the linked Invoice's own invoice_lines
--     quantities — `create_delivery_order` only checks that each
--     line's product exists for the business. Vol 13_0 §7 doesn't
--     specify a line-level 1:1 match between the two documents
--     either; the Invoice is the billing record and the DO is what
--     physically ships, and requiring them to match exactly would
--     rule out a perfectly normal case (part of an invoice shipped
--     now, the rest later) that this sprint's schema doesn't attempt
--     to support anyway (Invoice.delivery_order_id is a single scalar
--     FK — see note 6 — so multi-shipment-per-invoice is already out
--     of scope). Left as an explicit disclosed gap rather than a
--     half-built partial-shipment validation.
-- ==============================================================

-- ------------------------------------------------------------
-- 1. public.warehouses (Vol 13_0 §7) — a single default warehouse per
-- business is an acceptable functional minimum this sprint (see
-- Sprint 31's own "Safe to Carry Over"); the table exists so
-- multi-location isn't a later rewrite.
-- ------------------------------------------------------------
create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_warehouses_business on public.warehouses (business_id);
alter table public.warehouses enable row level security;
create policy "Active members with inventory view can see warehouses"
  on public.warehouses for select using (public.caller_has_capability(business_id, 'inventory', 'view'));

create or replace function public.create_warehouse(p_business_id uuid, p_name text)
returns public.warehouses
language plpgsql security definer set search_path = public, auth
as $$
declare v_row public.warehouses;
begin
  if not public.caller_has_capability(p_business_id, 'inventory', 'configure') then
    raise exception 'not_authorized: requires configure on inventory';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'warehouse_name_required';
  end if;
  insert into public.warehouses (business_id, name) values (p_business_id, btrim(p_name))
  returning * into v_row;
  return v_row;
end;
$$;

grant execute on function public.create_warehouse(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 2. public.stock_levels (Vol 13_0 §7) — never written to directly by
-- client code; only ever updated by this migration's own functions,
-- always alongside a corresponding stock_movements row.
-- ------------------------------------------------------------
create table if not exists public.stock_levels (
  business_id uuid not null references public.businesses (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  quantity_on_hand numeric(14, 3) not null default 0,
  last_movement_at timestamptz,
  primary key (product_id, warehouse_id)
);
create index if not exists idx_stock_levels_business on public.stock_levels (business_id);
alter table public.stock_levels enable row level security;
create policy "Active members with inventory view can see stock levels"
  on public.stock_levels for select using (public.caller_has_capability(business_id, 'inventory', 'view'));

-- ------------------------------------------------------------
-- 3. public.stock_movements (Vol 13_0 §7) — append-only ledger of
-- every quantity change; stock_levels.quantity_on_hand is always a
-- derived running total of these, never edited independently.
-- ------------------------------------------------------------
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  product_id uuid not null references public.products (id),
  warehouse_id uuid not null references public.warehouses (id),
  movement_type text not null check (movement_type in (
    'opening', 'purchase_receipt', 'delivery_out', 'adjustment_increase', 'adjustment_decrease'
  )),
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_cost numeric(14, 2),
  source_document_type text check (source_document_type in (
    'delivery_order', 'purchase_invoice', 'stock_take', 'manual'
  )),
  source_document_id uuid,
  occurred_at timestamptz not null default now(),
  created_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now()
);
create index if not exists idx_stock_movements_business on public.stock_movements (business_id);
create index if not exists idx_stock_movements_product_warehouse on public.stock_movements (product_id, warehouse_id);
alter table public.stock_movements enable row level security;
create policy "Active members with inventory view can see stock movements"
  on public.stock_movements for select using (public.caller_has_capability(business_id, 'inventory', 'view'));

-- record_opening_stock: the one-time initial-balance entry per
-- (product, warehouse) — see header note 4 for why this is gated on
-- capture, not configure, unlike create_warehouse.
create or replace function public.record_opening_stock(
  p_business_id uuid, p_product_id uuid, p_warehouse_id uuid, p_quantity numeric, p_unit_cost numeric default null
) returns public.stock_levels
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_product public.products;
  v_row public.stock_levels;
begin
  if not public.caller_has_capability(p_business_id, 'inventory', 'capture') then
    raise exception 'not_authorized: requires capture on inventory';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid_quantity: must be positive';
  end if;

  select * into v_product from public.products where id = p_product_id and business_id = p_business_id;
  if not found then raise exception 'product_not_found_for_this_business: %', p_product_id; end if;
  if not v_product.track_inventory then
    raise exception 'product_is_not_stock_tracked: %', p_product_id;
  end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse_id and business_id = p_business_id) then
    raise exception 'warehouse_not_found_for_this_business: %', p_warehouse_id;
  end if;
  if exists (
    select 1 from public.stock_movements
    where product_id = p_product_id and warehouse_id = p_warehouse_id and movement_type = 'opening'
  ) then
    raise exception 'opening_stock_already_recorded_for_this_product_and_warehouse';
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.stock_movements (
    business_id, product_id, warehouse_id, movement_type, quantity, unit_cost,
    source_document_type, created_by_membership_id
  ) values (
    p_business_id, p_product_id, p_warehouse_id, 'opening', p_quantity, p_unit_cost,
    'manual', v_caller_membership_id
  );

  insert into public.stock_levels (business_id, product_id, warehouse_id, quantity_on_hand, last_movement_at)
  values (p_business_id, p_product_id, p_warehouse_id, p_quantity, now())
  on conflict (product_id, warehouse_id) do update
    set quantity_on_hand = public.stock_levels.quantity_on_hand + excluded.quantity_on_hand,
        last_movement_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.record_opening_stock(uuid, uuid, uuid, numeric, numeric) to authenticated;

-- ------------------------------------------------------------
-- 4. public.delivery_orders / delivery_order_lines (Vol 13_0 §7).
-- ------------------------------------------------------------
create table if not exists public.delivery_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  do_no text not null,
  invoice_id uuid not null references public.invoices (id),
  warehouse_id uuid not null references public.warehouses (id),
  status text not null default 'draft' check (status in ('draft', 'dispatched', 'delivered', 'rejected')), -- see header note 2
  issue_date date not null default current_date,
  notes text,
  captured_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now(),
  unique (business_id, do_no)
);
create index if not exists idx_delivery_orders_business on public.delivery_orders (business_id);
alter table public.delivery_orders enable row level security;
create policy "Active members with inventory view can see delivery orders"
  on public.delivery_orders for select using (public.caller_has_capability(business_id, 'inventory', 'view'));

create table if not exists public.delivery_order_lines (
  id uuid primary key default gen_random_uuid(),
  delivery_order_id uuid not null references public.delivery_orders (id) on delete cascade,
  line_no integer not null,
  product_id uuid not null references public.products (id),
  quantity numeric(14, 3) not null check (quantity > 0),
  unique (delivery_order_id, line_no)
);
create index if not exists idx_delivery_order_lines_do on public.delivery_order_lines (delivery_order_id);
alter table public.delivery_order_lines enable row level security;
create policy "Active members with inventory view can see delivery order lines"
  on public.delivery_order_lines for select using (
    exists (select 1 from public.delivery_orders d where d.id = delivery_order_lines.delivery_order_id
      and public.caller_has_capability(d.business_id, 'inventory', 'view'))
  );

-- Now that public.delivery_orders exists, give Sprint 28's
-- pre-declared invoices.delivery_order_id its real FK (see header note 6).
alter table public.invoices
  add constraint invoices_delivery_order_id_fkey
  foreign key (delivery_order_id) references public.delivery_orders (id);

create or replace function public.create_delivery_order(
  p_business_id uuid,
  p_invoice_id uuid,
  p_warehouse_id uuid,
  p_lines jsonb,
  p_notes text default null,
  p_ai_draft_summary text default null,
  p_auto_approved boolean default false
) returns public.delivery_orders
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_do_no text;
  v_row public.delivery_orders;
  v_invoice public.invoices;
  v_line jsonb;
  v_line_no integer := 0;
  v_product_id uuid;
  v_quantity numeric;
begin
  if not public.caller_has_capability(p_business_id, 'inventory', 'capture') then
    raise exception 'not_authorized: requires capture on inventory';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'no_lines_supplied';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id and business_id = p_business_id;
  if not found then raise exception 'invoice_not_found_for_this_business: %', p_invoice_id; end if;
  if v_invoice.delivery_order_id is not null then
    raise exception 'invoice_already_has_a_delivery_order: %', v_invoice.delivery_order_id;
  end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse_id and business_id = p_business_id) then
    raise exception 'warehouse_not_found_for_this_business: %', p_warehouse_id;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.document_number_sequences (business_id, document_type, prefix, reset_period)
  values (p_business_id, 'delivery_order', 'DO', 'never')
  on conflict (business_id, document_type) do nothing;
  v_do_no := public.next_document_number(p_business_id, 'delivery_order');

  insert into public.delivery_orders (business_id, do_no, invoice_id, warehouse_id, notes, captured_by_membership_id)
  values (p_business_id, v_do_no, p_invoice_id, p_warehouse_id, p_notes, v_caller_membership_id)
  returning * into v_row;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_line_no := v_line_no + 1;
    v_product_id := nullif(v_line ->> 'product_id', '')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;

    if v_product_id is null or v_quantity is null or v_quantity <= 0 then
      raise exception 'line_%_needs_a_product_id_and_a_positive_quantity', v_line_no;
    end if;
    if not exists (select 1 from public.products where id = v_product_id and business_id = p_business_id) then
      raise exception 'line_%_product_not_found_for_this_business: %', v_line_no, v_product_id;
    end if;

    insert into public.delivery_order_lines (delivery_order_id, line_no, product_id, quantity)
    values (v_row.id, v_line_no, v_product_id, v_quantity);
  end loop;

  update public.invoices set delivery_order_id = v_row.id where id = p_invoice_id;

  perform public.create_approval_task(
    p_business_id, 'inventory', 'delivery_order', v_row.id, null,
    coalesce(p_ai_draft_summary, 'Delivery order ' || v_do_no || ' for invoice ' || v_invoice.invoice_no
      || ' (' || v_line_no || ' line(s))'),
    null, v_caller_membership_id, p_auto_approved, 'dispatch'
  );

  return v_row;
end;
$$;

grant execute on function public.create_delivery_order(uuid, uuid, uuid, jsonb, text, text, boolean) to authenticated;

-- Rejection sync — mirrors sync_quotation_status_on_task_rejection
-- (Sprint 28) exactly; no approval-side transition (see header note 3).
create or replace function public.sync_delivery_order_on_task_rejection()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.subject_type = 'delivery_order' and new.status = 'rejected' and old.status is distinct from new.status then
    update public.delivery_orders set status = 'rejected' where id = new.subject_id and status = 'draft';
  end if;
  return new;
end;
$$;

create trigger trg_sync_delivery_order_on_task_rejection
  after update on public.approval_tasks
  for each row execute function public.sync_delivery_order_on_task_rejection();

-- dispatch_delivery_order: THE concrete "inventori akan ditolak secara
-- automatik apabila Delivery Order dihantar" requirement (Vol 13_0
-- §7). Requires the linked ApprovalTask to have resolved approved
-- (see header note 3), locks each affected stock_levels row via
-- `for update` before decrementing it (header note 8), and skips
-- posting entirely for non-stock-tracked lines (header note 5).
create or replace function public.dispatch_delivery_order(p_delivery_order_id uuid)
returns public.delivery_orders
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_do public.delivery_orders;
  v_task_status text;
  v_caller_membership_id uuid;
  v_line record;
  v_product public.products;
  v_stock_level public.stock_levels;
begin
  select * into v_do from public.delivery_orders where id = p_delivery_order_id for update;
  if not found then raise exception 'delivery_order_not_found: %', p_delivery_order_id; end if;
  if not public.caller_has_capability(v_do.business_id, 'inventory', 'capture') then
    raise exception 'not_authorized: requires capture on inventory';
  end if;
  if v_do.status <> 'draft' then
    raise exception 'delivery_order_not_in_draft_status: current status %', v_do.status;
  end if;

  select status into v_task_status from public.approval_tasks
  where subject_type = 'delivery_order' and subject_id = p_delivery_order_id
  order by created_at desc limit 1;
  if v_task_status is null or v_task_status not in ('approved', 'auto_approved') then
    raise exception 'delivery_order_not_yet_approved: current approval status %', coalesce(v_task_status, 'none');
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = v_do.business_id and bm.user_id = auth.uid() and bm.status = 'active';

  for v_line in
    select dol.product_id, dol.quantity
    from public.delivery_order_lines dol
    where dol.delivery_order_id = p_delivery_order_id
    order by dol.line_no
  loop
    select * into v_product from public.products where id = v_line.product_id;
    if not v_product.track_inventory then
      continue; -- see header note 5
    end if;

    select * into v_stock_level from public.stock_levels
    where product_id = v_line.product_id and warehouse_id = v_do.warehouse_id
    for update;
    if not found or v_stock_level.quantity_on_hand < v_line.quantity then
      raise exception 'insufficient_stock_for_product_%: available %, requested %',
        v_line.product_id, coalesce(v_stock_level.quantity_on_hand, 0), v_line.quantity;
    end if;

    insert into public.stock_movements (
      business_id, product_id, warehouse_id, movement_type, quantity,
      source_document_type, source_document_id, created_by_membership_id
    ) values (
      v_do.business_id, v_line.product_id, v_do.warehouse_id, 'delivery_out', v_line.quantity,
      'delivery_order', p_delivery_order_id, v_caller_membership_id
    );

    update public.stock_levels
    set quantity_on_hand = quantity_on_hand - v_line.quantity, last_movement_at = now()
    where product_id = v_line.product_id and warehouse_id = v_do.warehouse_id;
  end loop;

  update public.delivery_orders set status = 'dispatched' where id = p_delivery_order_id returning * into v_do;
  return v_do;
end;
$$;

grant execute on function public.dispatch_delivery_order(uuid) to authenticated;

-- mark_delivery_order_delivered — see header note 9.
create or replace function public.mark_delivery_order_delivered(p_delivery_order_id uuid)
returns public.delivery_orders
language plpgsql security definer set search_path = public, auth
as $$
declare v_do public.delivery_orders;
begin
  select * into v_do from public.delivery_orders where id = p_delivery_order_id;
  if not found then raise exception 'delivery_order_not_found: %', p_delivery_order_id; end if;
  if not public.caller_has_capability(v_do.business_id, 'inventory', 'capture') then
    raise exception 'not_authorized: requires capture on inventory';
  end if;
  if v_do.status <> 'dispatched' then
    raise exception 'delivery_order_not_dispatched: current status %', v_do.status;
  end if;
  update public.delivery_orders set status = 'delivered' where id = p_delivery_order_id returning * into v_do;
  return v_do;
end;
$$;

grant execute on function public.mark_delivery_order_delivered(uuid) to authenticated;

-- ------------------------------------------------------------
-- 5. public.stock_takes / stock_take_lines (Vol 13_0 §7) — not
-- approval-gated (this sprint's own Task Breakdown names ApprovalTask
-- routing only for Delivery Order); gated on capture on inventory
-- throughout, same as opening stock entry.
-- ------------------------------------------------------------
create table if not exists public.stock_takes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  warehouse_id uuid not null references public.warehouses (id),
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  counted_at timestamptz,
  captured_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now()
);
create index if not exists idx_stock_takes_business on public.stock_takes (business_id);
alter table public.stock_takes enable row level security;
create policy "Active members with inventory view can see stock takes"
  on public.stock_takes for select using (public.caller_has_capability(business_id, 'inventory', 'view'));

create table if not exists public.stock_take_lines (
  id uuid primary key default gen_random_uuid(),
  stock_take_id uuid not null references public.stock_takes (id) on delete cascade,
  product_id uuid not null references public.products (id),
  system_qty numeric(14, 3) not null,
  counted_qty numeric(14, 3),
  variance numeric(14, 3),
  unique (stock_take_id, product_id)
);
create index if not exists idx_stock_take_lines_stock_take on public.stock_take_lines (stock_take_id);
alter table public.stock_take_lines enable row level security;
create policy "Active members with inventory view can see stock take lines"
  on public.stock_take_lines for select using (
    exists (select 1 from public.stock_takes st where st.id = stock_take_lines.stock_take_id
      and public.caller_has_capability(st.business_id, 'inventory', 'view'))
  );

-- create_stock_take: snapshots every currently-stocked product in the
-- warehouse as of right now — system_qty is frozen at snapshot time,
-- not re-read at completion, so a movement recorded mid-count doesn't
-- silently change what's being counted against.
create or replace function public.create_stock_take(p_business_id uuid, p_warehouse_id uuid)
returns public.stock_takes
language plpgsql security definer set search_path = public, auth
as $$
declare v_caller_membership_id uuid; v_row public.stock_takes;
begin
  if not public.caller_has_capability(p_business_id, 'inventory', 'capture') then
    raise exception 'not_authorized: requires capture on inventory';
  end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse_id and business_id = p_business_id) then
    raise exception 'warehouse_not_found_for_this_business: %', p_warehouse_id;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.stock_takes (business_id, warehouse_id, captured_by_membership_id)
  values (p_business_id, p_warehouse_id, v_caller_membership_id)
  returning * into v_row;

  insert into public.stock_take_lines (stock_take_id, product_id, system_qty)
  select v_row.id, sl.product_id, sl.quantity_on_hand
  from public.stock_levels sl
  where sl.warehouse_id = p_warehouse_id and sl.business_id = p_business_id;

  return v_row;
end;
$$;

grant execute on function public.create_stock_take(uuid, uuid) to authenticated;

-- record_stock_take_counts: sets counted_qty (and derived variance)
-- for one or more lines of an in-progress stock take. Can be called
-- more than once as counting progresses.
create or replace function public.record_stock_take_counts(p_stock_take_id uuid, p_counts jsonb)
returns setof public.stock_take_lines
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_stock_take public.stock_takes;
  v_count jsonb;
  v_product_id uuid;
  v_counted_qty numeric;
begin
  select * into v_stock_take from public.stock_takes where id = p_stock_take_id;
  if not found then raise exception 'stock_take_not_found: %', p_stock_take_id; end if;
  if not public.caller_has_capability(v_stock_take.business_id, 'inventory', 'capture') then
    raise exception 'not_authorized: requires capture on inventory';
  end if;
  if v_stock_take.status <> 'in_progress' then
    raise exception 'stock_take_not_in_progress: current status %', v_stock_take.status;
  end if;
  if p_counts is null or jsonb_array_length(p_counts) = 0 then
    raise exception 'no_counts_supplied';
  end if;

  for v_count in select * from jsonb_array_elements(p_counts) loop
    v_product_id := nullif(v_count ->> 'product_id', '')::uuid;
    v_counted_qty := (v_count ->> 'counted_qty')::numeric;
    if v_product_id is null or v_counted_qty is null or v_counted_qty < 0 then
      raise exception 'each_count_needs_a_product_id_and_a_nonnegative_counted_qty';
    end if;

    update public.stock_take_lines
    set counted_qty = v_counted_qty, variance = v_counted_qty - system_qty
    where stock_take_id = p_stock_take_id and product_id = v_product_id;

    if not found then
      raise exception 'product_%_not_on_this_stock_take_(not_stocked_in_this_warehouse_at_snapshot_time)', v_product_id;
    end if;
  end loop;

  return query select * from public.stock_take_lines where stock_take_id = p_stock_take_id order by product_id;
end;
$$;

grant execute on function public.record_stock_take_counts(uuid, jsonb) to authenticated;

-- complete_stock_take: generates one adjustment_increase/decrease
-- StockMovement per counted line with a nonzero variance (lines never
-- counted are left out of the adjustment — an uncounted product's
-- stock level is left untouched, not assumed zero), locking each
-- affected stock_levels row via `for update` (header note 8), same as
-- dispatch_delivery_order.
create or replace function public.complete_stock_take(p_stock_take_id uuid)
returns public.stock_takes
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_stock_take public.stock_takes;
  v_caller_membership_id uuid;
  v_line record;
  v_movement_type text;
begin
  select * into v_stock_take from public.stock_takes where id = p_stock_take_id for update;
  if not found then raise exception 'stock_take_not_found: %', p_stock_take_id; end if;
  if not public.caller_has_capability(v_stock_take.business_id, 'inventory', 'capture') then
    raise exception 'not_authorized: requires capture on inventory';
  end if;
  if v_stock_take.status <> 'in_progress' then
    raise exception 'stock_take_not_in_progress: current status %', v_stock_take.status;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = v_stock_take.business_id and bm.user_id = auth.uid() and bm.status = 'active';

  for v_line in
    select stl.product_id, stl.variance
    from public.stock_take_lines stl
    where stl.stock_take_id = p_stock_take_id
      and stl.counted_qty is not null and stl.variance is not null and stl.variance <> 0
  loop
    v_movement_type := case when v_line.variance > 0 then 'adjustment_increase' else 'adjustment_decrease' end;

    perform 1 from public.stock_levels
    where product_id = v_line.product_id and warehouse_id = v_stock_take.warehouse_id
    for update;

    insert into public.stock_movements (
      business_id, product_id, warehouse_id, movement_type, quantity,
      source_document_type, source_document_id, created_by_membership_id
    ) values (
      v_stock_take.business_id, v_line.product_id, v_stock_take.warehouse_id, v_movement_type, abs(v_line.variance),
      'stock_take', p_stock_take_id, v_caller_membership_id
    );

    update public.stock_levels
    set quantity_on_hand = quantity_on_hand + v_line.variance, last_movement_at = now()
    where product_id = v_line.product_id and warehouse_id = v_stock_take.warehouse_id;
  end loop;

  update public.stock_takes set status = 'completed', counted_at = now()
  where id = p_stock_take_id returning * into v_stock_take;

  return v_stock_take;
end;
$$;

grant execute on function public.complete_stock_take(uuid) to authenticated;

-- End of Sprint 31 migration.


-- ==============================================================
-- Sprint 32 append (Full Accounting Reports)
-- ==============================================================

-- ==============================================================
-- AIFA backend schema — Sprint 32 (Vol 13_0 §8 Module E: Laporan
-- Akaun / Accounting Reports — the remainder not covered by Sprint
-- 30's Cash Book/P&L). Closes Sub-phase 3c.
--
-- SCOPE NOTES (disclosed):
--
-- 1. Trial Balance, Balance Sheet, and the General Ledger export are
--    genuinely read-only — no new schema beyond what Sprints 26/28-31
--    already post to, exactly matching Vol 13_0 §8's own framing
--    ("mostly a reporting layer"). Only Bank Reconciliation
--    (`bank_statement_lines`' matching workflow) does any writing.
--
-- 2. Balance Sheet does NOT roll retained earnings/net profit from
--    revenue/expense accounts into Equity. No period-closing-entry
--    mechanism exists anywhere in this schema (no sprint has designed
--    one), so `balance_sheet_summary`'s three totals (assets,
--    liabilities, equity) will NOT necessarily satisfy
--    assets = liabilities + equity for a business with any posted
--    revenue or expense activity — only Trial Balance's own
--    debit=credit identity is a guaranteed invariant here (it's a
--    mechanical property of every ledger entry being posted as a
--    balanced pair, not something Balance Sheet inherits). Flagged
--    explicitly rather than silently building a misleading "balances"
--    report; a real closing-entry/retained-earnings mechanism is
--    reasonable future work, out of scope for a reporting-layer
--    sprint over Sprint 26's existing chart.
--
-- 3. `general_ledger_detail` mirrors `cash_book_detail`'s own
--    established shape (Sprint 30) — same running-balance-via-window-
--    function technique, same `posted_at < (p_date_to + 1)` inclusive-
--    end-of-day boundary — generalized to any chart_of_accounts row,
--    not just a bank-linked one. Unlike `bank_accounts`,
--    `chart_of_accounts` has no stored `opening_balance` column, so
--    the running balance starts from an implicit zero at account
--    creation (the sum of every entry before `p_date_from`, same
--    "true opening balance" computation `cash_book_detail` already
--    uses, just with no separate offset to add on top).
--
-- 4. `stock_report` values each line at `Product.default_cost`
--    (manual entry, per Sprint 27/31) — real weighted-average costing
--    from actual purchase receipts is still Sprint 31's own deferred
--    Purchase-Side Cost Auto-Calc item (no `purchase_invoices` table
--    exists yet), so this is the same disclosed limitation carried
--    forward, not a new one.
--
-- 5. `tax_report_placeholder` is exactly that — a placeholder, per
--    this sprint's own Task Breakdown wording ("minimal placeholder
--    pending Sprint 33's actual e-Invoice/SST data"). It returns a
--    fixed shape with every figure null and an explanatory `note`
--    field rather than inventing SST/e-Invoice computation logic this
--    sprint has no real data source for.
--
-- 6. Bank Reconciliation: `bank_statement_lines.matched_ledger_entry_id`
--    gets its real foreign key now (Sprint 26's own migration flagged
--    this as "a one-line follow-up, not a blocker" at the time, since
--    `ledger_entries` didn't exist yet earlier in that same file).
--    `import_bank_statement_lines` and `match_bank_statement_line` are
--    gated on `configure` on `accounting_reports` — the same
--    bookkeeping-privileged posture `create_bank_account` and
--    `post_ledger_entries` already use, not a new gating decision.
--    `match_bank_statement_line` additionally verifies the ledger
--    entry belongs to the SAME chart_of_accounts row as the bank
--    account's own `ledger_account_id` (can't match a statement line
--    to an unrelated account's entry) and that no other statement
--    line already claims that ledger entry (one ledger entry matches
--    at most one statement line) — data-integrity guards the volume's
--    text doesn't spell out but that a real reconciliation screen
--    needs to not silently corrupt itself. Only forward transitions
--    (unmatched → matched, unmatched → ignored) are built this
--    sprint, matching the volume's own literal three-state workflow
--    description; an "undo/unmatch" action is reasonable future
--    polish, consistent with this sprint's own "functional minimum,
--    not polished" framing for the reconciliation screen.
-- ==============================================================

-- ------------------------------------------------------------
-- 1. Trial Balance (Vol 13_0 §8) — per-account debit/credit totals;
-- summing total_debit and total_credit ACROSS every returned row must
-- equal (the mechanical "nets to zero" identity of a ledger where
-- every entry is posted as a balanced debit/credit pair — see header
-- note 2 on why this guarantee does NOT extend to Balance Sheet).
-- ------------------------------------------------------------
create or replace function public.trial_balance(
  p_business_id uuid, p_as_of_date date
) returns table (
  account_code text, account_name text, account_type text,
  total_debit numeric, total_credit numeric, balance numeric
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.caller_has_capability(p_business_id, 'accounting_reports', 'view') then
    raise exception 'not_authorized: requires view on accounting_reports';
  end if;

  return query
  select
    coa.account_code,
    coa.account_name,
    coa.account_type,
    coalesce(sum(case when le.direction = 'debit' then le.amount else 0 end), 0) as total_debit,
    coalesce(sum(case when le.direction = 'credit' then le.amount else 0 end), 0) as total_credit,
    coalesce(sum(case when le.direction = 'debit' then le.amount else -le.amount end), 0) as balance
  from public.chart_of_accounts coa
  left join public.ledger_entries le
    on le.chart_of_accounts_id = coa.id and le.posted_at < (p_as_of_date + 1)
  where coa.business_id = p_business_id
  group by coa.id, coa.account_code, coa.account_name, coa.account_type
  order by coa.account_code;
end;
$$;

grant execute on function public.trial_balance(uuid, date) to authenticated;

-- ------------------------------------------------------------
-- 2. Balance Sheet (Vol 13_0 §8) — see header note 2 on the
-- deliberate absence of a retained-earnings roll-up.
-- ------------------------------------------------------------
create or replace function public.balance_sheet_summary(
  p_business_id uuid, p_as_of_date date
) returns table (total_assets numeric, total_liabilities numeric, total_equity numeric)
language plpgsql stable security definer set search_path = public
as $$
declare v_assets numeric(14, 2); v_liabilities numeric(14, 2); v_equity numeric(14, 2);
begin
  if not public.caller_has_capability(p_business_id, 'accounting_reports', 'view') then
    raise exception 'not_authorized: requires view on accounting_reports';
  end if;

  select coalesce(sum(case when le.direction = 'debit' then le.amount else -le.amount end), 0) into v_assets
  from public.ledger_entries le
  join public.chart_of_accounts coa on coa.id = le.chart_of_accounts_id
  where coa.business_id = p_business_id and coa.account_type = 'asset' and le.posted_at < (p_as_of_date + 1);

  select coalesce(sum(case when le.direction = 'credit' then le.amount else -le.amount end), 0) into v_liabilities
  from public.ledger_entries le
  join public.chart_of_accounts coa on coa.id = le.chart_of_accounts_id
  where coa.business_id = p_business_id and coa.account_type = 'liability' and le.posted_at < (p_as_of_date + 1);

  select coalesce(sum(case when le.direction = 'credit' then le.amount else -le.amount end), 0) into v_equity
  from public.ledger_entries le
  join public.chart_of_accounts coa on coa.id = le.chart_of_accounts_id
  where coa.business_id = p_business_id and coa.account_type = 'equity' and le.posted_at < (p_as_of_date + 1);

  return query select v_assets, v_liabilities, v_equity;
end;
$$;

grant execute on function public.balance_sheet_summary(uuid, date) to authenticated;

-- ------------------------------------------------------------
-- 3. General Ledger export (Vol 13_0 §8) — see header note 3.
-- ------------------------------------------------------------
create or replace function public.general_ledger_detail(
  p_business_id uuid, p_account_id uuid, p_date_from date, p_date_to date
) returns table (
  entry_id uuid, posted_at timestamptz, direction text, amount numeric, running_balance numeric
)
language plpgsql stable security definer set search_path = public
as $$
declare v_opening_balance numeric(14, 2);
begin
  if not public.caller_has_capability(p_business_id, 'accounting_reports', 'view') then
    raise exception 'not_authorized: requires view on accounting_reports';
  end if;
  if not exists (select 1 from public.chart_of_accounts where id = p_account_id and business_id = p_business_id) then
    raise exception 'chart_of_accounts_row_not_found_for_this_business: %', p_account_id;
  end if;

  select coalesce(sum(case when le.direction = 'debit' then le.amount else -le.amount end), 0) into v_opening_balance
  from public.ledger_entries le
  where le.chart_of_accounts_id = p_account_id and le.posted_at < p_date_from;

  return query
  with in_range as (
    select le.id, le.posted_at, le.direction, le.amount
    from public.ledger_entries le
    where le.chart_of_accounts_id = p_account_id
      and le.posted_at >= p_date_from and le.posted_at < (p_date_to + 1)
    order by le.posted_at asc
  )
  select
    r.id,
    r.posted_at,
    r.direction,
    r.amount,
    v_opening_balance + sum(case when r.direction = 'debit' then r.amount else -r.amount end)
      over (order by r.posted_at rows between unbounded preceding and current row)
  from in_range r;
end;
$$;

grant execute on function public.general_ledger_detail(uuid, uuid, date, date) to authenticated;

-- ------------------------------------------------------------
-- 4. Stock report (from Sprint 31's StockLevel) — see header note 4
-- on default_cost-based valuation.
-- ------------------------------------------------------------
create or replace function public.stock_report(
  p_business_id uuid, p_warehouse_id uuid default null
) returns table (
  product_id uuid, sku text, product_name text, warehouse_id uuid,
  quantity_on_hand numeric, unit_cost numeric, valuation numeric
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.caller_has_capability(p_business_id, 'inventory', 'view') then
    raise exception 'not_authorized: requires view on inventory';
  end if;

  return query
  select
    p.id, p.sku, p.name, sl.warehouse_id, sl.quantity_on_hand, p.default_cost,
    sl.quantity_on_hand * coalesce(p.default_cost, 0)
  from public.stock_levels sl
  join public.products p on p.id = sl.product_id
  where sl.business_id = p_business_id
    and (p_warehouse_id is null or sl.warehouse_id = p_warehouse_id)
  order by p.name;
end;
$$;

grant execute on function public.stock_report(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 5. Tax report — placeholder only, see header note 5.
-- ------------------------------------------------------------
create or replace function public.tax_report_placeholder(
  p_business_id uuid, p_date_from date, p_date_to date
) returns table (
  date_from date, date_to date, output_tax_sst numeric, input_tax_sst numeric, note text
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.caller_has_capability(p_business_id, 'tax_compliance', 'view') then
    raise exception 'not_authorized: requires view on tax_compliance';
  end if;

  return query select
    p_date_from, p_date_to, null::numeric, null::numeric,
    'Placeholder only — SST/e-Invoice figures are not computed yet; see Sprint 33 (Vol 13_0 §9).'::text;
end;
$$;

grant execute on function public.tax_report_placeholder(uuid, date, date) to authenticated;

-- ------------------------------------------------------------
-- 6. Bank Reconciliation matching workflow (Vol 13_0 §8) — see
-- header note 6.
-- ------------------------------------------------------------
alter table public.bank_statement_lines
  add constraint bank_statement_lines_matched_ledger_entry_id_fkey
  foreign key (matched_ledger_entry_id) references public.ledger_entries (id);

create or replace function public.import_bank_statement_lines(
  p_bank_account_id uuid, p_lines jsonb
) returns setof public.bank_statement_lines
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_bank_account public.bank_accounts;
  v_line jsonb;
  v_statement_date date;
  v_description text;
  v_amount numeric;
begin
  select * into v_bank_account from public.bank_accounts where id = p_bank_account_id;
  if not found then raise exception 'bank_account_not_found: %', p_bank_account_id; end if;
  if not public.caller_has_capability(v_bank_account.business_id, 'accounting_reports', 'configure') then
    raise exception 'not_authorized: requires configure on accounting_reports';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'no_lines_supplied';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_statement_date := (v_line ->> 'statement_date')::date;
    v_description := v_line ->> 'description';
    v_amount := (v_line ->> 'amount')::numeric;
    if v_statement_date is null or v_amount is null or v_amount = 0 then
      raise exception 'each_line_needs_a_statement_date_and_a_nonzero_amount';
    end if;

    insert into public.bank_statement_lines (bank_account_id, statement_date, description, amount)
    values (p_bank_account_id, v_statement_date, v_description, v_amount);
  end loop;

  return query select * from public.bank_statement_lines
    where bank_account_id = p_bank_account_id
    order by created_at desc limit jsonb_array_length(p_lines);
end;
$$;

grant execute on function public.import_bank_statement_lines(uuid, jsonb) to authenticated;

create or replace function public.match_bank_statement_line(
  p_statement_line_id uuid, p_ledger_entry_id uuid
) returns public.bank_statement_lines
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_line public.bank_statement_lines;
  v_bank_account public.bank_accounts;
  v_ledger_entry public.ledger_entries;
begin
  select * into v_line from public.bank_statement_lines where id = p_statement_line_id for update;
  if not found then raise exception 'bank_statement_line_not_found: %', p_statement_line_id; end if;

  select * into v_bank_account from public.bank_accounts where id = v_line.bank_account_id;
  if not public.caller_has_capability(v_bank_account.business_id, 'accounting_reports', 'configure') then
    raise exception 'not_authorized: requires configure on accounting_reports';
  end if;
  if v_line.match_status <> 'unmatched' then
    raise exception 'bank_statement_line_not_unmatched: current status %', v_line.match_status;
  end if;

  select * into v_ledger_entry from public.ledger_entries where id = p_ledger_entry_id;
  if not found or v_ledger_entry.business_id <> v_bank_account.business_id
    or v_ledger_entry.chart_of_accounts_id <> v_bank_account.ledger_account_id then
    raise exception 'ledger_entry_not_found_for_this_bank_account: %', p_ledger_entry_id;
  end if;
  if exists (
    select 1 from public.bank_statement_lines
    where matched_ledger_entry_id = p_ledger_entry_id and match_status = 'matched'
  ) then
    raise exception 'ledger_entry_already_matched_to_another_statement_line: %', p_ledger_entry_id;
  end if;

  update public.bank_statement_lines
  set matched_ledger_entry_id = p_ledger_entry_id, match_status = 'matched'
  where id = p_statement_line_id
  returning * into v_line;

  return v_line;
end;
$$;

grant execute on function public.match_bank_statement_line(uuid, uuid) to authenticated;

create or replace function public.ignore_bank_statement_line(p_statement_line_id uuid)
returns public.bank_statement_lines
language plpgsql security definer set search_path = public, auth
as $$
declare v_line public.bank_statement_lines; v_bank_account public.bank_accounts;
begin
  select * into v_line from public.bank_statement_lines where id = p_statement_line_id;
  if not found then raise exception 'bank_statement_line_not_found: %', p_statement_line_id; end if;

  select * into v_bank_account from public.bank_accounts where id = v_line.bank_account_id;
  if not public.caller_has_capability(v_bank_account.business_id, 'accounting_reports', 'configure') then
    raise exception 'not_authorized: requires configure on accounting_reports';
  end if;
  if v_line.match_status <> 'unmatched' then
    raise exception 'bank_statement_line_not_unmatched: current status %', v_line.match_status;
  end if;

  update public.bank_statement_lines set match_status = 'ignored' where id = p_statement_line_id
  returning * into v_line;

  return v_line;
end;
$$;

grant execute on function public.ignore_bank_statement_line(uuid) to authenticated;

-- End of Sprint 32 migration.

-- ==============================================================
-- AIFA backend schema — Sprint 33 (Vol 13_0 §9 Module F: e-Invois &
-- SST / LHDN & Kastam Compliance). Opens (and, per this sprint's
-- own stubbed scope, does not close) Sub-phase 3d.
--
-- ==============================================================
-- OWNER DECISION RECORDED THIS SPRINT (asked via AskUserQuestion,
-- not treated as a disclosed implementation detail, because it is a
-- genuine external-dependency/business decision, not one this
-- migration could reasonably make on its own):
--
-- This sprint's own Definition of Done requires submitting a real
-- invoice to LHDN's MyInvois SANDBOX and getting back a real UUID/QR
-- code, and requires a real IRB rejection reason for a malformed
-- submission. Doing that needs real LHDN MyInvois sandbox API
-- credentials (client ID/secret or certificate) that this session
-- does not have and cannot fabricate — this is exactly the "Honest
-- open dependency" Vol 13_0 §9 itself names ("an external
-- account/compliance dependency the owner needs to hold").
--
-- Asked the owner directly how to proceed; they chose: build the full
-- schema, Finance PKA rule sets, SST computation, and a real
-- MyInvoisClient interface now, against a STUBBED/simulated response
-- (not the live sandbox), clearly disclosed as not meeting DoD items
-- 1 and 4's literal "real sandbox" / "real IRB response" requirement
-- until real credentials are supplied. Everything below is built to
-- that agreed scope — DoD items 1 and 4 are explicitly NOT checked
-- off in the Sprint 33 doc's Outcomes; they're open, pending
-- credentials, not silently marked done.
-- ==============================================================
--
-- SCOPE NOTES (disclosed):
--
-- 1. `sst_rates` is a real server-side table (system-wide, like
--    `permissions`), not a JSON file parsed at request time — a
--    closer, more literal realisation of this sprint's own Risks
--    table wording ("a correction is a data update, not a code
--    change") than re-parsing a file would be. Its codes/rates mirror
--    `packages/core/pka/regulations/MY-SST-RATES-1.0.0.json` (the
--    Finance PKA Knowledge Object Vol 13_0 §9 itself calls for), kept
--    in sync by convention, not by one file including the other.
--    RATES ARE ILLUSTRATIVE PLACEHOLDERS — Vol 6_9 §5's advice
--    boundary applies directly: AiFA computes and organises, it does
--    not replace the owner's own SST registration category or their
--    tax advisor's confirmation of which codes/rates actually apply
--    to this business.
--
-- 2. `invoice_lines.tax_code` (Sprint 28) and a new nullable
--    `payment_vouchers.sst_code` column are what SST computation
--    reads — computed via an explicit follow-up call
--    (`compute_sst_for_invoice` / `compute_sst_for_payment_voucher`)
--    over an already-created Invoice/PaymentVoucher, NOT inlined into
--    `create_quotation`'s or `create_payment_voucher`'s own bodies.
--    Touching those already-shipped, tested Sprint 28/30 functions
--    this late in the series, for a feature literally gated on
--    credentials this sprint doesn't have, was judged higher-risk
--    than it's worth; the explicit-follow-up-call shape is available
--    to be wired into automatic invocation once real submission is
--    live.
--
-- 3. SST computation does NOT itself post separate ledger entries
--    this sprint (no SST Payable / Input Tax Credit account split).
--    The DoD only asks that SST be "computed correctly," not posted;
--    Sprint 28/30's own SALE-001/EXP-001 ledger postings already use
--    each document's full `grand_total` (which already includes any
--    tax), so there's no double-counting risk from leaving this out.
--    A dedicated ledger split is reasonable future work alongside
--    real submission wiring.
--
-- 4. Consolidated e-Invoice eligibility ("non-B2B") is mapped onto
--    an existing, real schema signal: a Party with `tin` set is
--    treated as a business counterparty (must get its own itemised
--    e-Invoice, excluded from consolidation); a Party with no `tin`
--    is treated as a consumer, eligible for consolidation — matching
--    LHDN's real B2C-consolidation-only rule as closely as this
--    schema's existing fields allow, not a literal LHDN eligibility
--    check (which also considers industry code and other factors
--    this system doesn't model). Disclosed as an approximation.
--
-- 5. `e_invoice_submission_lines` (submission_id, invoice_id) is a
--    practical addition beyond Vol 13_0 §9's own literal
--    EInvoiceSubmission schema block, which gives a consolidated
--    submission no way to record which invoices it actually contains
--    (`invoice_id` on the header row itself is null for a
--    consolidated batch — "a synthetic one," the volume's own
--    words). Without a lines table a consolidated submission would
--    be an unauditable black box; disclosed as a genuine, necessary
--    addition, not a silent schema deviation.
--
-- 6. `submit_einvoice` / `record_einvoice_submission_result` split the
--    submission flow the same way every other external-facing action
--    in this schema is split: the Postgres function owns
--    authorization and state (draft -> submitted -> validated/
--    rejected), the actual outbound HTTP call to MyInvois happens
--    client-side (`packages/core/src/sync/eInvoiceSstTransport.ts`'s
--    `MyInvoisClient`), which then reports the outcome back via
--    `record_einvoice_submission_result`. This is architecturally
--    consistent with every prior sprint (Postgres never makes
--    outbound HTTP calls in this schema) — not a new pattern invented
--    for this sprint.
--
-- 7. SstReturn submission stays the explicitly-allowed lower-fidelity
--    carry-over this sprint's own "Safe to Carry Over" names: a
--    generated-document/status-flip step (`submit_sst_return`), not a
--    real Kastam API integration.
--
-- 8. A real, disclosed bug fix to existing Sprint 28 code, found while
--    building and testing this sprint's own compute_sst_for_invoice:
--    `public.create_quotation` accepted an optional `tax_code` key on
--    each line of its `p_lines` jsonb argument but never actually
--    extracted or persisted it into `quotation_lines.tax_code` — so
--    no invoice created through the normal Quotation -> Invoice flow
--    could ever end up with a populated `tax_code` on any line, no
--    matter what the caller supplied, silently starving this
--    sprint's own SST computation of anything to compute against.
--    Fixed here (see the `create or replace function
--    public.create_quotation` near the end of this migration) by
--    extracting and persisting `tax_code`, matching the same
--    nullif-on-empty pattern already used for `product_id`.
-- ==============================================================

-- ------------------------------------------------------------
-- 1. public.sst_rates (see header note 1) — a fixed catalog, same
-- "readable by any authenticated user" posture as public.permissions.
-- ------------------------------------------------------------
create table if not exists public.sst_rates (
  sst_code text primary key,
  tax_type text not null check (tax_type in ('sales_tax', 'service_tax', 'exempt')),
  rate numeric(5, 4) not null check (rate >= 0 and rate < 1),
  description text not null,
  rule_version text not null default '1.0.0'
);

alter table public.sst_rates enable row level security;
create policy "Any authenticated user can view the fixed SST rate catalog"
  on public.sst_rates for select using (auth.role() = 'authenticated');

insert into public.sst_rates (sst_code, tax_type, rate, description) values
  ('SR-10', 'sales_tax', 0.10, 'Sales Tax — standard rate (illustrative; confirm against your own registration).'),
  ('SR-5', 'sales_tax', 0.05, 'Sales Tax — reduced rate for certain goods (illustrative).'),
  ('SV-8', 'service_tax', 0.08, 'Service Tax — standard rate (illustrative).'),
  ('SV-6', 'service_tax', 0.06, 'Service Tax — legacy/reduced rate for certain services (illustrative).'),
  ('EX', 'exempt', 0.00, 'Exempt / out of scope of SST.')
on conflict (sst_code) do nothing;

-- ------------------------------------------------------------
-- 2. public.e_invoice_submissions / e_invoice_submission_lines
-- (Vol 13_0 §9 — see header notes 5-6).
-- ------------------------------------------------------------
create table if not exists public.e_invoice_submissions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  invoice_id uuid references public.invoices (id), -- null for a consolidated batch (see header note 5)
  lhdn_uuid text,
  qr_code_ref text,
  submission_type text not null check (submission_type in ('normal', 'consolidated')),
  consolidated_period text,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'validated', 'rejected', 'cancelled')),
  irb_response_ref text,
  submitted_at timestamptz,
  created_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now(),
  constraint e_invoice_submissions_normal_has_invoice check (
    (submission_type = 'normal' and invoice_id is not null and consolidated_period is null)
    or (submission_type = 'consolidated' and invoice_id is null and consolidated_period is not null)
  )
);
create index if not exists idx_e_invoice_submissions_business on public.e_invoice_submissions (business_id);
alter table public.e_invoice_submissions enable row level security;
create policy "Active members with tax_compliance view can see e-invoice subs"
  on public.e_invoice_submissions for select using (public.caller_has_capability(business_id, 'tax_compliance', 'view'));

create table if not exists public.e_invoice_submission_lines (
  submission_id uuid not null references public.e_invoice_submissions (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id),
  primary key (submission_id, invoice_id)
);
alter table public.e_invoice_submission_lines enable row level security;
create policy "Active members with tax_compliance view can see sub lines"
  on public.e_invoice_submission_lines for select using (
    exists (select 1 from public.e_invoice_submissions s where s.id = e_invoice_submission_lines.submission_id
      and public.caller_has_capability(s.business_id, 'tax_compliance', 'view'))
  );

create or replace function public.create_einvoice_submission(p_business_id uuid, p_invoice_id uuid)
returns public.e_invoice_submissions
language plpgsql security definer set search_path = public, auth
as $$
declare v_caller_membership_id uuid; v_row public.e_invoice_submissions;
begin
  if not public.caller_has_capability(p_business_id, 'tax_compliance', 'capture') then
    raise exception 'not_authorized: requires capture on tax_compliance';
  end if;
  if not exists (select 1 from public.invoices where id = p_invoice_id and business_id = p_business_id) then
    raise exception 'invoice_not_found_for_this_business: %', p_invoice_id;
  end if;
  if exists (
    select 1 from public.e_invoice_submissions
    where invoice_id = p_invoice_id and status not in ('rejected', 'cancelled')
  ) then
    raise exception 'invoice_already_has_an_active_einvoice_submission: %', p_invoice_id;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.e_invoice_submissions (business_id, invoice_id, submission_type, created_by_membership_id)
  values (p_business_id, p_invoice_id, 'normal', v_caller_membership_id)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_einvoice_submission(uuid, uuid) to authenticated;

-- generate_consolidated_einvoice_batch: see header note 4 for the
-- non-B2B mapping and header note 5 for why e_invoice_submission_lines
-- exists.
create or replace function public.generate_consolidated_einvoice_batch(
  p_business_id uuid, p_consolidated_period text
) returns public.e_invoice_submissions
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_row public.e_invoice_submissions;
  v_invoice_id uuid;
  v_line_count integer := 0;
begin
  if not public.caller_has_capability(p_business_id, 'tax_compliance', 'capture') then
    raise exception 'not_authorized: requires capture on tax_compliance';
  end if;
  if p_consolidated_period is null or btrim(p_consolidated_period) = '' then
    raise exception 'consolidated_period_required';
  end if;
  if exists (
    select 1 from public.e_invoice_submissions
    where business_id = p_business_id and submission_type = 'consolidated'
      and consolidated_period = p_consolidated_period and status not in ('rejected', 'cancelled')
  ) then
    raise exception 'consolidated_batch_already_exists_for_this_period: %', p_consolidated_period;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.e_invoice_submissions (
    business_id, submission_type, consolidated_period, created_by_membership_id
  ) values (
    p_business_id, 'consolidated', p_consolidated_period, v_caller_membership_id
  ) returning * into v_row;

  for v_invoice_id in
    select i.id
    from public.invoices i
    join public.parties pty on pty.id = i.party_id
    where i.business_id = p_business_id
      and to_char(i.issue_date, 'YYYY-MM') = p_consolidated_period
      and i.status not in ('draft', 'cancelled')
      and (pty.tin is null or btrim(pty.tin) = '') -- non-B2B, see header note 4
      and not exists (
        select 1 from public.e_invoice_submissions es
        where es.invoice_id = i.id and es.status not in ('rejected', 'cancelled')
      )
  loop
    insert into public.e_invoice_submission_lines (submission_id, invoice_id) values (v_row.id, v_invoice_id);
    v_line_count := v_line_count + 1;
  end loop;

  if v_line_count = 0 then
    raise exception 'no_eligible_non_b2b_invoices_found_for_period: %', p_consolidated_period;
  end if;

  return v_row;
end;
$$;

grant execute on function public.generate_consolidated_einvoice_batch(uuid, text) to authenticated;

-- submit_einvoice: moves draft -> submitted. The actual MyInvois call
-- happens client-side (see header note 6); this just marks intent and
-- timestamp so a submission can't be "outcome-recorded" without first
-- having been marked as sent.
create or replace function public.submit_einvoice(p_submission_id uuid)
returns public.e_invoice_submissions
language plpgsql security definer set search_path = public, auth
as $$
declare v_row public.e_invoice_submissions;
begin
  select * into v_row from public.e_invoice_submissions where id = p_submission_id for update;
  if not found then raise exception 'e_invoice_submission_not_found: %', p_submission_id; end if;
  if not public.caller_has_capability(v_row.business_id, 'tax_compliance', 'capture') then
    raise exception 'not_authorized: requires capture on tax_compliance';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'e_invoice_submission_not_in_draft_status: current status %', v_row.status;
  end if;

  update public.e_invoice_submissions set status = 'submitted', submitted_at = now()
  where id = p_submission_id returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.submit_einvoice(uuid) to authenticated;

-- record_einvoice_submission_result: the client calls this with
-- whatever the (stubbed, this sprint — see header) MyInvois response
-- actually was — success (uuid + qr) or rejection (irb_response_ref
-- carries the real rejection reason, never swallowed, per this
-- sprint's own DoD wording).
create or replace function public.record_einvoice_submission_result(
  p_submission_id uuid, p_status text, p_lhdn_uuid text default null,
  p_qr_code_ref text default null, p_irb_response_ref text default null
) returns public.e_invoice_submissions
language plpgsql security definer set search_path = public, auth
as $$
declare v_row public.e_invoice_submissions;
begin
  select * into v_row from public.e_invoice_submissions where id = p_submission_id for update;
  if not found then raise exception 'e_invoice_submission_not_found: %', p_submission_id; end if;
  if not public.caller_has_capability(v_row.business_id, 'tax_compliance', 'capture') then
    raise exception 'not_authorized: requires capture on tax_compliance';
  end if;
  if v_row.status <> 'submitted' then
    raise exception 'e_invoice_submission_not_submitted: current status %', v_row.status;
  end if;
  if p_status not in ('validated', 'rejected') then
    raise exception 'invalid_result_status: must be validated or rejected, got %', p_status;
  end if;
  if p_status = 'validated' and (p_lhdn_uuid is null or p_qr_code_ref is null) then
    raise exception 'validated_result_requires_lhdn_uuid_and_qr_code_ref';
  end if;

  update public.e_invoice_submissions
  set status = p_status, lhdn_uuid = p_lhdn_uuid, qr_code_ref = p_qr_code_ref, irb_response_ref = p_irb_response_ref
  where id = p_submission_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.record_einvoice_submission_result(uuid, text, text, text, text) to authenticated;

-- ------------------------------------------------------------
-- 3. SST computation (Vol 13_0 §9 — see header notes 1-3).
-- ------------------------------------------------------------
alter table public.payment_vouchers add column if not exists sst_code text;

create table if not exists public.sst_transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  invoice_id uuid references public.invoices (id),
  payment_voucher_id uuid references public.payment_vouchers (id),
  sst_code text not null references public.sst_rates (sst_code),
  rate numeric(5, 4) not null,
  taxable_amount numeric(14, 2) not null,
  sst_amount numeric(14, 2) not null,
  created_at timestamptz not null default now(),
  constraint sst_transactions_exactly_one_source check (
    (invoice_id is not null and payment_voucher_id is null)
    or (invoice_id is null and payment_voucher_id is not null)
  )
);
create index if not exists idx_sst_transactions_business on public.sst_transactions (business_id);
create index if not exists idx_sst_transactions_invoice on public.sst_transactions (invoice_id) where invoice_id is not null;
alter table public.sst_transactions enable row level security;
create policy "Active members with tax_compliance view can see SST txns"
  on public.sst_transactions for select using (public.caller_has_capability(business_id, 'tax_compliance', 'view'));

-- compute_sst_for_invoice: one sst_transactions row per invoice_line
-- carrying a non-null tax_code that resolves to a real sst_rates row;
-- lines with no tax_code (or one not found in sst_rates) are silently
-- skipped, not treated as an error — Sprint 28 never required
-- tax_code to be populated, so a pre-Sprint-33 invoice or a genuinely
-- untaxed line is expected to have gaps, not a data problem.
create or replace function public.compute_sst_for_invoice(p_invoice_id uuid)
returns setof public.sst_transactions
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_invoice public.invoices;
  v_line record;
  v_rate public.sst_rates;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id;
  if not found then raise exception 'invoice_not_found: %', p_invoice_id; end if;
  if not public.caller_has_capability(v_invoice.business_id, 'tax_compliance', 'capture') then
    raise exception 'not_authorized: requires capture on tax_compliance';
  end if;
  if exists (select 1 from public.sst_transactions where invoice_id = p_invoice_id) then
    raise exception 'sst_already_computed_for_this_invoice: %', p_invoice_id;
  end if;

  for v_line in
    select il.tax_code, il.line_total
    from public.invoice_lines il
    where il.invoice_id = p_invoice_id and il.tax_code is not null and btrim(il.tax_code) <> ''
  loop
    select * into v_rate from public.sst_rates where sst_code = v_line.tax_code;
    if not found then
      continue; -- unrecognised tax_code — skip rather than fail the whole invoice
    end if;

    insert into public.sst_transactions (business_id, invoice_id, sst_code, rate, taxable_amount, sst_amount)
    values (
      v_invoice.business_id, p_invoice_id, v_rate.sst_code, v_rate.rate, v_line.line_total,
      round(v_line.line_total * v_rate.rate, 2)
    );
  end loop;

  return query select * from public.sst_transactions where invoice_id = p_invoice_id;
end;
$$;

grant execute on function public.compute_sst_for_invoice(uuid) to authenticated;

-- compute_sst_for_payment_voucher: PaymentVoucher is single-amount
-- (Sprint 30), so this computes exactly one sst_transactions row
-- against the whole grand_total, gated on payment_vouchers.sst_code
-- (see this migration's own added column above) being set.
create or replace function public.compute_sst_for_payment_voucher(p_payment_voucher_id uuid)
returns public.sst_transactions
language plpgsql security definer set search_path = public, auth
as $$
declare v_pv public.payment_vouchers; v_rate public.sst_rates; v_row public.sst_transactions;
begin
  select * into v_pv from public.payment_vouchers where id = p_payment_voucher_id;
  if not found then raise exception 'payment_voucher_not_found: %', p_payment_voucher_id; end if;
  if not public.caller_has_capability(v_pv.business_id, 'tax_compliance', 'capture') then
    raise exception 'not_authorized: requires capture on tax_compliance';
  end if;
  if v_pv.sst_code is null or btrim(v_pv.sst_code) = '' then
    raise exception 'payment_voucher_has_no_sst_code_set: %', p_payment_voucher_id;
  end if;
  if exists (select 1 from public.sst_transactions where payment_voucher_id = p_payment_voucher_id) then
    raise exception 'sst_already_computed_for_this_payment_voucher: %', p_payment_voucher_id;
  end if;

  select * into v_rate from public.sst_rates where sst_code = v_pv.sst_code;
  if not found then
    raise exception 'unrecognised_sst_code_on_payment_voucher: %', v_pv.sst_code;
  end if;

  insert into public.sst_transactions (business_id, payment_voucher_id, sst_code, rate, taxable_amount, sst_amount)
  values (v_pv.business_id, p_payment_voucher_id, v_rate.sst_code, v_rate.rate, v_pv.grand_total, round(v_pv.grand_total * v_rate.rate, 2))
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.compute_sst_for_payment_voucher(uuid) to authenticated;

-- ------------------------------------------------------------
-- 4. public.sst_returns (Vol 13_0 §9 — see header note 7).
-- ------------------------------------------------------------
create table if not exists public.sst_returns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  period text not null,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  total_output_tax numeric(14, 2) not null default 0,
  submitted_at timestamptz,
  created_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now(),
  unique (business_id, period)
);
alter table public.sst_returns enable row level security;
create policy "Active members with tax_compliance view can see SST returns"
  on public.sst_returns for select using (public.caller_has_capability(business_id, 'tax_compliance', 'view'));

create or replace function public.create_sst_return(p_business_id uuid, p_period text)
returns public.sst_returns
language plpgsql security definer set search_path = public, auth
as $$
declare v_caller_membership_id uuid; v_total numeric(14, 2); v_row public.sst_returns;
begin
  if not public.caller_has_capability(p_business_id, 'tax_compliance', 'capture') then
    raise exception 'not_authorized: requires capture on tax_compliance';
  end if;
  if p_period is null or btrim(p_period) = '' then
    raise exception 'period_required';
  end if;

  select coalesce(sum(st.sst_amount), 0) into v_total
  from public.sst_transactions st
  left join public.invoices i on i.id = st.invoice_id
  left join public.payment_vouchers pv on pv.id = st.payment_voucher_id
  where st.business_id = p_business_id
    and coalesce(to_char(i.issue_date, 'YYYY-MM'), to_char(pv.issue_date, 'YYYY-MM')) = p_period;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.sst_returns (business_id, period, total_output_tax, created_by_membership_id)
  values (p_business_id, p_period, v_total, v_caller_membership_id)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_sst_return(uuid, text) to authenticated;

create or replace function public.submit_sst_return(p_sst_return_id uuid)
returns public.sst_returns
language plpgsql security definer set search_path = public, auth
as $$
declare v_row public.sst_returns;
begin
  select * into v_row from public.sst_returns where id = p_sst_return_id for update;
  if not found then raise exception 'sst_return_not_found: %', p_sst_return_id; end if;
  if not public.caller_has_capability(v_row.business_id, 'tax_compliance', 'capture') then
    raise exception 'not_authorized: requires capture on tax_compliance';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'sst_return_not_in_draft_status: current status %', v_row.status;
  end if;

  update public.sst_returns set status = 'submitted', submitted_at = now()
  where id = p_sst_return_id returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.submit_sst_return(uuid) to authenticated;

-- ------------------------------------------------------------
-- 8. Bug fix to existing Sprint 28 code (see header note 8 below),
--    found while testing this sprint's own compute_sst_for_invoice.
-- ------------------------------------------------------------
--
-- public.create_quotation (Sprint 28) accepted a `tax_code` key on
-- each element of its p_lines jsonb argument but never actually
-- extracted or persisted it — the insert into quotation_lines simply
-- omitted the column. Since public.convert_quotation_to_invoice (also
-- Sprint 28) faithfully copies quotation_lines.tax_code forward into
-- invoice_lines.tax_code, this meant no invoice created through the
-- normal Quotation -> Invoice flow could ever end up with a populated
-- tax_code on any line, silently starving this sprint's
-- compute_sst_for_invoice (which reads invoice_lines.tax_code) of any
-- rows to compute against, no matter what the caller supplied. Not
-- caught by Sprint 28's own test suite because that suite never
-- asserted on tax_code specifically. Discovered here, this sprint,
-- via compute_sst_for_invoice returning zero rows against a line that
-- was clearly given a tax_code. Fixed by extracting p_lines' optional
-- 'tax_code' key and persisting it, matching the same nullif-on-empty
-- pattern already used for product_id elsewhere in this function.
create or replace function public.create_quotation(
  p_business_id uuid,
  p_party_id uuid,
  p_valid_until date,
  p_notes text,
  p_lines jsonb,
  p_ai_draft_summary text default null,
  p_auto_approved boolean default false
) returns public.quotations
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_quotation_no text;
  v_quotation public.quotations;
  v_line jsonb;
  v_line_no integer := 0;
  v_product_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_discount numeric;
  v_tax_code text;
  v_line_total numeric;
  v_subtotal numeric := 0;
  v_resolved record;
begin
  if not public.caller_has_capability(p_business_id, 'sales', 'capture') then
    raise exception 'not_authorized: requires capture on sales';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'no_lines_supplied';
  end if;
  if not exists (select 1 from public.parties where id = p_party_id and business_id = p_business_id) then
    raise exception 'party_not_found_for_this_business: %', p_party_id;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.document_number_sequences (business_id, document_type, prefix, reset_period)
  values (p_business_id, 'quotation', 'QTN', 'never')
  on conflict (business_id, document_type) do nothing;
  v_quotation_no := public.next_document_number(p_business_id, 'quotation');

  insert into public.quotations (
    business_id, quotation_no, party_id, valid_until, notes, captured_by_membership_id
  ) values (
    p_business_id, v_quotation_no, p_party_id, p_valid_until, p_notes, v_caller_membership_id
  ) returning * into v_quotation;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_line_no := v_line_no + 1;
    v_product_id := nullif(v_line ->> 'product_id', '')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_discount := coalesce((v_line ->> 'discount_amount')::numeric, 0);
    v_tax_code := nullif(v_line ->> 'tax_code', '');

    if v_line ? 'unit_price' and (v_line ->> 'unit_price') is not null then
      v_unit_price := (v_line ->> 'unit_price')::numeric;
    elsif v_product_id is not null then
      select r.unit_price into v_unit_price from public.resolve_price(p_business_id, v_product_id, p_party_id) r;
    else
      raise exception 'line_%_needs_either_product_id_or_an_explicit_unit_price', v_line_no;
    end if;

    v_line_total := (v_quantity * v_unit_price) - v_discount;
    v_subtotal := v_subtotal + v_line_total;

    insert into public.quotation_lines (
      quotation_id, line_no, product_id, description, quantity, unit_price, tax_code, discount_amount, line_total
    ) values (
      v_quotation.id, v_line_no, v_product_id, v_line ->> 'description', v_quantity, v_unit_price, v_tax_code, v_discount, v_line_total
    );
  end loop;

  update public.quotations set subtotal = v_subtotal, tax_total = 0, grand_total = v_subtotal
  where id = v_quotation.id
  returning * into v_quotation;

  perform public.create_approval_task(
    p_business_id, 'sales', 'quotation', v_quotation.id, v_quotation.grand_total,
    coalesce(p_ai_draft_summary, 'Quotation ' || v_quotation_no || ' for ' || v_quotation.grand_total || ' ' || v_quotation.currency),
    null, v_caller_membership_id, p_auto_approved, 'send WhatsApp'
  );

  return v_quotation;
end;
$$;

grant execute on function public.create_quotation(uuid, uuid, date, text, jsonb, text, boolean) to authenticated;

-- End of Sprint 33 migration.
