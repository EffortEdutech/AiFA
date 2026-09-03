-- ==============================================================
-- AIFA backend schema — Sprint 34 (Vol 13_0 §10 Module G: Payroll &
-- Penggajian). Opens Sub-phase 3e.
--
-- ==============================================================
-- OWNER DECISION RECORDED THIS SPRINT (asked via AskUserQuestion,
-- not treated as a disclosed implementation detail, because it is a
-- genuine external-dependency decision, not one this migration could
-- reasonably make on its own):
--
-- This sprint's own DoD requires the Bulk Payment File Export to be
-- "validated against the target bank's actual format spec" (Maybank2u,
-- per Sprint 21's choice). Maybank2u Biz's real CSV column layout
-- lives inside their corporate banking portal (behind login) — public
-- documentation confirms the file must be CSV, 2-decimal amounts, no
-- scientific notation, but does not publish the actual column order/
-- field names. This session cannot fabricate that and call it
-- "validated."
--
-- Asked the owner directly how to proceed; they chose: build the
-- generator now against a documented, commonly-used Malaysian bulk-
-- pay CSV layout (recipient name / bank / account no / amount /
-- reference), clearly disclosed as NOT verified against Maybank2u's
-- real template, and wire in the real spec later once the owner (or
-- their bank) can supply it. DoD item 4 stays explicitly open in the
-- Sprint 34 doc's Outcomes, not silently marked done — the same
-- posture Sprint 33 took with the LHDN MyInvois sandbox.
-- ==============================================================
--
-- SCOPE NOTES (disclosed):
--
-- 1. Field-level encryption at rest for EmployeeProfile's sensitive
--    identifiers (Vol 8_2, called out explicitly by this sprint's own
--    task breakdown) is implemented with pgcrypto's
--    pgp_sym_encrypt/pgp_sym_decrypt, keyed by a text passphrase
--    supplied as an explicit RPC parameter at call time — never
--    stored in this schema, never generated or seen by this
--    development session (per this project's own standing rule: never
--    expose/fabricate secrets). The real deployment key is the
--    owner's own operational concern (e.g. a Supabase Edge Function /
--    server-side secret the client app is configured with), outside
--    this session's ability to provision. This sprint's own
--    verification uses a random, disposable, test-only key generated
--    inside the throwaway test database — never a real secret.
--    A stronger design exists on real Supabase — pgsodium/Vault-backed
--    key-id column encryption, where the raw key material never
--    leaves the vault or appears in SQL text at all — but pgsodium is
--    not installed in this session's local verification Postgres, so
--    it could not be built AND independently verified this sprint
--    (this project's own standing discipline: verified, not assumed).
--    Disclosed as a real, upgradeable limitation, not silently
--    accepted as final.
--
-- 2. `ic_number`, `epf_number`, `socso_number`, `income_tax_no`, and
--    `bank_account_no` are encrypted (all identifiers an owner would
--    reasonably call sensitive); `bank_name` and `basic_salary` are
--    left in plain columns — `bank_name` is not itself identifying,
--    and Vol 13_0 §10's own EmployeeProfile schema block does not
--    mark `basic_salary` for encryption (only `ic_number` is marked
--    "encrypted at rest (Vol 8_2)" there). Disclosed as a literal
--    reading of the spec, not an oversight.
--
-- 3. `StatutoryRateTable` is implemented the same way Sprint 33's
--    `sst_rates` was: a real, versioned server-side Postgres table
--    (queried by `compute_statutory_deductions` below) mirroring four
--    Finance PKA Knowledge Objects (`regulations/MY-EPF-2026.json`,
--    `MY-SOCSO-2026.json`, `MY-EIS-2026.json`, `MY-PCB-2026.json`),
--    kept in sync by convention. Rates are real published 2026 rates
--    (EPF 11%/13%-or-12%, SOCSO 0.5%/1.75% capped at RM6,000, EIS
--    0.2%/0.2% capped at RM6,000) researched via web search against
--    secondary payroll-reference sources, NOT verified against LHDN/
--    EPF/PERKESO's own primary published tables directly — the owner's
--    own payroll/HR advisor should confirm before this is relied on
--    for a real payroll run, per Vol 6_9 §5's advice boundary (applied
--    here by the same reasoning Vol 13_0 §10 extends from Vol 6_7 §5).
--
-- 4. `PCB` (Potongan Cukai Bulanan / Monthly Tax Deduction) is
--    implemented as a SIMPLIFIED progressive-bracket approximation:
--    annualised gross, less EPF relief (capped RM7,000) and personal
--    relief (RM9,000), taxed against the published YA2025/2026
--    resident individual bracket table, divided by 12. This is NOT
--    LHDN's actual PCB Schedule of Monthly Tax Deductions / Formula
--    Method, which additionally varies by marital-status category,
--    number of children, zakat, and other reliefs this schema does
--    not model. Disclosed as illustrative, matching Sprint 33's SST
--    rates posture exactly — never presented as a real LHDN-compliant
--    PCB calculation.
--
-- 5. Statutory deductions are computed via an explicit, deterministic,
--    separately-callable function (`compute_statutory_deductions`),
--    matching PRICE-001/`resolve_price`'s own established precedent
--    (Sprint 27) — "a lookup, not a classification judgment" — rather
--    than being buried inline inside `create_payroll_run`.
--
-- 6. `PayrollRun.status` has no `rejected` value in Vol 13_0 §10's own
--    literal enum (`draft | pending_approval | approved | paid`). On
--    an ApprovalTask rejection, this migration reverts the run to
--    `draft` (editable, resubmittable) rather than inventing a status
--    value the volume doesn't define — the true rejected state is
--    still fully recorded on the ApprovalTask row itself. Mirrors the
--    "no invented status value, defer to ApprovalTask's own status"
--    precedent established at Sprint 28 (Quotation) and reused at
--    Sprint 31 (DeliveryOrder).
--
-- 7. THE HARD RULE ITSELF — "PayrollRun approval never takes the
--    auto_approved path regardless of ai_confidence" — was already
--    built as a server-side guard inside `create_approval_task` back
--    in Sprint 25/28 (`if p_auto_approved and p_domain = 'payroll'
--    then raise exception 'payroll_never_auto_approves...'`),
--    anticipating exactly this sprint. This migration's own
--    `submit_payroll_run` additionally never exposes an
--    `p_auto_approved` parameter at all — there is no code path in
--    this migration that could even attempt to pass `true` — so the
--    guard is defence in depth, not the only line of defence. Both are
--    exercised directly by this sprint's own verification.
--
-- 8. Claims/SalaryAdvances are swept into a PayrollRun by full amount
--    in a single run (a Claim's whole `amount`, a SalaryAdvance's
--    entire `outstanding_balance`) — not partial/instalment deduction
--    across multiple runs. Vol 13_0 §10's own schema block shows a
--    single `advance_deducted` decimal per payslip with no instalment
--    concept, so this is a literal reading, not a scope cut; true
--    instalment-based advance recovery is reasonable future work.
--
-- 9. `BulkPaymentFileExport` gains a `file_content text` column beyond
--    Vol 13_0 §10's literal `file_ref` field — the same "necessary,
--    disclosed addition" reasoning as Sprint 33's
--    `e_invoice_submission_lines`: a `file_ref` alone, pointing at
--    nothing, would make "generated and validated" unverifiable. The
--    actual generated CSV text is stored so it can be inspected,
--    tested, and (eventually) actually downloaded/uploaded to the
--    bank portal.
--
-- 10. The payroll ledger posting (`mark_payroll_run_paid`) nets
--    `advance_deducted` directly against the Salaries & Wages debit,
--    since no dedicated Employee Advances Receivable asset account
--    exists yet to properly credit-reduce upon an advance's repayment
--    — a disclosed simplification for balance, not a correct full
--    treatment of the underlying asset. Two new system Chart of
--    Accounts rows are added to `seed_phase1_chart_of_accounts` (the
--    one canonical seeding function, per its own header comment):
--    '6500' Salaries & Wages (expense, child of Operating Expenses)
--    and '2100' Statutory Contributions Payable (liability).
--
-- 11. e-payslip delivery reuses the same click-to-chat WhatsApp
--    mechanism Sprint 21 already chose and Sprint 28 already built for
--    outbound sends (no separate decision needed for payslips) — this
--    migration marks `e_payslip_sent_at`/`e_payslip_channel` once
--    delivery is confirmed client-side, the same "Postgres owns state,
--    the actual send happens client-side" split every other outbound
--    channel in this schema already uses (Sprint 28 WhatsApp,
--    Sprint 33 MyInvois).
--
-- 12. A real bug found during this sprint's own testing:
--    `get_employee_profile_decrypted`'s `returns table (id uuid, ...)`
--    column list creates an implicit plpgsql variable named `id`,
--    which collided with `employee_profiles.id` in the function's own
--    `where id = p_employee_profile_id` lookup — `AmbiguousColumn`.
--    Fixed by aliasing the table (`employee_profiles ep ... where
--    ep.id = ...`), the same fix pattern used the moment it was hit.
-- ==============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 0. Two new system Chart of Accounts rows (see header note 10),
-- added to the one canonical seeding function.
-- ------------------------------------------------------------
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
    (p_business_id, '2100', 'Statutory Contributions Payable', 'liability', true),
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
    (p_business_id, '6500', 'Salaries & Wages', 'expense', v_opex_id, true),
    (p_business_id, '6900', 'Other', 'expense', v_opex_id, true)
  on conflict (business_id, account_code) do nothing;
end;
$$;

-- Backfill for any business seeded before this migration (Sprint 26
-- precedent: additive migration, dev environment has no real
-- production businesses yet, but the backfill call costs nothing).
do $$
declare r record;
begin
  for r in select id from public.businesses loop
    perform public.seed_phase1_chart_of_accounts(r.id);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 1. public.employee_profiles (Vol 13_0 §10 — see header notes 1-2).
-- ------------------------------------------------------------
create table if not exists public.employee_profiles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  party_id uuid not null unique references public.parties (id),
  ic_number_encrypted bytea not null,
  epf_number_encrypted bytea,
  socso_number_encrypted bytea,
  income_tax_no_encrypted bytea,
  bank_name text,
  bank_account_no_encrypted bytea not null,
  basic_salary numeric(14, 2) not null check (basic_salary >= 0),
  employment_type text not null check (employment_type in ('full_time', 'part_time', 'contract')),
  hire_date date not null,
  resign_date date,
  created_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now()
);
create index if not exists idx_employee_profiles_business on public.employee_profiles (business_id);
alter table public.employee_profiles enable row level security;
create policy "Active members with payroll view can see employee profiles"
  on public.employee_profiles for select using (public.caller_has_capability(business_id, 'payroll', 'view'));

create or replace function public.create_employee_profile(
  p_business_id uuid, p_party_id uuid, p_ic_number text, p_epf_number text,
  p_socso_number text, p_income_tax_no text, p_bank_name text, p_bank_account_no text,
  p_basic_salary numeric, p_employment_type text, p_hire_date date, p_encryption_key text
) returns public.employee_profiles
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_row public.employee_profiles;
begin
  if not public.caller_has_capability(p_business_id, 'payroll', 'capture') then
    raise exception 'not_authorized: requires capture on payroll';
  end if;
  if p_encryption_key is null or btrim(p_encryption_key) = '' then
    raise exception 'encryption_key_required';
  end if;
  if not exists (
    select 1 from public.parties where id = p_party_id and business_id = p_business_id
      and 'employee' = any(party_types)
  ) then
    raise exception 'party_not_found_or_not_an_employee_party: %', p_party_id;
  end if;
  if exists (select 1 from public.employee_profiles where party_id = p_party_id) then
    raise exception 'employee_profile_already_exists_for_this_party: %', p_party_id;
  end if;
  if p_employment_type not in ('full_time', 'part_time', 'contract') then
    raise exception 'invalid_employment_type: %', p_employment_type;
  end if;
  if p_ic_number is null or p_bank_account_no is null then
    raise exception 'ic_number_and_bank_account_no_required';
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.employee_profiles (
    business_id, party_id, ic_number_encrypted, epf_number_encrypted, socso_number_encrypted,
    income_tax_no_encrypted, bank_name, bank_account_no_encrypted, basic_salary, employment_type,
    hire_date, created_by_membership_id
  ) values (
    p_business_id, p_party_id,
    pgp_sym_encrypt(p_ic_number, p_encryption_key),
    case when p_epf_number is not null then pgp_sym_encrypt(p_epf_number, p_encryption_key) end,
    case when p_socso_number is not null then pgp_sym_encrypt(p_socso_number, p_encryption_key) end,
    case when p_income_tax_no is not null then pgp_sym_encrypt(p_income_tax_no, p_encryption_key) end,
    p_bank_name, pgp_sym_encrypt(p_bank_account_no, p_encryption_key), p_basic_salary, p_employment_type,
    p_hire_date, v_caller_membership_id
  ) returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_employee_profile(uuid, uuid, text, text, text, text, text, text, numeric, text, date, text) to authenticated;

-- get_employee_profile_decrypted: proves the encrypted columns round-
-- trip correctly with the right key, and that the WRONG key fails to
-- decrypt rather than silently returning garbage as if it were real
-- data (pgp_sym_decrypt raises on a key/format mismatch).
create or replace function public.get_employee_profile_decrypted(
  p_employee_profile_id uuid, p_encryption_key text
) returns table (
  id uuid, party_id uuid, ic_number text, epf_number text, socso_number text,
  income_tax_no text, bank_name text, bank_account_no text, basic_salary numeric,
  employment_type text, hire_date date, resign_date date
)
language plpgsql security definer set search_path = public, auth
as $$
declare v_ep public.employee_profiles;
begin
  select * into v_ep from public.employee_profiles ep where ep.id = p_employee_profile_id;
  if not found then raise exception 'employee_profile_not_found: %', p_employee_profile_id; end if;
  if not public.caller_has_capability(v_ep.business_id, 'payroll', 'view') then
    raise exception 'not_authorized: requires view on payroll';
  end if;

  return query select
    v_ep.id, v_ep.party_id,
    pgp_sym_decrypt(v_ep.ic_number_encrypted, p_encryption_key),
    case when v_ep.epf_number_encrypted is not null then pgp_sym_decrypt(v_ep.epf_number_encrypted, p_encryption_key) end,
    case when v_ep.socso_number_encrypted is not null then pgp_sym_decrypt(v_ep.socso_number_encrypted, p_encryption_key) end,
    case when v_ep.income_tax_no_encrypted is not null then pgp_sym_decrypt(v_ep.income_tax_no_encrypted, p_encryption_key) end,
    v_ep.bank_name,
    pgp_sym_decrypt(v_ep.bank_account_no_encrypted, p_encryption_key),
    v_ep.basic_salary, v_ep.employment_type, v_ep.hire_date, v_ep.resign_date;
end;
$$;

grant execute on function public.get_employee_profile_decrypted(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 2. public.statutory_rate_tables (Vol 13_0 §10 — see header note 3).
-- ------------------------------------------------------------
create table if not exists public.statutory_rate_tables (
  scheme text not null check (scheme in ('epf', 'socso', 'eis', 'pcb')),
  version text not null,
  effective_from date not null,
  rate_rules jsonb not null,
  created_at timestamptz not null default now(),
  primary key (scheme, version)
);
alter table public.statutory_rate_tables enable row level security;
create policy "Any authenticated user can view the statutory rate catalog"
  on public.statutory_rate_tables for select using (auth.role() = 'authenticated');

insert into public.statutory_rate_tables (scheme, version, effective_from, rate_rules) values
  ('epf', 'MY-EPF-2026', '2026-01-01',
   '{"employee_rate": 0.11, "employer_rate_low": 0.13, "employer_rate_high": 0.12, "employer_threshold": 5000}'::jsonb),
  ('socso', 'MY-SOCSO-2026', '2026-01-01',
   '{"employee_rate": 0.005, "employer_rate": 0.0175, "wage_ceiling": 6000}'::jsonb),
  ('eis', 'MY-EIS-2026', '2026-01-01',
   '{"employee_rate": 0.002, "employer_rate": 0.002, "wage_ceiling": 6000}'::jsonb),
  ('pcb', 'MY-PCB-2026', '2026-01-01',
   '{"personal_relief": 9000, "epf_relief_cap": 7000, "brackets": [
      {"lower": 0, "upper": 5000, "rate": 0.00},
      {"lower": 5000, "upper": 20000, "rate": 0.01},
      {"lower": 20000, "upper": 35000, "rate": 0.03},
      {"lower": 35000, "upper": 50000, "rate": 0.06},
      {"lower": 50000, "upper": 70000, "rate": 0.11},
      {"lower": 70000, "upper": 100000, "rate": 0.19},
      {"lower": 100000, "upper": 400000, "rate": 0.25},
      {"lower": 400000, "upper": 600000, "rate": 0.26},
      {"lower": 600000, "upper": 2000000, "rate": 0.28},
      {"lower": 2000000, "upper": null, "rate": 0.30}
   ]}'::jsonb)
on conflict (scheme, version) do nothing;

-- compute_statutory_deductions: see header notes 3-5. Deterministic
-- lookup + arithmetic against the CURRENT (latest effective_from <=
-- p_as_of) version per scheme — never owner-editable in-app, per Vol
-- 13_0 §10's own explicit instruction (there is no update/delete RPC
-- for statutory_rate_tables at all).
create or replace function public.compute_statutory_deductions(
  p_gross_pay numeric, p_as_of date default current_date
) returns table (
  epf_employee numeric, epf_employer numeric,
  socso_employee numeric, socso_employer numeric,
  eis_employee numeric, eis_employer numeric,
  pcb_deduction numeric
)
language plpgsql
as $$
declare
  v_epf jsonb; v_socso jsonb; v_eis jsonb; v_pcb jsonb;
  v_epf_employee numeric; v_epf_employer numeric;
  v_socso_wage numeric; v_socso_employee numeric; v_socso_employer numeric;
  v_eis_wage numeric; v_eis_employee numeric; v_eis_employer numeric;
  v_annual_gross numeric; v_epf_relief numeric; v_chargeable numeric;
  v_annual_tax numeric := 0;
  v_bracket jsonb;
  v_lower numeric; v_upper numeric; v_rate numeric; v_taxable_in_bracket numeric;
begin
  select rate_rules into v_epf from public.statutory_rate_tables
  where scheme = 'epf' and effective_from <= p_as_of order by effective_from desc limit 1;
  select rate_rules into v_socso from public.statutory_rate_tables
  where scheme = 'socso' and effective_from <= p_as_of order by effective_from desc limit 1;
  select rate_rules into v_eis from public.statutory_rate_tables
  where scheme = 'eis' and effective_from <= p_as_of order by effective_from desc limit 1;
  select rate_rules into v_pcb from public.statutory_rate_tables
  where scheme = 'pcb' and effective_from <= p_as_of order by effective_from desc limit 1;
  if v_epf is null or v_socso is null or v_eis is null or v_pcb is null then
    raise exception 'no_statutory_rate_table_effective_as_of: %', p_as_of;
  end if;

  v_epf_employee := round(p_gross_pay * (v_epf ->> 'employee_rate')::numeric, 2);
  v_epf_employer := round(
    p_gross_pay * (case when p_gross_pay <= (v_epf ->> 'employer_threshold')::numeric
      then (v_epf ->> 'employer_rate_low')::numeric else (v_epf ->> 'employer_rate_high')::numeric end),
    2
  );

  v_socso_wage := least(p_gross_pay, (v_socso ->> 'wage_ceiling')::numeric);
  v_socso_employee := round(v_socso_wage * (v_socso ->> 'employee_rate')::numeric, 2);
  v_socso_employer := round(v_socso_wage * (v_socso ->> 'employer_rate')::numeric, 2);

  v_eis_wage := least(p_gross_pay, (v_eis ->> 'wage_ceiling')::numeric);
  v_eis_employee := round(v_eis_wage * (v_eis ->> 'employee_rate')::numeric, 2);
  v_eis_employer := round(v_eis_wage * (v_eis ->> 'employer_rate')::numeric, 2);

  v_annual_gross := p_gross_pay * 12;
  v_epf_relief := least(v_epf_employee * 12, (v_pcb ->> 'epf_relief_cap')::numeric);
  v_chargeable := greatest(v_annual_gross - v_epf_relief - (v_pcb ->> 'personal_relief')::numeric, 0);

  for v_bracket in select * from jsonb_array_elements(v_pcb -> 'brackets')
  loop
    v_lower := (v_bracket ->> 'lower')::numeric;
    v_upper := nullif(v_bracket ->> 'upper', 'null')::numeric; -- null = unbounded top bracket
    v_rate := (v_bracket ->> 'rate')::numeric;
    if v_chargeable > v_lower then
      v_taxable_in_bracket := least(v_chargeable, coalesce(v_upper, v_chargeable)) - v_lower;
      v_annual_tax := v_annual_tax + (v_taxable_in_bracket * v_rate);
    end if;
  end loop;

  return query select
    v_epf_employee, v_epf_employer, v_socso_employee, v_socso_employer,
    v_eis_employee, v_eis_employer, round(v_annual_tax / 12, 2);
end;
$$;

grant execute on function public.compute_statutory_deductions(numeric, date) to authenticated;

-- ------------------------------------------------------------
-- 3. public.payroll_runs / public.payslips (Vol 13_0 §10 — see
-- header notes 6-8).
-- ------------------------------------------------------------
create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  period text not null,
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'approved', 'paid')),
  total_net_pay numeric(14, 2) not null default 0,
  created_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now(),
  unique (business_id, period)
);
create index if not exists idx_payroll_runs_business on public.payroll_runs (business_id);
alter table public.payroll_runs enable row level security;
create policy "Active members with payroll view can see payroll runs"
  on public.payroll_runs for select using (public.caller_has_capability(business_id, 'payroll', 'view'));

create table if not exists public.payslips (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references public.payroll_runs (id) on delete cascade,
  employee_party_id uuid not null references public.parties (id),
  gross_pay numeric(14, 2) not null,
  epf_employee numeric(14, 2) not null default 0,
  epf_employer numeric(14, 2) not null default 0,
  socso_employee numeric(14, 2) not null default 0,
  socso_employer numeric(14, 2) not null default 0,
  eis_employee numeric(14, 2) not null default 0,
  eis_employer numeric(14, 2) not null default 0,
  pcb_deduction numeric(14, 2) not null default 0,
  claims_included numeric(14, 2) not null default 0,
  advance_deducted numeric(14, 2) not null default 0,
  net_pay numeric(14, 2) not null,
  e_payslip_sent_at timestamptz,
  e_payslip_channel text check (e_payslip_channel in ('whatsapp', 'email')),
  created_at timestamptz not null default now(),
  unique (payroll_run_id, employee_party_id)
);
create index if not exists idx_payslips_payroll_run on public.payslips (payroll_run_id);
alter table public.payslips enable row level security;
create policy "Active members with payroll view can see payslips"
  on public.payslips for select using (
    exists (select 1 from public.payroll_runs pr where pr.id = payslips.payroll_run_id
      and public.caller_has_capability(pr.business_id, 'payroll', 'view'))
  );

-- ------------------------------------------------------------
-- 4. public.claims / public.salary_advances (Vol 13_0 §10).
-- ------------------------------------------------------------
create table if not exists public.claims (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  employee_party_id uuid not null references public.parties (id),
  amount numeric(14, 2) not null check (amount > 0),
  category text not null,
  status text not null default 'pending_approval' check (status in ('pending_approval', 'approved', 'included_in_payroll', 'rejected')),
  document_id_receipt uuid references public.documents (id),
  created_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now()
);
create index if not exists idx_claims_business on public.claims (business_id);
alter table public.claims enable row level security;
create policy "Active members with payroll view can see claims"
  on public.claims for select using (public.caller_has_capability(business_id, 'payroll', 'view'));

create table if not exists public.salary_advances (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  employee_party_id uuid not null references public.parties (id),
  amount numeric(14, 2) not null check (amount > 0),
  status text not null default 'pending_approval' check (status in ('pending_approval', 'approved', 'fully_deducted', 'rejected')),
  outstanding_balance numeric(14, 2) not null,
  created_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now()
);
create index if not exists idx_salary_advances_business on public.salary_advances (business_id);
alter table public.salary_advances enable row level security;
create policy "Active members with payroll view can see salary advances"
  on public.salary_advances for select using (public.caller_has_capability(business_id, 'payroll', 'view'));

create or replace function public.create_claim(
  p_business_id uuid, p_employee_party_id uuid, p_amount numeric, p_category text,
  p_document_id_receipt uuid default null, p_ai_draft_summary text default null, p_auto_approved boolean default false
) returns public.claims
language plpgsql security definer set search_path = public, auth
as $$
declare v_caller_membership_id uuid; v_row public.claims;
begin
  if not public.caller_has_capability(p_business_id, 'payroll', 'capture') then
    raise exception 'not_authorized: requires capture on payroll';
  end if;
  if not exists (select 1 from public.parties where id = p_employee_party_id and business_id = p_business_id
    and 'employee' = any(party_types)) then
    raise exception 'employee_party_not_found_for_this_business: %', p_employee_party_id;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.claims (business_id, employee_party_id, amount, category, document_id_receipt, created_by_membership_id)
  values (p_business_id, p_employee_party_id, p_amount, p_category, p_document_id_receipt, v_caller_membership_id)
  returning * into v_row;

  perform public.create_approval_task(
    p_business_id, 'payroll', 'claim', v_row.id, v_row.amount,
    coalesce(p_ai_draft_summary, 'Claim (' || p_category || ') for ' || v_row.amount),
    null, v_caller_membership_id, p_auto_approved, null
  );

  return v_row;
end;
$$;

grant execute on function public.create_claim(uuid, uuid, numeric, text, uuid, text, boolean) to authenticated;

create or replace function public.create_salary_advance(
  p_business_id uuid, p_employee_party_id uuid, p_amount numeric,
  p_ai_draft_summary text default null, p_auto_approved boolean default false
) returns public.salary_advances
language plpgsql security definer set search_path = public, auth
as $$
declare v_caller_membership_id uuid; v_row public.salary_advances;
begin
  if not public.caller_has_capability(p_business_id, 'payroll', 'capture') then
    raise exception 'not_authorized: requires capture on payroll';
  end if;
  if not exists (select 1 from public.parties where id = p_employee_party_id and business_id = p_business_id
    and 'employee' = any(party_types)) then
    raise exception 'employee_party_not_found_for_this_business: %', p_employee_party_id;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.salary_advances (business_id, employee_party_id, amount, outstanding_balance, created_by_membership_id)
  values (p_business_id, p_employee_party_id, p_amount, p_amount, v_caller_membership_id)
  returning * into v_row;

  perform public.create_approval_task(
    p_business_id, 'payroll', 'salary_advance', v_row.id, v_row.amount,
    coalesce(p_ai_draft_summary, 'Salary advance for ' || v_row.amount),
    null, v_caller_membership_id, p_auto_approved, null
  );

  return v_row;
end;
$$;

grant execute on function public.create_salary_advance(uuid, uuid, numeric, text, boolean) to authenticated;

-- Sync triggers — same shape as sync_payment_voucher_on_task_decision
-- (Sprint 30). Claim: pending_approval -> approved|rejected.
-- SalaryAdvance: pending_approval -> approved|rejected.
create or replace function public.sync_claim_on_task_decision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.subject_type <> 'claim' or old.status is not distinct from new.status then
    return new;
  end if;
  if new.status in ('approved', 'auto_approved') then
    update public.claims set status = 'approved' where id = new.subject_id and status = 'pending_approval';
  elsif new.status = 'rejected' then
    update public.claims set status = 'rejected' where id = new.subject_id and status = 'pending_approval';
  end if;
  return new;
end;
$$;
create trigger trg_sync_claim_on_task_decision
  after update on public.approval_tasks
  for each row execute function public.sync_claim_on_task_decision();

create or replace function public.sync_salary_advance_on_task_decision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.subject_type <> 'salary_advance' or old.status is not distinct from new.status then
    return new;
  end if;
  if new.status in ('approved', 'auto_approved') then
    update public.salary_advances set status = 'approved' where id = new.subject_id and status = 'pending_approval';
  elsif new.status = 'rejected' then
    update public.salary_advances set status = 'rejected' where id = new.subject_id and status = 'pending_approval';
  end if;
  return new;
end;
$$;
create trigger trg_sync_salary_advance_on_task_decision
  after update on public.approval_tasks
  for each row execute function public.sync_salary_advance_on_task_decision();

-- payroll_runs sync — see header note 6 (revert to 'draft' on
-- rejection, no invented status value).
create or replace function public.sync_payroll_run_on_task_decision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.subject_type <> 'payroll_run' or old.status is not distinct from new.status then
    return new;
  end if;
  if new.status = 'approved' then -- deliberately excludes 'auto_approved': see header note 7, that path is hard-blocked upstream
    update public.payroll_runs set status = 'approved' where id = new.subject_id and status = 'pending_approval';
  elsif new.status = 'rejected' then
    update public.payroll_runs set status = 'draft' where id = new.subject_id and status = 'pending_approval';
  end if;
  return new;
end;
$$;
create trigger trg_sync_payroll_run_on_task_decision
  after update on public.approval_tasks
  for each row execute function public.sync_payroll_run_on_task_decision();

-- ------------------------------------------------------------
-- 5. create_payroll_run / submit_payroll_run (Vol 13_0 §10 — see
-- header notes 6-8).
-- ------------------------------------------------------------
create or replace function public.create_payroll_run(p_business_id uuid, p_period text)
returns public.payroll_runs
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_row public.payroll_runs;
  v_emp record;
  v_stat record;
  v_claims_total numeric;
  v_advance_total numeric;
  v_claim record;
  v_advance record;
  v_net numeric;
  v_total numeric := 0;
  v_period_end date;
begin
  if not public.caller_has_capability(p_business_id, 'payroll', 'capture') then
    raise exception 'not_authorized: requires capture on payroll';
  end if;
  if p_period is null or p_period !~ '^\d{4}-\d{2}$' then
    raise exception 'invalid_period_format: expected YYYY-MM, got %', p_period;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  v_period_end := (to_date(p_period, 'YYYY-MM') + interval '1 month' - interval '1 day')::date;

  insert into public.payroll_runs (business_id, period, created_by_membership_id)
  values (p_business_id, p_period, v_caller_membership_id)
  returning * into v_row;

  for v_emp in
    select ep.*, p.id as employee_party_id from public.employee_profiles ep
    join public.parties p on p.id = ep.party_id
    where ep.business_id = p_business_id
      and ep.hire_date <= v_period_end
      and (ep.resign_date is null or ep.resign_date > v_period_end)
  loop
    select * into v_stat from public.compute_statutory_deductions(v_emp.basic_salary, v_period_end);

    v_claims_total := 0;
    for v_claim in select * from public.claims
      where employee_party_id = v_emp.employee_party_id and status = 'approved'
    loop
      v_claims_total := v_claims_total + v_claim.amount;
      update public.claims set status = 'included_in_payroll' where id = v_claim.id;
    end loop;

    v_advance_total := 0;
    for v_advance in select * from public.salary_advances
      where employee_party_id = v_emp.employee_party_id and status = 'approved'
    loop
      v_advance_total := v_advance_total + v_advance.outstanding_balance;
      update public.salary_advances set status = 'fully_deducted', outstanding_balance = 0 where id = v_advance.id;
    end loop;

    v_net := v_emp.basic_salary - v_stat.epf_employee - v_stat.socso_employee - v_stat.eis_employee
      - v_stat.pcb_deduction + v_claims_total - v_advance_total;

    insert into public.payslips (
      payroll_run_id, employee_party_id, gross_pay, epf_employee, epf_employer,
      socso_employee, socso_employer, eis_employee, eis_employer, pcb_deduction,
      claims_included, advance_deducted, net_pay
    ) values (
      v_row.id, v_emp.employee_party_id, v_emp.basic_salary, v_stat.epf_employee, v_stat.epf_employer,
      v_stat.socso_employee, v_stat.socso_employer, v_stat.eis_employee, v_stat.eis_employer, v_stat.pcb_deduction,
      v_claims_total, v_advance_total, v_net
    );

    v_total := v_total + v_net;
  end loop;

  update public.payroll_runs set total_net_pay = v_total where id = v_row.id returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_payroll_run(uuid, text) to authenticated;

-- submit_payroll_run: THE hard rule, see header note 7. There is no
-- p_auto_approved parameter anywhere in this function's signature —
-- no caller of this RPC can ever request the auto-approve path, full
-- stop, on top of create_approval_task's own server-side guard.
create or replace function public.submit_payroll_run(p_payroll_run_id uuid)
returns public.payroll_runs
language plpgsql security definer set search_path = public, auth
as $$
declare v_row public.payroll_runs; v_caller_membership_id uuid; v_payslip_count integer;
begin
  select * into v_row from public.payroll_runs where id = p_payroll_run_id for update;
  if not found then raise exception 'payroll_run_not_found: %', p_payroll_run_id; end if;
  if not public.caller_has_capability(v_row.business_id, 'payroll', 'capture') then
    raise exception 'not_authorized: requires capture on payroll';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'payroll_run_not_in_draft_status: current status %', v_row.status;
  end if;
  select count(*) into v_payslip_count from public.payslips where payroll_run_id = p_payroll_run_id;
  if v_payslip_count = 0 then
    raise exception 'payroll_run_has_no_payslips: nothing to submit for approval';
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = v_row.business_id and bm.user_id = auth.uid() and bm.status = 'active';

  update public.payroll_runs set status = 'pending_approval' where id = p_payroll_run_id returning * into v_row;

  perform public.create_approval_task(
    v_row.business_id, 'payroll', 'payroll_run', v_row.id, v_row.total_net_pay,
    'Payroll run for period ' || v_row.period || ', total net pay ' || v_row.total_net_pay,
    null, v_caller_membership_id, false, 'generate bulk payment file' -- p_auto_approved hardcoded false, not passed through
  );

  return v_row;
end;
$$;

grant execute on function public.submit_payroll_run(uuid) to authenticated;

-- ------------------------------------------------------------
-- 6. e-payslip delivery marking (Vol 13_0 §10 — see header note 11).
-- ------------------------------------------------------------
create or replace function public.mark_payslip_sent(p_payslip_id uuid, p_channel text)
returns public.payslips
language plpgsql security definer set search_path = public, auth
as $$
declare v_payslip public.payslips; v_run public.payroll_runs;
begin
  if p_channel not in ('whatsapp', 'email') then
    raise exception 'invalid_channel: must be whatsapp or email';
  end if;
  select * into v_payslip from public.payslips where id = p_payslip_id for update;
  if not found then raise exception 'payslip_not_found: %', p_payslip_id; end if;
  select * into v_run from public.payroll_runs where id = v_payslip.payroll_run_id;
  if not public.caller_has_capability(v_run.business_id, 'payroll', 'capture') then
    raise exception 'not_authorized: requires capture on payroll';
  end if;
  if v_run.status not in ('approved', 'paid') then
    raise exception 'payroll_run_not_yet_approved: current status %', v_run.status;
  end if;
  if v_payslip.e_payslip_sent_at is not null then
    raise exception 'payslip_already_marked_sent: %', p_payslip_id;
  end if;

  update public.payslips set e_payslip_sent_at = now(), e_payslip_channel = p_channel
  where id = p_payslip_id returning * into v_payslip;

  return v_payslip;
end;
$$;

grant execute on function public.mark_payslip_sent(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 7. public.bulk_payment_file_exports (Vol 13_0 §10 — see header
-- notes 9 and the owner-decision block at the top of this file).
-- ------------------------------------------------------------
create table if not exists public.bulk_payment_file_exports (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references public.payroll_runs (id),
  bank_format text not null,
  file_ref text not null,
  file_content text not null,
  created_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now()
);
create index if not exists idx_bulk_payment_file_exports_run on public.bulk_payment_file_exports (payroll_run_id);
alter table public.bulk_payment_file_exports enable row level security;
create policy "Active members with payroll view can see bulk payment file exp"
  on public.bulk_payment_file_exports for select using (
    exists (select 1 from public.payroll_runs pr where pr.id = bulk_payment_file_exports.payroll_run_id
      and public.caller_has_capability(pr.business_id, 'payroll', 'view'))
  );

-- generate_bulk_payment_file_export: builds a CSV against the
-- documented-generic layout named in the owner-decision block above —
-- NOT verified against Maybank2u's real template. 2-decimal amounts,
-- no scientific notation, per the one public constraint this session
-- could actually confirm (Maybank2u Biz FAQ).
create or replace function public.generate_bulk_payment_file_export(
  p_payroll_run_id uuid, p_encryption_key text, p_bank_format text default 'Maybank2u'
) returns public.bulk_payment_file_exports
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_run public.payroll_runs;
  v_caller_membership_id uuid;
  v_line record;
  v_csv text := 'Recipient Name,Recipient Bank Name,Recipient Bank Account No,Amount,Payment Reference,Payment Date' || E'\n';
  v_row public.bulk_payment_file_exports;
  v_file_ref text;
begin
  select * into v_run from public.payroll_runs where id = p_payroll_run_id for update;
  if not found then raise exception 'payroll_run_not_found: %', p_payroll_run_id; end if;
  if not public.caller_has_capability(v_run.business_id, 'payroll', 'capture') then
    raise exception 'not_authorized: requires capture on payroll';
  end if;
  if v_run.status <> 'approved' then
    raise exception 'payroll_run_not_approved: current status %', v_run.status;
  end if;
  if exists (select 1 from public.bulk_payment_file_exports where payroll_run_id = p_payroll_run_id) then
    raise exception 'bulk_payment_file_already_generated_for_this_run: %', p_payroll_run_id;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = v_run.business_id and bm.user_id = auth.uid() and bm.status = 'active';

  for v_line in
    select
      coalesce(p.legal_name, p.display_name) as recipient_name,
      ep.bank_name,
      pgp_sym_decrypt(ep.bank_account_no_encrypted, p_encryption_key) as bank_account_no,
      ps.net_pay
    from public.payslips ps
    join public.parties p on p.id = ps.employee_party_id
    join public.employee_profiles ep on ep.party_id = ps.employee_party_id
    where ps.payroll_run_id = p_payroll_run_id
    order by p.display_name
  loop
    v_csv := v_csv || format(
      '%s,%s,%s,%s,%s,%s' || E'\n',
      replace(v_line.recipient_name, ',', ' '),
      coalesce(replace(v_line.bank_name, ',', ' '), ''),
      v_line.bank_account_no,
      to_char(v_line.net_pay, 'FM999999990.00'),
      'Payroll ' || v_run.period,
      to_char(current_date, 'YYYY-MM-DD')
    );
  end loop;

  v_file_ref := 'payroll_' || v_run.period || '_' || p_bank_format || '_' || p_payroll_run_id::text || '.csv';

  insert into public.bulk_payment_file_exports (payroll_run_id, bank_format, file_ref, file_content, created_by_membership_id)
  values (p_payroll_run_id, p_bank_format, v_file_ref, v_csv, v_caller_membership_id)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.generate_bulk_payment_file_export(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
-- 8. mark_payroll_run_paid — the actual ledger-posting moment (see
-- header note 10). Mirrors mark_payment_voucher_paid's own posture:
-- dual-gate (payroll capture, or accounting_reports configure), the
-- real cash-movement/statutory-liability posting happens here, not at
-- approval time.
-- ------------------------------------------------------------
create or replace function public.mark_payroll_run_paid(p_payroll_run_id uuid)
returns public.payroll_runs
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_run public.payroll_runs;
  v_caller_membership_id uuid;
  v_salaries_account_id uuid;
  v_statutory_account_id uuid;
  v_cash_account_id uuid;
  v_debit_total numeric;
  v_statutory_total numeric;
  v_cash_total numeric;
begin
  select * into v_run from public.payroll_runs where id = p_payroll_run_id for update;
  if not found then raise exception 'payroll_run_not_found: %', p_payroll_run_id; end if;
  if not (
    public.caller_has_capability(v_run.business_id, 'payroll', 'capture')
    or public.caller_has_capability(v_run.business_id, 'accounting_reports', 'configure')
  ) then
    raise exception 'not_authorized: requires capture on payroll, or configure on accounting_reports';
  end if;
  if v_run.status <> 'approved' then
    raise exception 'payroll_run_not_approved: current status %', v_run.status;
  end if;
  if not exists (select 1 from public.bulk_payment_file_exports where payroll_run_id = p_payroll_run_id) then
    raise exception 'bulk_payment_file_not_yet_generated_for_this_run: %', p_payroll_run_id;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = v_run.business_id and bm.user_id = auth.uid() and bm.status = 'active';

  select id into v_salaries_account_id from public.chart_of_accounts
  where business_id = v_run.business_id and account_code = '6500';
  select id into v_statutory_account_id from public.chart_of_accounts
  where business_id = v_run.business_id and account_code = '2100';
  select id into v_cash_account_id from public.chart_of_accounts
  where business_id = v_run.business_id and account_code = '1000';
  if v_salaries_account_id is null or v_statutory_account_id is null or v_cash_account_id is null then
    raise exception 'chart_of_accounts_missing_expected_payroll_accounts: business %', v_run.business_id;
  end if;

  select
    coalesce(sum(gross_pay + epf_employer + socso_employer + eis_employer + claims_included - advance_deducted), 0),
    coalesce(sum(epf_employee + epf_employer + socso_employee + socso_employer + eis_employee + eis_employer + pcb_deduction), 0),
    coalesce(sum(net_pay), 0)
  into v_debit_total, v_statutory_total, v_cash_total
  from public.payslips where payroll_run_id = p_payroll_run_id;

  insert into public.ledger_entries (business_id, chart_of_accounts_id, direction, amount, currency, posted_by_membership_id)
  values
    (v_run.business_id, v_salaries_account_id, 'debit', v_debit_total, 'MYR', v_caller_membership_id),
    (v_run.business_id, v_statutory_account_id, 'credit', v_statutory_total, 'MYR', v_caller_membership_id),
    (v_run.business_id, v_cash_account_id, 'credit', v_cash_total, 'MYR', v_caller_membership_id);

  update public.payroll_runs set status = 'paid' where id = p_payroll_run_id returning * into v_run;

  return v_run;
end;
$$;

grant execute on function public.mark_payroll_run_paid(uuid) to authenticated;

-- End of Sprint 34 migration.
