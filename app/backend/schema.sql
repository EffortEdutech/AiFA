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

grant execute on function public.register_device(text, text, text) to aifa_app_role;

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

grant execute on function public.request_activation(text, bigint, uuid) to aifa_app_role;

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

grant execute on function public.request_primary_takeover(text, bigint) to aifa_app_role;

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

grant execute on function public.set_primary_device(text) to aifa_app_role;
