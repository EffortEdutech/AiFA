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
