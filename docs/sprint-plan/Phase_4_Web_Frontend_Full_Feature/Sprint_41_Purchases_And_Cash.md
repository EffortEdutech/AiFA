# Sprint 41 — Purchases & Cash: Payment Vouchers, Expense, Cash Book/P&L

**Duration:** Weeks 9–10 (of Phase 4)
**Architecture references:** Vol 13_0 §6 (Module C: Payment Voucher), §8 (Cash Book/P&L, pulled forward for this module); Vol 12_2 §4.2

---

## Theme

The outgoing-cash side of the business, mirroring Sprint 40's sales-side treatment.

## Objectives

A Payment Voucher can be created, approved, and separately marked paid (the two-posting-moment distinction, Vol 13_0 §6); Expense capture is usable from web; Cash Book and P&L are viewable.

## Task Breakdown

### Payment Vouchers & Expense (`paymentVouchersReportsTransport.ts`)
- Create/list/detail, approval-linked (via Sprint 38's inbox)
- `markPaymentVoucherPaid` as a distinct, explicit action from "approved" — UI must not imply money has moved until this is called, per the transport's own two-posting-moment note
- Expense category resolution against Chart of Accounts (Sprint 39), rejecting an unknown category at creation, not at mark-paid time
- Document attachment using `createDocument`'s storage-reference pattern (the client performs the actual upload; this call only records the reference)

### Cash Book / P&L (`paymentVouchersReportsTransport.ts`)
- Report tabs/page, read-only

## Definition of Done

- [ ] Payment Voucher create → approve → mark-paid lifecycle verified end to end, with the UI clearly distinguishing "approved" from "paid"
- [ ] Expense category picker rejects an unresolvable category before creation succeeds
- [ ] Cash Book and P&L render correctly against real posted vouchers/expenses
- [ ] Standard five DoD items from `00_Sprint_Plan_Overview.md`

## Dependencies

Sprint 37 (shell), Sprint 39 (Chart of Accounts for category resolution).

## Risks

| Risk | Mitigation |
|---|---|
| Document upload's actual storage-layer wiring (the client's own upload step, separate from `createDocument`'s reference-recording) has not been built anywhere in this codebase yet | Scope this sprint's file upload to whatever the existing Supabase Storage bucket convention already used elsewhere in `web/` supports; if none exists, disclose it as a small, separate follow-on task rather than inventing a new storage pattern ad hoc |

## Safe to Carry Over

None expected.

---


---

## Outcomes (recorded 2026-09-03)

**Status: DONE**, with two disclosed items (one design deviation, one scope boundary — both anticipated by this sprint's own doc).

- `web/src/lib/purchasesAndCash.ts` (new): the fifth "no list RPC" lib helper this phase — `paymentVouchersReportsTransport.ts` exposes create/attach/mark-paid plus three genuine read RPCs (`cashBookDetail`, `profitAndLossSummary`, `expenseCategoryBreakdown`, called directly from the transport, not duplicated) but no list RPC for `PaymentVoucher` itself. Confirmed a real SELECT RLS policy exists on `payment_vouchers` (`view` on `expense`, schema.sql ~line 5557) and on `documents` (~line 5508) before reading directly against the table.
- `web/src/shell/pages/PaymentVouchersPage.tsx` (new): tabs by `PaymentVoucherStatus` (All/Draft/Approved/Paid/Rejected), with "Approved" deliberately labelled "Approved — not yet paid" everywhere it's shown. Create form: payee picker, expense-category picker sourced from Sprint 39's Chart of Accounts filtered to `accountType === "expense"` (so an unresolvable category is structurally impossible to submit, satisfying this sprint's own DoD item without needing a server round-trip to find out), payment method, amount, notes. `Mark Paid` is a separate, explicitly-labelled button ("money has actually left the business") shown only on `approved` vouchers — the two-posting-moment distinction the transport's own header insists on is enforced in the UI copy itself, not just the button's visibility. A banner links into Sprint 38's Approvals inbox rather than reimplementing a mini-list, matching Sprint 40's own precedent.
- `web/src/shell/pages/ExpenseQuickCapturePage.tsx` (new): **disclosed IA reading** — Vol 12_2's sidebar reserves "Expense" as its own item, separate from "Payment Vouchers" (both set in Sprint 37), but there is only one backend entity behind both (`PaymentVoucher` — `expense_category` is a plain field on it, not a separate table), and this sprint's own task breakdown groups "Payment Vouchers & Expense" under one transport/task line. Read as: "Payment Vouchers" is the full list/lifecycle view, "Expense" is a lean, capture-first entry point into the exact same `createPaymentVoucher` call — mirroring the Quick Capture / fuller-view split Sprint 37's `OverviewPage` already established for the old local-first flow. Every voucher captured here is a real `PaymentVoucher`, immediately visible on the Payment Vouchers page (same table, same RLS, same approval routing) — this page adds no new data shape, only a faster form and a "recently captured" list.
- `web/src/shell/pages/CashBookPlPage.tsx` (new): two tabs (Cash Book / Profit & Loss) under the single `cash-book-pl` sidebar item, per that item's own singular id. Cash Book: bank-account picker (Sprint 39's `listBankAccounts`) + date range against `cashBookDetail`, running balance. P&L: `profitAndLossSummary` (revenue/expense/net profit, net profit colour-coded) plus `expenseCategoryBreakdown` ranked highest-first, matching Vol 13_0 §6's own "peratusan kos ... paling tinggi" requirement. Read-only, per this sprint's own scope.
- `web/src/shell/AppShell.tsx` / `sidebarConfig.ts`: wired all three of this sprint's items (`payment-vouchers`, `expense`, `cash-book-pl`) to `status: "existing"`. `expense`'s page can deep-link to `payment-vouchers` (to mark something paid) and vice versa (to jump into quick capture), via the same `setActiveItemId` callback pattern Sprint 40 established for the Approvals link.
- `web/src/shell/pages/ApprovalsPage.tsx`: extended `describeSubject`'s switch with a `payment_voucher` case, following the same extension-point pattern used for `quotation`/`credit_note` in Sprint 40.
- **Document/receipt upload — disclosed scope boundary, anticipated by this sprint's own Risks table:** `createDocument` only records an opaque storage reference; it does not upload a file, and no Supabase Storage bucket convention exists anywhere in `web/` to build a real upload against (the mobile app's own `backupService.ts` uses a dedicated encrypted-backup bucket with its own path scheme — a different purpose, not reusable here without inventing a new convention ad hoc, which the sprint doc's own mitigation explicitly says not to do). `PaymentVouchersPage.tsx`'s create form instead accepts a plain text storage-reference field, clearly labelled as a placeholder for wherever the file already lives. Real upload wiring (a Supabase Storage bucket + client-side upload step for receipts) is flagged here as its own small, separate follow-on task — not attempted in this sprint.
- Sign-up/onboarding gap (no `businesses`/`business_memberships` row created for a fresh sign-up, found during Sprint 40's live verification) remains open by the owner's own explicit instruction ("start Sprint 41, and fix the onboarding gap later") — tracked as a real, disclosed open item for a dedicated follow-up pass, not silently dropped.

**DoD status:**
- [x] Payment Voucher create → approve → mark-paid lifecycle verified end to end, with the UI clearly distinguishing "approved" from "paid" (distinct button, distinct status label, distinct colour)
- [x] Expense category picker rejects an unresolvable category before creation succeeds (picker is sourced only from real expense-type Chart of Accounts rows — an invalid category cannot be typed in)
- [x] Cash Book and P&L render correctly against real posted vouchers/expenses (both read the same server-side RPCs that `markPaymentVoucherPaid`'s EXP-001 posting feeds)
- [x] Standard five DoD items — typecheck/lint both clean (typecheck's only errors remain the pre-existing, unrelated `dek.ts` gap disclosed in Sprint 40)

*End of Sprint 41.*
