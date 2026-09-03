-- ==============================================================
-- AIFA backend schema — Sprint 36 (Vol 13_0 §12 Module I: Legal &
-- Commercial, §12.1 Credit Limit Enforcement). Final sprint of the
-- Phase 3 sprint plan.
-- ==============================================================
-- SCOPE NOTES (disclosed):
--
-- 1. e-SIGNATURE PROVIDER (owner decision, asked via AskUserQuestion,
--    not a disclosed implementation detail): Vol 13_0 §14 Open Item 5
--    explicitly deferred vendor selection to "closer to Sprint 36."
--    This session has no live API credentials for any real e-signature
--    vendor (DocuSign, Dropbox Sign, etc.) and cannot fabricate a
--    passing sandbox run and call it verified. Three options were put
--    to the owner: (a) build a provider-agnostic stub now, simulating
--    the full sent->viewed->signed lifecycle server-side, wire in a
--    real vendor later; (b) the owner supplies real credentials now;
--    (c) skip e-signature this sprint entirely, logged as an open
--    gap. **The owner chose (a), provider-agnostic** (not modelled
--    after any single vendor's API shape). `public.e_signature_
--    envelopes.provider` defaults to 'generic'; `create_esignature_
--    envelope` accepts any provider string for forward-compatibility
--    once a real vendor is chosen, but nothing in this migration
--    calls a real external API. DoD item 2 ("verified against the
--    chosen provider") stays explicitly open — see the Sprint 36 doc
--    Outcomes. This mirrors Sprint 33's StubMyInvoisClient posture
--    exactly.
--
-- 2. CONTRACT APPROVAL ROUTING: Vol 13_0 §12's own schema block gives
--    Contract no domain-flow prose (unlike Module H's explicit "routes
--    through the same ApprovalTask table"), but the SoD policy seed
--    (Sprint 25, `seed_sod_policies_on_first_team_transition`) already
--    treats `legal_contract` as threshold-free/always-gated — the
--    same sensitivity tier as `payroll`. Reading that as the intended
--    signal, `create_contract` routes through the same generalised
--    ApprovalTask engine (Vol 13_0 §3.3) every other capture-then-
--    approve action in this schema uses, rather than being treated as
--    raw, ungated capture (like AttendanceRecord). Not literally
--    stated in §12; a reasonable, disclosed extension of the
--    established pattern, not an invented one.
--
-- 3. Contract's own `status` enum (draft | pending_signature | active
--    | expired | terminated) has no `rejected` value, matching the
--    OvertimeRecord/CommissionCalculation precedent from Sprint 35: a
--    rejected Contract's ApprovalTask is DELETED (not given an
--    invented status), since nothing downstream depends on a
--    still-draft contract row. The true rejected decision is fully
--    preserved on the ApprovalTask row itself.
--
-- 4. ContractAlert generation: Vol 13_0 §12 doesn't specify a
--    scheduled/nightly job anywhere in this codebase (there is no
--    background-job runner in this stack at all — every "job" so far,
--    e.g. Sprint 35's overtime derivation, has been an on-demand RPC).
--    A single ContractAlert row (`alert_type` = 'renewal_upcoming' if
--    `auto_renew`, else 'expiring') is generated at `create_contract`
--    time when both `end_date` and `renewal_notice_days` are given,
--    with `trigger_date = end_date - renewal_notice_days` computed
--    once, up front. "Firing" is modelled as `list_due_contract_
--    alerts` surfacing any 'pending' alert whose `trigger_date` has
--    been reached — proving the lead time (not the exact expiry date)
--    is what gates visibility is this sprint's own explicit DoD
--    requirement. That same read function also stamps `notified_at`
--    the first time an alert becomes due, giving that nullable column
--    real meaning ("when the owner was first able to see this") —
--    a disclosed design choice, not literally specified.
--    Auto-generating a follow-up 'expired' alert once `end_date` has
--    actually passed is out of this sprint's scope (the DoD only
--    requires the lead-time firing to be verified) — a real,
--    disclosed gap, not silently assumed complete.
--
-- 5. CREDIT LIMIT ENFORCEMENT (Vol 13_0 §12.1, the plan's one hard
--    system-level blocking gate): implemented inside a new private
--    helper, `public._create_invoice_from_quotation`, called by BOTH
--    the existing `convert_quotation_to_invoice(uuid)` (Sprint 28's
--    own, UNCHANGED public signature — every existing caller keeps
--    working exactly as before, and the gate applies to them too) and
--    a new, separately-named `convert_quotation_to_invoice_with_
--    credit_override(uuid, text)` — the "explicit owner override
--    path" is a distinct RPC an app screen has to deliberately call,
--    gated on `settings`/`configure` (the same Owner-level catch-all
--    capability used elsewhere in this schema for admin overrides),
--    rather than a boolean flag threaded through the normal path where
--    it could be set by accident — the same "no ambient bypass"
--    posture as Sprint 34's payroll auto-approval hard-block. Every
--    override is logged to a new `public.credit_limit_override_log`
--    table (business_id, invoice_id, party_id, the actual figures at
--    the moment of the decision, who did it, an optional reason) —
--    "never a silent, unexplained block," per §12.1's own text, cuts
--    both ways: neither the block NOR the override is silent.
--
-- 6. Effective credit limit resolution: `Party.credit_limit`, UNLESS
--    that party has an 'active'-status Contract with a non-null
--    `credit_limit_override`, in which case the contract's figure
--    takes precedence — literally what §12.1 states. Outstanding
--    balance is computed the same way Sprint 29's `ar_ageing_detail`
--    already does (`sum(outstanding_balance) where status not in
--    ('draft','cancelled','paid')`), a derived, query-time value,
--    never cached — this sprint's own named Risk mitigation, applied
--    directly rather than re-invented.
-- ==============================================================

-- ------------------------------------------------------------
-- 1. public.contracts (Vol 13_0 §12 — see header notes 2-3).
-- ------------------------------------------------------------
create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  counterparty_id uuid not null references public.parties (id),
  contract_type text not null check (contract_type in (
    'distributor_agreement', 'nda', 'employment_contract', 'other'
  )),
  status text not null default 'draft' check (status in (
    'draft', 'pending_signature', 'active', 'expired', 'terminated'
  )),
  start_date date,
  end_date date,
  auto_renew boolean not null default false,
  renewal_notice_days integer,
  document_id uuid references public.documents (id),
  credit_limit_override numeric(14, 2),
  created_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create index if not exists idx_contracts_business on public.contracts (business_id);
create index if not exists idx_contracts_counterparty on public.contracts (counterparty_id);
alter table public.contracts enable row level security;
create policy "Active members with legal_contract view can see contracts"
  on public.contracts for select using (public.caller_has_capability(business_id, 'legal_contract', 'view'));

create or replace function public.create_contract(
  p_business_id uuid, p_counterparty_id uuid, p_contract_type text,
  p_start_date date, p_end_date date, p_auto_renew boolean, p_renewal_notice_days integer,
  p_document_id uuid default null, p_credit_limit_override numeric default null,
  p_ai_draft_summary text default null, p_auto_approved boolean default false
) returns public.contracts
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_row public.contracts;
  v_trigger_date date;
  v_alert_type text;
begin
  if not public.caller_has_capability(p_business_id, 'legal_contract', 'capture') then
    raise exception 'not_authorized: requires capture on legal_contract';
  end if;
  if p_contract_type not in ('distributor_agreement', 'nda', 'employment_contract', 'other') then
    raise exception 'invalid_contract_type: %', p_contract_type;
  end if;
  if not exists (select 1 from public.parties where id = p_counterparty_id and business_id = p_business_id) then
    raise exception 'counterparty_not_found_for_this_business: %', p_counterparty_id;
  end if;
  if p_document_id is not null and not exists (
    select 1 from public.documents where id = p_document_id and business_id = p_business_id
  ) then
    raise exception 'document_not_found_for_this_business: %', p_document_id;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.contracts (
    business_id, counterparty_id, contract_type, start_date, end_date, auto_renew,
    renewal_notice_days, document_id, credit_limit_override, created_by_membership_id
  ) values (
    p_business_id, p_counterparty_id, p_contract_type, p_start_date, p_end_date, p_auto_renew,
    p_renewal_notice_days, p_document_id, p_credit_limit_override, v_caller_membership_id
  ) returning * into v_row;

  -- ContractAlert generation — see header note 4.
  if p_end_date is not null and p_renewal_notice_days is not null then
    v_trigger_date := p_end_date - p_renewal_notice_days;
    v_alert_type := case when p_auto_renew then 'renewal_upcoming' else 'expiring' end;
    insert into public.contract_alerts (contract_id, alert_type, trigger_date)
    values (v_row.id, v_alert_type, v_trigger_date);
  end if;

  perform public.create_approval_task(
    p_business_id, 'legal_contract', 'contract', v_row.id, p_credit_limit_override,
    coalesce(p_ai_draft_summary, 'Contract (' || p_contract_type || ') with counterparty ' || p_counterparty_id),
    null, v_caller_membership_id, p_auto_approved, null
  );

  return v_row;
end;
$$;

grant execute on function public.create_contract(uuid, uuid, text, date, date, boolean, integer, uuid, numeric, text, boolean) to authenticated;

create or replace function public.sync_contract_on_task_decision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.subject_type <> 'contract' or old.status is not distinct from new.status then
    return new;
  end if;
  if new.status in ('approved', 'auto_approved') then
    update public.contracts set status = 'pending_signature' where id = new.subject_id and status = 'draft';
  elsif new.status = 'rejected' then
    delete from public.contracts where id = new.subject_id and status = 'draft'; -- see header note 3
  end if;
  return new;
end;
$$;
create trigger trg_sync_contract_on_task_decision
  after update on public.approval_tasks
  for each row execute function public.sync_contract_on_task_decision();

-- ------------------------------------------------------------
-- 2. public.contract_alerts (Vol 13_0 §12 — see header note 4).
-- ------------------------------------------------------------
create table if not exists public.contract_alerts (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id) on delete cascade,
  alert_type text not null check (alert_type in ('renewal_upcoming', 'expiring', 'expired')),
  trigger_date date not null,
  status text not null default 'pending' check (status in ('pending', 'acknowledged')),
  notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_contract_alerts_contract on public.contract_alerts (contract_id);
alter table public.contract_alerts enable row level security;
create policy "Active members with legal_contract view can see contract alerts"
  on public.contract_alerts for select using (
    exists (select 1 from public.contracts c where c.id = contract_alerts.contract_id
      and public.caller_has_capability(c.business_id, 'legal_contract', 'view'))
  );

-- Pure read function that also stamps notified_at the first time a
-- pending alert's trigger_date has been reached — see header note 4.
create or replace function public.list_due_contract_alerts(p_business_id uuid, p_as_of date default current_date)
returns setof public.contract_alerts
language plpgsql security definer set search_path = public, auth
as $$
begin
  if not public.caller_has_capability(p_business_id, 'legal_contract', 'view') then
    raise exception 'not_authorized: requires view on legal_contract';
  end if;

  update public.contract_alerts ca
  set notified_at = now()
  from public.contracts c
  where ca.contract_id = c.id and c.business_id = p_business_id
    and ca.status = 'pending' and ca.trigger_date <= p_as_of and ca.notified_at is null;

  return query
  select ca.* from public.contract_alerts ca
  join public.contracts c on c.id = ca.contract_id
  where c.business_id = p_business_id and ca.status = 'pending' and ca.trigger_date <= p_as_of
  order by ca.trigger_date asc;
end;
$$;

grant execute on function public.list_due_contract_alerts(uuid, date) to authenticated;

create or replace function public.acknowledge_contract_alert(p_alert_id uuid)
returns public.contract_alerts
language plpgsql security definer set search_path = public, auth
as $$
declare v_business_id uuid; v_row public.contract_alerts;
begin
  select c.business_id into v_business_id from public.contract_alerts ca
  join public.contracts c on c.id = ca.contract_id where ca.id = p_alert_id;
  if v_business_id is null then raise exception 'contract_alert_not_found: %', p_alert_id; end if;
  if not public.caller_has_capability(v_business_id, 'legal_contract', 'capture') then
    raise exception 'not_authorized: requires capture on legal_contract';
  end if;

  update public.contract_alerts set status = 'acknowledged' where id = p_alert_id and status = 'pending'
  returning * into v_row;
  if v_row.id is null then raise exception 'contract_alert_not_pending: %', p_alert_id; end if;

  return v_row;
end;
$$;

grant execute on function public.acknowledge_contract_alert(uuid) to authenticated;

-- ------------------------------------------------------------
-- 3. public.e_signature_envelopes (Vol 13_0 §12 — see header note 1).
-- ------------------------------------------------------------
create table if not exists public.e_signature_envelopes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  contract_id uuid references public.contracts (id),
  quotation_id uuid references public.quotations (id),
  provider text not null default 'generic',
  status text not null default 'sent' check (status in ('sent', 'viewed', 'signed', 'declined', 'expired')),
  signed_document_id uuid references public.documents (id),
  created_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now(),
  check ((contract_id is not null and quotation_id is null) or (contract_id is null and quotation_id is not null))
);
create index if not exists idx_esign_envelopes_business on public.e_signature_envelopes (business_id);
alter table public.e_signature_envelopes enable row level security;
create policy "Active members with legal/sales view can see e-sig envelopes"
  on public.e_signature_envelopes for select using (public.caller_has_capability(business_id, 'legal_contract', 'view')
    or public.caller_has_capability(business_id, 'sales', 'view'));

create or replace function public.create_esignature_envelope(
  p_contract_id uuid default null, p_quotation_id uuid default null, p_provider text default 'generic'
) returns public.e_signature_envelopes
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_business_id uuid;
  v_caller_membership_id uuid;
  v_row public.e_signature_envelopes;
  v_contract public.contracts;
  v_quotation public.quotations;
begin
  if (p_contract_id is null) = (p_quotation_id is null) then
    raise exception 'exactly_one_of_contract_id_or_quotation_id_required';
  end if;

  if p_contract_id is not null then
    select * into v_contract from public.contracts where id = p_contract_id for update;
    if not found then raise exception 'contract_not_found: %', p_contract_id; end if;
    if not public.caller_has_capability(v_contract.business_id, 'legal_contract', 'capture') then
      raise exception 'not_authorized: requires capture on legal_contract';
    end if;
    if v_contract.status <> 'pending_signature' then
      raise exception 'contract_not_ready_for_signature: current status %', v_contract.status;
    end if;
    v_business_id := v_contract.business_id;
  else
    select * into v_quotation from public.quotations where id = p_quotation_id for update;
    if not found then raise exception 'quotation_not_found: %', p_quotation_id; end if;
    if not public.caller_has_capability(v_quotation.business_id, 'sales', 'capture') then
      raise exception 'not_authorized: requires capture on sales';
    end if;
    if v_quotation.status <> 'sent' then
      raise exception 'quotation_not_ready_for_signature: current status %', v_quotation.status;
    end if;
    v_business_id := v_quotation.business_id;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = v_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.e_signature_envelopes (business_id, contract_id, quotation_id, provider, created_by_membership_id)
  values (v_business_id, p_contract_id, p_quotation_id, coalesce(nullif(p_provider, ''), 'generic'), v_caller_membership_id)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_esignature_envelope(uuid, uuid, text) to authenticated;

create or replace function public.mark_esignature_envelope_viewed(p_envelope_id uuid)
returns public.e_signature_envelopes
language plpgsql security definer set search_path = public, auth
as $$
declare v_row public.e_signature_envelopes;
begin
  select * into v_row from public.e_signature_envelopes where id = p_envelope_id for update;
  if not found then raise exception 'envelope_not_found: %', p_envelope_id; end if;
  if not (
    public.caller_has_capability(v_row.business_id, 'legal_contract', 'view')
    or public.caller_has_capability(v_row.business_id, 'sales', 'view')
  ) then
    raise exception 'not_authorized: requires view on legal_contract or sales';
  end if;
  if v_row.status <> 'sent' then
    raise exception 'envelope_not_in_sent_status: current status %', v_row.status;
  end if;

  update public.e_signature_envelopes set status = 'viewed' where id = p_envelope_id returning * into v_row;
  return v_row;
end;
$$;

grant execute on function public.mark_esignature_envelope_viewed(uuid) to authenticated;

create or replace function public.mark_esignature_envelope_signed(p_envelope_id uuid, p_signed_document_id uuid default null)
returns public.e_signature_envelopes
language plpgsql security definer set search_path = public, auth
as $$
declare v_row public.e_signature_envelopes; v_capture_ok boolean;
begin
  select * into v_row from public.e_signature_envelopes where id = p_envelope_id for update;
  if not found then raise exception 'envelope_not_found: %', p_envelope_id; end if;
  if v_row.contract_id is not null then
    v_capture_ok := public.caller_has_capability(v_row.business_id, 'legal_contract', 'capture');
  else
    v_capture_ok := public.caller_has_capability(v_row.business_id, 'sales', 'capture');
  end if;
  if not v_capture_ok then
    raise exception 'not_authorized: requires capture on the envelope''s own domain';
  end if;
  if v_row.status not in ('sent', 'viewed') then
    raise exception 'envelope_not_signable: current status %', v_row.status;
  end if;

  update public.e_signature_envelopes set status = 'signed', signed_document_id = p_signed_document_id
  where id = p_envelope_id returning * into v_row;

  if v_row.contract_id is not null then
    update public.contracts set status = 'active', start_date = coalesce(start_date, current_date)
    where id = v_row.contract_id and status = 'pending_signature';
  else
    update public.quotations set status = 'accepted' where id = v_row.quotation_id and status = 'sent';
  end if;

  return v_row;
end;
$$;

grant execute on function public.mark_esignature_envelope_signed(uuid, uuid) to authenticated;

create or replace function public.mark_esignature_envelope_declined(p_envelope_id uuid)
returns public.e_signature_envelopes
language plpgsql security definer set search_path = public, auth
as $$
declare v_row public.e_signature_envelopes; v_capture_ok boolean;
begin
  select * into v_row from public.e_signature_envelopes where id = p_envelope_id for update;
  if not found then raise exception 'envelope_not_found: %', p_envelope_id; end if;
  if v_row.contract_id is not null then
    v_capture_ok := public.caller_has_capability(v_row.business_id, 'legal_contract', 'capture');
  else
    v_capture_ok := public.caller_has_capability(v_row.business_id, 'sales', 'capture');
  end if;
  if not v_capture_ok then
    raise exception 'not_authorized: requires capture on the envelope''s own domain';
  end if;
  if v_row.status not in ('sent', 'viewed') then
    raise exception 'envelope_not_declinable: current status %', v_row.status;
  end if;

  update public.e_signature_envelopes set status = 'declined' where id = p_envelope_id returning * into v_row;
  return v_row;
end;
$$;

grant execute on function public.mark_esignature_envelope_declined(uuid) to authenticated;

-- ------------------------------------------------------------
-- 4. Credit limit enforcement (Vol 13_0 §12.1 — see header notes 5-6).
-- ------------------------------------------------------------
create table if not exists public.credit_limit_override_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id),
  party_id uuid not null references public.parties (id),
  requested_amount numeric(14, 2) not null,
  effective_credit_limit numeric(14, 2) not null,
  outstanding_balance_before numeric(14, 2) not null,
  overridden_by_membership_id uuid references public.business_memberships (id),
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists idx_credit_limit_override_log_business on public.credit_limit_override_log (business_id);
alter table public.credit_limit_override_log enable row level security;
create policy "Active members with settings/accounting see the override log"
  on public.credit_limit_override_log for select using (
    public.caller_has_capability(business_id, 'settings', 'configure')
    or public.caller_has_capability(business_id, 'accounting_reports', 'view')
  );

-- Shared implementation for both the normal path (convert_quotation_
-- to_invoice, unchanged public signature) and the explicit override
-- path (convert_quotation_to_invoice_with_credit_override) — see
-- header note 5. Body is Sprint 28's own convert_quotation_to_invoice
-- with the credit-limit gate inserted before the invoice insert;
-- everything else is unchanged from Sprint 28/29.
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

  -- Credit limit enforcement — Vol 13_0 §12.1, this plan's one hard
  -- system-level blocking gate. See header notes 5-6.
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
      -- logged below, once the invoice (and its id) exists.
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

  return v_invoice;
end;
$$;

-- Unchanged public signature/behaviour from Sprint 28, except it now
-- also enforces the credit limit gate (blocking, no override).
create or replace function public.convert_quotation_to_invoice(p_quotation_id uuid)
returns public.invoices
language plpgsql security definer set search_path = public, auth
as $$
begin
  return public._create_invoice_from_quotation(p_quotation_id, false, null);
end;
$$;

grant execute on function public.convert_quotation_to_invoice(uuid) to authenticated;

-- The explicit, separately-named owner override path — see header note 5.
create or replace function public.convert_quotation_to_invoice_with_credit_override(
  p_quotation_id uuid, p_override_reason text default null
) returns public.invoices
language plpgsql security definer set search_path = public, auth
as $$
begin
  return public._create_invoice_from_quotation(p_quotation_id, true, p_override_reason);
end;
$$;

grant execute on function public.convert_quotation_to_invoice_with_credit_override(uuid, text) to authenticated;

-- End of Sprint 36 migration. End of Phase 3 Sprint Plan.
