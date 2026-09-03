-- ==============================================================
-- AIFA backend schema — Sprint 35 (Vol 13_0 §11 Module H: Pengurusan
-- Syarikat Lengkap — Attendance, Leave, Commission). Continues Sub-
-- phase 3e.
--
-- ==============================================================
-- SCOPE NOTES (disclosed):
--
-- 1. DoD item 1 ("GPS clock-in/out works with offline queueing
--    verified — airplane-mode test, same discipline as Vol 7_4's
--    existing offline tests") cannot be literally performed by this
--    session: there is no mobile app UI or physical device in this
--    whole engagement's toolset — every sprint since Sprint 21 has
--    built and verified the Postgres/RPC layer plus a client-side
--    TypeScript transport, never actual React Native screens or
--    on-device behaviour. Vol 13_0 §11's own domain-flow text says
--    attendance capture "reuses" Vol 7_4's existing offline-capture/
--    queue pattern — "no new offline model needed" — meaning the
--    queueing mechanism itself is pre-existing, unmodified client
--    infrastructure from an earlier phase, not new work this sprint.
--    What IS new and IS server-side testable: `create_attendance_record`
--    accepts a caller-supplied `p_recorded_at` timestamp rather than
--    forcing `now()`, so a record captured while offline and synced
--    minutes or hours later still carries its true clock-in/out time
--    — the one thing the server side must get right to support an
--    offline-queued client correctly. This migration's own
--    verification proves that (a record inserted with a past
--    `p_recorded_at`, simulating a delayed sync, is stored and
--    ordered correctly) but does NOT and cannot claim an actual
--    airplane-mode-on-a-real-device test — that verification is
--    outside this session's reach, disclosed rather than assumed.
--    DoD item 1 stays open in the Sprint 35 doc's Outcomes.
--
-- 2. `create_attendance_record` rejects two consecutive clock-ins (or
--    clock-outs) in a row for the same employee — a genuine data-
--    integrity guard (an employee's most recent attendance record must
--    have the OPPOSITE clock_type before a new one is accepted),
--    matching the same "reject a nonsensical double-state" posture as
--    Sprint 32's bank-reconciliation guards. Not named explicitly in
--    Vol 13_0 §11's own schema block, but necessary to keep
--    OvertimeRecord derivation meaningful (pairing in/out records that
--    don't actually alternate would silently miscompute hours).
--
-- 3. There is no dedicated EmployeeSchedule table this sprint — Vol
--    13_0 §11's own OvertimeRecord schema block has no such table
--    either (only `hours`, computed "against the employee's scheduled
--    hours"). `derive_overtime_for_date` takes `p_scheduled_hours` as
--    an explicit parameter (default 8) rather than inventing a
--    schedule table beyond the literal spec — this is also how this
--    migration's own verification exercises an irregular-schedule case
--    (this sprint's own named Risk), by passing a non-default value.
--
-- 4. Overtime pay is folded directly into `create_payroll_run`'s own
--    `gross_pay` (re-defined here via `create or replace`, extending
--    Sprint 34's version) rather than added as a new Payslip column —
--    Vol 13_0 §11's own domain-flow text says an approved
--    OvertimeRecord "feeds directly into the next PayrollRun's
--    gross-pay calculation," and Sprint 34's own Payslip schema block
--    (Vol 13_0 §10) has no overtime line item, so folding it into
--    gross_pay (which EPF/SOCSO/EIS/PCB are then correctly computed
--    against, matching real-world statutory treatment of overtime pay)
--    is the more literal reading. Hourly rate is assumed as
--    `basic_salary / (26 working days x 8 hours)`, at 1.5x for
--    overtime hours — Vol 13_0 §11 specifies neither constant;
--    disclosed as a reasonable, common Malaysian payroll convention,
--    not a verified statutory requirement (the same advice-boundary
--    posture as every other statutory figure in this schema).
--
-- 5. Leave balance deduction happens ONLY in the ApprovalTask decision
--    sync trigger (on 'approved'), never at `create_leave_application`
--    time — this sprint's own explicit DoD requirement, verified
--    directly (submission alone leaves `used_days` unchanged).
--
-- 6. `LeaveApplication`/`OvertimeRecord`/`CommissionCalculation` have
--    no `rejected` value in Vol 13_0 §11's own literal enums except
--    LeaveApplication (which DOES list `rejected`). OvertimeRecord
--    (`draft | approved | synced_to_payroll`) and CommissionCalculation
--    (`computed | approved | paid`) do not — on rejection, this
--    migration DELETES the draft/computed row rather than inventing an
--    unlisted status value, since neither has any downstream effect
--    yet at that point (no payroll sync, no payment) — a disclosed,
--    reversible-safe choice, not silent data loss of anything
--    consequential. The true rejected decision is still fully
--    preserved on the ApprovalTask row itself.
--
-- 7. Commission's "auto-trigger the moment Invoice.status reaches the
--    business-configured trigger point" is realised the same way
--    Sprint 33 realised SST computation: an explicit follow-up RPC
--    (`compute_commission_for_invoice`) the client calls immediately
--    after the relevant status-changing action, which itself validates
--    the invoice's CURRENT status matches the business's configured
--    `commission_trigger_status` before proceeding — not a hidden
--    database trigger silently reaching into Sprint 28/29's own
--    already-shipped, already-tested invoice functions this late in
--    the series. `businesses.commission_trigger_status` (new column,
--    default 'issued') is the "business configuration" Vol 13_0 §11
--    itself names.
--
-- 8. `invoices.agent_party_id` (new nullable column, references
--    Party) is a necessary, disclosed addition beyond Vol 13_0 §11's
--    literal Invoice references — nothing in the existing schema
--    otherwise names which agent Party a given invoice's commission
--    belongs to. Set via a new `assign_invoice_agent` RPC, gated
--    `capture` on `sales` (the same domain that already governs
--    invoice-adjacent actions).
--
-- 9. The Dashboard is a read-only function, `revenue_vs_cost_dashboard`
--    — "no new storage," per Vol 13_0 §11's own framing. It sums
--    invoice revenue in the requested date range against payroll cost
--    (PayrollRuns whose period falls in range) and commission cost
--    (CommissionCalculations computed in range with status in
--    'approved'/'paid') — the "functional minimum" this sprint's own
--    Safe-to-Carry-Over section names, not a richer ratio-driven
--    analytics view (Vol 13_0 §14's own still-open item on which
--    ratios matter most).
-- ==============================================================

-- ------------------------------------------------------------
-- 0. businesses.commission_trigger_status (see header note 7).
-- ------------------------------------------------------------
alter table public.businesses
  add column if not exists commission_trigger_status text not null default 'issued'
  check (commission_trigger_status in ('issued', 'paid'));

alter table public.invoices
  add column if not exists agent_party_id uuid references public.parties (id);

create or replace function public.assign_invoice_agent(p_invoice_id uuid, p_agent_party_id uuid)
returns public.invoices
language plpgsql security definer set search_path = public, auth
as $$
declare v_invoice public.invoices;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'invoice_not_found: %', p_invoice_id; end if;
  if not public.caller_has_capability(v_invoice.business_id, 'sales', 'capture') then
    raise exception 'not_authorized: requires capture on sales';
  end if;
  if not exists (
    select 1 from public.parties where id = p_agent_party_id and business_id = v_invoice.business_id
      and 'agent' = any(party_types)
  ) then
    raise exception 'agent_party_not_found_or_not_an_agent_party: %', p_agent_party_id;
  end if;

  update public.invoices set agent_party_id = p_agent_party_id where id = p_invoice_id
  returning * into v_invoice;

  return v_invoice;
end;
$$;

grant execute on function public.assign_invoice_agent(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 1. public.attendance_records (Vol 13_0 §11 — see header notes 1-2).
-- ------------------------------------------------------------
create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  employee_party_id uuid not null references public.parties (id),
  clock_type text not null check (clock_type in ('in', 'out')),
  recorded_at timestamptz not null,
  gps_lat numeric(10, 6),
  gps_lng numeric(10, 6),
  gps_accuracy_m numeric(8, 2),
  source text not null default 'mobile_app' check (source in ('mobile_app', 'manual_admin_entry')),
  created_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now()
);
create index if not exists idx_attendance_records_employee on public.attendance_records (employee_party_id, recorded_at);
alter table public.attendance_records enable row level security;
create policy "Active members with hr_attendance_leave view can see attendance"
  on public.attendance_records for select using (public.caller_has_capability(business_id, 'hr_attendance_leave', 'view'));

create or replace function public.create_attendance_record(
  p_business_id uuid, p_employee_party_id uuid, p_clock_type text, p_recorded_at timestamptz,
  p_gps_lat numeric default null, p_gps_lng numeric default null, p_gps_accuracy_m numeric default null,
  p_source text default 'mobile_app'
) returns public.attendance_records
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_row public.attendance_records;
  v_last_clock_type text;
begin
  if not public.caller_has_capability(p_business_id, 'hr_attendance_leave', 'capture') then
    raise exception 'not_authorized: requires capture on hr_attendance_leave';
  end if;
  if p_clock_type not in ('in', 'out') then
    raise exception 'invalid_clock_type: must be in or out';
  end if;
  if p_source not in ('mobile_app', 'manual_admin_entry') then
    raise exception 'invalid_source: must be mobile_app or manual_admin_entry';
  end if;
  if not exists (
    select 1 from public.parties where id = p_employee_party_id and business_id = p_business_id
      and 'employee' = any(party_types)
  ) then
    raise exception 'employee_party_not_found_for_this_business: %', p_employee_party_id;
  end if;

  select clock_type into v_last_clock_type from public.attendance_records
  where employee_party_id = p_employee_party_id
  order by recorded_at desc limit 1;

  if v_last_clock_type is null and p_clock_type <> 'in' then
    raise exception 'cannot_clock_out_before_ever_clocking_in';
  end if;
  if v_last_clock_type is not null and v_last_clock_type = p_clock_type then
    raise exception 'cannot_clock_%_twice_in_a_row: most recent record was already %', p_clock_type, v_last_clock_type;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.attendance_records (
    business_id, employee_party_id, clock_type, recorded_at, gps_lat, gps_lng, gps_accuracy_m, source, created_by_membership_id
  ) values (
    p_business_id, p_employee_party_id, p_clock_type, p_recorded_at, p_gps_lat, p_gps_lng, p_gps_accuracy_m, p_source, v_caller_membership_id
  ) returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_attendance_record(uuid, uuid, text, timestamptz, numeric, numeric, numeric, text) to authenticated;

-- ------------------------------------------------------------
-- 2. public.overtime_records (Vol 13_0 §11 — see header notes 3, 6).
-- ------------------------------------------------------------
create table if not exists public.overtime_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  employee_party_id uuid not null references public.parties (id),
  date date not null,
  hours numeric(6, 2) not null check (hours > 0),
  status text not null default 'draft' check (status in ('draft', 'approved', 'synced_to_payroll')),
  created_at timestamptz not null default now(),
  unique (employee_party_id, date)
);
create index if not exists idx_overtime_records_business on public.overtime_records (business_id);
alter table public.overtime_records enable row level security;
create policy "Active members with hr_attendance_leave view can see overtime"
  on public.overtime_records for select using (public.caller_has_capability(business_id, 'hr_attendance_leave', 'view'));

create or replace function public.derive_overtime_for_date(
  p_business_id uuid, p_employee_party_id uuid, p_date date, p_scheduled_hours numeric default 8,
  p_ai_draft_summary text default null, p_auto_approved boolean default false
) returns public.overtime_records
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_row public.overtime_records;
  v_worked_hours numeric := 0;
  v_pair record;
  v_overtime_hours numeric;
begin
  if not public.caller_has_capability(p_business_id, 'hr_attendance_leave', 'capture') then
    raise exception 'not_authorized: requires capture on hr_attendance_leave';
  end if;
  if exists (select 1 from public.overtime_records where employee_party_id = p_employee_party_id and date = p_date) then
    raise exception 'overtime_already_derived_for_this_employee_and_date: %', p_date;
  end if;

  -- Pair consecutive in/out records that fall on this calendar date,
  -- summing worked duration. A record spanning midnight is out of
  -- scope this sprint (disclosed simplification, not silently wrong —
  -- such a pair simply doesn't match this date-scoped query and is
  -- excluded rather than mis-attributed).
  for v_pair in
    select
      a_in.recorded_at as clock_in, a_out.recorded_at as clock_out
    from public.attendance_records a_in
    join lateral (
      select recorded_at from public.attendance_records a_out
      where a_out.employee_party_id = a_in.employee_party_id and a_out.clock_type = 'out'
        and a_out.recorded_at > a_in.recorded_at
      order by a_out.recorded_at asc limit 1
    ) a_out on true
    where a_in.employee_party_id = p_employee_party_id and a_in.clock_type = 'in'
      and a_in.recorded_at::date = p_date and a_out.recorded_at::date = p_date
  loop
    v_worked_hours := v_worked_hours + extract(epoch from (v_pair.clock_out - v_pair.clock_in)) / 3600.0;
  end loop;

  v_overtime_hours := round(v_worked_hours - p_scheduled_hours, 2);
  if v_overtime_hours <= 0 then
    raise exception 'no_overtime_for_this_date: worked % hours against a % hour schedule', round(v_worked_hours, 2), p_scheduled_hours;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.overtime_records (business_id, employee_party_id, date, hours)
  values (p_business_id, p_employee_party_id, p_date, v_overtime_hours)
  returning * into v_row;

  perform public.create_approval_task(
    p_business_id, 'hr_attendance_leave', 'overtime_record', v_row.id, null,
    coalesce(p_ai_draft_summary, 'Overtime for ' || p_date || ': ' || v_overtime_hours || ' hours'),
    null, v_caller_membership_id, p_auto_approved, null
  );

  return v_row;
end;
$$;

grant execute on function public.derive_overtime_for_date(uuid, uuid, date, numeric, text, boolean) to authenticated;

create or replace function public.sync_overtime_record_on_task_decision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.subject_type <> 'overtime_record' or old.status is not distinct from new.status then
    return new;
  end if;
  if new.status in ('approved', 'auto_approved') then
    update public.overtime_records set status = 'approved' where id = new.subject_id and status = 'draft';
  elsif new.status = 'rejected' then
    delete from public.overtime_records where id = new.subject_id and status = 'draft'; -- see header note 6
  end if;
  return new;
end;
$$;
create trigger trg_sync_overtime_record_on_task_decision
  after update on public.approval_tasks
  for each row execute function public.sync_overtime_record_on_task_decision();

-- ------------------------------------------------------------
-- 3. public.leave_types / public.leave_balances / public.leave_applications
-- (Vol 13_0 §11 — see header note 5).
-- ------------------------------------------------------------
create table if not exists public.leave_types (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  default_entitlement_days numeric(6, 2) not null check (default_entitlement_days >= 0),
  created_at timestamptz not null default now(),
  unique (business_id, name)
);
alter table public.leave_types enable row level security;
create policy "Active members with hr_attendance_leave view can see leave typ"
  on public.leave_types for select using (public.caller_has_capability(business_id, 'hr_attendance_leave', 'view'));

create or replace function public.create_leave_type(p_business_id uuid, p_name text, p_default_entitlement_days numeric)
returns public.leave_types
language plpgsql security definer set search_path = public, auth
as $$
declare v_row public.leave_types;
begin
  if not public.caller_has_capability(p_business_id, 'hr_attendance_leave', 'configure') then
    raise exception 'not_authorized: requires configure on hr_attendance_leave';
  end if;
  insert into public.leave_types (business_id, name, default_entitlement_days)
  values (p_business_id, p_name, p_default_entitlement_days)
  returning * into v_row;
  return v_row;
end;
$$;

grant execute on function public.create_leave_type(uuid, text, numeric) to authenticated;

create table if not exists public.leave_balances (
  employee_party_id uuid not null references public.parties (id),
  leave_type_id uuid not null references public.leave_types (id),
  year integer not null,
  entitled_days numeric(6, 2) not null default 0,
  used_days numeric(6, 2) not null default 0,
  primary key (employee_party_id, leave_type_id, year)
);
alter table public.leave_balances enable row level security;
create policy "Active members with hr_attendance_leave view can see leave bal"
  on public.leave_balances for select using (
    exists (select 1 from public.leave_types lt where lt.id = leave_balances.leave_type_id
      and public.caller_has_capability(lt.business_id, 'hr_attendance_leave', 'view'))
  );

create or replace function public.grant_leave_balance(
  p_employee_party_id uuid, p_leave_type_id uuid, p_year integer, p_entitled_days numeric default null
) returns public.leave_balances
language plpgsql security definer set search_path = public, auth
as $$
declare v_leave_type public.leave_types; v_row public.leave_balances; v_days numeric;
begin
  select * into v_leave_type from public.leave_types where id = p_leave_type_id;
  if not found then raise exception 'leave_type_not_found: %', p_leave_type_id; end if;
  if not public.caller_has_capability(v_leave_type.business_id, 'hr_attendance_leave', 'configure') then
    raise exception 'not_authorized: requires configure on hr_attendance_leave';
  end if;
  v_days := coalesce(p_entitled_days, v_leave_type.default_entitlement_days);

  insert into public.leave_balances (employee_party_id, leave_type_id, year, entitled_days, used_days)
  values (p_employee_party_id, p_leave_type_id, p_year, v_days, 0)
  on conflict (employee_party_id, leave_type_id, year)
  do update set entitled_days = excluded.entitled_days
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.grant_leave_balance(uuid, uuid, integer, numeric) to authenticated;

create table if not exists public.leave_applications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  employee_party_id uuid not null references public.parties (id),
  leave_type_id uuid not null references public.leave_types (id),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  status text not null default 'pending_approval' check (status in ('pending_approval', 'approved', 'rejected')),
  approved_by uuid references public.business_memberships (id),
  created_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now()
);
create index if not exists idx_leave_applications_business on public.leave_applications (business_id);
alter table public.leave_applications enable row level security;
create policy "Active members with hr_attendance_leave view can see leave apps"
  on public.leave_applications for select using (public.caller_has_capability(business_id, 'hr_attendance_leave', 'view'));

create or replace function public.create_leave_application(
  p_business_id uuid, p_employee_party_id uuid, p_leave_type_id uuid, p_start_date date, p_end_date date,
  p_ai_draft_summary text default null, p_auto_approved boolean default false
) returns public.leave_applications
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_row public.leave_applications;
  v_days numeric;
  v_balance public.leave_balances;
begin
  if not public.caller_has_capability(p_business_id, 'hr_attendance_leave', 'capture') then
    raise exception 'not_authorized: requires capture on hr_attendance_leave';
  end if;
  if not exists (
    select 1 from public.parties where id = p_employee_party_id and business_id = p_business_id
      and 'employee' = any(party_types)
  ) then
    raise exception 'employee_party_not_found_for_this_business: %', p_employee_party_id;
  end if;
  if not exists (select 1 from public.leave_types where id = p_leave_type_id and business_id = p_business_id) then
    raise exception 'leave_type_not_found_for_this_business: %', p_leave_type_id;
  end if;

  v_days := (p_end_date - p_start_date) + 1;

  select * into v_balance from public.leave_balances
  where employee_party_id = p_employee_party_id and leave_type_id = p_leave_type_id
    and year = extract(year from p_start_date)::integer;
  if not found or (v_balance.entitled_days - v_balance.used_days) < v_days then
    raise exception 'insufficient_leave_balance: requested % days, % available', v_days,
      coalesce(v_balance.entitled_days - v_balance.used_days, 0);
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.leave_applications (
    business_id, employee_party_id, leave_type_id, start_date, end_date, created_by_membership_id
  ) values (
    p_business_id, p_employee_party_id, p_leave_type_id, p_start_date, p_end_date, v_caller_membership_id
  ) returning * into v_row;

  perform public.create_approval_task(
    p_business_id, 'hr_attendance_leave', 'leave_application', v_row.id, null,
    coalesce(p_ai_draft_summary, 'Leave application ' || p_start_date || ' to ' || p_end_date || ' (' || v_days || ' days)'),
    null, v_caller_membership_id, p_auto_approved, null
  );

  return v_row;
end;
$$;

grant execute on function public.create_leave_application(uuid, uuid, uuid, date, date, text, boolean) to authenticated;

-- Balance deduction happens ONLY here, on approval — see header note 5.
create or replace function public.sync_leave_application_on_task_decision()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_app public.leave_applications; v_days numeric;
begin
  if new.subject_type <> 'leave_application' or old.status is not distinct from new.status then
    return new;
  end if;
  select * into v_app from public.leave_applications where id = new.subject_id and status = 'pending_approval';
  if not found then
    return new;
  end if;
  if new.status in ('approved', 'auto_approved') then
    v_days := (v_app.end_date - v_app.start_date) + 1;
    update public.leave_balances set used_days = used_days + v_days
    where employee_party_id = v_app.employee_party_id and leave_type_id = v_app.leave_type_id
      and year = extract(year from v_app.start_date)::integer;
    update public.leave_applications set status = 'approved', approved_by = new.decided_by_membership_id
    where id = new.subject_id;
  elsif new.status = 'rejected' then
    update public.leave_applications set status = 'rejected', approved_by = new.decided_by_membership_id
    where id = new.subject_id;
  end if;
  return new;
end;
$$;
create trigger trg_sync_leave_application_on_task_decision
  after update on public.approval_tasks
  for each row execute function public.sync_leave_application_on_task_decision();

-- ------------------------------------------------------------
-- 4. public.commission_rules / public.commission_calculations
-- (Vol 13_0 §11 — see header notes 6-8).
-- ------------------------------------------------------------
create table if not exists public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  applies_to_party_id uuid references public.parties (id), -- null = business-wide default
  basis text not null check (basis in ('percent_of_invoice', 'percent_of_margin', 'flat_per_unit')),
  rate numeric(10, 4) not null check (rate >= 0),
  product_scope text,
  created_at timestamptz not null default now()
);
create index if not exists idx_commission_rules_business on public.commission_rules (business_id);
alter table public.commission_rules enable row level security;
create policy "Active members with commission view can see commission rules"
  on public.commission_rules for select using (public.caller_has_capability(business_id, 'commission', 'view'));

create or replace function public.create_commission_rule(
  p_business_id uuid, p_basis text, p_rate numeric, p_applies_to_party_id uuid default null, p_product_scope text default null
) returns public.commission_rules
language plpgsql security definer set search_path = public, auth
as $$
declare v_row public.commission_rules;
begin
  if not public.caller_has_capability(p_business_id, 'commission', 'configure') then
    raise exception 'not_authorized: requires configure on commission';
  end if;
  if p_basis not in ('percent_of_invoice', 'percent_of_margin', 'flat_per_unit') then
    raise exception 'invalid_basis: %', p_basis;
  end if;
  if p_applies_to_party_id is not null and not exists (
    select 1 from public.parties where id = p_applies_to_party_id and business_id = p_business_id and 'agent' = any(party_types)
  ) then
    raise exception 'applies_to_party_not_found_or_not_an_agent_party: %', p_applies_to_party_id;
  end if;

  insert into public.commission_rules (business_id, applies_to_party_id, basis, rate, product_scope)
  values (p_business_id, p_applies_to_party_id, p_basis, p_rate, p_product_scope)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_commission_rule(uuid, text, numeric, uuid, text) to authenticated;

create table if not exists public.commission_calculations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id),
  agent_party_id uuid not null references public.parties (id),
  commission_rule_id uuid not null references public.commission_rules (id),
  amount numeric(14, 2) not null,
  status text not null default 'computed' check (status in ('computed', 'approved', 'paid')),
  created_at timestamptz not null default now(),
  unique (invoice_id) -- one commission calculation per invoice this sprint (see header note 7's single-trigger-point design)
);
create index if not exists idx_commission_calculations_business on public.commission_calculations (business_id);
alter table public.commission_calculations enable row level security;
create policy "Active members with commission view can see commission calcs"
  on public.commission_calculations for select using (public.caller_has_capability(business_id, 'commission', 'view'));

create or replace function public.compute_commission_for_invoice(
  p_invoice_id uuid, p_ai_draft_summary text default null, p_auto_approved boolean default false
) returns public.commission_calculations
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_invoice public.invoices;
  v_business public.businesses;
  v_caller_membership_id uuid;
  v_rule public.commission_rules;
  v_amount numeric;
  v_margin numeric;
  v_total_qty numeric;
  v_row public.commission_calculations;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'invoice_not_found: %', p_invoice_id; end if;
  if not public.caller_has_capability(v_invoice.business_id, 'commission', 'capture') then
    raise exception 'not_authorized: requires capture on commission';
  end if;
  select * into v_business from public.businesses where id = v_invoice.business_id;
  if v_invoice.status <> v_business.commission_trigger_status then
    raise exception 'invoice_has_not_reached_the_configured_commission_trigger_status: invoice is % but trigger is %',
      v_invoice.status, v_business.commission_trigger_status;
  end if;
  if v_invoice.agent_party_id is null then
    raise exception 'invoice_has_no_assigned_agent: call assign_invoice_agent first';
  end if;
  if exists (select 1 from public.commission_calculations where invoice_id = p_invoice_id) then
    raise exception 'commission_already_computed_for_this_invoice: %', p_invoice_id;
  end if;

  select * into v_rule from public.commission_rules
  where business_id = v_invoice.business_id and applies_to_party_id = v_invoice.agent_party_id
  order by created_at desc limit 1;
  if not found then
    select * into v_rule from public.commission_rules
    where business_id = v_invoice.business_id and applies_to_party_id is null
    order by created_at desc limit 1;
  end if;
  if not found then
    raise exception 'no_commission_rule_found_for_agent_or_business_default: %', v_invoice.agent_party_id;
  end if;

  if v_rule.basis = 'percent_of_invoice' then
    v_amount := round(v_invoice.grand_total * v_rule.rate, 2);
  elsif v_rule.basis = 'percent_of_margin' then
    select coalesce(sum(il.line_total - (il.unit_cost * il.quantity)), 0) into v_margin
    from public.invoice_lines il where il.invoice_id = p_invoice_id;
    v_amount := round(greatest(v_margin, 0) * v_rule.rate, 2);
  elsif v_rule.basis = 'flat_per_unit' then
    select coalesce(sum(il.quantity), 0) into v_total_qty
    from public.invoice_lines il where il.invoice_id = p_invoice_id;
    v_amount := round(v_total_qty * v_rule.rate, 2);
  else
    raise exception 'unrecognised_commission_basis: %', v_rule.basis;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = v_invoice.business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.commission_calculations (business_id, invoice_id, agent_party_id, commission_rule_id, amount)
  values (v_invoice.business_id, p_invoice_id, v_invoice.agent_party_id, v_rule.id, v_amount)
  returning * into v_row;

  perform public.create_approval_task(
    v_invoice.business_id, 'commission', 'commission_calculation', v_row.id, v_amount,
    coalesce(p_ai_draft_summary, 'Commission (' || v_rule.basis || ') for invoice ' || v_invoice.invoice_no || ': ' || v_amount),
    null, v_caller_membership_id, p_auto_approved, null
  );

  return v_row;
end;
$$;

grant execute on function public.compute_commission_for_invoice(uuid, text, boolean) to authenticated;

create or replace function public.sync_commission_calculation_on_task_decision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.subject_type <> 'commission_calculation' or old.status is not distinct from new.status then
    return new;
  end if;
  if new.status in ('approved', 'auto_approved') then
    update public.commission_calculations set status = 'approved' where id = new.subject_id and status = 'computed';
  elsif new.status = 'rejected' then
    delete from public.commission_calculations where id = new.subject_id and status = 'computed'; -- see header note 6
  end if;
  return new;
end;
$$;
create trigger trg_sync_commission_calculation_on_task_decision
  after update on public.approval_tasks
  for each row execute function public.sync_commission_calculation_on_task_decision();

create or replace function public.mark_commission_paid(p_commission_calculation_id uuid)
returns public.commission_calculations
language plpgsql security definer set search_path = public, auth
as $$
declare v_row public.commission_calculations;
begin
  select * into v_row from public.commission_calculations where id = p_commission_calculation_id for update;
  if not found then raise exception 'commission_calculation_not_found: %', p_commission_calculation_id; end if;
  if not public.caller_has_capability(v_row.business_id, 'commission', 'capture') then
    raise exception 'not_authorized: requires capture on commission';
  end if;
  if v_row.status <> 'approved' then
    raise exception 'commission_calculation_not_approved: current status %', v_row.status;
  end if;

  update public.commission_calculations set status = 'paid' where id = p_commission_calculation_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.mark_commission_paid(uuid) to authenticated;

-- ------------------------------------------------------------
-- 5. create_payroll_run — re-defined to fold approved OvertimeRecords
-- into gross_pay (see header note 4), extending Sprint 34's version.
-- Everything else about this function is unchanged from Sprint 34.
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
  v_overtime_hours numeric;
  v_overtime_pay numeric;
  v_hourly_rate numeric;
  v_gross_pay numeric;
  v_net numeric;
  v_total numeric := 0;
  v_period_end date;
  v_period_start date;
begin
  if not public.caller_has_capability(p_business_id, 'payroll', 'capture') then
    raise exception 'not_authorized: requires capture on payroll';
  end if;
  if p_period is null or p_period !~ '^\d{4}-\d{2}$' then
    raise exception 'invalid_period_format: expected YYYY-MM, got %', p_period;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  v_period_start := to_date(p_period, 'YYYY-MM');
  v_period_end := (v_period_start + interval '1 month' - interval '1 day')::date;

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
    -- Overtime: sum approved, not-yet-synced OvertimeRecords within this period (see header note 4).
    select coalesce(sum(hours), 0) into v_overtime_hours from public.overtime_records
    where employee_party_id = v_emp.employee_party_id and status = 'approved'
      and date >= v_period_start and date <= v_period_end;

    v_hourly_rate := v_emp.basic_salary / (26 * 8);
    v_overtime_pay := round(v_overtime_hours * v_hourly_rate * 1.5, 2);
    v_gross_pay := v_emp.basic_salary + v_overtime_pay;

    select * into v_stat from public.compute_statutory_deductions(v_gross_pay, v_period_end);

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

    v_net := v_gross_pay - v_stat.epf_employee - v_stat.socso_employee - v_stat.eis_employee
      - v_stat.pcb_deduction + v_claims_total - v_advance_total;

    insert into public.payslips (
      payroll_run_id, employee_party_id, gross_pay, epf_employee, epf_employer,
      socso_employee, socso_employer, eis_employee, eis_employer, pcb_deduction,
      claims_included, advance_deducted, net_pay
    ) values (
      v_row.id, v_emp.employee_party_id, v_gross_pay, v_stat.epf_employee, v_stat.epf_employer,
      v_stat.socso_employee, v_stat.socso_employer, v_stat.eis_employee, v_stat.eis_employer, v_stat.pcb_deduction,
      v_claims_total, v_advance_total, v_net
    );

    update public.overtime_records set status = 'synced_to_payroll'
    where employee_party_id = v_emp.employee_party_id and status = 'approved'
      and date >= v_period_start and date <= v_period_end;

    v_total := v_total + v_net;
  end loop;

  update public.payroll_runs set total_net_pay = v_total where id = v_row.id returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_payroll_run(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 6. revenue_vs_cost_dashboard — read model, no new storage (Vol
-- 13_0 §11 — see header note 9).
-- ------------------------------------------------------------
create or replace function public.revenue_vs_cost_dashboard(
  p_business_id uuid, p_date_from date, p_date_to date
) returns table (
  revenue numeric, payroll_cost numeric, commission_cost numeric, net numeric
)
language plpgsql security definer set search_path = public, auth
as $$
declare v_revenue numeric; v_payroll_cost numeric; v_commission_cost numeric;
begin
  if not public.caller_has_capability(p_business_id, 'accounting_reports', 'view') then
    raise exception 'not_authorized: requires view on accounting_reports';
  end if;

  select coalesce(sum(grand_total), 0) into v_revenue from public.invoices
  where business_id = p_business_id and status not in ('draft', 'cancelled')
    and issue_date >= p_date_from and issue_date <= p_date_to;

  select coalesce(sum(total_net_pay), 0) into v_payroll_cost from public.payroll_runs
  where business_id = p_business_id and status in ('approved', 'paid')
    and to_date(period, 'YYYY-MM') >= date_trunc('month', p_date_from)
    and to_date(period, 'YYYY-MM') <= date_trunc('month', p_date_to);

  select coalesce(sum(amount), 0) into v_commission_cost from public.commission_calculations
  where business_id = p_business_id and status in ('approved', 'paid')
    and created_at::date >= p_date_from and created_at::date <= p_date_to;

  return query select v_revenue, v_payroll_cost, v_commission_cost, v_revenue - v_payroll_cost - v_commission_cost;
end;
$$;

grant execute on function public.revenue_vs_cost_dashboard(uuid, date, date) to authenticated;

-- End of Sprint 35 migration.
