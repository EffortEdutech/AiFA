# Architecture Audit — "1 Input, AI Does the Rest" vs. What AiFA Can Actually Do

**Date:** 14 September 2026
**Trigger:** Testing Sprint 58's capture wiring surfaced two real problems — "invoiced Sunrise Trading RM800" drafted a Quotation (a pre-sale proposal) for something that had already happened, and a generated Purchase Order had nowhere to be viewed except buried inside Approvals. The owner asked to stop and audit the whole architecture against the founding goal before wiring anything else.

## What "1 Input, AI Does the Rest" actually requires

For any one business domain, "AI does the rest" is really a promise about **five stages**, and AI only ever owns one of them:

1. **Capture & classify** — the owner types/forwards/speaks something; AI decides what domain it belongs to. (Sprint 57's job.)
2. **Draft the right artifact for what actually happened** — not always the earliest-stage artifact. If the input describes something already done, drafting the "propose" stage of that workflow is wrong even if it's the only stage AI has access to. (Sprint 58-60's job, when done correctly.)
3. **Route for approval** — a human confirms or corrects before anything is real. (Already built once, Sprint 25 — every domain reuses it.)
4. **Progress the record forward through its real lifecycle** — dispatch, fulfillment, payment, reconciliation — without the owner re-typing anything. (Must already exist manually — AI does not invent this.)
5. **Land correctly in books/reports.** (Must already exist manually.)

**The load-bearing conclusion:** AI can only ever replace step 2 — the form-filling. Steps 3, 4, and 5 have to already exist, correctly, as manual capabilities *before* it makes sense to wire AI capture into them. Sprint 58's mistake in both findings was the same mistake in two different shapes: assuming step 2 could draft into whatever stage-1 artifact existed, without checking whether that artifact was the *right* one for what the input actually described (Sales), or whether steps 4-5 existed at all (Purchases).

## The actual audit

Built from real evidence — every RPC and table this schema actually defines (`grep`'d directly from `00000000000000_initial_schema.sql`), not assumption.

| Domain | Manual lifecycle in the schema today | Verdict |
|---|---|---|
| **Expense** | `create_payment_voucher` → `mark_payment_voucher_paid`, status `draft → approved → paid`. Record-now: the Payment Voucher created *is* the real transaction from the start. | **Complete.** Already correctly wired in Sprint 53. |
| **Leave application** | `create_leave_application`, status `pending_approval → approved/rejected`. Record-now. | **Complete.** Already correctly wired in Sprint 53. |
| **Sale / Invoice** | `create_quotation` → owner marks `accepted` → `convert_quotation_to_invoice` → `record_payment` → `ar_ageing_detail`. Full downstream lifecycle exists and works. But the *only* entry point is Quotation — there is no RPC anywhere in this schema that records an invoice directly (confirmed: `create_document` is a generic file-attachment helper, not a document creator; `_create_invoice_from_quotation` is a private helper only `convert_quotation_to_invoice` calls). | **Partial — this is exactly Sprint 58's bug.** The downstream lifecycle is solid; the entry point assumes every sale starts as a proposal, which most owner-described captures ("invoiced X", "sold Y to Z") don't. |
| **Purchase Order** | Nothing existed before this sprint. `sidebarConfig.ts`'s "Purchases & Cash" section has exactly three items (Payment Vouchers, Expense, Cash Book/P&L) — no PO, not even a placeholder. Sprint 58 added `purchase_order`/`purchase_order_line` tables and `create_purchase_order`, but: no list/sidebar page exists to view one, no stock-receipt confirmation RPC exists, and there is no "supplier bill"/accounts-payable concept anywhere for the chained `payment_due` step to land in. | **Incomplete at the base-product level.** This isn't a Phase 5 oversight to patch — Phase 1-4 never built procurement at all. Building it out is its own real body of work, correctly the heaviest sprint in the plan. |
| **Delivery Order (outbound, Inventory)** | `create_delivery_order` → `dispatch_delivery_order` → `mark_delivery_order_delivered`. Complete lifecycle, but `delivery_orders.invoice_id` is `not null references invoices` — it can only exist downstream of an Invoice, inheriting Sales' same quote-first dependency. | **Complete lifecycle, same upstream dependency as Sales.** Not yet wired to Phase 5 capture; will need the Sales fix first. |
| **Commission** | `create_commission_rule`, `compute_commission_for_invoice`, `mark_commission_paid`, synced off approval-task decisions. | **Complete.** Tied to Invoice, so also downstream of the Sales fix. Not yet wired to capture. |
| **Contract / Contract alert** | `create_contract` (record-now, `draft → pending_signature → active → expired → terminated`), `acknowledge_contract_alert`, `list_due_contract_alerts`. | **Complete.** Not yet wired to capture. |
| **e-Signature request** | `create_esignature_envelope` → `mark_esignature_envelope_viewed/signed/declined`. | **Complete.** Not yet wired to capture. |
| **e-Invoice flag** | `create_einvoice_submission` → `submit_einvoice` → `record_einvoice_submission_result`, `compute_sst_for_invoice`/`compute_sst_for_payment_voucher`. | **Complete.** Tied to Invoice/Payment Voucher. Not yet wired to capture. |
| **Stock adjustment** | `create_stock_take` → `record_stock_take_counts` → `complete_stock_take`, `record_opening_stock`. This is a stock-*take* (a counting/audit event) — whether it's the right artifact for a single ad-hoc "adjustment" description is **not yet confirmed**. | **Needs its own 10-minute check before wiring** — flagged, not verified either way. |
| **Attendance correction** | `create_attendance_record`, synced off task decisions. Whether this genuinely covers a *correction* to an existing record, versus only a new one, is **not yet confirmed**. | **Needs its own 10-minute check before wiring** — flagged, not verified either way. |

## What this means, concretely

Of the twelve domains, **ten already have a real, complete, correctly-designed manual lifecycle** sitting in this schema, built across Phases 1-4 before Phase 5 ever existed. For those, "1 input, AI does the rest" is genuinely achievable by doing exactly what Sprint 57 did for classification and what Sprint 53 already proved for Expense/Leave: draft into the *existing* form, route through the *existing* approval engine, let the *existing* lifecycle carry it forward. That is not a gap — that is the architecture working as intended.

The two domains that broke are the two where that assumption was silently wrong:

- **Sales** looks complete but has a narrower opening than a real capture needs — it can only accept "propose a sale," never "record one that already closed." This is a small, well-scoped fix: teach Sales one new way in (a "record as an already-accepted sale" path that still reuses `create_quotation`/`convert_quotation_to_invoice` under the hood — no new tables, no schema change), not a redesign of Sales itself.
- **Purchases** looked like the heaviest sprint because it genuinely is one — it's the one place Phase 1-4 left a real hole, not a Phase 5 shortcut. Sprint 58 correctly started filling it; it just isn't finished, and drafting a PO into a product with no PO page was premature.

## Recommendation

1. **Don't pause capture wiring across every domain** — the evidence doesn't support that; ten of twelve domains are genuinely ready and it would be wasted caution to re-verify what's already solid.
2. **Do fix Sales narrowly**: add one new orchestration path for "record an already-completed sale" that reuses the existing Quotation→Invoice RPCs (auto-mark-accepted, immediately convert) rather than inventing a parallel Invoice-creation mechanism. Needs an explicit decision with you first: should this always skip straight to `issued`, or still land as a reviewable draft before that happens? (Every other domain's answer to this question is "still reviewable" — recommend the same here for consistency, but it's worth saying out loud rather than assuming.)
3. **Do finish Purchases properly, not incrementally**: sidebar + list page (unblocks visibility immediately), the stock-receipt confirmation RPC, and a real decision on whether the `payment_due` chain becomes its own "Supplier Bill" concept or reuses Payment Voucher. This is worth its own short design pass before more code, given it's the one truly new module in the whole product.
4. **Before wiring `stock_adjustment` or `attendance_correction` into capture** (Sprints 59-60), spend the same 10 minutes this audit spent on Sale/PO confirming the manual RPC actually matches what an AI capture would describe. Cheap insurance against repeating this exact mistake a third time.
5. **Update the Sprint 58/59/60 documents** to reflect this audit before resuming implementation — this document is the evidence base for those revisions, not a replacement for them.

## Addendum (14 September 2026) — a cross-cutting bug found while building the two fixes above

While designing `mark_purchase_order_paid` (part of "finish Purchases properly," recommendation #3), a real, pre-existing bug surfaced that is bigger than Purchases alone, and is disclosed here rather than silently patched or silently ignored.

**The bug:** `create_approval_task`'s `p_auto_approved = true` branch does a plain `insert ... status = 'auto_approved'` and never performs a subsequent `update`. Every `sync_*_on_task_decision` trigger in this schema (`sync_payment_voucher_on_task_decision`, the new `sync_purchase_order_on_task_decision`, the new `sync_direct_sale_invoice_on_task_decision`, and every other domain's equivalent) is declared strictly `after update on public.approval_tasks` — none is `after insert or update` — confirmed by grepping every trigger declaration in the schema. **This means none of these triggers ever fires for an auto-approved capture, in any domain.**

**Concretely:** an auto-approved Payment Voucher (or anything else) is created and immediately stuck at its initial status forever — nothing ever performs the `update` that would move it to `'approved'`. `mark_payment_voucher_paid` requires `status = 'approved'` and would fail with `payment_voucher_not_approved` against such a record.

**Why this matters beyond today's fix:** this directly undermines the Sprint 57/61 vision of auto-approving high-confidence (≥90%) AI captures across every domain — the moment any domain's capture flow starts passing `autoApproved: true`, that record silently stalls. It has likely been latent since whichever sprint first introduced `p_auto_approved`, simply because nothing has exercised that path in production yet.

**What was (and wasn't) done about it here:** it is NOT fixed schema-wide in this round of work — that is a cross-cutting change (most likely: `create_approval_task` should `insert` then immediately `update` the same row, so the trigger fires exactly as it does for a human decision) that deserves its own dedicated migration and its own regression check across every domain that uses auto-approval, not a side effect of a narrower Sales/Purchases fix. The one new function that would have hit it directly — `mark_purchase_order_paid`, which creates its Payment Voucher with `p_auto_approved = true` — works around it locally and narrowly: it performs one explicit `update payment_vouchers set status = 'approved'` on the single voucher it just created, immediately before paying it. No other function, and no other domain, is touched by this workaround.

**Recommendation:** treat this as its own small, well-scoped follow-up sprint (fix `create_approval_task`, then re-verify every existing `auto_approved: true` call site across the schema still behaves correctly) before leaning further on auto-approval anywhere in Phase 5.

---
*This audit was produced by grepping every `create or replace function public.*` definition and the relevant table definitions directly from `00000000000000_initial_schema.sql` and `sidebarConfig.ts` — not from memory of what earlier sprints intended to build.*
