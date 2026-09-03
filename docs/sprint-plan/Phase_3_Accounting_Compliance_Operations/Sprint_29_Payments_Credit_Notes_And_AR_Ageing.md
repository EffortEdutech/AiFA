# Sprint 29 — Payments, Credit Notes & AR Ageing

**Duration:** Weeks 17–18 (of Phase 3)
**Architecture references:** Vol 13_0 §4 (Payment, CreditNote, Invoice.status lifecycle, real AR ageing)

---

## Theme

Closes the sales cycle Sprint 28 opened: recording payment against an invoice, issuing credit notes, and replacing the Vol 6_1 §6-flagged "flat outstanding list" with real bucketed ageing — directly closing a gap the architecture has named since Sprint 6.

## Objectives

Partial and full payments correctly update `Invoice.status`/`outstanding_balance`, post correctly to the ledger (Cash/Bank debit, AR credit), credit notes correctly reduce a customer's balance, and AR ageing reports real buckets (current, 30/60/90+ days) rather than a flat list.

## Task Breakdown

### Schema & Posting
- `public.payments`, `public.credit_notes` per Vol 13_0 §4
- Ledger posting on payment receipt (against Sprint 26's `ChartOfAccounts`), correctly netting `Invoice.outstanding_balance`
- `Invoice.status` state machine: `issued → partially_paid → paid`, `→ overdue` (time-based, not event-based — a scheduled/derived check against `due_date`)

### Reporting
- Real AR ageing buckets replacing `getOutstandingReceivables`'s flat list (Vol 6_1 §6), now possible because `Invoice.due_date` exists (Sprint 28)
- Wire ageing into the AI CFO Assistant's existing "overdue invoice, suggest follow-up" behaviour (Vol 6_1 §3) with real bucket data instead of the flat list it currently has

### Approval
- Credit note issuance routes through the `ApprovalTask` engine (`domain = sales`) same as quotations/invoices — no separate approval mechanism invented

## Definition of Done

- [ ] Partial and full payment recording both verified, including correct ledger posting
- [ ] Credit note issuance reduces balance correctly and is approval-gated
- [ ] AR ageing shows real buckets, verified against at least one manually-computed test case
- [ ] `Invoice.status` transitions correctly through its full lifecycle including `overdue`

## Dependencies

Sprint 28.

## Risks

| Risk | Mitigation |
|---|---|
| `overdue` status requires a time-based check, not just an event — easy to build as "checked only when the app opens," which misses a business that hasn't opened the app in days | Implement as a derived value computed at query time (today's date vs. due_date, unpaid balance), never a stored status that can go stale, same "computed, not cached" discipline Vol 13_3 §2 already applies to `effective_access_model` |

## Safe to Carry Over

Multi-currency handling on payments (Vol 13_0 §3.2's `currency` field exists but isn't exercised) stays MYR-only through this sprint; the field is present for future use, not actively multi-currency yet.

---

*End of Sprint 29.*
