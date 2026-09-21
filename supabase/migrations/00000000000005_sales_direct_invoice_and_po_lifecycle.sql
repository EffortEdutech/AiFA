-- Sprint 58 follow-on (14 September 2026) — "Proceed draft to fix the
-- Sales and finish Purchases properly," per the owner's own two bug
-- reports and the Architecture Audit that followed
-- (Architecture_Audit_1Input_AI_Does_The_Rest.md, delivered same day).
--
-- Additive only, except one narrow, disclosed constraint widening on
-- purchase_order.status (item 2 below) — no existing table dropped or
-- redefined, no capability domain added.
--
-- ------------------------------------------------------------------
-- PART 1 — SALES: "invoiced Sunrise Trading RM800" must not draft a
-- pre-sale Quotation. Root cause (confirmed by reading create_quotation
-- in full, both definitions, this session): the ONLY entry point into
-- the Sales lifecycle is Quotation, which always starts at status
-- 'draft' and requires the propose -> sent -> accepted stages before
-- becoming an Invoice. An input describing an ALREADY-COMPLETED sale
-- has no accurate stage to land in — "draft, pending a WhatsApp send"
-- is simply false for something that already happened.
--
-- Fix: create_quotation gets one new optional parameter,
-- p_already_completed (default false, so every existing caller is
-- unaffected — PostgREST/postgres match function args by name, so a
-- new trailing default-valued parameter is fully backward compatible).
-- When true, the created quotation's approval task is tagged with a
-- second, new value for the existing free-text on_approval_action
-- column ('issue invoice directly', alongside the existing 'send
-- WhatsApp') rather than a new subject_type or table. A new trigger,
-- sync_direct_sale_invoice_on_task_decision, reacts ONLY to that tag:
-- on approval it advances the quotation straight from 'draft' to
-- 'accepted' (skipping 'sent' deliberately — there is no customer to
-- propose to; the sale already happened in reality) and immediately
-- calls the existing private helper _create_invoice_from_quotation to
-- produce a real, issued Invoice — reusing 100% of the existing
-- Quotation->Invoice pipeline (AR ageing, payment recording, etc.),
-- exactly as the Architecture Audit's recommendation #2 called for.
-- ------------------------------------------------------------------

create or replace function public.create_quotation(
  p_business_id uuid,
  p_party_id uuid,
  p_valid_until date,
  p_notes text,
  p_lines jsonb,
  p_ai_draft_summary text default null,
  p_auto_approved boolean default false,
  p_already_completed boolean default false
) returns public.quotations
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_quotation_no text;
  v_quotation public.quotations;
  v_line jsonb;
  v_line_no integer := 0;
  v_product_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_discount numeric;
  v_tax_code text;
  v_line_total numeric;
  v_subtotal numeric := 0;
begin
  if not public.caller_has_capability(p_business_id, 'sales', 'capture') then
    raise exception 'not_authorized: requires capture on sales';
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
  values (p_business_id, 'quotation', 'QTN', 'never')
  on conflict (business_id, document_type) do nothing;
  v_quotation_no := public.next_document_number(p_business_id, 'quotation');

  insert into public.quotations (
    business_id, quotation_no, party_id, valid_until, notes, captured_by_membership_id
  ) values (
    p_business_id, v_quotation_no, p_party_id, p_valid_until, p_notes, v_caller_membership_id
  ) returning * into v_quotation;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_line_no := v_line_no + 1;
    v_product_id := nullif(v_line ->> 'product_id', '')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_discount := coalesce((v_line ->> 'discount_amount')::numeric, 0);
    v_tax_code := nullif(v_line ->> 'tax_code', '');

    if v_line ? 'unit_price' and (v_line ->> 'unit_price') is not null then
      v_unit_price := (v_line ->> 'unit_price')::numeric;
    elsif v_product_id is not null then
      select r.unit_price into v_unit_price from public.resolve_price(p_business_id, v_product_id, p_party_id) r;
    else
      raise exception 'line_%_needs_either_product_id_or_an_explicit_unit_price', v_line_no;
    end if;

    v_line_total := (v_quantity * v_unit_price) - v_discount;
    v_subtotal := v_subtotal + v_line_total;

    insert into public.quotation_lines (
      quotation_id, line_no, product_id, description, quantity, unit_price, tax_code, discount_amount, line_total
    ) values (
      v_quotation.id, v_line_no, v_product_id, v_line ->> 'description', v_quantity, v_unit_price, v_tax_code, v_discount, v_line_total
    );
  end loop;

  update public.quotations set subtotal = v_subtotal, tax_total = 0, grand_total = v_subtotal
  where id = v_quotation.id
  returning * into v_quotation;

  perform public.create_approval_task(
    p_business_id, 'sales', 'quotation', v_quotation.id, v_quotation.grand_total,
    coalesce(
      p_ai_draft_summary,
      case when p_already_completed
        then 'Already-completed sale ' || v_quotation_no || ' for ' || v_quotation.grand_total || ' ' || v_quotation.currency || ' — approval will issue a real Invoice directly'
        else 'Quotation ' || v_quotation_no || ' for ' || v_quotation.grand_total || ' ' || v_quotation.currency
      end
    ),
    null, v_caller_membership_id, p_auto_approved,
    case when p_already_completed then 'issue invoice directly' else 'send WhatsApp' end
  );

  return v_quotation;
end;
$$;

grant execute on function public.create_quotation(uuid, uuid, date, text, jsonb, text, boolean, boolean) to authenticated;

-- New trigger: reacts only to on_approval_action = 'issue invoice
-- directly' (an already-completed sale). Every other quotation
-- (on_approval_action = 'send WhatsApp') is untouched by this trigger
-- and keeps its existing draft -> sent -> accepted -> converted flow
-- exactly as before.
create or replace function public.sync_direct_sale_invoice_on_task_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quotation public.quotations;
begin
  if new.subject_type <> 'quotation'
     or new.on_approval_action <> 'issue invoice directly'
     or old.status is not distinct from new.status then
    return new;
  end if;

  if new.status in ('approved', 'auto_approved') then
    select * into v_quotation from public.quotations where id = new.subject_id and status = 'draft' for update;
    if found then
      update public.quotations set status = 'accepted' where id = v_quotation.id;
      -- Reuses the existing, private Quotation->Invoice conversion
      -- helper unchanged — no new invoice-creation logic is written
      -- here. p_allow_credit_override=false, p_override_reason=null:
      -- an already-completed sale still goes through the same credit
      -- check every other invoice does.
      perform public._create_invoice_from_quotation(v_quotation.id, false, null);
    end if;
  elsif new.status = 'rejected' then
    update public.quotations set status = 'rejected' where id = new.subject_id and status = 'draft';
  end if;

  return new;
end;
$$;

create trigger trg_sync_direct_sale_invoice_on_task_decision
  after update on public.approval_tasks
  for each row execute function public.sync_direct_sale_invoice_on_task_decision();

-- ------------------------------------------------------------------
-- PART 2 — PURCHASES: "PO to Maju Suppliers for RM1200" produced a PO
-- that "can only be viewed on the Approvals [page] and there is no
-- Purchase Order at the sidebar." Two real root causes, both
-- self-introduced omissions in this session's own Sprint 58 scaffold
-- (00000000000004_purchase_order_and_party_resolution.sql), found
-- while designing this fix:
--
--   (a) purchase_order.status's check constraint never included
--       'rejected' — fixed below via drop/add constraint.
--   (b) create_purchase_order creates the PO's approval task but
--       NOTHING was ever wired to react to its decision — so a PO's
--       status was permanently stuck at 'drafted' regardless of
--       approval outcome. This is the actual technical reason the PO
--       "could only be viewed in Approvals": there was nothing else
--       to show, because status never advanced past its initial
--       value. Fixed below via sync_purchase_order_on_task_decision.
--
-- The missing sidebar/list page itself is a web/ change, not a
-- database concern — handled in this same batch of work as
-- web/src/shell/pages/PurchaseOrdersPage.tsx (see that file and
-- Sprint 58's own updated DoD).
--
-- DISCLOSED PRE-EXISTING BUG (not introduced by this migration, not
-- fixed schema-wide here — see the note directly above
-- mark_purchase_order_paid below for why, and for the narrow local
-- workaround this migration uses instead): create_approval_task's
-- p_auto_approved=true branch performs a plain INSERT with
-- status='auto_approved' and never a subsequent UPDATE. Every
-- sync_*_on_task_decision trigger in this entire schema (confirmed by
-- grep: all are declared strictly "after update on
-- public.approval_tasks", none "after insert or update") therefore
-- never fires for an auto-approved capture, in ANY domain — not just
-- Purchases. Concretely, an auto-approved Payment Voucher (or
-- anything else) is left stuck at its initial status forever, because
-- nothing ever performs the UPDATE that would move it forward. This
-- is cross-cutting and affects the Sprint 57/61 "auto-approve at
-- >=90% confidence" vision for every domain — it deserves its own
-- dedicated fix (most likely: create_approval_task should still
-- INSERT then immediately UPDATE the same row it just created, so the
-- trigger fires exactly as it would for a human-decided task) rather
-- than being silently patched here as a side effect of one narrower
-- migration. Flagged to the owner in chat and in the Architecture
-- Audit addendum delivered alongside this migration; NOT fixed
-- schema-wide in this file.
-- ------------------------------------------------------------------

-- (a) Add the missing 'rejected' status value.
alter table public.purchase_order drop constraint if exists purchase_order_status_check;
alter table public.purchase_order add constraint purchase_order_status_check
  check (status in (
    'drafted', 'approved', 'rejected', 'stock_received_partial', 'stock_received_full', 'paid', 'closed'
  ));

-- (b) The missing approval-decision sync trigger — mirrors
-- sync_payment_voucher_on_task_decision's exact shape (this schema's
-- established pattern for this kind of trigger, read in full this
-- session).
create or replace function public.sync_purchase_order_on_task_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.subject_type <> 'purchase_order' or old.status is not distinct from new.status then
    return new;
  end if;
  if new.status in ('approved', 'auto_approved') then
    update public.purchase_order set status = 'approved' where id = new.subject_id and status = 'drafted';
  elsif new.status = 'rejected' then
    update public.purchase_order set status = 'rejected' where id = new.subject_id and status = 'drafted';
  end if;
  return new;
end;
$$;

create trigger trg_sync_purchase_order_on_task_decision
  after update on public.approval_tasks
  for each row execute function public.sync_purchase_order_on_task_decision();

-- (c) Stock-receipt confirmation — full receipt only, matching Sprint
-- 58's own deferred-scope decision (Safe to Carry Over: "partial-line
-- stock receipt ... logged as open items for a future ... pass").
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

  return v_po;
end;
$$;

grant execute on function public.confirm_purchase_order_receipt(uuid) to authenticated;

-- (d) Mark paid — deliberately reuses the EXISTING Payment Voucher
-- pipeline (create_payment_voucher + mark_payment_voucher_paid)
-- rather than inventing a new Supplier Bill/Accounts-Payable concept,
-- per the Architecture Audit's own reuse-don't-reinvent
-- recommendation. p_expense_category is required (not guessed) for
-- the same reason create_payment_voucher itself requires it: it must
-- match an existing Chart of Accounts expense-type account_name, and
-- guessing one here could silently post to the wrong account.
--
-- WORKAROUND FOR THE DISCLOSED BUG ABOVE, SCOPED NARROWLY TO THIS ONE
-- CALL: create_payment_voucher is called with p_auto_approved=true so
-- the owner does not have to separately approve a voucher for a PO
-- they already approved — but per the disclosed bug, an
-- auto_approved voucher's status never advances past 'auto_approved'
-- on its own (no trigger ever fires for it), and
-- mark_payment_voucher_paid requires status='approved'. Rather than
-- fix create_approval_task's general INSERT-only auto-approve path
-- schema-wide inside this narrower migration, this function performs
-- one explicit, local `update ... set status = 'approved'` on the
-- single voucher it just created, immediately before paying it. This
-- is a targeted, disclosed workaround for this one call site only —
-- it does not touch create_approval_task or any other domain.
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

  -- Disclosed local workaround — see this function's header comment.
  update public.payment_vouchers set status = 'approved' where id = v_voucher.id
  returning * into v_voucher;

  perform public.mark_payment_voucher_paid(v_voucher.id);

  update public.purchase_order set status = 'paid' where id = v_po.id
  returning * into v_po;

  return v_po;
end;
$$;

grant execute on function public.mark_purchase_order_paid(uuid, text, text) to authenticated;

-- End of Sprint 58 follow-on migration (Sales direct-invoice path +
-- Purchase Order status lifecycle/receipt/payment).
