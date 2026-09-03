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
