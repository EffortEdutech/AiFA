-- ==============================================================
-- AIFA backend schema — Sprint 31 (Vol 13_0 §7 Module D:
-- Penghantaran & Inventori / Delivery & Inventory, extends Vol 6_5).
-- Opens Sub-phase 3c.
--
-- SCOPE NOTES (disclosed):
--
-- 1. `business_id` is added directly to `stock_levels` and
--    `stock_movements`, even though Vol 13_0 §7's own schema block
--    lists neither column on those two tables (only `product_id`/
--    `warehouse_id`, from which a business is technically derivable
--    via a join). Every RLS-scoped table in this schema carries its
--    own `business_id` for direct, indexable policy checks rather
--    than a join-through — the same convention already applied
--    without exception to every table since Sprint 22; this is that
--    convention, not a new decision.
--
-- 2. `delivery_orders.status` gets a `'rejected'` value ADDED to Vol
--    13_0 §7's literal three-value enum (draft | dispatched |
--    delivered). The volume names no rejection outcome for this
--    document type, but a real ApprovalTask can genuinely be
--    rejected — the same disclosed precedent already used for
--    ApprovalTask.resolved_via's `blocked_awaiting_reviewer`
--    (Sprint 25), and reused for PaymentVoucher.status (Sprint 30).
--
-- 3. Deliberately NOT added: an `'approved'` value on
--    `delivery_orders.status`. Unlike PaymentVoucher (Sprint 30),
--    which genuinely needed a stored "authorized but not yet paid"
--    state, this migration follows Quotation's own Sprint 28
--    precedent (its header note 4) instead: approval state lives on
--    the linked ApprovalTask row alone, and `dispatch_delivery_order`
--    checks it directly (`select status from approval_tasks where
--    subject_type='delivery_order' ... order by created_at desc
--    limit 1`) — the exact idiom `mark_quotation_sent` and
--    `convert_quotation_to_invoice` already use, not a new one.
--
-- 4. Warehouse creation is gated on `configure` on `inventory` (a
--    setup-level action, same posture as `create_bank_account`'s
--    `configure` gate on `accounting_reports` and
--    `configure_document_sequence`'s gate on `settings`) — only the
--    Owner holds `configure` on `inventory` among the six system role
--    templates today. Day-to-day inventory actions (opening stock
--    entry, delivery order creation/dispatch/delivered, stock takes)
--    are gated on `capture` on `inventory` instead, matching Warehouse
--    Staff's actual role grant (`view` + `capture` on `inventory`,
--    no `configure`) — Warehouse Staff can run every day-to-day
--    inventory action but cannot stand up a new warehouse location.
--
-- 5. A non-stock-tracked product (`track_inventory = false`, e.g. a
--    service line) may still appear on a Delivery Order line for
--    documentation purposes, but generates no `StockMovement` and
--    touches no `StockLevel` row — Product.track_inventory already
--    exists (Sprint 27) precisely to make this distinction, and
--    silently skipping stock posting for such lines is the natural
--    reading of it, not a new design decision being introduced here.
--
-- 6. `invoices.delivery_order_id` (declared in Sprint 28 as a plain
--    nullable uuid with no FK yet — see that migration's own header
--    note 3) gets its real foreign key added now that
--    `public.delivery_orders` exists. Because that column is a single
--    scalar FK, not an array, a given Invoice can link to at most ONE
--    DeliveryOrder — matching Vol 13_0 §4's own literal shape.
--    `create_delivery_order` raises `invoice_already_has_a_delivery_order`
--    if called against an invoice that already has one linked; genuine
--    multi-shipment/partial-delivery-per-invoice is out of scope this
--    sprint, a limitation of the volume's own schema, not something
--    silently narrowed here.
--
-- 7. Purchase-Side Cost Auto-Calc (this sprint's own Task Breakdown
--    item) is explicitly DEFERRED, per that same item's own wording
--    ("if not ready, this stays deferred and flagged explicitly
--    rather than silently skipped"). The Sprint 21 Purchase
--    Operations addendum (Vol 13_0 §4a) remains a design stub only —
--    no `public.purchase_invoices` table has been built in any sprint
--    to date, and `create_product` (Sprint 27) already hard-rejects
--    `cost_source = 'auto_from_purchase'` for exactly this reason.
--    There is nothing for this migration to wire up; flagged here
--    rather than silently omitted.
--
-- 8. Concurrency (this sprint's own named risk): `dispatch_delivery_order`
--    and stock-take completion both lock the specific `stock_levels`
--    row via `select ... for update` before reading or decrementing
--    it — the same per-row-locking discipline already used elsewhere
--    in this schema (e.g. `mark_payment_voucher_paid`'s own-row lock),
--    verified directly in this sprint's own test against a genuine
--    concurrent-dispatch scenario, not assumed safe.
--
-- 9. `mark_delivery_order_delivered` is added to complete the
--    volume's own literal three-state lifecycle (draft → dispatched →
--    delivered) even though the Definition of Done doesn't explicitly
--    require it. It's a self-reported external event — the server
--    cannot observe a physical delivery happening — mirroring the
--    same pattern Sprint 28's `mark_quotation_sent` and Sprint 30's
--    `mark_payment_voucher_paid` already established.
--
-- 10. A DeliveryOrder's own lines (product_id + quantity) are NOT
--     cross-validated against the linked Invoice's own invoice_lines
--     quantities — `create_delivery_order` only checks that each
--     line's product exists for the business. Vol 13_0 §7 doesn't
--     specify a line-level 1:1 match between the two documents
--     either; the Invoice is the billing record and the DO is what
--     physically ships, and requiring them to match exactly would
--     rule out a perfectly normal case (part of an invoice shipped
--     now, the rest later) that this sprint's schema doesn't attempt
--     to support anyway (Invoice.delivery_order_id is a single scalar
--     FK — see note 6 — so multi-shipment-per-invoice is already out
--     of scope). Left as an explicit disclosed gap rather than a
--     half-built partial-shipment validation.
-- ==============================================================

-- ------------------------------------------------------------
-- 1. public.warehouses (Vol 13_0 §7) — a single default warehouse per
-- business is an acceptable functional minimum this sprint (see
-- Sprint 31's own "Safe to Carry Over"); the table exists so
-- multi-location isn't a later rewrite.
-- ------------------------------------------------------------
create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_warehouses_business on public.warehouses (business_id);
alter table public.warehouses enable row level security;
create policy "Active members with inventory view can see warehouses"
  on public.warehouses for select using (public.caller_has_capability(business_id, 'inventory', 'view'));

create or replace function public.create_warehouse(p_business_id uuid, p_name text)
returns public.warehouses
language plpgsql security definer set search_path = public, auth
as $$
declare v_row public.warehouses;
begin
  if not public.caller_has_capability(p_business_id, 'inventory', 'configure') then
    raise exception 'not_authorized: requires configure on inventory';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'warehouse_name_required';
  end if;
  insert into public.warehouses (business_id, name) values (p_business_id, btrim(p_name))
  returning * into v_row;
  return v_row;
end;
$$;

grant execute on function public.create_warehouse(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 2. public.stock_levels (Vol 13_0 §7) — never written to directly by
-- client code; only ever updated by this migration's own functions,
-- always alongside a corresponding stock_movements row.
-- ------------------------------------------------------------
create table if not exists public.stock_levels (
  business_id uuid not null references public.businesses (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  quantity_on_hand numeric(14, 3) not null default 0,
  last_movement_at timestamptz,
  primary key (product_id, warehouse_id)
);
create index if not exists idx_stock_levels_business on public.stock_levels (business_id);
alter table public.stock_levels enable row level security;
create policy "Active members with inventory view can see stock levels"
  on public.stock_levels for select using (public.caller_has_capability(business_id, 'inventory', 'view'));

-- ------------------------------------------------------------
-- 3. public.stock_movements (Vol 13_0 §7) — append-only ledger of
-- every quantity change; stock_levels.quantity_on_hand is always a
-- derived running total of these, never edited independently.
-- ------------------------------------------------------------
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  product_id uuid not null references public.products (id),
  warehouse_id uuid not null references public.warehouses (id),
  movement_type text not null check (movement_type in (
    'opening', 'purchase_receipt', 'delivery_out', 'adjustment_increase', 'adjustment_decrease'
  )),
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_cost numeric(14, 2),
  source_document_type text check (source_document_type in (
    'delivery_order', 'purchase_invoice', 'stock_take', 'manual'
  )),
  source_document_id uuid,
  occurred_at timestamptz not null default now(),
  created_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now()
);
create index if not exists idx_stock_movements_business on public.stock_movements (business_id);
create index if not exists idx_stock_movements_product_warehouse on public.stock_movements (product_id, warehouse_id);
alter table public.stock_movements enable row level security;
create policy "Active members with inventory view can see stock movements"
  on public.stock_movements for select using (public.caller_has_capability(business_id, 'inventory', 'view'));

-- record_opening_stock: the one-time initial-balance entry per
-- (product, warehouse) — see header note 4 for why this is gated on
-- capture, not configure, unlike create_warehouse.
create or replace function public.record_opening_stock(
  p_business_id uuid, p_product_id uuid, p_warehouse_id uuid, p_quantity numeric, p_unit_cost numeric default null
) returns public.stock_levels
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_product public.products;
  v_row public.stock_levels;
begin
  if not public.caller_has_capability(p_business_id, 'inventory', 'capture') then
    raise exception 'not_authorized: requires capture on inventory';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid_quantity: must be positive';
  end if;

  select * into v_product from public.products where id = p_product_id and business_id = p_business_id;
  if not found then raise exception 'product_not_found_for_this_business: %', p_product_id; end if;
  if not v_product.track_inventory then
    raise exception 'product_is_not_stock_tracked: %', p_product_id;
  end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse_id and business_id = p_business_id) then
    raise exception 'warehouse_not_found_for_this_business: %', p_warehouse_id;
  end if;
  if exists (
    select 1 from public.stock_movements
    where product_id = p_product_id and warehouse_id = p_warehouse_id and movement_type = 'opening'
  ) then
    raise exception 'opening_stock_already_recorded_for_this_product_and_warehouse';
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.stock_movements (
    business_id, product_id, warehouse_id, movement_type, quantity, unit_cost,
    source_document_type, created_by_membership_id
  ) values (
    p_business_id, p_product_id, p_warehouse_id, 'opening', p_quantity, p_unit_cost,
    'manual', v_caller_membership_id
  );

  insert into public.stock_levels (business_id, product_id, warehouse_id, quantity_on_hand, last_movement_at)
  values (p_business_id, p_product_id, p_warehouse_id, p_quantity, now())
  on conflict (product_id, warehouse_id) do update
    set quantity_on_hand = public.stock_levels.quantity_on_hand + excluded.quantity_on_hand,
        last_movement_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.record_opening_stock(uuid, uuid, uuid, numeric, numeric) to authenticated;

-- ------------------------------------------------------------
-- 4. public.delivery_orders / delivery_order_lines (Vol 13_0 §7).
-- ------------------------------------------------------------
create table if not exists public.delivery_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  do_no text not null,
  invoice_id uuid not null references public.invoices (id),
  warehouse_id uuid not null references public.warehouses (id),
  status text not null default 'draft' check (status in ('draft', 'dispatched', 'delivered', 'rejected')), -- see header note 2
  issue_date date not null default current_date,
  notes text,
  captured_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now(),
  unique (business_id, do_no)
);
create index if not exists idx_delivery_orders_business on public.delivery_orders (business_id);
alter table public.delivery_orders enable row level security;
create policy "Active members with inventory view can see delivery orders"
  on public.delivery_orders for select using (public.caller_has_capability(business_id, 'inventory', 'view'));

create table if not exists public.delivery_order_lines (
  id uuid primary key default gen_random_uuid(),
  delivery_order_id uuid not null references public.delivery_orders (id) on delete cascade,
  line_no integer not null,
  product_id uuid not null references public.products (id),
  quantity numeric(14, 3) not null check (quantity > 0),
  unique (delivery_order_id, line_no)
);
create index if not exists idx_delivery_order_lines_do on public.delivery_order_lines (delivery_order_id);
alter table public.delivery_order_lines enable row level security;
create policy "Active members with inventory view can see delivery order lines"
  on public.delivery_order_lines for select using (
    exists (select 1 from public.delivery_orders d where d.id = delivery_order_lines.delivery_order_id
      and public.caller_has_capability(d.business_id, 'inventory', 'view'))
  );

-- Now that public.delivery_orders exists, give Sprint 28's
-- pre-declared invoices.delivery_order_id its real FK (see header note 6).
alter table public.invoices
  add constraint invoices_delivery_order_id_fkey
  foreign key (delivery_order_id) references public.delivery_orders (id);

create or replace function public.create_delivery_order(
  p_business_id uuid,
  p_invoice_id uuid,
  p_warehouse_id uuid,
  p_lines jsonb,
  p_notes text default null,
  p_ai_draft_summary text default null,
  p_auto_approved boolean default false
) returns public.delivery_orders
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_do_no text;
  v_row public.delivery_orders;
  v_invoice public.invoices;
  v_line jsonb;
  v_line_no integer := 0;
  v_product_id uuid;
  v_quantity numeric;
begin
  if not public.caller_has_capability(p_business_id, 'inventory', 'capture') then
    raise exception 'not_authorized: requires capture on inventory';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'no_lines_supplied';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id and business_id = p_business_id;
  if not found then raise exception 'invoice_not_found_for_this_business: %', p_invoice_id; end if;
  if v_invoice.delivery_order_id is not null then
    raise exception 'invoice_already_has_a_delivery_order: %', v_invoice.delivery_order_id;
  end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse_id and business_id = p_business_id) then
    raise exception 'warehouse_not_found_for_this_business: %', p_warehouse_id;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.document_number_sequences (business_id, document_type, prefix, reset_period)
  values (p_business_id, 'delivery_order', 'DO', 'never')
  on conflict (business_id, document_type) do nothing;
  v_do_no := public.next_document_number(p_business_id, 'delivery_order');

  insert into public.delivery_orders (business_id, do_no, invoice_id, warehouse_id, notes, captured_by_membership_id)
  values (p_business_id, v_do_no, p_invoice_id, p_warehouse_id, p_notes, v_caller_membership_id)
  returning * into v_row;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_line_no := v_line_no + 1;
    v_product_id := nullif(v_line ->> 'product_id', '')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;

    if v_product_id is null or v_quantity is null or v_quantity <= 0 then
      raise exception 'line_%_needs_a_product_id_and_a_positive_quantity', v_line_no;
    end if;
    if not exists (select 1 from public.products where id = v_product_id and business_id = p_business_id) then
      raise exception 'line_%_product_not_found_for_this_business: %', v_line_no, v_product_id;
    end if;

    insert into public.delivery_order_lines (delivery_order_id, line_no, product_id, quantity)
    values (v_row.id, v_line_no, v_product_id, v_quantity);
  end loop;

  update public.invoices set delivery_order_id = v_row.id where id = p_invoice_id;

  perform public.create_approval_task(
    p_business_id, 'inventory', 'delivery_order', v_row.id, null,
    coalesce(p_ai_draft_summary, 'Delivery order ' || v_do_no || ' for invoice ' || v_invoice.invoice_no
      || ' (' || v_line_no || ' line(s))'),
    null, v_caller_membership_id, p_auto_approved, 'dispatch'
  );

  return v_row;
end;
$$;

grant execute on function public.create_delivery_order(uuid, uuid, uuid, jsonb, text, text, boolean) to authenticated;

-- Rejection sync — mirrors sync_quotation_status_on_task_rejection
-- (Sprint 28) exactly; no approval-side transition (see header note 3).
create or replace function public.sync_delivery_order_on_task_rejection()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.subject_type = 'delivery_order' and new.status = 'rejected' and old.status is distinct from new.status then
    update public.delivery_orders set status = 'rejected' where id = new.subject_id and status = 'draft';
  end if;
  return new;
end;
$$;

create trigger trg_sync_delivery_order_on_task_rejection
  after update on public.approval_tasks
  for each row execute function public.sync_delivery_order_on_task_rejection();

-- dispatch_delivery_order: THE concrete "inventori akan ditolak secara
-- automatik apabila Delivery Order dihantar" requirement (Vol 13_0
-- §7). Requires the linked ApprovalTask to have resolved approved
-- (see header note 3), locks each affected stock_levels row via
-- `for update` before decrementing it (header note 8), and skips
-- posting entirely for non-stock-tracked lines (header note 5).
create or replace function public.dispatch_delivery_order(p_delivery_order_id uuid)
returns public.delivery_orders
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_do public.delivery_orders;
  v_task_status text;
  v_caller_membership_id uuid;
  v_line record;
  v_product public.products;
  v_stock_level public.stock_levels;
begin
  select * into v_do from public.delivery_orders where id = p_delivery_order_id for update;
  if not found then raise exception 'delivery_order_not_found: %', p_delivery_order_id; end if;
  if not public.caller_has_capability(v_do.business_id, 'inventory', 'capture') then
    raise exception 'not_authorized: requires capture on inventory';
  end if;
  if v_do.status <> 'draft' then
    raise exception 'delivery_order_not_in_draft_status: current status %', v_do.status;
  end if;

  select status into v_task_status from public.approval_tasks
  where subject_type = 'delivery_order' and subject_id = p_delivery_order_id
  order by created_at desc limit 1;
  if v_task_status is null or v_task_status not in ('approved', 'auto_approved') then
    raise exception 'delivery_order_not_yet_approved: current approval status %', coalesce(v_task_status, 'none');
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = v_do.business_id and bm.user_id = auth.uid() and bm.status = 'active';

  for v_line in
    select dol.product_id, dol.quantity
    from public.delivery_order_lines dol
    where dol.delivery_order_id = p_delivery_order_id
    order by dol.line_no
  loop
    select * into v_product from public.products where id = v_line.product_id;
    if not v_product.track_inventory then
      continue; -- see header note 5
    end if;

    select * into v_stock_level from public.stock_levels
    where product_id = v_line.product_id and warehouse_id = v_do.warehouse_id
    for update;
    if not found or v_stock_level.quantity_on_hand < v_line.quantity then
      raise exception 'insufficient_stock_for_product_%: available %, requested %',
        v_line.product_id, coalesce(v_stock_level.quantity_on_hand, 0), v_line.quantity;
    end if;

    insert into public.stock_movements (
      business_id, product_id, warehouse_id, movement_type, quantity,
      source_document_type, source_document_id, created_by_membership_id
    ) values (
      v_do.business_id, v_line.product_id, v_do.warehouse_id, 'delivery_out', v_line.quantity,
      'delivery_order', p_delivery_order_id, v_caller_membership_id
    );

    update public.stock_levels
    set quantity_on_hand = quantity_on_hand - v_line.quantity, last_movement_at = now()
    where product_id = v_line.product_id and warehouse_id = v_do.warehouse_id;
  end loop;

  update public.delivery_orders set status = 'dispatched' where id = p_delivery_order_id returning * into v_do;
  return v_do;
end;
$$;

grant execute on function public.dispatch_delivery_order(uuid) to authenticated;

-- mark_delivery_order_delivered — see header note 9.
create or replace function public.mark_delivery_order_delivered(p_delivery_order_id uuid)
returns public.delivery_orders
language plpgsql security definer set search_path = public, auth
as $$
declare v_do public.delivery_orders;
begin
  select * into v_do from public.delivery_orders where id = p_delivery_order_id;
  if not found then raise exception 'delivery_order_not_found: %', p_delivery_order_id; end if;
  if not public.caller_has_capability(v_do.business_id, 'inventory', 'capture') then
    raise exception 'not_authorized: requires capture on inventory';
  end if;
  if v_do.status <> 'dispatched' then
    raise exception 'delivery_order_not_dispatched: current status %', v_do.status;
  end if;
  update public.delivery_orders set status = 'delivered' where id = p_delivery_order_id returning * into v_do;
  return v_do;
end;
$$;

grant execute on function public.mark_delivery_order_delivered(uuid) to authenticated;

-- ------------------------------------------------------------
-- 5. public.stock_takes / stock_take_lines (Vol 13_0 §7) — not
-- approval-gated (this sprint's own Task Breakdown names ApprovalTask
-- routing only for Delivery Order); gated on capture on inventory
-- throughout, same as opening stock entry.
-- ------------------------------------------------------------
create table if not exists public.stock_takes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  warehouse_id uuid not null references public.warehouses (id),
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  counted_at timestamptz,
  captured_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now()
);
create index if not exists idx_stock_takes_business on public.stock_takes (business_id);
alter table public.stock_takes enable row level security;
create policy "Active members with inventory view can see stock takes"
  on public.stock_takes for select using (public.caller_has_capability(business_id, 'inventory', 'view'));

create table if not exists public.stock_take_lines (
  id uuid primary key default gen_random_uuid(),
  stock_take_id uuid not null references public.stock_takes (id) on delete cascade,
  product_id uuid not null references public.products (id),
  system_qty numeric(14, 3) not null,
  counted_qty numeric(14, 3),
  variance numeric(14, 3),
  unique (stock_take_id, product_id)
);
create index if not exists idx_stock_take_lines_stock_take on public.stock_take_lines (stock_take_id);
alter table public.stock_take_lines enable row level security;
create policy "Active members with inventory view can see stock take lines"
  on public.stock_take_lines for select using (
    exists (select 1 from public.stock_takes st where st.id = stock_take_lines.stock_take_id
      and public.caller_has_capability(st.business_id, 'inventory', 'view'))
  );

-- create_stock_take: snapshots every currently-stocked product in the
-- warehouse as of right now — system_qty is frozen at snapshot time,
-- not re-read at completion, so a movement recorded mid-count doesn't
-- silently change what's being counted against.
create or replace function public.create_stock_take(p_business_id uuid, p_warehouse_id uuid)
returns public.stock_takes
language plpgsql security definer set search_path = public, auth
as $$
declare v_caller_membership_id uuid; v_row public.stock_takes;
begin
  if not public.caller_has_capability(p_business_id, 'inventory', 'capture') then
    raise exception 'not_authorized: requires capture on inventory';
  end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse_id and business_id = p_business_id) then
    raise exception 'warehouse_not_found_for_this_business: %', p_warehouse_id;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.stock_takes (business_id, warehouse_id, captured_by_membership_id)
  values (p_business_id, p_warehouse_id, v_caller_membership_id)
  returning * into v_row;

  insert into public.stock_take_lines (stock_take_id, product_id, system_qty)
  select v_row.id, sl.product_id, sl.quantity_on_hand
  from public.stock_levels sl
  where sl.warehouse_id = p_warehouse_id and sl.business_id = p_business_id;

  return v_row;
end;
$$;

grant execute on function public.create_stock_take(uuid, uuid) to authenticated;

-- record_stock_take_counts: sets counted_qty (and derived variance)
-- for one or more lines of an in-progress stock take. Can be called
-- more than once as counting progresses.
create or replace function public.record_stock_take_counts(p_stock_take_id uuid, p_counts jsonb)
returns setof public.stock_take_lines
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_stock_take public.stock_takes;
  v_count jsonb;
  v_product_id uuid;
  v_counted_qty numeric;
begin
  select * into v_stock_take from public.stock_takes where id = p_stock_take_id;
  if not found then raise exception 'stock_take_not_found: %', p_stock_take_id; end if;
  if not public.caller_has_capability(v_stock_take.business_id, 'inventory', 'capture') then
    raise exception 'not_authorized: requires capture on inventory';
  end if;
  if v_stock_take.status <> 'in_progress' then
    raise exception 'stock_take_not_in_progress: current status %', v_stock_take.status;
  end if;
  if p_counts is null or jsonb_array_length(p_counts) = 0 then
    raise exception 'no_counts_supplied';
  end if;

  for v_count in select * from jsonb_array_elements(p_counts) loop
    v_product_id := nullif(v_count ->> 'product_id', '')::uuid;
    v_counted_qty := (v_count ->> 'counted_qty')::numeric;
    if v_product_id is null or v_counted_qty is null or v_counted_qty < 0 then
      raise exception 'each_count_needs_a_product_id_and_a_nonnegative_counted_qty';
    end if;

    update public.stock_take_lines
    set counted_qty = v_counted_qty, variance = v_counted_qty - system_qty
    where stock_take_id = p_stock_take_id and product_id = v_product_id;

    if not found then
      raise exception 'product_%_not_on_this_stock_take_(not_stocked_in_this_warehouse_at_snapshot_time)', v_product_id;
    end if;
  end loop;

  return query select * from public.stock_take_lines where stock_take_id = p_stock_take_id order by product_id;
end;
$$;

grant execute on function public.record_stock_take_counts(uuid, jsonb) to authenticated;

-- complete_stock_take: generates one adjustment_increase/decrease
-- StockMovement per counted line with a nonzero variance (lines never
-- counted are left out of the adjustment — an uncounted product's
-- stock level is left untouched, not assumed zero), locking each
-- affected stock_levels row via `for update` (header note 8), same as
-- dispatch_delivery_order.
create or replace function public.complete_stock_take(p_stock_take_id uuid)
returns public.stock_takes
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_stock_take public.stock_takes;
  v_caller_membership_id uuid;
  v_line record;
  v_movement_type text;
begin
  select * into v_stock_take from public.stock_takes where id = p_stock_take_id for update;
  if not found then raise exception 'stock_take_not_found: %', p_stock_take_id; end if;
  if not public.caller_has_capability(v_stock_take.business_id, 'inventory', 'capture') then
    raise exception 'not_authorized: requires capture on inventory';
  end if;
  if v_stock_take.status <> 'in_progress' then
    raise exception 'stock_take_not_in_progress: current status %', v_stock_take.status;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = v_stock_take.business_id and bm.user_id = auth.uid() and bm.status = 'active';

  for v_line in
    select stl.product_id, stl.variance
    from public.stock_take_lines stl
    where stl.stock_take_id = p_stock_take_id
      and stl.counted_qty is not null and stl.variance is not null and stl.variance <> 0
  loop
    v_movement_type := case when v_line.variance > 0 then 'adjustment_increase' else 'adjustment_decrease' end;

    perform 1 from public.stock_levels
    where product_id = v_line.product_id and warehouse_id = v_stock_take.warehouse_id
    for update;

    insert into public.stock_movements (
      business_id, product_id, warehouse_id, movement_type, quantity,
      source_document_type, source_document_id, created_by_membership_id
    ) values (
      v_stock_take.business_id, v_line.product_id, v_stock_take.warehouse_id, v_movement_type, abs(v_line.variance),
      'stock_take', p_stock_take_id, v_caller_membership_id
    );

    update public.stock_levels
    set quantity_on_hand = quantity_on_hand + v_line.variance, last_movement_at = now()
    where product_id = v_line.product_id and warehouse_id = v_stock_take.warehouse_id;
  end loop;

  update public.stock_takes set status = 'completed', counted_at = now()
  where id = p_stock_take_id returning * into v_stock_take;

  return v_stock_take;
end;
$$;

grant execute on function public.complete_stock_take(uuid) to authenticated;

-- End of Sprint 31 migration.
