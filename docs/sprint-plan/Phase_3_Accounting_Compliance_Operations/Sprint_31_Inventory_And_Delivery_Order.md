# Sprint 31 — Inventory & Delivery Order

**Duration:** Weeks 21–22 (of Phase 3)
**Architecture references:** Vol 13_0 §7 (Penghantaran & Inventori)

---

**Status: ✅ COMPLETE — 3 September 2026**

## Outcomes (recorded 3 September 2026)

`public.warehouses`, `public.stock_levels`, `public.stock_movements`, `public.delivery_orders`/`delivery_order_lines`, and `public.stock_takes`/`stock_take_lines` all live with RLS in `app/backend/migrations/sprint31_inventory_and_delivery_order.sql`, appended to `app/backend/schema.sql` (5872 → 6551 lines). Client-side: `packages/core/src/sync/inventoryDeliveryTransport.ts`, type-checks clean (only the same pre-existing, unrelated environment errors present since earlier sprints). Verification: `app/backend/verification/sprint31_inventory_delivery_test.py` — every check passes against a full replay of the real, cumulative `app/backend/schema.sql` (Phase 1/2 base through Sprint 31), including a genuine 3-trial threaded concurrency race. No bugs found in existing code this sprint — everything passed on the first full run.

**The concurrent-dispatch race, verified with real concurrency, not just sequential calls (this sprint's own named risk):** two Delivery Orders were drafted and approved against the same 10-unit stock position, each requesting 6 units — more than the 10 available combined. `dispatch_delivery_order` was called from two genuinely separate database connections, synchronized to fire at the same instant with a `threading.Barrier`, the identical discipline Sprint 15's own concurrency test used for the device-activation lock. Across 3 trials, exactly one dispatch succeeded and one was rejected with `insufficient_stock_for_product_...` every time, and the final `quantity_on_hand` was exactly 4 (10 − 6) in every trial — never negative, never double-decremented. The mechanism is a `select ... for update` lock on the specific `stock_levels` row before it's read or decremented, the same per-row-locking discipline `mark_payment_voucher_paid` (Sprint 30) already used for its own target row.

**A disclosed schema-consistency addition:** `business_id` is added directly to `stock_levels` and `stock_movements`, even though Vol 13_0 §7's own schema block lists neither column on those two tables (a business would technically be derivable via a join through `product_id`/`warehouse_id`). Every RLS-scoped table in this schema has carried its own `business_id` for direct policy checks since Sprint 22 without exception; this sprint follows that existing convention rather than introducing a new one.

**A disclosed non-decision, following Quotation's own Sprint 28 precedent rather than PaymentVoucher's Sprint 30 one:** `delivery_orders.status` does NOT gain an `'approved'` value. Unlike PaymentVoucher, which genuinely needed a stored "authorized but not yet paid" state, a DO's approval state lives entirely on its linked ApprovalTask row — `dispatch_delivery_order` checks it directly with the exact idiom `mark_quotation_sent`/`convert_quotation_to_invoice` already use. A `'rejected'` value WAS added (the same disclosed enum-extension precedent reused a fourth time, after `blocked_awaiting_reviewer`, Quotation, and PaymentVoucher).

**Disclosed gating split:** warehouse creation requires `configure` on `inventory` (only the Owner holds this among the six system role templates), while every day-to-day inventory action — opening stock, delivery order creation/dispatch/delivered, stock takes — requires only `capture`, matching Warehouse Staff's actual role grant exactly. Verified directly: Warehouse Staff can do everything day-to-day but cannot create a warehouse; Payroll Admin (no inventory grants at all) is rejected from opening-stock entry; Sales Agent (no inventory capture) is rejected from creating delivery orders and stock takes.

**Other disclosed simplifications:** a non-stock-tracked product's Delivery Order line (Product.track_inventory = false, e.g. a service) posts no StockMovement and touches no StockLevel — verified directly. `invoices.delivery_order_id` (pre-declared in Sprint 28 specifically for this sprint) now has its real foreign key; because it's a single scalar column, an invoice can link at most one DeliveryOrder, and `create_delivery_order` rejects a second attempt against an already-linked invoice — genuine multi-shipment-per-invoice is out of scope, a limitation of the volume's own schema shape. DeliveryOrder line quantities are not cross-validated against the linked invoice's own line quantities, a disclosed gap rather than a half-built partial-shipment check. `mark_delivery_order_delivered` was added to complete the volume's own literal draft→dispatched→delivered lifecycle even though the DoD didn't explicitly require it, mirroring the same self-reported-external-event pattern as `mark_quotation_sent`/`mark_payment_voucher_paid`.

**Purchase-Side Cost Auto-Calc — explicitly deferred, exactly as this sprint's own Task Breakdown anticipated:** the Sprint 21 Purchase Operations addendum (Vol 13_0 §4a) remains a design stub only; no `public.purchase_invoices` table exists in any sprint to date, and `create_product` (Sprint 27) already hard-rejects `cost_source = 'auto_from_purchase'` for exactly this reason. Nothing to wire this sprint; flagged per the item's own wording rather than silently skipped.

## Theme

Opens Sub-phase 3c. Builds real stock tracking on top of Sprint 27's product catalog and Sprint 28's invoicing — the point where "Delivery Order dispatched" automatically decrements inventory, closing the exact automation the owner asked for.

## Objectives

Products can be stock-tracked with opening balances, a Delivery Order linked to an Invoice correctly decrements `StockLevel` on dispatch, and a Stock Take correctly generates adjustment movements from counted variances.

## Task Breakdown

### Schema
- `public.warehouses`, `public.stock_levels`, `public.stock_movements`, `public.delivery_orders` / lines, `public.stock_takes` (+ lines) per Vol 13_0 §7
- Enable `track_inventory` on `Product` (stubbed since Sprint 27) and wire opening-stock entry as a `StockMovement(opening)` row

### Automation
- `DeliveryOrder.status → dispatched` posts one `StockMovement(delivery_out)` per line and decrements `StockLevel` — the concrete "inventori akan ditolak secara automatik" requirement
- Stock Take completion generates variance `StockMovement(adjustment_increase/decrease)` rows per counted line, never edits `StockLevel` directly
- Delivery Order routes through `ApprovalTask` (`domain = inventory`)

### Purchase-Side Cost Auto-Calc (closes the Sprint 21 gap-closure item)
- If the Sprint 21 Purchase Operations addendum is ready, wire `Product.default_cost` auto-recalculation on purchase receipt (weighted average, Vol 6_5 §4); if not ready, this stays deferred and flagged explicitly rather than silently skipped

## Definition of Done

- [x] Opening stock entry works correctly
- [x] Delivery Order dispatch correctly and atomically decrements stock, verified with a concurrent-dispatch test (two DOs for the same product near-simultaneously) to confirm no lost update
- [x] Stock Take variance-to-adjustment generation verified against a manually-counted test scenario
- [x] Delivery Order approval-gated through the real engine

## Dependencies

Sprint 27 (Product), Sprint 28 (Invoice, for DO linkage), Sprint 25 (approval engine).

## Risks

| Risk | Mitigation |
|---|---|
| Concurrent dispatches for the same low-stock product cause a lost-update race (two DOs both read stock=5, both decrement, stock goes negative incorrectly) | Explicit concurrency test required in Definition of Done, not assumed safe — use the same real-concurrency testing discipline Sprint 15 applied to the device lock |
| Weighted-average costing math implemented incorrectly | Verify against a hand-calculated reference scenario before relying on it for Sprint 32's valuation reports |

## Safe to Carry Over

Multi-warehouse support exists in the schema (Section `warehouses`) but a single default warehouse per business is an acceptable functional minimum for this sprint if multi-location isn't yet needed by the pilot business.

---

*End of Sprint 31.*
