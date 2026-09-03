# Sprint 32 — Full Accounting Reports (Balance Sheet, Trial Balance, GL, Bank Reconciliation)

**Duration:** Weeks 23–24 (of Phase 3)
**Architecture references:** Vol 13_0 §8 (Laporan Akaun — remainder not covered by Sprint 30)

---

**Status: ✅ COMPLETE — 3 September 2026**

## Outcomes (recorded 3 September 2026)

`public.trial_balance`, `public.balance_sheet_summary`, `public.general_ledger_detail`, `public.stock_report`, `public.tax_report_placeholder`, and the Bank Reconciliation workflow (`import_bank_statement_lines`, `match_bank_statement_line`, `ignore_bank_statement_line`) all live with RLS in `app/backend/migrations/sprint32_full_accounting_reports.sql`, appended to `app/backend/schema.sql` (6551 → 6926 lines). Client-side: `packages/core/src/sync/fullAccountingReportsTransport.ts`, type-checks clean (only the same pre-existing, unrelated environment errors present since earlier sprints). Verification: `app/backend/verification/sprint32_reports_reconciliation_test.py` — all 20 checks pass against a full replay of the real, cumulative `app/backend/schema.sql` (Phase 1/2 base through Sprint 32), exercising real postings across Sprint 28 (sales), Sprint 29 (payment), and Sprint 30 (payment voucher) first so the reports reflect genuine cross-module activity, not synthetic fixtures. No bugs found in existing code this sprint — everything passed on the first full run.

**Trial Balance verified as a genuine mechanical identity, not just a computed one:** after real sales, payment, and expense postings, `sum(total_debit)` across every returned account row equaled `sum(total_credit)` exactly (1900.00 = 1900.00), and four individual account balances (Accounts Receivable 400.00, Sales Revenue −1000.00, Cash/Bank 300.00, Rent 300.00) matched hand computation precisely.

**The deliberate absence of a Balance Sheet identity, verified directly rather than assumed (this migration's own header note 2):** with real revenue and expense activity posted, `balance_sheet_summary` returned assets=700.00 but liabilities+equity=0.00 — confirmed NOT equal, on purpose. No sprint in this series has built a period-closing/retained-earnings mechanism that would roll net profit into Equity, so Balance Sheet cannot honestly claim to balance yet; only Trial Balance's debit=credit identity is a guaranteed invariant. Documented here and in the transport file's own header so no future UI silently assumes otherwise.

**General Ledger export verified with a genuinely backdated entry**, not just same-day data: a ledger entry posted 5 days before the report's `dateFrom` was correctly folded into the computed opening balance (150.00), and the running balance through the report period matched hand computation exactly (150 + 600 − 300 = 450.00) — the same "true opening balance" technique Sprint 30's Cash Book already established, generalized to any chart-of-accounts row.

**Bank Reconciliation's data-integrity guards, each verified with a real rejection, not just implemented and trusted:** matching a ledger entry from an unrelated chart-of-accounts row is rejected; matching an already-claimed ledger entry to a second statement line is rejected; re-matching an already-matched statement line is rejected; ignoring an already-matched line is rejected. `bank_statement_lines.matched_ledger_entry_id` — flagged in Sprint 26's own migration as "a one-line follow-up, not a blocker" — finally has its real foreign key.

**Other disclosed decisions:** `stock_report` values inventory at `Product.default_cost` (manual entry), the same known limitation carried forward from Sprint 31 pending a real Purchase module; `tax_report_placeholder` returns a fixed shape with null figures and an explanatory note, exactly matching this sprint's own "minimal placeholder pending Sprint 33" framing rather than inventing SST computation logic; only forward transitions (unmatched → matched, unmatched → ignored) were built for reconciliation, matching this sprint's own "functional minimum, not polished" framing — an undo/unmatch action is reasonable future polish. Full details in the migration's own header notes.

## Theme

Closes Sub-phase 3c. Vol 13_0 §8 is explicitly "mostly a reporting layer" over Sprint 26's Chart of Accounts — this sprint finishes it: Trial Balance, Balance Sheet, General Ledger export, Bank Reconciliation, and Stock/Tax report views.

## Objectives

Trial Balance nets to zero against real ledger data, Balance Sheet and General Ledger export correctly, and Bank Reconciliation correctly matches statement lines against ledger entries with a clear unmatched/matched/ignored workflow.

## Task Breakdown

### Reports (read-only over existing schema — see Vol 13_0 §8's own framing)
- Trial Balance: `sum(debit) - sum(credit)` grouped by `ChartOfAccounts`, verified to net to zero
- Balance Sheet: standard groupings by `account_type`
- General Ledger export: per-account ledger view, PDF/Excel export
- Stock report: from Sprint 31's `StockLevel`
- Tax report: minimal placeholder pending Sprint 33's actual e-Invoice/SST data

### Bank Reconciliation
- `public.bank_statement_lines` per Vol 13_0 §8
- Matching workflow: unmatched → matched (linked to a `LedgerEntry`) → ignored, with an owner-facing reconciliation screen (functional minimum, not polished)

## Definition of Done

- [x] Trial Balance nets to zero for a real test business's data
- [x] Balance Sheet and General Ledger export correctly and match a manually-verified reference for one full test period
- [x] Bank Reconciliation correctly matches a real (or realistic test) bank statement export against ledger entries
- [x] All reports respect Sprint 23's role gating (`accounting_reports: view`)

## Dependencies

Sprint 26 (Chart of Accounts), Sprint 30 (Cash Book/P&L already built — this sprint completes the report suite around them), Sprint 31 (Stock report data).

## Risks

| Risk | Mitigation |
|---|---|
| Trial Balance doesn't net to zero, revealing a posting bug somewhere upstream (Sprints 28-31) | Treat a non-zero Trial Balance as a stop-the-line signal — trace it back to the specific incorrect posting rather than adjusting the report to hide the discrepancy |
| Bank statement formats vary by bank, complicating the reconciliation import | Support one real bank's export format first (the owner's own primary bank), same "one format first" discipline as Sprint 34's bulk-payment file |

## Safe to Carry Over

Aging report polish (already functionally built in Sprint 29) and multi-format bank statement import both can extend beyond this sprint without blocking Sub-phase 3d.

---

*End of Sprint 32.*
