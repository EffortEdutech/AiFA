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
