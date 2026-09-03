# Sprint 27 — Pricing & Product Catalog

**Duration:** Weeks 13–14 (of Phase 3)
**Architecture references:** Vol 13_0 §5 (Harga & Kos Jualan)

---

## Theme

Products, price types, and the price-list resolution rule (`PRICE-001`) that Sprint 28's Invoice/Quotation module depends on for "the right customer sees the right price" without any manual lookup.

## Objectives

An owner (or a role with `pricing: capture`) can create products, define price types (Retail/Stokis/Ejen/Dropship or business-specific equivalents), set per-product-per-price-type prices with effective dates, assign a customer's default price type, and the resolution order (Party → PriceListEntry, falling back to business default) works correctly and is externalised as a Finance PKA rule, not inline logic.

## Task Breakdown

### Schema
- `public.price_types`, `public.products`, `public.price_list_entries` per Vol 13_0 §5
- `products.cost_source` (`manual`/`auto_from_purchase`) — this sprint implements `manual` fully; `auto_from_purchase` is stubbed pending the Purchase module addendum from Sprint 21's gap-closure

### Finance PKA
- Add rule `PRICE-001` (price resolution order) as a versioned Finance PKA Knowledge Object, per Vol 13_0 §5's explicit instruction not to hardcode this in the capture pipeline
- Wire the AI drafting pipeline (used by Sprint 28) to consult `PRICE-001` rather than a hardcoded lookup

### Product Import (pulled forward from Vol 13_0 §7 since it's needed before real product catalogs exist)
- Minimal Excel import staging (`ProductImportBatch` per Vol 13_0 §7) — parse → validate → owner review → commit, same never-silently-guess discipline as Vol 0_1 §7's OCR failure handling
- Full inventory-tracking fields (`track_inventory`, stock levels) stay stubbed until Sprint 31; this sprint only needs the product catalog itself

## Definition of Done

- [ ] Products, price types, and price list entries CRUD-able with correct role gating (`pricing` domain, Sprint 25's engine)
- [ ] Price resolution correctly picks the customer's assigned price type, falling back to default, verified by test with at least three price types
- [ ] `PRICE-001` exists as an externalised, versioned rule, not inline code
- [ ] Excel product import works end to end including a deliberately-bad row surfaced for correction, not silently dropped or guessed

## Dependencies

Sprint 26 (`Party`, `ChartOfAccounts`). Sprint 25 (role gating on the `pricing` domain).

## Risks

| Risk | Mitigation |
|---|---|
| Excel import format assumptions don't match how the owner's real product lists are structured | Get a real sample file from the owner during this sprint, not a synthetic one, before finalising the parser |
| `auto_from_purchase` stub creates a half-finished feature that confuses users before Purchase module exists | Hide the option in UI entirely until the Purchase addendum ships; `manual` is the only visible cost-entry method this sprint |

## Safe to Carry Over

Promotions/promo-note polish (Vol 13_0 §5's `promo_note` field) can ship as a bare text field this sprint; richer promotion rules are not in scope for Series 13 at all per Vol 13_0's own module boundary.

---

*End of Sprint 27.*
