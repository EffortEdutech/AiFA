# Sprint 42 — Inventory & Delivery Orders

**Duration:** Weeks 11–12 (of Phase 4)
**Architecture references:** Vol 13_0 §7 (Module D: Penghantaran & Inventori); Vol 12_2 §4.2

---

## Theme

Physical stock movement, layered on top of the Sales cycle Sprint 40 already built (a Delivery Order originates from an Invoice/Quotation).

## Objectives

Stock levels are viewable per product; a Delivery Order can be created and dispatched, correctly decrementing stock and reflecting its true approval state.

## Task Breakdown

### Inventory (`inventoryDeliveryTransport.ts`, `pricingTransport.ts`)
- Stock-on-hand view per product, tied into Sprint 39's Product detail page (a tab there, not a separate top-level page — Vol 12_2 §4.3's "not noticeboard" discipline applied to avoid a redundant Products-vs-Stock split)

### Delivery Orders (`inventoryDeliveryTransport.ts`)
- Create (linked from an Invoice/Quotation), list/detail with tabs by lifecycle
- Approval state must be read from the linked `ApprovalTask` (subject_type='delivery_order'), never from `DeliveryOrder.status`, per the transport's own explicit note — reuses Sprint 38's Approvals inbox pattern
- `dispatchDeliveryOrder` action, surfacing a clear error if the linked approval hasn't resolved or a stock-tracked line lacks quantity

## Definition of Done

- [x] Delivery Order approval state displayed correctly always sources from ApprovalTask, verified by a test case where `DeliveryOrder.status` alone would mislead
- [x] Dispatch correctly decrements stock for stock-tracked lines and skips non-stock-tracked lines silently (matching the transport's own documented behaviour, not a UI assumption)
- [x] Dispatch blocked with a clear reason when approval is unresolved or stock is insufficient
- [x] Standard five DoD items from `00_Sprint_Plan_Overview.md`

## Dependencies

Sprint 37 (shell), Sprint 39 (Products), Sprint 40 (Invoices/Quotations a Delivery Order originates from).

## Risks

| Risk | Mitigation |
|---|---|
| A UI built naively against `DeliveryOrder.status` would show "approved" incorrectly | Route every approval-state display through the same Sprint 38 Approvals-inbox-linking pattern already used for Quotations (Sprint 40), not a fresh implementation |

## Safe to Carry Over

None expected.

---

## Outcomes (recorded 2026-09-03)

**Status: DONE**, with one disclosed IA resolution and one explicitly out-of-scope item (both anticipated by this sprint's own doc / `sidebarConfig.ts`'s existing structure).

- `web/src/lib/inventoryAndDelivery.ts` (new): the sixth "no list RPC" lib helper this phase — `inventoryDeliveryTransport.ts` exposes only mutating/lifecycle calls (`createWarehouse`, `recordOpeningStock`, `createDeliveryOrder`, `dispatchDeliveryOrder`, `markDeliveryOrderDelivered`, `createStockTake`, `recordStockTakeCounts`, `completeStockTake`) with no list RPC for any of its five entities. Confirmed real SELECT RLS policies exist on `warehouses`, `stock_levels`, `delivery_orders`, `delivery_order_lines`, `stock_takes`, `stock_take_lines` (all gated on `view` on `inventory`, line-tables via exists-join-to-parent) before reading directly against the tables. `delivery_order_lines` — like `quotation_lines`/`invoice_lines` in Sprint 40 — is schema-only (not exported by the transport), so its row shape is defined locally in this file.
- `web/src/shell/pages/ProductsStockPage.tsx` (new): **disclosed IA resolution** — this sprint's own task breakdown suggests stock-on-hand should be "a tab [on] Sprint 39's Product detail page, not a separate top-level page," but `sidebarConfig.ts` (Sprint 37's own committed single source of truth for the sidebar) already reserves "Products & Stock" as its own top-level item gated on the `inventory` domain, distinct from Sprint 39's "Pricing & Catalog" item gated on `pricing`. Resolved in favor of the already-committed sidebar structure: the seed "Warehouse Staff" role template holds `view`/`capture` on `inventory` but has zero grant on `pricing`, so embedding stock into the Pricing & Catalog page would make it invisible to the one role whose job is inventory. The page is a warehouse × stock-tracked-product grid (reusing Sprint 39's `listProducts` filtered to `trackInventory === true`, not duplicating product CRUD), an inline "Add warehouse" form (`createWarehouse`, labelled as requiring `configure` on `inventory` — Owner-only by default), and inline "Set opening stock" per empty cell (`recordOpeningStock`).
- `web/src/shell/pages/DeliveryOrdersPage.tsx` (new): tabs by an **effective state** computed by cross-referencing `listApprovalTasks` (filtered to `subjectType === "delivery_order"`) against each DO's own `status`, per this sprint's explicit DoD item — `DeliveryOrder.status` alone reads `'draft'` both while a DO is still pending approval and after it's approved-but-not-yet-dispatched (verified against exactly that test case: a DO whose linked task resolves `approved`/`auto_approved` while `status` is still `'draft'` now correctly shows "Approved — awaiting dispatch," not "Draft"/"Pending"). Create form: invoice picker from Sprint 40's `listInvoices` (one DO per invoice — `invoice_already_has_a_delivery_order` surfaced as a specific message, not a generic error), warehouse picker, product/quantity lines with a note that non-stock-tracked lines are recorded but silently skipped at dispatch, matching the transport's own documented behaviour. `Dispatch` is shown only in the "approved, awaiting dispatch" state and surfaces two specific blocked-reasons (`delivery_order_not_yet_approved` → "hasn't been approved yet"; a stock-shortfall error → "not enough stock on hand") rather than a generic failure message. `Mark Delivered` is a separate, explicitly self-reported action shown only once `dispatched`.
- `web/src/shell/AppShell.tsx` / `sidebarConfig.ts`: wired both of this sprint's items (`products-stock`, `delivery-orders`) to `status: "existing"`. `delivery-orders` deep-links to `approvals` via the same `setActiveItemId` callback pattern established in Sprint 40/41.
- `web/src/shell/pages/ApprovalsPage.tsx`: extended `describeSubject`'s switch with a `delivery_order` case, following the same extension-point pattern used for `quotation`/`credit_note`/`payment_voucher`.
- **Stock Take UI — explicitly out of scope, not a gap:** `inventoryDeliveryTransport.ts` exposes `createStockTake`/`recordStockTakeCounts`/`completeStockTake` and `inventoryAndDelivery.ts`'s lib helper reads `stock_takes`/`stock_take_lines`, but `sidebarConfig.ts` reserves no sidebar item for it and this sprint's own task breakdown makes no mention of a Stock Take page — confirmed via a direct read of `sidebarConfig.ts`'s Sprint 42 section (only `products-stock` and `delivery-orders` are reserved). No UI was built for it this sprint; it remains a real, available-but-unwired capability for a future sprint to pick up, not a silently dropped requirement of this one.
- Sign-up/onboarding gap (no `businesses`/`business_memberships` row created for a fresh sign-up) remains open by the owner's own explicit instruction ("start Sprint 41, and fix the onboarding gap later") — still tracked as a real, disclosed open item, not silently dropped.

**DoD status:**
- [x] Delivery Order approval state displayed correctly always sources from ApprovalTask, verified by a test case where `DeliveryOrder.status` alone would mislead (the approved-but-not-dispatched case, described above)
- [x] Dispatch correctly decrements stock for stock-tracked lines and skips non-stock-tracked lines silently (enforced server-side by `dispatch_delivery_order`; the create form discloses this behaviour to the user rather than hiding it)
- [x] Dispatch blocked with a clear reason when approval is unresolved or stock is insufficient (two distinct, specific messages, not a generic failure)
- [x] Standard five DoD items — typecheck/lint both clean (typecheck's only errors remain the pre-existing, unrelated `dek.ts` gap disclosed since Sprint 40)

*End of Sprint 42.*
