-- Sprint 58 (Phase 5, "Draft-and-Approve Bridge I: Sales & Purchases",
-- 14 September 2026) — additive only, no existing table/constraint altered.
--
-- Two pieces, both existing gaps found while scaffolding this sprint
-- (see this sprint's own doc, CORRECTION #3, for the full reasoning):
--
-- 1. find_or_create_party(): Sprint 57's AI classifier extracts a bare
--    counterparty NAME from captured text (e.g. "ABC Sdn Bhd"), but
--    every document-creation RPC in this schema (create_quotation,
--    and the new create_purchase_order below) requires an existing
--    party_id and fails closed with party_not_found_for_this_business
--    otherwise. Nothing anywhere in this schema previously resolved a
--    name to a party row. This is the shared piece both the Sales and
--    Purchases halves of this sprint need — added once here rather
--    than duplicated in create_purchase_order's own body.
--
--    Deliberately does NOT introduce a new capability domain: gated
--    identically to the existing create_party (Sprint 26) — 'sales'
--    capture for customer/supplier/agent/dropship_partner, or
--    'hr_attendance_leave' capture for employee — because
--    permissions.domain is a fixed, explicitly "never owner-editable"
--    11-value catalog duplicated across three separate check
--    constraints in the initial schema (permissions,
--    segregation_of_duties_policies, approval_tasks); widening it is a
--    cross-cutting change out of scope for this additive sprint.
--
-- 2. purchase_order / purchase_order_line + create_purchase_order():
--    the first-class multi-line PO entity this sprint's original
--    design (pre-revision Sprint 58) already called for, unchanged.
--    Gated on the EXISTING 'expense' capability domain, not a new
--    'purchases' domain, for the same reason as (1) above — and
--    matching this schema's own precedent: create_party already gates
--    a 'supplier' party under 'sales' capture, not a dedicated
--    purchases domain, so there is no existing convention this
--    deviates from by reusing 'expense' for the document itself.
--
-- NOT included in this migration (logged here, not silently dropped):
-- the on-approval chaining that constructs a `stock_receipt_pending`
-- intake, and on full receipt a `payment_due` intake (Vol_5_5 §9) —
-- that is application-level orchestration triggered off
-- approval_tasks.status transitioning to 'approved'/'auto_approved'
-- for subject_type='purchase_order', not a database schema concern,
-- and is scaffolded separately in packages/core (see
-- purchaseOrderTransport.ts's own header). A stock-receipt
-- CONFIRMATION RPC (recording quantity_received per line and flipping
-- status to stock_received_partial/stock_received_full/paid) is also
-- not in this migration yet — purchase_order_line.quantity_received
-- is created here so that RPC has a column to write to, but the RPC
-- itself is next-step scaffolding, not yet built.

-- ------------------------------------------------------------
-- 1. find_or_create_party
-- ------------------------------------------------------------
create or replace function public.find_or_create_party(
  p_business_id uuid,
  p_display_name text,
  p_party_types text[]
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

  -- Same capture gate as create_party (Sprint 26) — see this file's
  -- header for why no new capability domain is introduced here.
  if 'employee' = any(p_party_types) and not public.caller_has_capability(p_business_id, 'hr_attendance_leave', 'capture') then
    raise exception 'not_authorized_to_capture: no capture access to hr_attendance_leave';
  end if;

  if (p_party_types && array['customer', 'supplier', 'agent', 'dropship_partner']::text[])
     and not public.caller_has_capability(p_business_id, 'sales', 'capture') then
    raise exception 'not_authorized_to_capture: no capture access to sales';
  end if;

  -- Case-insensitive match on display_name, restricted to a party that
  -- shares at least one of the requested types — an AI capture
  -- classified as a purchase should not silently reuse a same-named
  -- party that only exists as a customer, and vice versa.
  select p.* into v_row
  from public.parties p
  where p.business_id = p_business_id
    and lower(p.display_name) = lower(p_display_name)
    and p.party_types && p_party_types
  order by p.created_at asc
  limit 1;

  if found then
    return v_row;
  end if;

  insert into public.document_number_sequences (business_id, document_type, prefix, reset_period)
  values (p_business_id, 'party', 'PTY', 'never')
  on conflict (business_id, document_type) do nothing;

  v_party_no := public.next_document_number(p_business_id, 'party');

  insert into public.parties (
    business_id, party_no, display_name, party_types, created_by_membership_id
  ) values (
    p_business_id, v_party_no, p_display_name, p_party_types, v_caller_membership_id
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.find_or_create_party(uuid, text, text[]) to authenticated;

-- ------------------------------------------------------------
-- 2. public.purchase_order / public.purchase_order_line
-- ------------------------------------------------------------
create table if not exists public.purchase_order (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  po_no text not null,
  party_id uuid not null references public.parties (id),
  status text not null default 'drafted' check (status in (
    'drafted', 'approved', 'stock_received_partial', 'stock_received_full', 'paid', 'closed'
  )),
  issue_date date not null default current_date,
  expected_delivery_date date,
  currency text not null default 'MYR',
  subtotal numeric(14, 2) not null default 0,
  tax_total numeric(14, 2) not null default 0,
  grand_total numeric(14, 2) not null default 0,
  notes text,
  captured_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now(),
  unique (business_id, po_no)
);
create index if not exists idx_purchase_order_business on public.purchase_order (business_id);
alter table public.purchase_order enable row level security;
create policy "Active members with expense view can see purchase orders"
  on public.purchase_order for select using (public.caller_has_capability(business_id, 'expense', 'view'));

create table if not exists public.purchase_order_line (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_order (id) on delete cascade,
  line_no integer not null,
  product_id uuid references public.products (id),
  description text not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_cost numeric(14, 2) not null check (unit_cost >= 0),
  line_total numeric(14, 2) not null,
  -- Written by the (not-yet-built, see this file's header) stock-receipt
  -- confirmation RPC — created here so that RPC has a column, never
  -- written by create_purchase_order itself (always starts at 0).
  quantity_received numeric(14, 3) not null default 0,
  unique (purchase_order_id, line_no)
);
create index if not exists idx_purchase_order_line_po on public.purchase_order_line (purchase_order_id);
alter table public.purchase_order_line enable row level security;
create policy "Active members with expense view can see purchase order lines"
  on public.purchase_order_line for select using (
    exists (select 1 from public.purchase_order po where po.id = purchase_order_line.purchase_order_id
      and public.caller_has_capability(po.business_id, 'expense', 'view'))
  );

-- ------------------------------------------------------------
-- 3. create_purchase_order — mirrors create_quotation's exact shape
--    (see quotationInvoiceTransport.ts / the initial schema's own
--    create_quotation for the pattern this deliberately follows).
-- ------------------------------------------------------------
create or replace function public.create_purchase_order(
  p_business_id uuid,
  p_party_id uuid,
  p_expected_delivery_date date,
  p_notes text,
  p_lines jsonb,
  p_ai_draft_summary text default null,
  p_auto_approved boolean default false
) returns public.purchase_order
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_po_no text;
  v_po public.purchase_order;
  v_line jsonb;
  v_line_no integer := 0;
  v_product_id uuid;
  v_quantity numeric;
  v_unit_cost numeric;
  v_line_total numeric;
  v_subtotal numeric := 0;
begin
  if not public.caller_has_capability(p_business_id, 'expense', 'capture') then
    raise exception 'not_authorized: requires capture on expense';
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
  values (p_business_id, 'purchase_order', 'PO', 'never')
  on conflict (business_id, document_type) do nothing;
  v_po_no := public.next_document_number(p_business_id, 'purchase_order');

  insert into public.purchase_order (
    business_id, po_no, party_id, expected_delivery_date, notes, captured_by_membership_id
  ) values (
    p_business_id, v_po_no, p_party_id, p_expected_delivery_date, p_notes, v_caller_membership_id
  ) returning * into v_po;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_line_no := v_line_no + 1;
    v_product_id := nullif(v_line ->> 'product_id', '')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_cost := (v_line ->> 'unit_cost')::numeric;

    if v_unit_cost is null then
      raise exception 'line_%_needs_an_explicit_unit_cost', v_line_no;
    end if;

    v_line_total := v_quantity * v_unit_cost;
    v_subtotal := v_subtotal + v_line_total;

    insert into public.purchase_order_line (
      purchase_order_id, line_no, product_id, description, quantity, unit_cost, line_total
    ) values (
      v_po.id, v_line_no, v_product_id, v_line ->> 'description', v_quantity, v_unit_cost, v_line_total
    );
  end loop;

  update public.purchase_order set subtotal = v_subtotal, tax_total = 0, grand_total = v_subtotal
  where id = v_po.id
  returning * into v_po;

  perform public.create_approval_task(
    p_business_id, 'expense', 'purchase_order', v_po.id, v_po.grand_total,
    coalesce(p_ai_draft_summary, 'Purchase Order ' || v_po_no || ' for ' || v_po.grand_total || ' ' || v_po.currency),
    null, v_caller_membership_id, p_auto_approved, 'confirm stock receipt'
  );

  return v_po;
end;
$$;

grant execute on function public.create_purchase_order(uuid, uuid, date, text, jsonb, text, boolean) to authenticated;

-- End of Sprint 58 migration (Purchase Order entity + shared party resolution).
