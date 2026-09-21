# Sprint 43 — Full Accounting Reports & Bank Reconciliation

**Duration:** Weeks 13–14 (of Phase 4)
**Architecture references:** Vol 13_0 §8 (Module E: Laporan Akaun); Vol 12_2 §4.2, §4.3

---

## Theme

The reporting module that closes out the Accounting sidebar section, drawing on every prior sprint's posted data (Sales, Purchases, Inventory).

## Objectives

Trial Balance, Balance Sheet, and Bank Reconciliation are viewable and usable, with the Balance Sheet's known non-identity and the Tax Report's null-placeholder state both correctly and visibly caveated rather than presented as finished figures.

## Task Breakdown

### Reports (`fullAccountingReportsTransport.ts`)
- Trial Balance, Balance Sheet, Bank Reconciliation as tabs of one "Full Reports" page (Vol 12_2 §4.3 — reports are tabs of the Accounting module, not separate sidebar items)
- Balance Sheet view must visibly note that assets = liabilities + equity is not guaranteed to hold (no period-closing mechanism exists yet, per the transport's own note) — a UI that silently displays three totals without this caveat is not done
- Tax Report Placeholder rendered with its `note` field shown prominently, null figures never rendered as zeros

## Definition of Done

- [x] Trial Balance's debit/credit identity is verified matching in the UI against real posted data
- [x] Balance Sheet displays its known-non-identity caveat visibly, not buried in a tooltip
- [x] Tax Report Placeholder is unmistakably a placeholder in the UI, not styled as a completed report
- [x] Bank Reconciliation flow usable end to end against real data
- [x] Standard five DoD items from `00_Sprint_Plan_Overview.md`

## Dependencies

Sprint 37 (shell), Sprint 39-41 (the posted data these reports summarise).

## Risks

| Risk | Mitigation |
|---|---|
| A future contributor or the owner mistakes the Balance Sheet or Tax Report Placeholder for finished, reliable figures because the caveat is visually subtle | Treat the caveat as a DoD item with its own checkbox (above), not an afterthought — verify it is genuinely prominent, not just present in the DOM |

## Safe to Carry Over

None expected.

---

## Outcomes (recorded 2026-09-03)

**Status: DONE.** All four task-breakdown items shipped as tabs of one `full-reports` sidebar page, matching `sidebarConfig.ts`'s single reserved item and Vol 12_2 §4.3's "reports are tabs, not separate sidebar items" rule.

- `web/src/lib/fullAccountingReports.ts` (new): the one lib helper this sprint needed. Unlike every other module this phase, `fullAccountingReportsTransport.ts` already exposes genuine read RPCs for Trial Balance, Balance Sheet, General Ledger detail, and the Tax Report Placeholder — those are called directly from the transport with no duplication. `bank_statement_lines` is the sole exception (only import/match/ignore RPCs exist, no list RPC), so this file reads that table directly; confirmed the real SELECT RLS policy first (`schema.sql`'s "Active members can view their business's bank statement lines," joined through `bank_accounts` since the table itself carries no `business_id` column).
- `web/src/shell/pages/FullReportsPage.tsx` (new), four tabs:
  - **Trial Balance:** as-of-date picker, per-account debit/credit/balance table, and a prominent balanced/not-balanced banner computed client-side from the same rows (`sum(totalDebit) == sum(totalCredit)`) — this is the one report whose identity is a guaranteed invariant of the data model, and the banner says so.
  - **Balance Sheet:** the non-identity caveat renders as a permanent, red-bordered banner directly above the three totals — always shown, not gated on whether the numbers happen to balance, and not a tooltip — plus a computed "Assets − (Liabilities + Equity)" gap line so the mismatch is a number on screen, not something the owner has to calculate themselves.
  - **Tax Report:** date-range picker; the RPC's own `note` field is the tab's headline inside an amber "Placeholder — not a completed report" banner; `outputTaxSst`/`inputTaxSst` render as "Not available yet" when null, never as "RM0.00" — a null is structurally distinct from a real zero throughout this tab.
  - **Bank Reconciliation:** bank-account and date-range pickers; a single-line manual statement-line importer (disclosed as one-at-a-time — no bulk file upload this sprint, each entry still becomes a real `unmatched` row via `importBankStatementLines`); three sections (Unmatched / Matched / Ignored) driven by `match_status`; "Match to ledger entry" expands a candidate list built from `generalLedgerDetail` against the bank account's own `ledgerAccountId`, filtered to entries no other statement line has already claimed, so the same ledger entry can't be matched twice from this UI; "Ignore" moves a line to `ignored` for e.g. bank fees with no ledger counterpart. Verified end to end: import → appears Unmatched → match against a real posted ledger entry → moves to Matched with its own confirmation styling.
- `web/src/shell/AppShell.tsx` / `sidebarConfig.ts`: wired `full-reports` to `status: "existing"`.
- `stockReport` (a genuine RPC on this same transport) was not surfaced in this sprint's UI — Sprint 42's `ProductsStockPage.tsx` already covers current stock-on-hand from `stock_levels` directly, and neither this sprint's task breakdown nor `sidebarConfig.ts` reserves a place for a separate valuation report; left available-but-unwired for a future sprint, not silently dropped.
- Onboarding gap remains open by the owner's own explicit instruction, still tracked for a dedicated follow-up.

*End of Sprint 43.*
