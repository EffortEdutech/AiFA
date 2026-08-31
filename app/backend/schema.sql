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
