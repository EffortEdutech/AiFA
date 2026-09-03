# Sprint 26 — Party, Document Numbering & Chart-of-Accounts Migration

**Status: ✅ COMPLETE — 3 September 2026**
**Duration:** Weeks 11–12 (of Phase 3)
**Architecture references:** Vol 13_0 §3.1 (Party), §3.2 (Document header/line pattern), §3.4 (Document numbering), §8 (Chart of Accounts)

## Outcomes (recorded 3 September 2026)

`public.parties`, `public.document_number_sequences`, `public.chart_of_accounts` (auto-seeded with the exact Vol 11_1 §4.1 Phase 1 set — 7 top-level + 5 Operating Expenses sub-categories, `is_system = true`, immutable type/code), `public.bank_accounts`, `public.bank_statement_lines`, and — see the architecture discovery below — a brand-new `public.ledger_entries` all live with RLS in `app/backend/migrations/sprint26_party_document_numbering_chart_of_accounts.sql`, appended to `app/backend/schema.sql`. Client-side: `packages/core/src/sync/partyAndLedgerTransport.ts`, type-checks clean. Verification: `app/backend/verification/sprint26_party_coa_test.py` — 27/27 checks pass against a full replay of the real, cumulative `app/backend/schema.sql` (Phase 1/2 base through Sprint 26).

**A genuine architecture discovery, surfaced and put to the owner before any schema was written, not silently worked around:** Vol 13_0 §8's own text describes the Chart-of-Accounts migration as an additive-column-then-cleanup `ALTER TABLE` on `LedgerEntry.account`. The real schema has no such table to alter — `ledger_entry`, like `BusinessEvent` before Sprint 25, is only one of `sync_envelopes`'s encrypted payload shapes, living exclusively in each device's local SQLite store under Vol 4_4/Vol 12_1's local-first model. There is no server-side column to migrate, and historical ledger data cannot be server-side-backfilled at all — only a client holding the Business DEK can decrypt it. Put to the owner directly: defer the migration (Sprint 25's own precedent for BusinessEvent) or follow `ApprovalTask`'s Sprint 25 precedent and give `LedgerEntry` a real server-side table now. **Owner chose the latter** — `public.ledger_entries` is built fresh this sprint, with `chart_of_accounts_id` as a real foreign key from day one (there being no old free-string column to migrate away from is itself the resolution of Section 8's own "additive, not destructive" caution).

**A disclosed scope boundary on that same decision, not silently expanded further:** this sprint builds `public.ledger_entries` as the real, RLS-protected, `configure`-gated destination table and its `post_ledger_entries` posting RPC (atomic, balance-enforced — a batch must debit-equal-credit or nothing posts). It does **not** rewire the existing, working, tested client-side pipeline (`packages/core/src/db/ledgerRepository.ts` + the encrypted sync-envelope path in `applyEnvelope.ts`/`envelope.ts`/`reconciliation.ts`) to post here instead, and does **not** attempt to decrypt and migrate any business's historical local ledger data into this table. Rewiring a working, tested sync/crypto pipeline in the same pass as new schema work is exactly the kind of change this project has consistently given its own dedicated review (Sprint 22's crypto review; the Path B gate at Sprint 34–35) — so the client-side cutover and a client-side decrypt-and-backfill step are flagged here as necessary, scoped follow-on work, not attempted blind. `public.ledger_entries` is empty of historical data by design until that follow-up lands; `partyAndLedgerTransport.ts`'s own header comment repeats this warning at the point future code would actually call `postLedgerEntries`.

**A deliberate, disclosed adaptation of the volume's own literal text:** Vol 13_0 §3.1 specifies `Party.id` in the format `"PTY-NNNNNN"`. Every other foreign-keyable table in this schema (including `business_memberships.party_id`, added in Sprint 23 specifically so this sprint wouldn't need a second migration of that table) uses a `uuid` primary key. `parties.id` stays `uuid` for that consistency; the volume's own human-readable format is delivered as a separate `party_no` display column, generated through Section 3.4's own shared document-numbering mechanism (`document_type = 'party'`) — proving that mechanism's generic design is real, not just documented, rather than a parallel hand-rolled counter.

**Two real bugs found and fixed during testing, not shipped:** (1) `next_document_number`'s auto-provisioned default prefix (`upper(left(document_type,3))`) produced `'PAR-000001'` for `document_type = 'party'`, not the volume's specified `'PTY-'` — caught by the test asserting the literal prefix, fixed by having `create_party` pre-provision its sequence row with the correct prefix on first use. (2) A `SET ROLE`-inside-an-aborted-transaction test-harness artifact (not a schema bug — confirmed by reproducing the same check directly in `psql`, where the immutability trigger fired correctly) made a second `expect_error` check in the same test transaction silently pass with the wrong role active; fixed by re-asserting the role before each check rather than assuming it survives a prior rollback.

**A real refactor introduced and disclosed, not silently duplicating existing logic:** `public.caller_has_capability(business_id, domain, capability)` generalizes the inline `role_permissions` lookup every Sprint 24/25 RPC had been hand-rolling — introduced here because Party's own RLS SELECT policy is the first place this project needs that check as a row-visibility *predicate*, not just inside a function body. Existing Sprint 23–25 functions are untouched; this is additive only.

---

## Theme

The shared foundation every Sub-phase 3b–3e module builds on: the unified `Party` table, the generic document header/line pattern, document numbering, and — the one change to an *existing* table in the whole of Series 13 — migrating `LedgerEntry.account` from a free string to a real `ChartOfAccounts` foreign key. Vol 13_0 §14 Open Item 7 and this plan's own Program Risks (§6) both call this migration out as deserving its own focused review, which is why it has a dedicated sprint rather than being folded into Sprint 28.

## Objectives

`Party`, the generic `DocumentHeader`/`DocumentLine` shape, `document_number_sequences`, and `ChartOfAccounts` all exist; every existing Phase 1 account is seeded as an `is_system = true` row with an exact 1:1 mapping; every existing ledger/report test passes unchanged against the new foreign key.

## Task Breakdown

### Party
- `public.parties` per Vol 13_0 §3.1, including `party_types` as a set, `price_type_id`/`credit_limit`/`credit_terms_days` fields (nullable, unused until Sprints 27/36 respectively)
- RLS via Sprint 23's membership model, `capture`/`view` gated per the `sales`/`hr` domains as relevant per party type

### Document Pattern
- Generic `document_number_sequences` per Vol 13_0 §3.4 — prefix/next-number/reset-period, one row per business per document type
- Shared header/line base shape implemented as reusable `@aifa/core` types (not a literal shared table — each module's own header table per Vol 13_0's per-module sections), so Sprints 27–36 aren't each redesigning numbering logic

### Chart of Accounts Migration (treat as its own reviewed step)
- `public.chart_of_accounts` per Vol 13_0 §8
- Seed every Vol 11_1 §4.1 Phase 1 account (Cash/Bank, Accounts Receivable, Accounts Payable, Sales Revenue, Cost of Goods Sold, Operating Expenses + sub-categories, Owner's Equity/Drawings) as `is_system = true`
- Migrate `LedgerEntry.account` (free string) to `ledger_entry.chart_of_accounts_id` (foreign key) — write the migration as additive (new column, backfill, only then drop the old column in a follow-up once verified, not a single destructive step)
- Full regression: every existing Phase 1/2 ledger, dashboard, and financial-summary test passes unchanged

## Definition of Done

- [x] `Party`, document numbering, and `ChartOfAccounts` all live with RLS
- [x] Every existing Phase 1 account seeded correctly with exact 1:1 mapping, verified by direct comparison, not assumption
- [x] `LedgerEntry` migration — scope changed by owner decision mid-sprint (see Outcomes): no old column existed to migrate additively, so the owner chose a real server-side `ledger_entries` table built fresh instead; the existing client pipeline and historical local data are explicitly NOT touched this sprint, disclosed as scoped follow-on work
- [x] 100% of existing ledger/report regression tests pass unchanged — unaffected, since the existing client-side ledger pipeline was deliberately left untouched (see Outcomes)
- [x] No new user-facing module ships yet — this sprint is foundation only, same discipline as Sprint 13/23

## Dependencies

Sprint 25 (approval engine — `Party` capture will route through it starting Sprint 27, but this sprint's own Party CRUD doesn't strictly need it yet if the owner is the one entering initial customer/supplier records).

## Risks

| Risk | Mitigation |
|---|---|
| Chart-of-accounts migration corrupts historical ledger data | Additive-column approach (see Task Breakdown) means the old column is never dropped until every downstream consumer is verified against the new one, and can be rolled back trivially if a problem is found |
| Document numbering design turns out too generic/too rigid once Sprint 28 actually uses it | Time-box; a small, additive refinement in Sprint 28 is acceptable and expected, matching Sprint 25's own risk note about first-real-usage adjustments |

## Safe to Carry Over

Party fields specific to a later module (e.g. `EmployeeProfile` linkage, Sprint 34) don't need to be populated or exercised yet — only their presence in the schema.

---

*End of Sprint 26.*
