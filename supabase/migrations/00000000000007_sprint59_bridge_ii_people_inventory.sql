-- ==============================================================
-- Sprint 59 (Draft-and-Approve Bridge II: People & Inventory)
-- ==============================================================
--
-- Adds capture-to-approval routing for the four domains this sprint
-- covers: Commission (manual/ad hoc draft), Attendance correction,
-- Delivery Order (no schema change — see note 3), and Stock
-- adjustment. All four route through the existing
-- public.create_approval_task / public.approval_tasks machinery,
-- exactly mirroring the conventions already established by
-- create_leave_application (draft-then-approve RPC + sync trigger)
-- and complete_stock_take/record_opening_stock (stock_levels upsert
-- pattern).
--
-- SCOPE NOTES (disclosed to and confirmed by the business owner,
-- 15 September 2026 — see Sprint_59 doc for the full discussion):
--
-- 1. Commission — commission_calculations was, until now, only ever
--    populated by compute_commission_for_invoice (rule-computed,
--    tied to an invoice). This migration relaxes invoice_id and
--    commission_rule_id to nullable and adds a 'drafted' status so a
--    manual/ad hoc commission (a flat stated amount, not derived from
--    an invoice or a configured rule) can be captured and routed
--    through the same approval_tasks pipeline. The existing
--    unique(invoice_id) constraint is unaffected: Postgres treats
--    multiple NULLs in a unique column as distinct, so any number of
--    manual drafts (invoice_id null) can coexist.
--
-- 2. Attendance correction — attendance_records is, and remains, an
--    append-only clock-in/out ledger with no correction concept.
--    This migration adds a new attendance_corrections table (a
--    proposed correction to be approved) whose approval inserts a
--    real attendance_records row using source = 'manual_admin_entry'
--    (a value create_attendance_record already accepted but that
--    nothing wired until now).
--
-- 3. Delivery Order — no schema change. create_delivery_order already
--    requires a real, existing invoice (p_invoice_id not null,
--    invoices.delivery_order_id enforcing one DO per invoice). Per
--    the owner's decision, a captured Delivery Order must resolve to
--    a real invoice reference or fall through to Unclassified Triage
--    — that resolution is capture-router (TypeScript) wiring, not a
--    schema concern, and is not part of this migration.
--
-- 4. Stock adjustment — no standalone adjustment RPC existed before
--    this migration; only the full Stock Take flow derives adjustment
--    movements from counted-vs-system variance. This migration adds a
--    lightweight, single-line stock_adjustments draft table — a
--    sibling to Stock Take, not a replacement for it — whose approval
--    posts one stock_movements row (adjustment_increase/decrease per
--    the sign of the stated delta) and updates stock_levels via the
--    same upsert pattern record_opening_stock uses (so a first-ever
--    movement for a product/warehouse pair does not require a
--    pre-existing stock_levels row).
--
-- All four new/extended RPCs never auto-post: every capture becomes
-- either a status = 'drafted' domain row awaiting approval_tasks
-- resolution, or (stock_adjustment/attendance_correction) is
-- permanently excluded from any future confidence-based auto-record
-- shortcut per Sprint 61's own five-domain permanent-approval list —
-- unaffected by p_auto_approved being available on these RPCs for
-- symmetry with every other capture RPC in this schema.
-- ==============================================================

-- ------------------------------------------------------------
-- 1. Commission — manual/ad hoc draft
-- ------------------------------------------------------------

alter table public.commission_calculations
  alter column invoice_id drop not null,
  alter column agent_party_id drop not null,
  alter column commission_rule_id drop not null;

-- agent_party_id stays required in practice (every RPC path sets it);
-- dropped not null only because a future capture path might not have
-- resolved the agent yet — no current caller relies on this, kept
-- strict via CHECK below instead of at the column level so a direct
-- SQL Editor insert without an agent is still rejected.
alter table public.commission_calculations
  add constraint commission_calculations_agent_required
  check (agent_party_id is not null);

alter table public.commission_calculations
  drop constraint if exists commission_calculations_status_check;
alter table public.commission_calculations
  add constraint commission_calculations_status_check
  check (status in ('drafted', 'computed', 'approved', 'paid'));

comment on column public.commission_calculations.invoice_id is
  'Null for a manual/ad hoc commission draft (Sprint 59) — set for every rule-computed row from compute_commission_for_invoice.';
comment on column public.commission_calculations.commission_rule_id is
  'Null for a manual/ad hoc commission draft (Sprint 59) — set for every rule-computed row from compute_commission_for_invoice.';

create or replace function public.create_manual_commission_draft(
  p_business_id uuid, p_agent_party_id uuid, p_amount numeric, p_notes text default null,
  p_ai_draft_summary text default null, p_auto_approved boolean default false
) returns public.commission_calculations
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_row public.commission_calculations;
begin
  if not public.caller_has_capability(p_business_id, 'commission', 'capture') then
    raise exception 'not_authorized: requires capture on commission';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount: must be positive';
  end if;
  if not exists (
    select 1 from public.parties where id = p_agent_party_id and business_id = p_business_id and 'agent' = any(party_types)
  ) then
    raise exception 'agent_party_not_found_for_this_business: %', p_agent_party_id;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.commission_calculations (
    business_id, invoice_id, agent_party_id, commission_rule_id, amount, status
  ) values (
    p_business_id, null, p_agent_party_id, null, p_amount, 'drafted'
  ) returning * into v_row;

  perform public.create_approval_task(
    p_business_id, 'commission', 'commission_calculation', v_row.id, p_amount,
    coalesce(p_ai_draft_summary, 'Manual commission draft for agent ' || p_agent_party_id || ': ' || p_amount
      || coalesce(' (' || p_notes || ')', '')),
    null, v_caller_membership_id, p_auto_approved, null
  );

  return v_row;
end;
$$;

grant execute on function public.create_manual_commission_draft(uuid, uuid, numeric, text, text, boolean) to authenticated;

-- Extends the Sprint 34 trigger (same function name, `create or
-- replace`) to also handle the new 'drafted' status alongside the
-- existing 'computed' path — both transition to 'approved' the same
-- way; only the pre-image status differs.
create or replace function public.sync_commission_calculation_on_task_decision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.subject_type <> 'commission_calculation' or old.status is not distinct from new.status then
    return new;
  end if;
  if new.status in ('approved', 'auto_approved') then
    update public.commission_calculations set status = 'approved'
    where id = new.subject_id and status in ('computed', 'drafted');
  elsif new.status = 'rejected' then
    delete from public.commission_calculations where id = new.subject_id and status in ('computed', 'drafted');
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 2. Attendance correction — new table + draft-then-approve RPC,
-- mirroring create_leave_application's shape.
-- ------------------------------------------------------------

create table if not exists public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  employee_party_id uuid not null references public.parties (id),
  clock_type text not null check (clock_type in ('in', 'out')),
  corrected_at timestamptz not null,
  reason text,
  status text not null default 'drafted' check (status in ('drafted', 'approved', 'rejected')),
  captured_by_membership_id uuid references public.business_memberships (id),
  decided_by_membership_id uuid references public.business_memberships (id),
  created_attendance_record_id uuid references public.attendance_records (id),
  created_at timestamptz not null default now()
);
create index if not exists idx_attendance_corrections_business on public.attendance_corrections (business_id);
alter table public.attendance_corrections enable row level security;
create policy "Active members with hr_attendance_leave view can see attendance corrections"
  on public.attendance_corrections for select using (public.caller_has_capability(business_id, 'hr_attendance_leave', 'view'));

create or replace function public.create_attendance_correction(
  p_business_id uuid, p_employee_party_id uuid, p_clock_type text, p_corrected_at timestamptz, p_reason text default null,
  p_ai_draft_summary text default null, p_auto_approved boolean default false
) returns public.attendance_corrections
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_row public.attendance_corrections;
begin
  if not public.caller_has_capability(p_business_id, 'hr_attendance_leave', 'capture') then
    raise exception 'not_authorized: requires capture on hr_attendance_leave';
  end if;
  if p_clock_type not in ('in', 'out') then
    raise exception 'invalid_clock_type: must be in or out';
  end if;
  if not exists (
    select 1 from public.parties where id = p_employee_party_id and business_id = p_business_id
      and 'employee' = any(party_types)
  ) then
    raise exception 'employee_party_not_found_for_this_business: %', p_employee_party_id;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.attendance_corrections (
    business_id, employee_party_id, clock_type, corrected_at, reason, captured_by_membership_id
  ) values (
    p_business_id, p_employee_party_id, p_clock_type, p_corrected_at, p_reason, v_caller_membership_id
  ) returning * into v_row;

  -- Attendance correction is one of Sprint 61's five permanently-
  -- approval-gated domains (payroll downstream impact) — p_auto_approved
  -- is accepted only for RPC-shape symmetry with every other capture
  -- RPC in this schema; nothing in the capture router is expected to
  -- ever pass true for this domain.
  perform public.create_approval_task(
    p_business_id, 'hr_attendance_leave', 'attendance_correction', v_row.id, null,
    coalesce(p_ai_draft_summary, 'Attendance correction: clock-' || p_clock_type || ' at ' || p_corrected_at
      || coalesce(' (' || p_reason || ')', '')),
    null, v_caller_membership_id, p_auto_approved, null
  );

  return v_row;
end;
$$;

grant execute on function public.create_attendance_correction(uuid, uuid, text, timestamptz, text, text, boolean) to authenticated;

-- On approval, inserts the real attendance_records row directly
-- (SECURITY DEFINER trigger context — same convention as every other
-- sync_*_on_task_decision trigger in this schema, which write to the
-- domain table(s) themselves rather than calling back through a
-- capture RPC). Deliberately bypasses create_attendance_record's
-- clock-in/clock-out alternation check: a correction is explicitly
-- fixing a gap or an out-of-sequence record, so re-enforcing strict
-- alternation here would defeat the feature's purpose.
create or replace function public.sync_attendance_correction_on_task_decision()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_correction public.attendance_corrections;
  v_record_id uuid;
begin
  if new.subject_type <> 'attendance_correction' or old.status is not distinct from new.status then
    return new;
  end if;
  select * into v_correction from public.attendance_corrections where id = new.subject_id and status = 'drafted';
  if not found then
    return new;
  end if;

  if new.status in ('approved', 'auto_approved') then
    insert into public.attendance_records (
      business_id, employee_party_id, clock_type, recorded_at, source, created_by_membership_id
    ) values (
      v_correction.business_id, v_correction.employee_party_id, v_correction.clock_type, v_correction.corrected_at,
      'manual_admin_entry', v_correction.captured_by_membership_id
    ) returning id into v_record_id;

    update public.attendance_corrections
    set status = 'approved', decided_by_membership_id = new.decided_by_membership_id, created_attendance_record_id = v_record_id
    where id = new.subject_id;
  elsif new.status = 'rejected' then
    update public.attendance_corrections
    set status = 'rejected', decided_by_membership_id = new.decided_by_membership_id
    where id = new.subject_id;
  end if;
  return new;
end;
$$;

create trigger trg_sync_attendance_correction_on_task_decision
  after update on public.approval_tasks
  for each row execute function public.sync_attendance_correction_on_task_decision();

-- ------------------------------------------------------------
-- 3. Delivery Order — no schema change (see header note 3).
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 4. Stock adjustment — new single-line draft table + approval-time
-- posting, mirroring complete_stock_take's variance-posting shape and
-- record_opening_stock's stock_levels upsert.
-- ------------------------------------------------------------

create table if not exists public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  product_id uuid not null references public.products (id),
  warehouse_id uuid not null references public.warehouses (id),
  quantity_delta numeric(14, 3) not null check (quantity_delta <> 0),
  reason text,
  status text not null default 'drafted' check (status in ('drafted', 'approved', 'rejected')),
  captured_by_membership_id uuid references public.business_memberships (id),
  decided_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now()
);
create index if not exists idx_stock_adjustments_business on public.stock_adjustments (business_id);
alter table public.stock_adjustments enable row level security;
create policy "Active members with inventory view can see stock adjustments"
  on public.stock_adjustments for select using (public.caller_has_capability(business_id, 'inventory', 'view'));

create or replace function public.create_stock_adjustment(
  p_business_id uuid, p_product_id uuid, p_warehouse_id uuid, p_quantity_delta numeric, p_reason text default null,
  p_ai_draft_summary text default null, p_auto_approved boolean default false
) returns public.stock_adjustments
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_product public.products;
  v_row public.stock_adjustments;
begin
  if not public.caller_has_capability(p_business_id, 'inventory', 'capture') then
    raise exception 'not_authorized: requires capture on inventory';
  end if;
  if p_quantity_delta is null or p_quantity_delta = 0 then
    raise exception 'invalid_quantity_delta: must be nonzero';
  end if;

  select * into v_product from public.products where id = p_product_id and business_id = p_business_id;
  if not found then raise exception 'product_not_found_for_this_business: %', p_product_id; end if;
  if not v_product.track_inventory then
    raise exception 'product_is_not_stock_tracked: %', p_product_id;
  end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse_id and business_id = p_business_id) then
    raise exception 'warehouse_not_found_for_this_business: %', p_warehouse_id;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.stock_adjustments (
    business_id, product_id, warehouse_id, quantity_delta, reason, captured_by_membership_id
  ) values (
    p_business_id, p_product_id, p_warehouse_id, p_quantity_delta, p_reason, v_caller_membership_id
  ) returning * into v_row;

  -- Stock adjustment is one of Sprint 61's five permanently-approval-
  -- gated domains (inventory accuracy) — p_auto_approved is accepted
  -- only for RPC-shape symmetry; the capture router is not expected
  -- to ever pass true for this domain.
  perform public.create_approval_task(
    p_business_id, 'inventory', 'stock_adjustment', v_row.id, null,
    coalesce(p_ai_draft_summary, 'Stock adjustment: ' || p_quantity_delta || ' units'
      || coalesce(' (' || p_reason || ')', '')),
    null, v_caller_membership_id, p_auto_approved, null
  );

  return v_row;
end;
$$;

grant execute on function public.create_stock_adjustment(uuid, uuid, uuid, numeric, text, text, boolean) to authenticated;

create or replace function public.sync_stock_adjustment_on_task_decision()
returns trigger language plpgsql security definer set search_path = public, auth
as $$
declare
  v_adj public.stock_adjustments;
  v_movement_type text;
begin
  if new.subject_type <> 'stock_adjustment' or old.status is not distinct from new.status then
    return new;
  end if;
  select * into v_adj from public.stock_adjustments where id = new.subject_id and status = 'drafted' for update;
  if not found then
    return new;
  end if;

  if new.status in ('approved', 'auto_approved') then
    v_movement_type := case when v_adj.quantity_delta > 0 then 'adjustment_increase' else 'adjustment_decrease' end;

    perform 1 from public.stock_levels
    where product_id = v_adj.product_id and warehouse_id = v_adj.warehouse_id
    for update;

    insert into public.stock_movements (
      business_id, product_id, warehouse_id, movement_type, quantity,
      source_document_type, source_document_id, created_by_membership_id
    ) values (
      v_adj.business_id, v_adj.product_id, v_adj.warehouse_id, v_movement_type, abs(v_adj.quantity_delta),
      'manual', v_adj.id, v_adj.captured_by_membership_id
    );

    insert into public.stock_levels (business_id, product_id, warehouse_id, quantity_on_hand, last_movement_at)
    values (v_adj.business_id, v_adj.product_id, v_adj.warehouse_id, v_adj.quantity_delta, now())
    on conflict (product_id, warehouse_id) do update
      set quantity_on_hand = public.stock_levels.quantity_on_hand + excluded.quantity_on_hand,
          last_movement_at = now();

    update public.stock_adjustments
    set status = 'approved', decided_by_membership_id = new.decided_by_membership_id
    where id = new.subject_id;
  elsif new.status = 'rejected' then
    update public.stock_adjustments
    set status = 'rejected', decided_by_membership_id = new.decided_by_membership_id
    where id = new.subject_id;
  end if;
  return new;
end;
$$;

create trigger trg_sync_stock_adjustment_on_task_decision
  after update on public.approval_tasks
  for each row execute function public.sync_stock_adjustment_on_task_decision();

-- End of Sprint 59 migration.
