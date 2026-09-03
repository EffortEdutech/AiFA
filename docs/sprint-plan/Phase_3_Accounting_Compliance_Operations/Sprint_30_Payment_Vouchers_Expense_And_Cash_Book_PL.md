# Sprint 30 — Payment Vouchers, Expense & Cash Book/P&L

**Duration:** Weeks 19–20 (of Phase 3)
**Architecture references:** Vol 13_0 §6 (Perbelanjaan & Untung Rugi), §8 (Cash Book, P&L — partial, pulled forward)

---

## Theme

Closes Sub-phase 3b: the formal, printable, receipt-attached Payment Voucher on top of the existing Expense capture (Vol 6_3), and the first real reports — Cash Book and Profit & Loss — now that Sprint 26's Chart of Accounts gives them enough granularity to mean something.

## Objectives

An owner (or an appropriately-permissioned role) can raise a Payment Voucher, attach its receipt, route it through approval exactly like any other module, and see an automatically-generated Cash Book and P&L reflecting it alongside every other Sub-phase 3b transaction.

## Task Breakdown

### Payment Voucher
- `public.payment_vouchers` per Vol 13_0 §6, wrapping the existing Expense Business Event in the Section 3.2 document shape
- Receipt attachment via the existing `Document` table (Vol 11_1 §5) — no new document storage
- Routes through the same `expense` domain `ApprovalTask` and `SegregationOfDutiesPolicy` as everything else — explicitly *not* a second bookkeeping/approval path

### Reporting
- Cash Book: a bank-account-filtered ledger view (needs `BankAccount` — pulled forward minimally from Vol 13_0 §8, full Bank Reconciliation stays in Sprint 32)
- Profit & Loss: standard grouping by `ChartOfAccounts.account_type`, now meaningful with Sprint 26's expanded chart
- Cost/expense percentage breakdown by category (Vol 13_0 §6's explicit "peratusan kos ... paling tinggi" requirement)

## Definition of Done

- [ ] Payment Voucher creation, receipt attachment, and approval all verified end to end
- [ ] Cash Book correctly reflects a real bank account's transaction history for at least one test period
- [ ] P&L generated automatically and matches a manually-computed reference figure for the same period
- [ ] Cost/expense percentage breakdown correctly ranks categories

## Dependencies

Sprint 26 (Chart of Accounts), Sprint 25 (approval engine). Does not depend on Sprint 27/28/29 directly, though it will typically run after them for the P&L to have real sales data to show alongside expenses.

## Risks

| Risk | Mitigation |
|---|---|
| P&L figures don't reconcile against what the owner's current manual process shows | Run this sprint's P&L output side by side with the owner's existing Word/Excel process for the same real period before declaring done — this is the concrete proof point the owner's original complaint (waiting for an accountant) is actually solved |

## Safe to Carry Over

Printable/exportable PDF formatting for the P&L and Payment Voucher can be minimal (a clean on-screen/export view) this sprint; a polished print layout is not schema work and can follow.

---

*End of Sprint 30.*
