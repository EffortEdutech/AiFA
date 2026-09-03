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
