-- Sprint 61 (Phase 5, "Cross-Domain Approval Chaining & Confidence
-- Trust," 16 September 2026) — Bismillah.
--
-- PREMISE-MISMATCH DISCLOSURE (both surfaced while verifying this
-- sprint doc against the real codebase, both resolved via explicit
-- owner decision before any code below was written):
--
--   1. CHAINING: the sprint doc's own framing — "a generalized form of
--      Sprint 58's chaining rule" — assumed an automatic-reentry
--      mechanism already existed to generalize. It does not.
--      purchaseOrderTransport.ts's own header (14 September 2026)
--      explicitly records that the originally-planned automatic
--      re-entry into the Channel Intake router was deliberately NOT
--      built; Sprint 58 shipped explicit owner-triggered buttons
--      (confirmPurchaseOrderReceipt/markPurchaseOrderPaid) instead,
--      calling it "a simpler, safer first cut." Owner's decision:
--      build the real automatic re-entry this sprint. Implemented
--      below as a new `chained_intakes` table, populated by explicit
--      hooks at each existing transition point (the approval-decision
--      trigger AND the two owner-triggered RPCs themselves) — NOT a
--      fully generic runtime engine watching every status column in
--      the schema (that would be a far larger, riskier rewrite of
--      every domain's trigger for one sprint, and is not what either
--      premise-mismatch decision asked for). The one place this
--      migration IS genuinely declarative, per the doc's own wording:
--      which domain comes next for a given domain is looked up from a
--      small `chain_definitions` table, not hardcoded as a string
--      literal at each call site — so the *shape* of the chain is real
--      data, even though *when* to advance it is still one explicit
--      hook per existing transition point, the same discipline every
--      other trigger in this schema already follows.
--
--   2. TRUST: the sprint doc's own framing — "the same trust-
--      accumulation mechanism vendor-category confidence already
--      uses" — assumed that mechanism (businessKnowledgeRepository.ts,
--      packages/core/src/db) was reachable from this sprint's Path B
--      capture router. It is not: that mechanism is Path A-only
--      (local SQLite, end-to-end encrypted before it ever reaches
--      Supabase — Vol_13_1 §8), while the capture router this sprint
--      touches is explicitly Path B (useCaptureRouterCore.ts's own
--      header: "Still PATH B, NOT PATH A"). The two systems share no
--      data — a Path B RPC genuinely cannot read Path A's encrypted
--      store, by design. Owner's decision: build a NEW, Path B-native
--      Postgres table (`channel_domain_trust`), MIRRORING
--      businessKnowledgeRepository.ts's exact shape (3-in-a-row
--      confirmation threshold, reset to 0 on a wrong classification,
--      one row per tracked pair) rather than reaching into Path A's
--      store, which is architecturally impossible from here.
--
-- Both disclosures and resolutions were presented to and confirmed by
-- the owner via explicit choice in chat before this file was written.
-- ------------------------------------------------------------------

-- ==================================================================
-- PART 1 — CHANNEL-DOMAIN TRUST (Path B-native)
--
-- PERMANENT EXCEPTION (carried unchanged from Sprints 59/60, verified
-- here as a real, unbypassable database guarantee per this sprint's
-- own DoD requirement — "verified as an explicit test, not an
-- assumption"): attendance corrections, stock adjustments, e-Invoice/
-- SST flags, contract alerts, and e-signature requests can NEVER
-- report is_trusted = true, no matter how many confirmations
-- accumulate. Enforced inside get_channel_domain_trust_status itself,
-- not left for the client to remember to apply.
-- ==================================================================

create table public.channel_domain_trust (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  channel text not null,
  domain text not null,
  confirmation_count integer not null default 0,
  auto_record_threshold integer not null default 3,
  last_confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (business_id, channel, domain)
);
create index idx_channel_domain_trust_business on public.channel_domain_trust (business_id);
alter table public.channel_domain_trust enable row level security;

create policy "Active members can view their business's channel-domain trust"
  on public.channel_domain_trust for select
  using (exists (
    select 1 from public.business_memberships bm
    where bm.business_id = channel_domain_trust.business_id and bm.user_id = auth.uid() and bm.status = 'active'
  ));

-- Gated on active membership alone, same reasoning as capture_triage
-- (Sprint 53's own precedent, restated in that file's header): this
-- table spans every domain, so there is no single capability domain
-- to gate it on.
create or replace function public.record_channel_domain_confirmation(
  p_business_id uuid, p_channel text, p_domain text, p_was_correct boolean
) returns public.channel_domain_trust
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_row public.channel_domain_trust;
begin
  if not exists (
    select 1 from public.business_memberships bm
    where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active'
  ) then
    raise exception 'not_authorized: no active membership for this business';
  end if;

  insert into public.channel_domain_trust (business_id, channel, domain, confirmation_count, last_confirmed_at)
  values (
    p_business_id, p_channel, p_domain,
    case when p_was_correct then 1 else 0 end,
    case when p_was_correct then now() else null end
  )
  on conflict (business_id, channel, domain) do update set
    confirmation_count = case when p_was_correct then public.channel_domain_trust.confirmation_count + 1 else 0 end,
    last_confirmed_at = case when p_was_correct then now() else public.channel_domain_trust.last_confirmed_at end,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.record_channel_domain_confirmation(uuid, text, text, boolean) to authenticated;

create or replace function public.get_channel_domain_trust_status(
  p_business_id uuid, p_channel text, p_domain text
) returns table (confirmation_count integer, auto_record_threshold integer, is_trusted boolean)
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_count integer;
  v_threshold integer;
begin
  if not exists (
    select 1 from public.business_memberships bm
    where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active'
  ) then
    raise exception 'not_authorized: no active membership for this business';
  end if;

  select t.confirmation_count, t.auto_record_threshold into v_count, v_threshold
  from public.channel_domain_trust t
  where t.business_id = p_business_id and t.channel = p_channel and t.domain = p_domain;

  v_count := coalesce(v_count, 0);
  v_threshold := coalesce(v_threshold, 3);

  return query select
    v_count,
    v_threshold,
    (v_count >= v_threshold) and p_domain not in (
      'attendance_correction', 'stock_adjustment', 'e_invoice_flag', 'contract_alert', 'e_signature_request'
    );
end;
$$;

grant execute on function public.get_channel_domain_trust_status(uuid, text, text) to authenticated;

-- ==================================================================
-- PART 2 — CHAIN DEFINITIONS + CHAINED INTAKES (the real automatic
-- router re-entry the owner asked for — see this file's header).
-- ==================================================================

create table public.chain_definitions (
  from_domain text primary key,
  next_domain text not null
);
insert into public.chain_definitions (from_domain, next_domain) values
  ('purchase_order', 'stock_receipt_pending'),
  ('stock_receipt_pending', 'payment_due'),
  ('sale', 'payment_expected');
-- Domains with no genuine next step (commission, attendance_correction,
-- e_invoice_flag, contract_alert, e_signature_request, stock_adjustment)
-- deliberately have no row here — approval ends their lifecycle, which
-- is correct per this sprint's own doc, not a gap.

create table public.chained_intakes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  domain text not null,
  subject_type text not null,
  subject_id uuid not null,
  summary text,
  status text not null default 'pending' check (status in ('pending', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index idx_chained_intakes_business_pending on public.chained_intakes (business_id, status, created_at desc);
alter table public.chained_intakes enable row level security;

create policy "Active members can view their business's chained intakes"
  on public.chained_intakes for select
  using (exists (
    select 1 from public.business_memberships bm
    where bm.business_id = chained_intakes.business_id and bm.user_id = auth.uid() and bm.status = 'active'
  ));

-- Internal helpers — not granted to authenticated (mirrors
-- _create_invoice_from_quotation's own precedent: an underscore-
-- prefixed private function, only ever called from other
-- security-definer functions in this file, never called directly).
create or replace function public._create_chained_intake(
  p_business_id uuid, p_from_domain text, p_subject_type text, p_subject_id uuid, p_summary text
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_next_domain text;
begin
  select next_domain into v_next_domain from public.chain_definitions where from_domain = p_from_domain;
  if v_next_domain is null then
    return; -- no chain entry for this domain — correct, not an error.
  end if;

  insert into public.chained_intakes (business_id, domain, subject_type, subject_id, summary)
  values (p_business_id, v_next_domain, p_subject_type, p_subject_id, p_summary);
end;
$$;

create or replace function public._resolve_chained_intake(
  p_subject_type text, p_subject_id uuid, p_domain text
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.chained_intakes
  set status = 'resolved', resolved_at = now()
  where subject_type = p_subject_type and subject_id = p_subject_id and domain = p_domain and status = 'pending';
end;
$$;

create or replace function public.list_chained_intakes(p_business_id uuid)
returns setof public.chained_intakes
language plpgsql security definer set search_path = public, auth
as $$
begin
  if not exists (
    select 1 from public.business_memberships bm
    where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active'
  ) then
    raise exception 'not_authorized: no active membership for this business';
  end if;

  return query select * from public.chained_intakes
  where business_id = p_business_id and status = 'pending'
  order by created_at desc;
end;
$$;

grant execute on function public.list_chained_intakes(uuid) to authenticated;

create or replace function public.dismiss_chained_intake(p_id uuid)
returns public.chained_intakes
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_row public.chained_intakes;
begin
  select * into v_row from public.chained_intakes where id = p_id;
  if not found then
    raise exception 'chained_intake_not_found: %', p_id;
  end if;
  if not exists (
    select 1 from public.business_memberships bm
    where bm.business_id = v_row.business_id and bm.user_id = auth.uid() and bm.status = 'active'
  ) then
    raise exception 'not_authorized: no active membership for this business';
  end if;

  update public.chained_intakes set status = 'dismissed', resolved_at = now() where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.dismiss_chained_intake(uuid) to authenticated;

-- ==================================================================
-- PART 3 — HOOK THE PO CHAIN INTO ITS EXISTING TRANSITION POINTS.
-- Every line of Sprint 58's own logic below is unchanged; only the
-- chain calls are new (regression-safe by construction, not just by
-- intent — re-verified live per this sprint's own DoD).
-- ==================================================================

-- (a) drafted -> approved: create the stock_receipt_pending intake.
create or replace function public.sync_purchase_order_on_task_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.purchase_order;
begin
  if new.subject_type <> 'purchase_order' or old.status is not distinct from new.status then
    return new;
  end if;
  if new.status in ('approved', 'auto_approved') then
    update public.purchase_order set status = 'approved' where id = new.subject_id and status = 'drafted'
    returning * into v_po;
    if found then
      perform public._create_chained_intake(
        v_po.business_id, 'purchase_order', 'purchase_order', v_po.id,
        'PO ' || v_po.po_no || ' approved — confirm stock receipt when it arrives'
      );
    end if;
  elsif new.status = 'rejected' then
    update public.purchase_order set status = 'rejected' where id = new.subject_id and status = 'drafted';
  end if;
  return new;
end;
$$;

-- (b) stock_received_full: resolve stock_receipt_pending, create payment_due.
create or replace function public.confirm_purchase_order_receipt(p_purchase_order_id uuid)
returns public.purchase_order
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_po public.purchase_order;
begin
  select * into v_po from public.purchase_order where id = p_purchase_order_id for update;
  if not found then raise exception 'purchase_order_not_found: %', p_purchase_order_id; end if;
  if not public.caller_has_capability(v_po.business_id, 'expense', 'capture') then
    raise exception 'not_authorized: requires capture on expense';
  end if;
  if v_po.status <> 'approved' then
    raise exception 'purchase_order_not_approved: current status %', v_po.status;
  end if;

  update public.purchase_order_line set quantity_received = quantity
  where purchase_order_id = v_po.id;

  update public.purchase_order set status = 'stock_received_full' where id = v_po.id
  returning * into v_po;

  perform public._resolve_chained_intake('purchase_order', v_po.id, 'stock_receipt_pending');
  perform public._create_chained_intake(
    v_po.business_id, 'stock_receipt_pending', 'purchase_order', v_po.id,
    'PO ' || v_po.po_no || ' stock received — payment due'
  );

  return v_po;
end;
$$;

grant execute on function public.confirm_purchase_order_receipt(uuid) to authenticated;

-- (c) paid: resolve payment_due.
create or replace function public.mark_purchase_order_paid(
  p_purchase_order_id uuid,
  p_expense_category text,
  p_payment_method text default 'bank_transfer'
) returns public.purchase_order
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_po public.purchase_order;
  v_voucher public.payment_vouchers;
begin
  select * into v_po from public.purchase_order where id = p_purchase_order_id for update;
  if not found then raise exception 'purchase_order_not_found: %', p_purchase_order_id; end if;
  if not public.caller_has_capability(v_po.business_id, 'expense', 'capture') then
    raise exception 'not_authorized: requires capture on expense';
  end if;
  if v_po.status <> 'stock_received_full' then
    raise exception 'purchase_order_not_ready_for_payment: current status % (stock must be confirmed received first)', v_po.status;
  end if;

  v_voucher := public.create_payment_voucher(
    v_po.business_id, v_po.party_id, p_expense_category, p_payment_method, v_po.grand_total,
    'Payment for Purchase Order ' || v_po.po_no, null,
    'Payment for Purchase Order ' || v_po.po_no || ' (' || v_po.grand_total || ' ' || v_po.currency || ')',
    true
  );

  update public.payment_vouchers set status = 'approved' where id = v_voucher.id
  returning * into v_voucher;

  perform public.mark_payment_voucher_paid(v_voucher.id);

  update public.purchase_order set status = 'paid' where id = v_po.id
  returning * into v_po;

  perform public._resolve_chained_intake('purchase_order', v_po.id, 'payment_due');

  return v_po;
end;
$$;

grant execute on function public.mark_purchase_order_paid(uuid, text, text) to authenticated;

-- ==================================================================
-- PART 4 — SALE -> PAYMENT_EXPECTED CHAIN. Hooked into the ONE shared
-- helper both invoice-creation paths (already-completed-sale direct
-- path, and the normal accept-then-convert path) already call, so
-- both are covered by a single hook rather than two that could drift.
-- ==================================================================

create or replace function public._create_invoice_from_quotation(
  p_quotation_id uuid, p_allow_credit_override boolean, p_override_reason text
) returns public.invoices
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
  v_outstanding numeric;
  v_contract_limit numeric;
  v_effective_limit numeric;
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

  select credit_limit_override into v_contract_limit from public.contracts
  where counterparty_id = v_party.id and business_id = v_quotation.business_id
    and status = 'active' and credit_limit_override is not null
  order by created_at desc limit 1;
  v_effective_limit := coalesce(v_contract_limit, v_party.credit_limit);

  if v_effective_limit is not null then
    select coalesce(sum(outstanding_balance), 0) into v_outstanding from public.invoices
    where party_id = v_party.id and business_id = v_quotation.business_id
      and status not in ('draft', 'cancelled', 'paid');

    if (v_outstanding + v_quotation.grand_total) > v_effective_limit then
      if not p_allow_credit_override then
        raise exception 'credit_limit_exceeded: party % outstanding % + new invoice % would exceed effective credit limit %',
          v_party.id, v_outstanding, v_quotation.grand_total, v_effective_limit;
      end if;
      if not public.caller_has_capability(v_quotation.business_id, 'settings', 'configure') then
        raise exception 'not_authorized: credit limit override requires configure on settings';
      end if;
    end if;
  end if;

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

  if v_effective_limit is not null and p_allow_credit_override
     and (v_outstanding + v_quotation.grand_total) > v_effective_limit then
    insert into public.credit_limit_override_log (
      business_id, invoice_id, party_id, requested_amount, effective_credit_limit,
      outstanding_balance_before, overridden_by_membership_id, reason
    ) values (
      v_quotation.business_id, v_invoice.id, v_party.id, v_quotation.grand_total, v_effective_limit,
      v_outstanding, v_caller_membership_id, p_override_reason
    );
  end if;

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

  -- Sprint 61 addition: every issued invoice with a nonzero balance
  -- gets a payment_expected chained intake — an AR-ageing-visible
  -- expectation, not an auto-created Payment (the owner still records
  -- the actual payment via record_payment, which resolves this same
  -- intake below once the invoice reaches 'paid').
  if v_invoice.outstanding_balance > 0 then
    perform public._create_chained_intake(
      v_quotation.business_id, 'sale', 'invoice', v_invoice.id,
      'Invoice ' || v_invoice_no || ' issued — payment expected (' || v_invoice.grand_total || ' ' || v_invoice.currency || ')'
    );
  end if;

  return v_invoice;
end;
$$;

-- (b) record_payment resolves the payment_expected intake once the
-- invoice is fully paid (recompute_invoice_balance's own status
-- computation decides 'paid' — a partial payment leaves the
-- expectation open, correctly).
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
  v_updated_invoice public.invoices;
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

  v_updated_invoice := public.recompute_invoice_balance(p_invoice_id);

  if v_updated_invoice.status = 'paid' then
    perform public._resolve_chained_intake('invoice', p_invoice_id, 'payment_expected');
  end if;

  return v_row;
end;
$$;

grant execute on function public.record_payment(uuid, uuid, numeric, text, date, text) to authenticated;

-- End of Sprint 61 migration.
