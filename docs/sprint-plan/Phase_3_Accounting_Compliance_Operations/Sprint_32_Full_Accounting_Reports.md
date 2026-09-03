# Sprint 32 — Full Accounting Reports (Balance Sheet, Trial Balance, GL, Bank Reconciliation)

**Duration:** Weeks 23–24 (of Phase 3)
**Architecture references:** Vol 13_0 §8 (Laporan Akaun — remainder not covered by Sprint 30)

---

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

- [ ] Trial Balance nets to zero for a real test business's data
- [ ] Balance Sheet and General Ledger export correctly and match a manually-verified reference for one full test period
- [ ] Bank Reconciliation correctly matches a real (or realistic test) bank statement export against ledger entries
- [ ] All reports respect Sprint 23's role gating (`accounting_reports: view`)

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
