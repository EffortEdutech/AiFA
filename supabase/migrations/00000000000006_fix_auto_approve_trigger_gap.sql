-- ------------------------------------------------------------------
-- Sprint 58 close-out (15 September 2026) — fixes the disclosed
-- cross-cutting bug flagged in 00000000000005's own header comment
-- above mark_purchase_order_paid, and in
-- 01_Architecture_Audit_1Input_AI_Does_The_Rest.md's addendum: this
-- was the last open Definition-of-Done item on Sprint 58
-- ("Draft-and-Approve Bridge I: Sales & Purchases") before it can be
-- marked genuinely done.
--
-- THE BUG: public.create_approval_task's p_auto_approved=true branch
-- performed a single plain INSERT straight to a terminal status
-- ('auto_approved'/'auto_approved'), with no subsequent UPDATE.
-- Confirmed by grep against every sync_*_on_task_decision trigger in
-- this schema (13 in total, across Purchase Orders, Payment Vouchers,
-- Leave Applications, Commission, Payroll Runs, Overtime, Salary
-- Advances, Claims, Credit Notes, Contracts): every one of them is
-- declared strictly "after update on public.approval_tasks", none
-- "after insert or update". An INSERT-only auto-approve therefore
-- fires none of them, silently leaving the subject row (a Payment
-- Voucher, a Purchase Order, a Leave Application, ...) stuck at its
-- initial draft/pending status forever, with the approval_tasks row
-- itself showing "auto_approved" the whole time -- a mismatch that
-- looks fine in Approvals but is wrong everywhere the subject's own
-- status is read.
--
-- BLAST RADIUS CHECKED BEFORE WRITING THIS FIX (15 September 2026):
-- grepped every call site in packages/core and supabase/migrations for
-- `auto_approved: true` / `autoApproved: true` / `p_auto_approved...
-- true`. The only current caller passing true is
-- mark_purchase_order_paid's own internal create_payment_voucher call
-- (00000000000005), and that call site already carries its own
-- narrow, disclosed local workaround (a manual `update ... set
-- status = 'approved'` immediately after, described in that
-- migration's own comment). No other domain currently exercises the
-- true branch live -- every other domain's present auto-approval goes
-- through resolve_approval_task's solo_self_resolved branch instead,
-- which already performs a real UPDATE and therefore already fires
-- its trigger correctly (this is why Sprint 53's live leave-application
-- smoke test passed even before this fix). So this fix changes no
-- other domain's live behaviour today -- it only correctly enables the
-- p_auto_approved=true path for when Sprint 57/61's confidence-based
-- auto-record actually starts calling it.
--
-- THE FIX (exactly what 00000000000005's own comment proposed, "most
-- likely: create_approval_task should still INSERT then immediately
-- UPDATE the same row it just created, so the trigger fires exactly
-- as it would for a human-decided task"): the auto_approved branch now
-- inserts at the same 'pending_approval' placeholder status the
-- non-auto-approved branch already uses, then performs a real second
-- UPDATE statement moving it to 'auto_approved' -- mirroring the
-- existing non-auto-approved path's own insert-then-resolve_approval_
-- task (itself an UPDATE) shape. old.status ('pending_approval') now
-- genuinely differs from new.status ('auto_approved'), so every
-- sync_*_on_task_decision trigger's own `old.status is not distinct
-- from new.status` guard passes and the trigger body runs, exactly as
-- it already does for a human decision or a solo self-resolve.
--
-- NOT touched here: mark_purchase_order_paid's own local workaround
-- (00000000000005) is left exactly as it is -- migrations already
-- applied to the live project are never edited in place. That
-- workaround becomes a harmless, now-redundant no-op once this fix is
-- applied (the trigger will already have moved the voucher to
-- 'approved' by the time that function's own explicit UPDATE runs),
-- not a conflict -- left in place rather than removed, since a defensive
-- redundant statement here costs nothing and this migration's own scope
-- is the trigger-firing bug alone, not a cleanup pass over 000005.
--
-- Function signature is unchanged (same 10 params, same names, types,
-- and defaults) -- this is a body-only `create or replace`, so every
-- existing caller (create_purchase_order, create_quotation,
-- create_leave_application, create_payment_voucher, and the Payroll/
-- Commission/e-Invoice/Legal/Inventory RPCs) keeps working with no
-- changes on their side, and the existing `grant execute` from the
-- initial schema still matches this signature -- no re-grant needed.
-- ------------------------------------------------------------------

create or replace function public.create_approval_task(
  p_business_id uuid,
  p_domain text,
  p_subject_type text,
  p_subject_id uuid,
  p_amount numeric,
  p_ai_draft_summary text,
  p_ai_confidence numeric,
  p_captured_by_membership_id uuid,
  p_auto_approved boolean default false,
  p_on_approval_action text default null
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
      resolved_via, status, on_approval_action
    ) values (
      p_business_id, p_domain, p_subject_type, p_subject_id, p_amount,
      p_ai_draft_summary, p_ai_confidence, p_captured_by_membership_id,
      'auto_approved', 'pending_approval', p_on_approval_action
    )
    returning * into v_row;

    -- The real fix: a genuine second statement (UPDATE, not folded
    -- into the INSERT above) so every "after update" sync trigger
    -- actually fires for an auto-approved task, the same way it
    -- already does for decide_approval_task and resolve_approval_task's
    -- solo_self_resolved branch below.
    update public.approval_tasks
    set status = 'auto_approved', decided_at = now()
    where id = v_row.id
    returning * into v_row;

    return v_row;
  end if;

  insert into public.approval_tasks (
    business_id, domain, subject_type, subject_id, amount,
    ai_draft_summary, ai_confidence, captured_by_membership_id,
    resolved_via, status, on_approval_action
  ) values (
    p_business_id, p_domain, p_subject_type, p_subject_id, p_amount,
    p_ai_draft_summary, p_ai_confidence, p_captured_by_membership_id,
    'escalation', -- placeholder, overwritten by resolve_approval_task below
    'pending_approval', p_on_approval_action
  )
  returning * into v_row;

  return public.resolve_approval_task(v_row.id);
end;
$$;

-- ------------------------------------------------------------------
-- Backfill: any approval_tasks row already sitting at status=
-- 'auto_approved' from BEFORE this fix (created by the old INSERT-only
-- branch) never had its trigger fire, so its subject row is still
-- stuck at its original draft/pending status. A plain re-UPDATE of the
-- same row to the same status is a no-op in Postgres (no row-level
-- trigger fires when old and new are identical), so those historical
-- rows need an explicit nudge: flip to 'pending_approval' and back to
-- 'auto_approved' in two statements, exactly mirroring the fixed
-- function's own new shape, so their sync trigger finally fires once.
-- Safe to run any number of times: a row whose subject has already
-- moved on (e.g. already manually approved/paid another way) simply
-- has its trigger's own idempotent `where status = 'drafted'`-style
-- guard skip it, per every sync_*_on_task_decision function's own
-- existing logic.
update public.approval_tasks set status = 'pending_approval' where status = 'auto_approved';
update public.approval_tasks set status = 'auto_approved' where status = 'pending_approval' and resolved_via = 'auto_approved';
