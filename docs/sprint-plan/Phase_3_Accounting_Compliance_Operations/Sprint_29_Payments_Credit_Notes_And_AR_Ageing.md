# Sprint 29 — Payments, Credit Notes & AR Ageing

**Duration:** Weeks 17–18 (of Phase 3)
**Architecture references:** Vol 13_0 §4 (Payment, CreditNote, Invoice.status lifecycle, real AR ageing)

---

**Status: ✅ COMPLETE — 3 September 2026**

## Outcomes (recorded 3 September 2026)

`public.payments`, `public.credit_notes`, `public.invoice_effective_status`, `public.recompute_invoice_balance`, `public.record_payment`, `public.create_credit_note`, and `public.ar_ageing_detail` all live with RLS in `app/backend/migrations/sprint29_payments_credit_notes_ar_ageing.sql`, appended to `app/backend/schema.sql` (4968 → 5404 lines). Client-side: `packages/core/src/sync/paymentsCreditNotesTransport.ts`, type-checks clean. Verification: `app/backend/verification/sprint29_payments_creditnotes_test.py` — 26/26 checks pass against a full replay of the real, cumulative `app/backend/schema.sql` (Phase 1/2 base through Sprint 29). No bugs found in existing code this sprint — every check passed on the first run.

**"Computed, not cached," followed through exactly as this sprint's own risk note specified:** `invoices.status` never has `'overdue'` written to it anywhere in this migration — `public.invoice_effective_status(invoice_id)` derives it at read time (today vs. `due_date`, current `outstanding_balance`), the same discipline Vol 13_3 §2 already applies to `effective_access_model`. Verified directly: an unpaid invoice backdated 15 days past due still reads `status = 'issued'` in the row itself, while `invoice_effective_status` correctly reports `'overdue'`; a fully-paid invoice past a hypothetical due date is never reported as overdue by either. `ar_ageing_detail` applies the same logic internally rather than trusting the stored column.

**A disclosed narrower shape than Vol 13_0's schema block's own wording implies:** `CreditNote` is built as a single-amount document (one `grand_total` reducing the linked invoice's balance), not a full `DocumentHeader`/`DocumentLine` pair with per-line credit allocation. The volume lists `CreditNote : DocumentHeader` with only `source_invoice_id` as its own field and never describes a `CreditNoteLine` table anywhere, and this sprint's own DoD only asks that issuance "reduces balance correctly and is approval-gated" — not line-level allocation. Building a full line-item credit note was judged out of proportion to what's actually asked for; disclosed rather than silently narrowed without a note.

**A disclosed accounting simplification:** credit note ledger posting reuses Sales Revenue (4000) as the debit side (credit Accounts Receivable) rather than a dedicated "Sales Returns & Allowances" contra-revenue account, because no such account exists in Vol 11_1 §4.1's Phase 1 seed set (the same 12-row set Sprint 26 seeds verbatim) and this migration doesn't add a new system account outside that set. A cleaner contra-revenue treatment is reasonable future work.

**A disclosed gating decision Vol 13_0's text doesn't settle:** `record_payment` and `create_credit_note` are gated on EITHER `capture` on `sales` OR `configure` on `accounting_reports` (not a single domain), because neither fixed role template alone covers who realistically records a payment — a Sales Agent marking a sale paid on the spot, or a Bookkeeper reconciling it later against a bank statement (the same `configure` grant that already lets them call `post_ledger_entries` directly). Verified both ways: Warehouse Staff (neither grant) is rejected from both actions; Bookkeeper (accounting_reports configure, no sales capture at all) can successfully record a payment, proving the OR-gate actually covers the reconciliation path it's meant for.

**Overpayment guard, disclosed as the conservative default:** Vol 13_0 doesn't specify overpayment handling; a payment or credit note that would push total-paid-plus-credited above `grand_total` is rejected outright (`payment_exceeds_outstanding_balance` / `credit_note_exceeds_outstanding_balance`) rather than allowed to go negative. A credit-balance/refund flow is future work if a real overpayment case comes up.

**Disclosed scope boundary on "wire ageing into the AI CFO Assistant" (Task Breakdown's own wording):** this sprint delivers `ar_ageing_detail` as a real, tested, correctly-bucketed server function — the actual data Vol 6_1 §3's overdue-invoice-follow-up behaviour needs. It does NOT modify the AI CFO Assistant's own client-side code to call it in place of the old flat list; that's a client-side integration change to existing assistant logic this sprint didn't touch or verify, and doing it without seeing that code's current shape risked a shallow, unverified edit. Flagged as necessary follow-on work, not silently skipped — `paymentsCreditNotesTransport.ts`'s `arAgeingDetail` is ready to be called from there.

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

- [x] Partial and full payment recording both verified, including correct ledger posting
- [x] Credit note issuance reduces balance correctly and is approval-gated
- [x] AR ageing shows real buckets, verified against at least one manually-computed test case — verified against three (a 15-day, a 45-day, and a not-yet-due invoice, plus confirming a fully-paid invoice is excluded)
- [x] `Invoice.status` transitions correctly through its full lifecycle including `overdue` — `overdue` specifically as a read-time-only derived value, never a stored transition; see Outcomes

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
