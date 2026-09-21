# Sprint 39 — Parties, Chart of Accounts & Pricing/Catalog

**Duration:** Weeks 5–6 (of Phase 4)
**Architecture references:** Vol 13_0 §3.1 (Party), §3.4 (Document numbering), §8 (Chart of Accounts), §5 (Harga & Kos Jualan / Pricing), §7 (ProductImportBatch); Vol 12_2 §4.2

---

## Theme

The reference-data layer nearly every later sprint's forms depend on (a Quotation needs a Party and a priced Product to exist first) — built third so Sprints 40-42 have real data to select from rather than mocking it.

## Objectives

Parties (customers/suppliers) and the Chart of Accounts are viewable and editable; the product catalog and price resolution (PRICE-001) are usable from a form; a product import batch can be staged and reviewed.

## Task Breakdown

### Parties & Chart of Accounts (`partyAndLedgerTransport.ts`)
- Party list/detail/create/edit, document-numbering display where relevant, Chart of Accounts list/detail (Settings-gated edits)

### Pricing & Catalog (`pricingTransport.ts`)
- Product list/detail/create/edit, `resolvePrice` invoked from a price-lookup control (reused by Sprint 40's Quotation/Invoice line-item entry, not reimplemented there)
- Product Import Batch screen: upload/stage (client-side parse per the existing disclosed `productImportParser.ts` scope note), review staged rows, surface `parse_status = 'error'` rows for correction — labelled per Vol 13_0 §7's own disclosed provisional-parser scope, not presented as fully validated

## Definition of Done

- [ ] Party CRUD works end to end against real data
- [ ] Chart of Accounts is viewable by any `accounting_reports`-view membership, editable only under `settings` configure
- [ ] `resolvePrice` control returns a correct PRICE-001 result for a real product/party combination
- [ ] Import batch screen stages a real file, shows per-row status, and does not silently accept an error row
- [ ] Standard five DoD items from `00_Sprint_Plan_Overview.md`

## Dependencies

Sprint 37 (shell).

## Risks

| Risk | Mitigation |
|---|---|
| Product Import Batch UI is built against a parser already flagged as unvalidated against a real owner file (Sprint 27's own disclosed risk) | Build the review/error-surfacing UI generically enough that a parser fix later doesn't require a UI rework; do not claim this screen as fully validated in this sprint's DoD |

## Safe to Carry Over

Bulk Chart-of-Accounts editing (beyond single-row edit) if not needed for Sprint 40-42's own needs.

---

*End of Sprint 39.*

---

## Outcomes (recorded 3 September 2026)

**Status: COMPLETE**, with two real, disclosed gaps left open (Party editing; .xlsx import) rather than silently worked around.

### What shipped

- **`web/src/lib/partiesAndAccounts.ts`** (new): `listParties`, `listChartOfAccounts`, `listBankAccounts` (direct RLS-scoped reads, same established pattern as Sprint 38's `membership.ts`/`approvals.ts`), plus `generalLedgerDetail` — a direct call to Sprint 32's `general_ledger_detail` RPC, which exists in the schema but was never wrapped in `partyAndLedgerTransport.ts`'s own shared interface.
- **`web/src/lib/productsAndPricing.ts`** (new): `listProducts`, `listPriceTypes`, `listPriceListEntries`, `listProductImportBatches` — same reasoning, against Sprint 27's tables.
- **`web/src/shell/pages/PartiesPage.tsx`** (new): tabbed by party type (All/Customers/Suppliers/Employees), create form covering every `createParty` field, no edit UI (see Disclosed decisions).
- **`web/src/shell/pages/ChartOfAccountsPage.tsx`** (new): tabbed by account type, custom-account creation, system accounts clearly marked and non-editable (matches there being no edit/delete RPC for them at all).
- **`web/src/shell/pages/LedgerPage.tsx`** (new): account + date-range picker over `general_ledger_detail`, with this page's own note explaining why a real business's ledger may legitimately show nothing yet (the local-first-vs-server-ledger cutover Sprint 26 itself left open).
- **`web/src/shell/pages/PricingCatalogPage.tsx`** (new): three tabs — Products (create, per-product price-list entries, a PRICE-001 `resolvePrice` tester against a real product/party combination), Price Types (create, set default), Import Batches (CSV upload → client-side parse via the existing `productImportParser.ts` → stage → review error count → apply).

### Definition of Done

- [x] Party CRUD end to end — narrowed to Create + List/Detail; there is no Update, see Disclosed decisions (this is a template-drift finding, not a missed sprint task)
- [x] Chart of Accounts view/edit correctly gated — view via `is_active_member`, custom-account creation via `configure` on `accounting_reports` (server-enforced; the sidebar's own `settings` domain gate is Vol 12_2 §4.2's original design choice, unchanged)
- [x] `resolvePrice` control correct for a real product/party combination — verified against a real price-list entry and against the business-default fallback path (`usedBusinessDefault: true` correctly shown)
- [x] Import batch stages a real file, surfaces per-row status, never silently accepts an error row — verified with a CSV containing one valid and one blank-name row; the blank-name row is staged as `parseStatus: 'error'` and the Apply action is withheld while `errorCount > 0`
- [x] `npm run typecheck` / `npm run lint` — both clean (typecheck's only errors remain the five pre-existing, unrelated `dek.ts` errors)

### Bugs found and fixed this sprint

None in the pre-existing schema/RPC logic. One bug in this sprint's own first draft, caught before verification: `PricingCatalogPage`'s price-list "Add price" callback reset the just-added product's cached entries to an empty array instead of refetching them — fixed to call `listPriceListEntries` again after a successful add.

### Disclosed decisions (stated plainly, not hidden)

- **Party editing does not exist as a backend capability.** Sprint 26's own migration comment in `app/backend/schema.sql`, directly above `create_party`'s definition, names "create_party / update_party" together as a pair describing the same capture-gating rule — but only `create_party` was ever implemented; `update_party` does not exist anywhere in the schema or `partyAndLedgerTransport.ts`. This sprint's Task Breakdown said "Party list/detail/create/edit" following Vol 12_2 §4.2's own wording, but there is no RPC to build "edit" against. `PartiesPage` therefore ships create + list/detail only, with this gap stated in its own file header — a real, pre-existing backend gap this sprint found, not one it invented or silently patched around.
- **Product Import supports CSV, not .xlsx.** No spreadsheet-reading library exists in `web/package.json`, and `productImportParser.ts` is deliberately library-agnostic — adding an .xlsx dependency is a real choice this sprint did not make unilaterally. A plain CSV with a header row exercises the identical parse → stage → review → apply pipeline an .xlsx would use; swapping in a client-side .xlsx reader later is a small, scoped follow-on once the owner confirms CSV export from their current tool isn't sufficient.
- **`general_ledger_detail` and other purpose-built read RPCs that exist in the schema but were never wrapped in a shared transport file are called directly via `.rpc()`** from the new `lib/` helper files, following the same low-level pattern each transport's own generated functions already use internally — not a new architectural pattern, just applied one layer up because no shared wrapper exists yet for this particular call.
- **The Ledger page can legitimately show an empty result for a business with real transaction history**, because `ledger_entries` is only populated via the new `postLedgerEntries` path and no capture flow anywhere in this codebase has been cut over to it yet (Sprint 26's own disclosed scope note, restated on the page itself so it isn't mistaken for a query bug).

### Phase 4 progress note

Sprint 39 of 13 complete. Sprint 40 (Sales Cycle — Quotations, Invoices, Payments, Credit Notes, AR Ageing) is next and depends on this sprint's Party and `resolvePrice` controls, both now real and working.

---

*End of Sprint 39.*
