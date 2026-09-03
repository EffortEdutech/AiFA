# Sprint 31 — Inventory & Delivery Order

**Duration:** Weeks 21–22 (of Phase 3)
**Architecture references:** Vol 13_0 §7 (Penghantaran & Inventori)

---

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

- [ ] Opening stock entry works correctly
- [ ] Delivery Order dispatch correctly and atomically decrements stock, verified with a concurrent-dispatch test (two DOs for the same product near-simultaneously) to confirm no lost update
- [ ] Stock Take variance-to-adjustment generation verified against a manually-counted test scenario
- [ ] Delivery Order approval-gated through the real engine

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
