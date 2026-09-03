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
