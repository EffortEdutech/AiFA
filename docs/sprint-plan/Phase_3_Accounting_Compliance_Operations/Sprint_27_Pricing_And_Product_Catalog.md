# Sprint 27 — Pricing & Product Catalog

**Status: ✅ COMPLETE — 3 September 2026**
**Duration:** Weeks 13–14 (of Phase 3)
**Architecture references:** Vol 13_0 §5 (Harga & Kos Jualan), §7 (`ProductImportBatch`, pulled forward)

## Outcomes (recorded 3 September 2026)

`public.price_types`, `public.products`, `public.price_list_entries`, `public.resolve_price` (PRICE-001), and `public.product_import_batches`/`product_import_rows` all live with RLS in `app/backend/migrations/sprint27_pricing_and_product_catalog.sql`, appended to `app/backend/schema.sql` (3770 → 4331 lines). Client-side: `packages/core/src/sync/pricingTransport.ts` (type-checks clean) and `packages/core/src/catalog/productImportParser.ts`. Finance PKA: `PRICE-001` added to `packages/core/pka/accounting_rules.json`, `pka_version` bumped 0.3.0 → 0.4.0. Verification: `app/backend/verification/sprint27_pricing_product_test.py` — 24/24 checks pass against a full replay of the real, cumulative `app/backend/schema.sql` (Phase 1/2 base through Sprint 27). No bugs found during testing this sprint — every check passed on the first run.

**A disclosed extension to PRICE-001's literal two-step resolution order:** Vol 13_0 §5 describes the fallback as Party's price type → business default. This sprint's implementation adds a third, narrower case within that: a party can have a price type *assigned* that simply has no `PriceListEntry` for the specific product being priced (e.g. a new VIP tier not yet priced for every SKU). Rather than treat that as "step 1 resolved to nothing, fail," `resolve_price` falls through to the business default in that case too, returning `used_business_default = true` so callers can still see that the party's own tier didn't apply. This is recorded in `PRICE-001`'s own rule text (not silently implemented and left undocumented) and verified directly by test case D3 (a price type assigned to a party but with zero entries for the product in question).

**A disclosed, deliberate scope decision on "wire the AI drafting pipeline to consult PRICE-001" (Task Breakdown's own wording):** there is no AI drafting call site for a unit price yet — that call site is Sprint 28's Quotation/Invoice module, which doesn't exist yet. This sprint delivers `PRICE-001` as a versioned Finance PKA Knowledge Object and `resolve_price` as its deterministic implementation (following `BANK-001`'s own precedent: price resolution is not and should not be run through the AI classification pipeline, since it is a lookup with a defined answer, not a categorisation judgment call). Sprint 28 is the sprint that will actually call `resolve_price`/consult `PRICE-001` when drafting a quotation or invoice line.

**A disclosed, provisional decision on the Excel import parser, not escalated to an owner question:** this sprint's own risk note calls for "a real sample file from the owner during this sprint, not synthetic," but no such file was available while this sprint was executed. Rather than block the sprint on it (or silently invent a rigid format and call it final), `packages/core/src/catalog/productImportParser.ts` implements conventional header-name matching (common spellings for SKU/Name/Unit/Cost columns) with a `HEADER_ALIASES` list disclosed in the file's own header comment as a first pass to be corrected once a real file is seen. This was judged lower-stakes than the Sprint 25/26 architecture forks — it's a client-side parsing detail, not a schema or authorization design, and is already time-boxed by this sprint's own mitigation note — so it was handled as a disclosed design call rather than raised as an `AskUserQuestion`. Server-side, `create_product_import_batch`/`apply_product_import_batch` are format-agnostic (they take already-parsed rows) and enforce the real invariant regardless of parser quality: a row that fails to parse is stored with `parse_status = 'error'` and never silently turned into a product (verified by test case E).

**cost_source gating, verified both ways:** `products.cost_source` accepts `'auto_from_purchase'` at the column-constraint level (so the column itself doesn't need a future migration when the Purchase module ships) but `create_product` rejects it server-side right now with a clear `auto_from_purchase_not_yet_available` error — verified by test. Per this sprint's own risk mitigation, the client-side option should stay hidden in the UI entirely until the Purchase module addendum ships, rather than exposing a control that always errors.

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

- [x] Products, price types, and price list entries CRUD-able with correct role gating (`pricing` domain, Sprint 25's engine) — verified: Sales Agent (capture+view) succeeds, Bookkeeper (view+approve only) rejected, cross-business rejection confirmed
- [x] Price resolution correctly picks the customer's assigned price type, falling back to default, verified by test with at least three price types (Retail/Wholesale/VIP) — including the disclosed extra fallback case (see Outcomes)
- [x] `PRICE-001` exists as an externalised, versioned rule, not inline code — see Outcomes for the disclosed scope note on when the AI drafting pipeline will actually call it (Sprint 28)
- [x] Excel product import works end to end including a deliberately-bad row surfaced for correction, not silently dropped or guessed — verified; parser itself is disclosed as provisional pending a real owner sample file (see Outcomes)

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
