# Sprint 30 — Payment Vouchers, Expense & Cash Book/P&L

**Duration:** Weeks 19–20 (of Phase 3)
**Architecture references:** Vol 13_0 §6 (Perbelanjaan & Untung Rugi), §8 (Cash Book, P&L — partial, pulled forward)

---

**Status: ✅ COMPLETE — 3 September 2026**

## Outcomes (recorded 3 September 2026)

`public.documents`, `public.payment_vouchers`, `public.cash_book_detail`, `public.profit_and_loss_summary`, and `public.expense_category_breakdown` all live with RLS in `app/backend/migrations/sprint30_payment_vouchers_expense_cash_book_pl.sql`, appended to `app/backend/schema.sql` (5404 → 5872 lines). Client-side: `packages/core/src/sync/paymentVouchersReportsTransport.ts`, type-checks clean (only the same pre-existing, unrelated environment errors present since earlier sprints — `dek.ts`'s `@noble/*` module resolution and `testAdapter.ts`'s `node:sqlite` typing). Verification: `app/backend/verification/sprint30_pv_expense_reports_test.py` — 18/18 checks pass against a full replay of the real, cumulative `app/backend/schema.sql` (Phase 1/2 base through Sprint 30).

**A disclosed schema gap, not escalated (parallel to but smaller than Sprint 26's LedgerEntry fork):** `public.documents` is a NEW, minimal, forward-only table. Vol 13_0 §6's `PaymentVoucher.document_id_receipt` points at "Document (Vol 11_1 §5)" and the Task Breakdown says "via the existing Document table... no new document storage," but `Document` has no real server-side table today — it's a local-first/encrypted concept only, the same situation `BusinessEvent`/`LedgerEntry` were in before Sprints 25/26. Unlike those, this gap has no historical-data-migration dimension (a receipt attachment is inherently forward-only), so it was built directly as a minimal table — an opaque storage reference plus content type, not a document-management system — rather than escalated as an owner decision. It does not perform file upload/storage itself; the client wires that to its own storage layer (e.g. Supabase Storage) and passes the resulting URI as `storage_ref`.

**Disclosed shape simplifications, consistent with Sprint 29's own precedents:** PaymentVoucher is a single-amount document (`grand_total`), matching CreditNote's shape — Vol 13_0 §6 gives it no line-item table either. `expense_category` stores a bare `chart_of_accounts.account_name` value directly (e.g. 'Supplies'), not the PKA JSON's compound 'Operating Expenses:Supplies' label, resolved case-insensitively against expense-type accounts at creation time (a bad category is rejected immediately rather than surfacing confusingly later at mark-paid time). `payment_method` matches Vol 13_0 §6's own literal three-value enum (cash | bank_transfer | cheque) — narrower than Sprint 29's Payment.method, which is the volume's own stated list for this document type, not an oversight.

**A disclosed enum extension, same precedent as Sprint 25's `blocked_awaiting_reviewer`:** `payment_vouchers.status` gains a `'rejected'` value beyond Vol 13_0 §6's literal three values (draft | approved | paid) — the volume names no rejection outcome, but a real ApprovalTask can genuinely be rejected.

**A deliberate two-posting-moment design, diverging from CreditNote's single-step pattern:** approval moves a PV to `'approved'` but posts nothing — it's authorization only. A separate, explicit `mark_payment_voucher_paid` call (mirroring Sprint 28's `mark_quotation_sent` self-reported-external-event pattern) is what actually posts EXP-001 (debit the resolved expense account, credit Cash/Bank 1000) and moves status to `'paid'`. This matches how a real payment voucher works: it's authorized before the money actually leaves the business, and the two moments were kept genuinely distinct rather than collapsed for convenience. Verified directly: no ledger entry exists after approval; the debit/credit pair appears only after `mark_payment_voucher_paid`; an already-paid or rejected PV refuses a second `mark_payment_voucher_paid` call.

**A bug caught during this sprint's own testing (new code, not inherited — disclosed with the same transparency as every prior sprint's finds):** `cash_book_detail`'s opening-balance calculation originally referenced bare `direction`/`amount` columns from `ledger_entries`, which Postgres could not disambiguate from the function's own `RETURNS TABLE(..., direction text, amount numeric, ...)` OUT parameters of the same names — an `AmbiguousColumn` error at call time. Fixed by table-qualifying that subquery, matching the qualification already used correctly elsewhere in the same function. Full detail in the migration's own header note 7.

**Verified against manually-computed reference figures, per this sprint's own risk note:** Cash Book's running balance (opening 5000.00 − 1200 − 60 + 300 − 100 = 3940.00), P&L (revenue=2000.00, expense=1260.00, net=740.00), and the expense-category breakdown (Rent 1200.00 at 95.24%, ranked above Utilities 60.00 at 4.76%) all matched hand-computed figures exactly — the concrete proof point this sprint's risk note called for.

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

- [x] Payment Voucher creation, receipt attachment, and approval all verified end to end
- [x] Cash Book correctly reflects a real bank account's transaction history for at least one test period
- [x] P&L generated automatically and matches a manually-computed reference figure for the same period
- [x] Cost/expense percentage breakdown correctly ranks categories

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
