-- ==============================================================
-- AIFA backend schema — Sprint 25 (Vol 13_1 §5-6; Vol 13_2 full;
-- Vol 13_3 §3's solo_self_resolved extension).
--
-- Delegated, SoD-Aware Approval Engine & Role-Gated Capture. This is
-- the generic ApprovalTask resolution engine every future Vol 13_0
-- module sprint (starting Sprint 26) depends on, plus the capture
-- attribution/permission gate and Segregation-of-Duties policy layer
-- Vol 13_2 requires now that capture is no longer owner-only.
--
-- A genuine architecture note, disclosed up front rather than
-- discovered mid-migration: `ApprovalTask` did not exist as a real
-- table before this sprint — Vol 13_0 §3.3 and Vol 13_1 §6 only ever
-- specified its shape on paper. This migration creates it fresh from
-- Vol 13_1 §6's revised spec; "revised" in that section's own title
-- refers to superseding the *paper* design, not an existing table.
--
-- A second, more consequential architecture note: `BusinessEvent`
-- (Vol 13_2 §2) is likewise not a standalone Postgres table today — it
-- is one of `sync_envelopes.entity_type`'s encrypted payload shapes
-- (Vol 13_1 §8's Path A local-first model), so its fields normally
-- live inside `payload_ciphertext`, unreadable server-side by design.
-- Vol 13_2 §2's two new fields (`captured_by_membership_id`,
-- `capture_channel`) are exactly the fields Section 4's
-- Segregation-of-Duties control and Section 5's audit trail need to
-- read server-side without decrypting anything — so this migration
-- adds them to `sync_envelopes` as plaintext metadata columns
-- (entity_type = 'business_event' rows only), the same treatment
-- `business_id`/`device_id` already get alongside the same ciphertext
-- payload. This is additive and forward-compatible: whenever a future
-- sprint gives `BusinessEvent` its own first-class table, these two
-- columns carry over unchanged. The capture-permission gate (Section
-- 3) is correspondingly implemented as a pipeline-side RPC
-- (`check_capture_permission`, called by `capturePipeline.ts` before
-- an event is even encrypted) rather than a DB constraint on
-- ciphertext, matching how Vol 13_2 §3 itself describes the gate
-- ("today, any input reaching capturePipeline.ts is processed
-- unconditionally" — a pipeline-stage problem, not an RLS one).
--
-- Owner decision recorded (3 September 2026, this sprint): a solo
-- (one-person) business's payroll runs resolve via
-- `solo_self_resolved` exactly like every other domain — Vol 13_0
-- §10's "payroll never auto-approves" rule targets AI-confidence
-- bypass (Section 8 below still hard-bars that path unconditionally),
-- not a sole owner's own act of capturing-and-confirming their own
-- payroll run, which Vol 13_3 §3 requires to stay byte-for-byte
-- identical to pre-Series-13 behaviour.
-- ==============================================================

-- ------------------------------------------------------------
-- 1. public.approval_delegations (Vol 13_1 §5).
-- ------------------------------------------------------------
create table if not exists public.approval_delegations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  delegator_membership_id uuid not null references public.business_memberships (id),
  delegate_membership_id uuid not null references public.business_memberships (id),
  domain_scope text check (domain_scope in (
    'sales', 'pricing', 'expense', 'inventory', 'accounting_reports',
    'tax_compliance', 'payroll', 'hr_attendance_leave', 'commission',
    'legal_contract', 'settings'
  )),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  reason text,
  created_by_membership_id uuid not null references public.business_memberships (id),
  status text not null default 'active' check (status in ('active', 'expired', 'revoked')),
  constraint approval_delegations_not_self check (delegator_membership_id <> delegate_membership_id),
  constraint approval_delegations_valid_window check (ends_at is null or ends_at > starts_at)
);

create index if not exists idx_approval_delegations_delegator_active
  on public.approval_delegations (delegator_membership_id)
  where status = 'active';

create index if not exists idx_approval_delegations_business
  on public.approval_delegations (business_id);

alter table public.approval_delegations enable row level security;

create policy "Active members can view their business's delegations"
  on public.approval_delegations for select
  using (public.is_active_member(business_id));

-- ------------------------------------------------------------
-- 2. public.segregation_of_duties_policies (Vol 13_2 §4.3).
-- ------------------------------------------------------------
create table if not exists public.segregation_of_duties_policies (
  business_id uuid not null references public.businesses (id) on delete cascade,
  domain text not null check (domain in (
    'sales', 'pricing', 'expense', 'inventory', 'accounting_reports',
    'tax_compliance', 'payroll', 'hr_attendance_leave', 'commission',
    'legal_contract', 'settings'
  )),
  enforce_maker_checker boolean not null default true,
  amount_threshold_myr numeric(14, 2),
  allow_self_approval_if_sole_eligible boolean not null default true,
  primary key (business_id, domain)
);

alter table public.segregation_of_duties_policies enable row level security;

create policy "Active members can view their business's SoD policies"
  on public.segregation_of_duties_policies for select
  using (public.is_active_member(business_id));

-- Owner-adjustable per §4.3's own text ("owner-adjustable afterward via
-- the settings domain configure capability") — same authorization
-- pattern as set_access_model_override/invite_member.
create or replace function public.set_sod_policy(
  p_business_id uuid,
  p_domain text,
  p_enforce_maker_checker boolean,
  p_amount_threshold_myr numeric,
  p_allow_self_approval_if_sole_eligible boolean
) returns public.segregation_of_duties_policies
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_membership record;
  v_can_configure boolean;
  v_row public.segregation_of_duties_policies;
begin
  select bm.id as membership_id, bm.role_id as role_id into v_membership
  from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if v_membership.membership_id is null then
    raise exception 'no_active_membership_for_this_business';
  end if;

  select exists (
    select 1 from public.role_permissions rp
    where rp.role_id = v_membership.role_id
      and rp.domain = 'settings' and rp.capability = 'configure'
  ) into v_can_configure;

  if not v_can_configure then
    raise exception 'not_authorized: requires configure on settings';
  end if;

  insert into public.segregation_of_duties_policies (
    business_id, domain, enforce_maker_checker, amount_threshold_myr,
    allow_self_approval_if_sole_eligible
  ) values (
    p_business_id, p_domain, p_enforce_maker_checker, p_amount_threshold_myr,
    p_allow_self_approval_if_sole_eligible
  )
  on conflict (business_id, domain) do update set
    enforce_maker_checker = excluded.enforce_maker_checker,
    amount_threshold_myr = excluded.amount_threshold_myr,
    allow_self_approval_if_sole_eligible = excluded.allow_self_approval_if_sole_eligible
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.set_sod_policy(uuid, text, boolean, numeric, boolean) to authenticated;

-- Seeding — fires exactly once, at the moment identified by Sprint 24's
-- own transition-log hook (business_access_model_transitions,
-- trigger_reason = 'membership_accepted', transitioned_to = 'team'),
-- the first time it happens for a business. §4.3's resolved defaults:
-- expense RM 500 / sales RM 2,000 thresholds, enforce_maker_checker
-- true for sales/expense/payroll/legal_contract (payroll/legal_contract
-- with no threshold — every transaction gated), false for
-- hr_attendance_leave/inventory. The remaining domains (pricing,
-- accounting_reports, tax_compliance, commission, settings) are not
-- named in §4.3's worked examples; seeded here with the same
-- control-first default (`enforce_maker_checker = true`, no threshold)
-- the table's own column default already uses, so every domain has an
-- explicit, owner-visible, owner-adjustable row rather than an implicit
-- gap for the five unnamed ones.
create or replace function public.seed_sod_policies_on_first_team_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.transitioned_to = 'team' and not exists (
    select 1 from public.business_access_model_transitions
    where business_id = new.business_id
      and transitioned_to = 'team'
      and id <> new.id
  ) then
    insert into public.segregation_of_duties_policies (
      business_id, domain, enforce_maker_checker, amount_threshold_myr,
      allow_self_approval_if_sole_eligible
    )
    select new.business_id, v.domain, v.enforce, v.threshold, true
    from (values
      ('sales', true, 2000.00),
      ('expense', true, 500.00),
      ('payroll', true, null::numeric),
      ('legal_contract', true, null::numeric),
      ('hr_attendance_leave', false, null::numeric),
      ('inventory', false, null::numeric),
      ('pricing', true, null::numeric),
      ('accounting_reports', true, null::numeric),
      ('tax_compliance', true, null::numeric),
      ('commission', true, null::numeric),
      ('settings', true, null::numeric)
    ) as v(domain, enforce, threshold)
    on conflict (business_id, domain) do nothing;
  end if;
  return new;
end;
$$;

create trigger trg_seed_sod_policies_on_first_team_transition
  after insert on public.business_access_model_transitions
  for each row execute function public.seed_sod_policies_on_first_team_transition();

-- ------------------------------------------------------------
-- 3. public.approval_tasks (Vol 13_1 §6, revised/created fresh — see
-- header note). `resolved_via` gains two values beyond Vol 13_1 §6's
-- own four: `solo_self_resolved` (Vol 13_3 §3, this sprint's own
-- extension) and `blocked_awaiting_reviewer` (this sprint's own
-- addition — Vol 13_2 §4.3's escape valve names the *behaviour*
-- "blocks the transaction entirely until a second person is added"
-- but Vol 13_1 §6 was written before that blocking outcome existed as
-- a case to represent; disclosed here rather than silently folded into
-- an existing value it doesn't actually match).
-- ------------------------------------------------------------
create table if not exists public.approval_tasks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  domain text not null check (domain in (
    'sales', 'pricing', 'expense', 'inventory', 'accounting_reports',
    'tax_compliance', 'payroll', 'hr_attendance_leave', 'commission',
    'legal_contract', 'settings'
  )),
  subject_type text not null,
  subject_id uuid not null,
  amount numeric(14, 2),
  ai_draft_summary text,
  ai_confidence numeric(5, 4),
  captured_by_membership_id uuid references public.business_memberships (id),
  assigned_membership_id uuid references public.business_memberships (id),
  resolved_via text not null check (resolved_via in (
    'direct_permission', 'delegation', 'escalation', 'auto_approved',
    'solo_self_resolved', 'blocked_awaiting_reviewer'
  )),
  delegated_from_membership_id uuid references public.business_memberships (id),
  status text not null default 'pending_approval' check (status in (
    'pending_approval', 'approved', 'rejected', 'auto_approved'
  )),
  decided_by_membership_id uuid references public.business_memberships (id),
  decided_at timestamptz,
  next_action text,
  self_approved_via_escape_valve boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_approval_tasks_business_status
  on public.approval_tasks (business_id, status);

create index if not exists idx_approval_tasks_assigned
  on public.approval_tasks (assigned_membership_id)
  where status = 'pending_approval';

alter table public.approval_tasks enable row level security;

-- Visibility: any active member can see every task in their business
-- (matches Section 7/§5's "a report over this table" framing — the
-- fine-grained "who should see this in their queue today" filter is a
-- UI concern layered on top of this broad read policy, not an RLS
-- concern; no ApprovalTask/approval UI exists yet, same disclosed
-- deferral Sprint 24 recorded for Team/Roles screens).
create policy "Active members can view their business's approval tasks"
  on public.approval_tasks for select
  using (public.is_active_member(business_id));

-- No direct insert/update policy: every row is created and mutated
-- exclusively through the SECURITY DEFINER functions below, the same
-- convention business_memberships/devices already established.

-- ------------------------------------------------------------
-- 4. BusinessEvent capture attribution (Vol 13_2 §2) — see header note
-- on why these land on sync_envelopes rather than a standalone table.
-- ------------------------------------------------------------
alter table public.sync_envelopes
  add column if not exists captured_by_membership_id uuid references public.business_memberships (id);

alter table public.sync_envelopes
  add column if not exists capture_channel text
    check (capture_channel in ('mobile_app', 'web_app', 'api'));

create index if not exists idx_sync_envelopes_captured_by
  on public.sync_envelopes (captured_by_membership_id)
  where captured_by_membership_id is not null;

-- Defense in depth: even though payload_ciphertext can't be validated
-- server-side, this plaintext attribution metadata can be — a caller
-- cannot stamp an envelope as captured by a membership that isn't
-- their own active membership on this business (no forging capture
-- attribution for someone else).
create or replace function public.enforce_own_capture_attribution()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.captured_by_membership_id is not null then
    if not exists (
      select 1 from public.business_memberships bm
      where bm.id = new.captured_by_membership_id
        and bm.business_id = new.business_id
        and bm.user_id = auth.uid()
        and bm.status = 'active'
    ) then
      raise exception 'captured_by_membership_id_must_be_callers_own_active_membership';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_enforce_own_capture_attribution
  before insert on public.sync_envelopes
  for each row execute function public.enforce_own_capture_attribution();

-- ------------------------------------------------------------
-- 5. Capture-permission gate (Vol 13_2 §3) — a pipeline-callable RPC,
-- run before capturePipeline.ts's AI pipeline processes anything.
-- Resolves the caller's own active membership internally (same
-- established pattern as the devices RPCs), maps domain_hint -> Domain
-- per §3's table, and raises a clear, specific error rather than
-- silently swallowing the request.
-- ------------------------------------------------------------
create or replace function public.map_domain_hint(p_domain_hint text)
returns text
language sql
immutable
as $$
  select case p_domain_hint
    when 'sale' then 'sales'
    when 'purchase' then 'purchase'
    when 'expense' then 'expense'
    when 'banking' then 'accounting_reports'
    else null
  end;
$$;

create or replace function public.check_capture_permission(
  p_business_id uuid,
  p_domain_hint text
) returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_membership record;
  v_domain text;
  v_can_capture boolean;
begin
  select bm.id as membership_id, bm.role_id as role_id into v_membership
  from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if v_membership.membership_id is null then
    raise exception 'no_active_membership_for_this_business';
  end if;

  v_domain := public.map_domain_hint(p_domain_hint);

  if v_domain is null then
    raise exception 'unclassified_domain_hint_cannot_be_captured: %', p_domain_hint;
  end if;

  select exists (
    select 1 from public.role_permissions rp
    where rp.role_id = v_membership.role_id
      and rp.domain = v_domain and rp.capability = 'capture'
  ) into v_can_capture;

  if not v_can_capture then
    raise exception 'not_authorized_to_capture: no capture access to %', v_domain;
  end if;

  return v_membership.membership_id;
end;
$$;

grant execute on function public.check_capture_permission(uuid, text) to authenticated;
grant execute on function public.map_domain_hint(text) to authenticated;

-- ------------------------------------------------------------
-- 6. Resolution engine (Vol 13_1 §6.1, Vol 13_2 §4.1/§4.3, Vol 13_3
-- §3). `resolve_approval_task` is the pure resolver — safe to call
-- repeatedly against a still-`pending_approval` task (re-run when a
-- relevant delegation starts/ends, per §6.1's own instruction).
-- `create_approval_task` is the entry point every future module sprint
-- calls once, at task creation.
-- ------------------------------------------------------------
create or replace function public.resolve_approval_task(p_task_id uuid)
returns public.approval_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.approval_tasks;
  v_business_id uuid;
  v_access_model text;
  v_policy public.segregation_of_duties_policies;
  v_sod_applies boolean := false;
  v_excluded_id uuid := null;
  v_owner_membership_id uuid;
  v_eligible_raw uuid[];
  v_eligible_filtered uuid[];
  v_delegate_candidates uuid[];
  v_delegated_from uuid;
  v_candidates uuid[];
  v_resolved_via text;
  v_assigned uuid;
  v_next_action text := null;
  v_escape_valve_invoked boolean := false;
begin
  select * into v_task from public.approval_tasks where id = p_task_id for update;
  if not found then
    raise exception 'approval_task_not_found: %', p_task_id;
  end if;
  if v_task.status <> 'pending_approval' then
    -- Already decided or otherwise terminal — nothing to (re-)resolve.
    return v_task;
  end if;

  v_business_id := v_task.business_id;
  v_access_model := public.effective_access_model(v_business_id);

  -- Vol 13_3 §3: a solo business resolves and confirms in the same
  -- transaction, no separate review step, in every domain including
  -- payroll (owner decision, 3 September 2026 — see this file's header).
  if v_access_model = 'solo' then
    update public.approval_tasks set
      resolved_via = 'solo_self_resolved',
      assigned_membership_id = v_task.captured_by_membership_id,
      status = 'approved',
      decided_by_membership_id = v_task.captured_by_membership_id,
      decided_at = now(),
      self_approved_via_escape_valve = false
    where id = p_task_id
    returning * into v_task;
    return v_task;
  end if;

  select id into v_owner_membership_id
  from public.business_memberships
  where business_id = v_business_id
    and status = 'active'
    and role_id = '00000000-0000-0000-0000-000000000001';

  -- Vol 13_2 §4.1/§4.3: does SoD's maker-exclusion apply to this
  -- domain/amount right now?
  select * into v_policy
  from public.segregation_of_duties_policies
  where business_id = v_business_id and domain = v_task.domain;

  if found and v_policy.enforce_maker_checker
     and v_task.captured_by_membership_id is not null
     and (v_task.amount is null or v_policy.amount_threshold_myr is null
          or v_task.amount >= v_policy.amount_threshold_myr) then
    v_sod_applies := true;
    v_excluded_id := v_task.captured_by_membership_id;
  end if;

  -- Step 1: eligible-by-permission-and-limit set.
  select coalesce(array_agg(bm.id), array[]::uuid[]) into v_eligible_raw
  from public.business_memberships bm
  join public.role_permissions rp on rp.role_id = bm.role_id
  where bm.business_id = v_business_id
    and bm.status = 'active'
    and rp.domain = v_task.domain
    and rp.capability = 'approve'
    and (
      v_task.amount is null
      or coalesce(bm.approval_limit_myr, (select r.default_approval_limit_myr from public.roles r where r.id = bm.role_id)) is null
      or coalesce(bm.approval_limit_myr, (select r.default_approval_limit_myr from public.roles r where r.id = bm.role_id)) >= v_task.amount
    );

  if v_sod_applies then
    select coalesce(array_agg(x), array[]::uuid[]) into v_eligible_filtered
    from unnest(v_eligible_raw) as x where x <> v_excluded_id;
  else
    v_eligible_filtered := v_eligible_raw;
  end if;

  if array_length(v_eligible_filtered, 1) > 0 then
    v_resolved_via := 'direct_permission';
    v_candidates := v_eligible_filtered;
  elsif v_sod_applies and array_length(v_eligible_raw, 1) = 1 and v_eligible_raw[1] = v_excluded_id then
    -- Vol 13_2 §4.2/§4.3: the maker was the *only* eligible approver.
    -- The escape valve decides self-approval vs. block.
    if v_policy.allow_self_approval_if_sole_eligible then
      v_resolved_via := 'direct_permission';
      v_candidates := array[v_excluded_id];
      v_escape_valve_invoked := true;
    else
      v_resolved_via := 'blocked_awaiting_reviewer';
      v_candidates := array[]::uuid[];
      v_next_action := 'Blocked: excluding the capturer leaves no eligible approver for ' || v_task.domain ||
        '. Ask an Owner to add a second approver, raise the SoD threshold, or enable self-approval for this domain.';
    end if;
  else
    -- Step 2: delegation lookup among members ineligible purely by
    -- limit (they have approve on this domain, just not a high enough
    -- one) — Vol 13_1 §6.1 Step 2.
    select coalesce(array_agg(d.delegate_membership_id), array[]::uuid[]) into v_delegate_candidates
    from public.business_memberships bm
    join public.role_permissions rp on rp.role_id = bm.role_id
    join public.approval_delegations d
      on d.delegator_membership_id = bm.id
      and d.status = 'active'
      and now() >= d.starts_at
      and (d.ends_at is null or now() < d.ends_at)
      and (d.domain_scope is null or d.domain_scope = v_task.domain)
    -- The delegate is NOT required to independently hold `approve` on
    -- this domain via their own role — Vol 13_1 §5 is explicit that
    -- delegation moves *whose queue* a task lands in, exercising the
    -- delegator's own permission grant, narrowed only by domain_scope
    -- and by whichever of the two has the lower approval_limit_myr. A
    -- delegate who happens to also hold their own approve grant on the
    -- domain is not treated any differently.
    join public.business_memberships delegate_bm on delegate_bm.id = d.delegate_membership_id
    where bm.business_id = v_business_id
      and bm.status = 'active'
      and rp.domain = v_task.domain
      and rp.capability = 'approve'
      and v_task.amount is not null
      and coalesce(bm.approval_limit_myr, (select r.default_approval_limit_myr from public.roles r where r.id = bm.role_id)) is not null
      and coalesce(bm.approval_limit_myr, (select r.default_approval_limit_myr from public.roles r where r.id = bm.role_id)) < v_task.amount
      and delegate_bm.status = 'active'
      and (
        v_task.amount is null
        or coalesce(delegate_bm.approval_limit_myr, (select r.default_approval_limit_myr from public.roles r where r.id = delegate_bm.role_id)) is null
        or coalesce(delegate_bm.approval_limit_myr, (select r.default_approval_limit_myr from public.roles r where r.id = delegate_bm.role_id)) >= v_task.amount
      )
      and (not v_sod_applies or d.delegate_membership_id <> v_excluded_id);

    if array_length(v_delegate_candidates, 1) > 0 then
      v_resolved_via := 'delegation';
      v_candidates := v_delegate_candidates;
      if array_length(v_delegate_candidates, 1) = 1 then
        select d.delegator_membership_id into v_delegated_from
        from public.approval_delegations d
        where d.delegate_membership_id = v_delegate_candidates[1]
          and d.status = 'active'
          and now() >= d.starts_at and (d.ends_at is null or now() < d.ends_at)
          and (d.domain_scope is null or d.domain_scope = v_task.domain)
        limit 1;
      end if;
    else
      -- Step 3: escalate to Owner — "never leave a task with nowhere
      -- to go" (Vol 13_1 §6.1 Step 3), exempt from SoD exclusion, since
      -- the Owner fallback is the guaranteed-to-exist last resort.
      if v_owner_membership_id is null then
        raise exception 'no_active_owner_membership_to_escalate_to: %', v_business_id;
      end if;
      v_resolved_via := 'escalation';
      v_candidates := array[v_owner_membership_id];
      if v_sod_applies and v_owner_membership_id = v_task.captured_by_membership_id then
        -- SoD wanted to exclude the maker, but the guaranteed Owner
        -- fallback (Step 3) landed right back on them — still an
        -- escape-valve outcome, just reached via escalation rather
        -- than the explicit sole-eligible branch above.
        v_escape_valve_invoked := true;
      end if;
    end if;
  end if;

  if array_length(v_candidates, 1) = 1 then
    v_assigned := v_candidates[1];
  else
    v_assigned := null;
  end if;

  update public.approval_tasks set
    resolved_via = v_resolved_via,
    assigned_membership_id = v_assigned,
    delegated_from_membership_id = case when v_resolved_via = 'delegation' then v_delegated_from else null end,
    next_action = v_next_action,
    -- Vol 13_2 §5: flag set only when the escape valve mechanism was
    -- actually what let this resolve to self-approval (SoD wanted to
    -- exclude the maker, and either the sole-eligible branch or the
    -- Owner-escalation fallback put it right back on them) — NOT for
    -- the ordinary case of a maker who is simply, unexceptionally,
    -- also a valid approver (e.g. below SoD's amount_threshold_myr, or
    -- no SoD policy in force for this domain at all), which is not an
    -- escape-valve outcome and would mislabel every routine below-
    -- threshold self-approval as a control exception if flagged blindly.
    self_approved_via_escape_valve = v_escape_valve_invoked
  where id = p_task_id
  returning * into v_task;

  return v_task;
end;
$$;

grant execute on function public.resolve_approval_task(uuid) to authenticated;

-- create_approval_task: the entry point every future module sprint
-- calls. p_auto_approved is Vol 13_0 §3.3's existing AI-confidence
-- shortcut (unchanged, Vol 13_1 §6.1 Step 5) — bypasses the resolution
-- algorithm entirely, EXCEPT payroll, which this function hard-bars
-- from that path unconditionally (Vol 13_0 §10, reaffirmed every
-- sprint this has come up) — a DB-level backstop behind whatever
-- caller-side check already exists, the same belt-and-braces pattern
-- as enforce_sole_owner_membership.
create or replace function public.create_approval_task(
  p_business_id uuid,
  p_domain text,
  p_subject_type text,
  p_subject_id uuid,
  p_amount numeric,
  p_ai_draft_summary text,
  p_ai_confidence numeric,
  p_captured_by_membership_id uuid,
  p_auto_approved boolean default false
) returns public.approval_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.approval_tasks;
begin
  if p_auto_approved and p_domain = 'payroll' then
    raise exception 'payroll_never_auto_approves: Vol 13_0 §10 bars payroll from resolved_via = auto_approved regardless of AI confidence';
  end if;

  if p_auto_approved then
    insert into public.approval_tasks (
      business_id, domain, subject_type, subject_id, amount,
      ai_draft_summary, ai_confidence, captured_by_membership_id,
      resolved_via, status, decided_at
    ) values (
      p_business_id, p_domain, p_subject_type, p_subject_id, p_amount,
      p_ai_draft_summary, p_ai_confidence, p_captured_by_membership_id,
      'auto_approved', 'auto_approved', now()
    )
    returning * into v_row;
    return v_row;
  end if;

  insert into public.approval_tasks (
    business_id, domain, subject_type, subject_id, amount,
    ai_draft_summary, ai_confidence, captured_by_membership_id,
    resolved_via, status
  ) values (
    p_business_id, p_domain, p_subject_type, p_subject_id, p_amount,
    p_ai_draft_summary, p_ai_confidence, p_captured_by_membership_id,
    'escalation', -- placeholder, overwritten by resolve_approval_task below
    'pending_approval'
  )
  returning * into v_row;

  return public.resolve_approval_task(v_row.id);
end;
$$;

grant execute on function public.create_approval_task(uuid, text, text, uuid, numeric, text, numeric, uuid, boolean) to authenticated;

-- decide_approval_task: the approve/reject action. Callable by the
-- assigned member, or — for an open shared queue (assigned_membership_id
-- is null) — by any currently-eligible member; the first to act wins,
-- per §6.1 Step 4's "shared queue" behaviour, and a losing racer gets a
-- clear "already actioned by X" error rather than a stale button.
create or replace function public.decide_approval_task(
  p_task_id uuid,
  p_decision text
) returns public.approval_tasks
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_task public.approval_tasks;
  v_caller_membership_id uuid;
  v_can_approve boolean;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid_decision: must be approved or rejected';
  end if;

  select * into v_task from public.approval_tasks where id = p_task_id for update;
  if not found then
    raise exception 'approval_task_not_found: %', p_task_id;
  end if;
  if v_task.status <> 'pending_approval' then
    raise exception 'already_actioned_by_another_approver: current status %', v_task.status;
  end if;

  select bm.id into v_caller_membership_id
  from public.business_memberships bm
  where bm.business_id = v_task.business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if v_caller_membership_id is null then
    raise exception 'no_active_membership_for_this_business';
  end if;

  if v_task.assigned_membership_id is not null then
    if v_caller_membership_id <> v_task.assigned_membership_id then
      raise exception 'not_the_assigned_approver';
    end if;
  else
    -- Open queue: caller must actually be eligible right now (re-derive
    -- the same permission+limit check resolve_approval_task uses,
    -- rather than trusting the client).
    select exists (
      select 1 from public.role_permissions rp
      where rp.role_id = (select role_id from public.business_memberships where id = v_caller_membership_id)
        and rp.domain = v_task.domain and rp.capability = 'approve'
    ) into v_can_approve;
    if not v_can_approve then
      raise exception 'not_eligible_to_decide_this_task';
    end if;
  end if;

  update public.approval_tasks set
    status = p_decision,
    decided_by_membership_id = v_caller_membership_id,
    decided_at = now(),
    assigned_membership_id = coalesce(assigned_membership_id, v_caller_membership_id)
  where id = p_task_id
  returning * into v_task;

  return v_task;
end;
$$;

grant execute on function public.decide_approval_task(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 7. Delegation lifecycle RPCs (Vol 13_1 §5) — self-service for one's
-- own membership (a member covering their own leave), or configure-on-
-- settings for arranging someone else's (e.g. an Owner covering a
-- Bookkeeper's leave). Creating/revoking a delegation re-runs
-- resolution on every still-pending task the change could affect, per
-- §6.1's own instruction ("re-run if it is still pending_approval when
-- a relevant ApprovalDelegation starts or ends").
-- ------------------------------------------------------------
create or replace function public.create_approval_delegation(
  p_business_id uuid,
  p_delegator_membership_id uuid,
  p_delegate_membership_id uuid,
  p_domain_scope text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text
) returns public.approval_delegations
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_can_configure boolean;
  v_row public.approval_delegations;
begin
  select bm.id into v_caller_membership_id
  from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if v_caller_membership_id is null then
    raise exception 'no_active_membership_for_this_business';
  end if;

  if v_caller_membership_id <> p_delegator_membership_id then
    select exists (
      select 1 from public.role_permissions rp
      where rp.role_id = (select role_id from public.business_memberships where id = v_caller_membership_id)
        and rp.domain = 'settings' and rp.capability = 'configure'
    ) into v_can_configure;
    if not v_can_configure then
      raise exception 'not_authorized: can only delegate your own authority, unless you have configure on settings';
    end if;
  end if;

  insert into public.approval_delegations (
    business_id, delegator_membership_id, delegate_membership_id, domain_scope,
    starts_at, ends_at, reason, created_by_membership_id, status
  ) values (
    p_business_id, p_delegator_membership_id, p_delegate_membership_id, p_domain_scope,
    coalesce(p_starts_at, now()), p_ends_at, p_reason, v_caller_membership_id, 'active'
  )
  returning * into v_row;

  perform public.resolve_approval_task(t.id)
  from public.approval_tasks t
  where t.business_id = p_business_id
    and t.status = 'pending_approval'
    and (p_domain_scope is null or t.domain = p_domain_scope);

  return v_row;
end;
$$;

grant execute on function public.create_approval_delegation(uuid, uuid, uuid, text, timestamptz, timestamptz, text) to authenticated;

create or replace function public.revoke_approval_delegation(
  p_delegation_id uuid
) returns public.approval_delegations
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_delegation public.approval_delegations;
  v_caller_membership_id uuid;
  v_can_configure boolean;
begin
  select * into v_delegation from public.approval_delegations where id = p_delegation_id;
  if not found then
    raise exception 'delegation_not_found: %', p_delegation_id;
  end if;

  select bm.id into v_caller_membership_id
  from public.business_memberships bm
  where bm.business_id = v_delegation.business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if v_caller_membership_id is null then
    raise exception 'no_active_membership_for_this_business';
  end if;

  if v_caller_membership_id <> v_delegation.delegator_membership_id then
    select exists (
      select 1 from public.role_permissions rp
      where rp.role_id = (select role_id from public.business_memberships where id = v_caller_membership_id)
        and rp.domain = 'settings' and rp.capability = 'configure'
    ) into v_can_configure;
    if not v_can_configure then
      raise exception 'not_authorized: can only revoke your own delegation, unless you have configure on settings';
    end if;
  end if;

  update public.approval_delegations set status = 'revoked'
  where id = p_delegation_id
  returning * into v_delegation;

  perform public.resolve_approval_task(t.id)
  from public.approval_tasks t
  where t.business_id = v_delegation.business_id
    and t.status = 'pending_approval'
    and (v_delegation.domain_scope is null or t.domain = v_delegation.domain_scope);

  return v_delegation;
end;
$$;

grant execute on function public.revoke_approval_delegation(uuid) to authenticated;

-- End of Sprint 25 migration.
