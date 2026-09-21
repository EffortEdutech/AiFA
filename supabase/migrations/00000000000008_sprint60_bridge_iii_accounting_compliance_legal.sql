-- ==============================================================
-- Sprint 60 (Draft-and-Approve Bridge III: Accounting, Compliance
-- & Legal)
-- ==============================================================
--
-- Adds capture-to-approval routing for the three domains this
-- sprint covers: e-Invoice/SST flag, Contract (alert), and
-- e-Signature request. Unlike Sprint 59's four domains, two of
-- these three needed NO schema change at all once checked against
-- the real, already-shipped `eInvoiceSstTransport.ts` /
-- `legalCommercialTransport.ts` schema — only the third
-- (e-Signature) required new schema. All three route through the
-- existing public.create_approval_task / public.approval_tasks
-- machinery except e-Invoice (see note 1).
--
-- SCOPE NOTES (disclosed to and confirmed by the business owner,
-- 16 September 2026 — see Sprint_60 doc for the full discussion):
--
-- 1. e-Invoice/SST flag — the sprint doc's premise of "a draft flag
--    row against the existing eInvoiceSstTransport.ts schema" does
--    not hold: public.e_invoice_submissions has no freestanding
--    "flag, no invoice yet" concept — its own
--    e_invoice_submissions_normal_has_invoice constraint requires a
--    real, already-existing public.invoices row for a 'normal'
--    submission. create_einvoice_submission (Sprint 33, unchanged)
--    already inserts status = 'draft' directly (no approval_tasks
--    routing of its own — the draft state itself, plus the
--    existing e-Invoice & SST page's own separate "Submit" action,
--    is what already gates anything reaching LHDN). Per the
--    owner's decision, a captured e-Invoice/SST-relevant document
--    must resolve to a real, existing invoice with no active
--    (non-rejected/cancelled) e_invoice_submission yet, exactly
--    mirroring Sprint 59's Delivery Order resolution — that
--    resolution is capture-router (TypeScript) wiring, not a
--    schema concern, and is not part of this migration.
--
-- 2. Contract (alert) — the sprint doc's premise of "a draft entry
--    against legalCommercialTransport.ts's existing Contracts &
--    Alerts schema" undersold what drafting an alert actually
--    requires: public.contract_alerts has no RPC to insert a
--    standalone alert row — every alert is only ever generated as
--    an automatic side effect of create_contract (Sprint 36,
--    unchanged), which already drafts a brand-new Contract and
--    opens its own ApprovalTask (domain 'legal_contract', subject
--    'contract') via the same create_approval_task machinery this
--    migration reuses for e-Signature below. Per the owner's
--    decision, a captured contract_alert description is drafted as
--    a whole new Contract (counterparty, type, dates, auto-renew,
--    renewal notice days) via the existing create_contract RPC —
--    no schema change, and no new migration content for this
--    domain either.
--
-- 3. e-Signature request — the one domain this sprint's premise
--    materially failed for: public.e_signature_envelopes has NO
--    draft/undispatched status at all (its own status check is
--    `in ('sent', 'viewed', 'signed', 'declined', 'expired')`,
--    defaulting to 'sent') — calling create_esignature_envelope
--    today is equivalent to immediately dispatching. Per the
--    owner's decision, this migration adds a new
--    e_signature_requests draft table (own draft-then-approve RPC
--    create_esignature_request_draft, domain 'legal_contract'),
--    mirroring Sprint 59's attendance_correction shape: only on
--    approval does a trigger perform the real, already-existing
--    envelope-eligibility validation and insert the real
--    e_signature_envelopes row (which is when dispatch actually,
--    unavoidably, happens under the existing schema's own "no
--    draft status" lifecycle) — a rejected or still-drafted request
--    never creates a real envelope, so nothing is ever sent to a
--    signer without the owner's own explicit approval.
--
-- Neither of this sprint's three domains is ever offered a
-- confidence-based auto-record shortcut, per the Sprint 60 doc's
-- own Risks table (stated as a permanent design choice, not a
-- temporary caution) — p_auto_approved is accepted on the new RPC
-- below only for signature symmetry with every other capture RPC
-- in this schema.
-- ==============================================================

-- ------------------------------------------------------------
-- 1. e-Invoice/SST flag — no schema change (see header note 1).
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 2. Contract (alert) — no schema change (see header note 2).
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 3. e-Signature request — new draft table + approval-time
-- creation of the real e_signature_envelopes row, mirroring
-- create_esignature_envelope's own eligibility validation exactly
-- (contract must be 'pending_signature', quotation must be 'sent')
-- so a request that was still valid when drafted but has since
-- drifted (e.g. the contract was terminated before approval) fails
-- loudly at approval time rather than silently creating a
-- mismatched envelope.
-- ------------------------------------------------------------

create table if not exists public.e_signature_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  contract_id uuid references public.contracts (id),
  quotation_id uuid references public.quotations (id),
  provider text not null default 'generic',
  status text not null default 'drafted' check (status in ('drafted', 'approved', 'rejected')),
  captured_by_membership_id uuid references public.business_memberships (id),
  decided_by_membership_id uuid references public.business_memberships (id),
  created_envelope_id uuid references public.e_signature_envelopes (id),
  created_at timestamptz not null default now(),
  check ((contract_id is not null and quotation_id is null) or (contract_id is null and quotation_id is not null))
);
create index if not exists idx_esignature_requests_business on public.e_signature_requests (business_id);
alter table public.e_signature_requests enable row level security;
create policy "Active members with legal/sales view can see e-sig requests"
  on public.e_signature_requests for select using (public.caller_has_capability(business_id, 'legal_contract', 'view')
    or public.caller_has_capability(business_id, 'sales', 'view'));

create or replace function public.create_esignature_request_draft(
  p_business_id uuid, p_contract_id uuid default null, p_quotation_id uuid default null,
  p_provider text default 'generic', p_ai_draft_summary text default null, p_auto_approved boolean default false
) returns public.e_signature_requests
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_contract public.contracts;
  v_quotation public.quotations;
  v_row public.e_signature_requests;
begin
  if (p_contract_id is null) = (p_quotation_id is null) then
    raise exception 'exactly_one_of_contract_id_or_quotation_id_required';
  end if;

  if p_contract_id is not null then
    select * into v_contract from public.contracts where id = p_contract_id and business_id = p_business_id;
    if not found then raise exception 'contract_not_found_for_this_business: %', p_contract_id; end if;
    if not public.caller_has_capability(p_business_id, 'legal_contract', 'capture') then
      raise exception 'not_authorized: requires capture on legal_contract';
    end if;
    if v_contract.status <> 'pending_signature' then
      raise exception 'contract_not_ready_for_signature: current status %', v_contract.status;
    end if;
  else
    select * into v_quotation from public.quotations where id = p_quotation_id and business_id = p_business_id;
    if not found then raise exception 'quotation_not_found_for_this_business: %', p_quotation_id; end if;
    if not public.caller_has_capability(p_business_id, 'sales', 'capture') then
      raise exception 'not_authorized: requires capture on sales';
    end if;
    if v_quotation.status <> 'sent' then
      raise exception 'quotation_not_ready_for_signature: current status %', v_quotation.status;
    end if;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.e_signature_requests (
    business_id, contract_id, quotation_id, provider, captured_by_membership_id
  ) values (
    p_business_id, p_contract_id, p_quotation_id, coalesce(nullif(p_provider, ''), 'generic'), v_caller_membership_id
  ) returning * into v_row;

  -- e-Signature request is permanently excluded from any future
  -- confidence-based auto-record shortcut (Sprint 60 Risks table) —
  -- p_auto_approved is accepted only for RPC-shape symmetry; the
  -- capture router is not expected to ever pass true for this domain.
  perform public.create_approval_task(
    p_business_id, 'legal_contract', 'e_signature_request', v_row.id, null,
    coalesce(p_ai_draft_summary, 'e-Signature request (' || coalesce(p_provider, 'generic') || ') for '
      || case when p_contract_id is not null then 'contract ' || p_contract_id else 'quotation ' || p_quotation_id end),
    null, v_caller_membership_id, p_auto_approved, null
  );

  return v_row;
end;
$$;

grant execute on function public.create_esignature_request_draft(uuid, uuid, uuid, text, text, boolean) to authenticated;

-- On approval, re-validates eligibility exactly as
-- create_esignature_envelope itself would (the contract/quotation
-- may have drifted out of the right status between draft and
-- decision) and, only if still eligible, inserts the real
-- e_signature_envelopes row directly (SECURITY DEFINER trigger
-- context — same convention as every other sync_*_on_task_decision
-- trigger in this schema). A rejected request never creates a real
-- envelope; a request that has drifted out of eligibility by
-- approval time raises loudly rather than silently creating a
-- mismatched envelope, aborting that approval decision.
create or replace function public.sync_esignature_request_on_task_decision()
returns trigger language plpgsql security definer set search_path = public, auth
as $$
declare
  v_req public.e_signature_requests;
  v_contract public.contracts;
  v_quotation public.quotations;
  v_envelope public.e_signature_envelopes;
begin
  if new.subject_type <> 'e_signature_request' or old.status is not distinct from new.status then
    return new;
  end if;
  select * into v_req from public.e_signature_requests where id = new.subject_id and status = 'drafted' for update;
  if not found then
    return new;
  end if;

  if new.status in ('approved', 'auto_approved') then
    if v_req.contract_id is not null then
      select * into v_contract from public.contracts where id = v_req.contract_id for update;
      if not found or v_contract.status <> 'pending_signature' then
        raise exception 'contract_no_longer_ready_for_signature: %', v_req.contract_id;
      end if;
    else
      select * into v_quotation from public.quotations where id = v_req.quotation_id for update;
      if not found or v_quotation.status <> 'sent' then
        raise exception 'quotation_no_longer_ready_for_signature: %', v_req.quotation_id;
      end if;
    end if;

    insert into public.e_signature_envelopes (
      business_id, contract_id, quotation_id, provider, created_by_membership_id
    ) values (
      v_req.business_id, v_req.contract_id, v_req.quotation_id, v_req.provider, v_req.captured_by_membership_id
    ) returning * into v_envelope;

    update public.e_signature_requests
    set status = 'approved', decided_by_membership_id = new.decided_by_membership_id, created_envelope_id = v_envelope.id
    where id = new.subject_id;
  elsif new.status = 'rejected' then
    update public.e_signature_requests
    set status = 'rejected', decided_by_membership_id = new.decided_by_membership_id
    where id = new.subject_id;
  end if;
  return new;
end;
$$;

create trigger trg_sync_esignature_request_on_task_decision
  after update on public.approval_tasks
  for each row execute function public.sync_esignature_request_on_task_decision();

-- End of Sprint 60 migration.
