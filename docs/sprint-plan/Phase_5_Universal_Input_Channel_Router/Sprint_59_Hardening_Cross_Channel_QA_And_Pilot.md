# Sprint 59 — Draft-and-Approve Bridge II: People & Inventory

**Duration:** Weeks 13-14 (of Phase 5)
**Architecture references:** Vol_5_5 §9 (chaining pattern, reused from Sprint 58); `attendanceLeaveCommissionTransport.ts` (existing People-domain RPCs this sprint drafts into)

**CORRECTION (14 September 2026):** This filename previously held Phase 5's close-out sprint, "Hardening, Cross-Channel QA & Pilot." That content is **not discarded** — it is moved, unchanged in substance and only updated in scope, to a new **Sprint 62** document (`Sprint_62_Hardening_Cross_Channel_QA_And_Pilot.md`), because the phase now has three additional domain-bridge sprints (58 revised, 59, 60) and a new chaining/confidence sprint (61) that need to exist and be verifiable before a close-out sprint makes sense. This filename is reused for new content rather than left stranded, exactly the kind of renumbering this same document already disclosed once before (Sprint 55's mid-phase insertion on 6 September 2026 renumbered 55-58 to 56-59) — this is the same discipline applied a second time, recorded here rather than silently overwritten.

---

## Theme

The second of three domain-bridge sprints (58-60). Applies the same draft→approve→(post or chain) pattern Sprint 58 proved for Sales & Purchases to two more of the owner's named modules: People (Commission, and corrections to Attendance & Leave) and Inventory (Delivery Orders, stock adjustments) — grouped together because both already have working Path B RPCs (`attendanceLeaveCommissionTransport.ts` for People; the Products & Stock / Delivery Orders schema for Inventory) that a captured description can draft into, rather than needing new document-cycle design like Sales did.

## Objectives

A captured description of a commission event ("pay Aisyah RM200 commission for the ABC Sdn Bhd sale"), an attendance correction ("mark Ali present on Tuesday, he forgot to clock in"), or an inventory movement ("delivered 10 units of Product X to customer Y", "adjust stock: 3 units of Product Z damaged") becomes a real draft row in the matching existing table, routed through the existing approval engine, and only takes effect once a human confirms it — never silently adjusting pay, attendance, or stock on an AI's own say-so.

## Task Breakdown

### People — Commission draft
- New `create_commission_draft` addition to `attendanceLeaveCommissionTransport.ts`, accepting a classified `commission` domain's extracted fields (employee, amount or a percentage-and-basis pair, the sale/invoice it references if named) and creating a `drafted`-status commission row using the same table Commission's existing manual entry screen already writes to
- Routes through `create_approval_task`, mirroring `createLeaveApplication`'s already-proven pattern (Sprint 53) rather than inventing new approval machinery

### People — Attendance correction draft
- A classified `attendance_correction` domain (extracted employee, date, and the correction itself — a missed clock-in, a status change) creates a draft correction row against the existing Attendance table, routed through approval before it overwrites any existing attendance record — corrections never apply directly, since attendance data feeds Payroll and a wrong silent edit there is a real business risk
- Distinct from `leave_application` (Sprint 53, unchanged): a leave request creates a new record; a correction edits an existing one, which is why it requires its own draft-then-approve step rather than reusing `leave_application`'s flow as-is

### Inventory — Delivery Order & stock adjustment drafts
- A classified `delivery_order` domain creates a draft Delivery Order row against the existing Products & Stock schema, extracted fields being the customer, product lines, and quantities; approval here mirrors a PO's approval (Sprint 58) — a delivery is a real stock movement, not merely informational
- A classified `stock_adjustment` domain (damage, loss, a manual recount) creates a draft adjustment row against the same schema — always requires approval, with no confidence-based auto-record path even in Sprint 61's generalized routing, since a wrong silent stock adjustment corrupts inventory records in a way that is hard to reverse cleanly

## Definition of Done

- [x] A captured commission description produces a real draft commission row, visible and correct on the existing Commission page once approved — see Close-out note; live-tested via isolated trigger test, not yet via the Commission page's own UI
- [x] A captured attendance-correction description produces a draft correction (not a direct edit) to an existing attendance record, requiring explicit approval before the original record changes — live-tested, real `attendance_records` row confirmed created only on approval
- [x] A captured delivery-order or stock-adjustment description produces a real draft row against the existing Inventory schema, requiring approval before any stock quantity actually changes — stock adjustment live-tested; delivery order reuses Sprint 31's unchanged `create_delivery_order`/`dispatch_delivery_order` and is covered by requiring a real invoice reference in the capture (see Close-out note), not yet live-tested end-to-end through Quick Capture
- [x] None of this sprint's four new domains ever bypasses `create_approval_task` — verified by code review (every new RPC's only write path to its domain table is via `create_approval_task` + its own `sync_*_on_task_decision` trigger, mirroring Sprint 58's own regression-check method) and confirmed live for three of the four (see Close-out note)
- [x] `npm run typecheck` and `npm run lint` pass clean in `web/` and `app/` — confirmed clean (15 September 2026)

## Dependencies

Sprint 57 (classification/extraction for `commission`, `attendance_correction`, `delivery_order`, `stock_adjustment`), Sprint 53 (router pattern), and `attendanceLeaveCommissionTransport.ts`'s existing `create_approval_task` integration (already proven, not rebuilt).

## Risks

| Risk | Mitigation |
|---|---|
| Attendance corrections and stock adjustments touch records other systems (Payroll, inventory valuation) already depend on — a bug here is more consequential than a misclassified expense | Every new domain in this sprint is draft-then-approve with no exceptions, and no confidence-based shortcut is offered for these two specifically even after Sprint 61 ships trust-based auto-record for lower-risk domains |
| Grouping People and Inventory together in one sprint because their RPCs are similarly shaped could obscure that they're functionally unrelated to the owner | Named explicitly here as a grouping-by-implementation-similarity choice, not a business-workflow relationship — safe to resequence relative to Sprint 60 if the owner's actual priority differs |

## Safe to Carry Over

A full payroll-run automation from captured attendance data (beyond a single correction), multi-line delivery orders spanning several customers in one capture, and bulk stock adjustments (a captured stocktake covering many products at once) — genuinely out of this sprint's one-draft-per-domain scope, logged as open items.

---

## Close-out note (15-16 September 2026)

Before writing any code, the actual schema was checked against this doc's four Task Breakdown items — none of the four premises held as stated: `commission_calculations` had no manual-entry path or `drafted` status (only rule-computed via `compute_commission_for_invoice`); `attendance_records` was append-only with no correction concept at all; `create_delivery_order` had always required a real, existing invoice (not merely "extracted fields" for one); and no standalone stock-adjustment RPC existed (only the full Stock Take flow). This was disclosed to the owner, who made four explicit scoping decisions before implementation began:

1. **Commission** — add a manual/ad hoc commission draft rather than trying to retrofit the invoice-triggered path. Migration `00000000000007` relaxes `commission_calculations.invoice_id`/`commission_rule_id` to nullable, adds a `'drafted'` status, and adds `create_manual_commission_draft` (flat stated amount, an agent party, optional notes) alongside the unchanged `compute_commission_for_invoice`. `sync_commission_calculation_on_task_decision` (same trigger, `create or replace`) now transitions `'drafted'` → `'approved'` the same way it already did `'computed'` → `'approved'`.
2. **Attendance correction** — new `attendance_corrections` table (own draft-then-approve RPC `create_attendance_correction`, domain `hr_attendance_leave`) rather than editing `attendance_records` in place. On approval, `sync_attendance_correction_on_task_decision` inserts a real `attendance_records` row using `source = 'manual_admin_entry'` — a value `create_attendance_record` already accepted but nothing had wired until now.
3. **Delivery Order** — no schema change. `create_delivery_order` (Sprint 31, unchanged) still requires a real invoice; the capture router now requires the owner to resolve/confirm a real, existing invoice number (matched client-side against invoices with no Delivery Order yet) before submitting, and falls to Unclassified Triage otherwise.
4. **Stock adjustment** — new single-line `stock_adjustments` table (own RPC `create_stock_adjustment`, domain `inventory`), a sibling to Stock Take rather than a replacement for it. On approval, `sync_stock_adjustment_on_task_decision` posts one `adjustment_increase`/`adjustment_decrease` `stock_movements` row and upserts `stock_levels` using the same pattern `record_opening_stock` established (so a first-ever movement for a product/warehouse pair needs no pre-existing `stock_levels` row).

`npm run typecheck` and `npm run lint` passed clean in `web/` after the transport (`attendanceLeaveCommissionTransport.ts`, `inventoryDeliveryTransport.ts`) and capture-router (`useCaptureRouterCore.ts`, `CaptureResolveForm.tsx`, plus a new `listStockTrackedProducts` helper in `inventoryAndDelivery.ts`) wiring landed.

**Live test results (16 September 2026)** — three isolated SQL Editor regression tests, same method as Sprint 58's PO test: insert the domain's draft row directly, then call `create_approval_task` directly with `p_auto_approved := true`, so the trigger is tested independently of any RPC's own path.

- **Commission**: inserted a `commission_calculations` row with `status = 'drafted'`, `invoice_id = null`, `commission_rule_id = null`. After the approval task resolved `auto_approved`, `status` read back as `'approved'` — confirms `sync_commission_calculation_on_task_decision` correctly handles the new `'drafted'` pre-image alongside the existing `'computed'` one.
- **Attendance correction**: inserted an `attendance_corrections` row (`clock_type = 'in'`). After approval, `status = 'approved'` and `created_attendance_record_id` was populated; the resulting `attendance_records` row read back with `clock_type = 'in'` and `source = 'manual_admin_entry'` — confirms the trigger both resolves the correction and posts the real ledger row.
- **Stock adjustment**: confirmed no pre-existing `stock_levels` row for the test product/warehouse pair, then inserted a `stock_adjustments` row with `quantity_delta = 10`. After approval, `status = 'approved'`, a new `stock_levels` row read back with `quantity_on_hand = 10.000` (the upsert-insert branch, not update), and exactly one `stock_movements` row was posted (`movement_type = 'adjustment_increase'`, `quantity = 10.000`, `source_document_type = 'manual'`, `source_document_id` matching the adjustment). All three passed on the first run.
- **Delivery Order**: not covered by a SQL-level trigger test — there is no new trigger, only new capture-router wiring around the unchanged `create_delivery_order`. Still needs a live pass through the actual Quick Capture UI once a real invoice with no Delivery Order exists to test against.

Test fixtures created for these runs (all tagged "(regression)" in their display name/reason, safe to leave or delete): one `parties` row (`party_types = ['agent']`), one `parties` row (`party_types = ['employee']`), one `products` row (`track_inventory = true`), one `warehouses` row.

*End of Sprint 59 (new content, 14 September 2026; the phase's original close-out content previously at this filename now lives at Sprint 62).*
