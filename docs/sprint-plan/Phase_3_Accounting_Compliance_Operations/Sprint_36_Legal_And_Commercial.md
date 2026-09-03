# Sprint 36 — Legal & Commercial

**Duration:** Weeks 31–32 (of Phase 3)
**Architecture references:** Vol 13_0 §12 (Legal & Commercial), §12.1 (Credit Limit Enforcement)

---

## Theme

The final sprint of this plan. The second domain Vol 13_0 introduced from scratch: contract storage, renewal alerts, e-signature, and — the one hard system-level blocking gate in the whole of Series 13 — credit limit enforcement on new invoice creation.

## Objectives

A contract can be stored with a renewal alert that fires at the configured lead time, a quotation or contract can be sent for e-signature via the provider chosen in Sprint 21, and an over-limit customer is correctly blocked from a new invoice with a clear, explained reason and an explicit override path.

## Task Breakdown

### Schema
- `public.contracts`, `public.contract_alerts`, `public.e_signature_envelopes` per Vol 13_0 §12

### Contracts & Alerts
- Contract CRUD with document attachment (existing `Document` table, no new storage)
- `ContractAlert` generation (`trigger_date = end_date - renewal_notice_days`), verified firing correctly at the configured lead time, not just on the exact expiry date

### e-Signature
- Integration with the Sprint-21-chosen provider for Quotation/Contract signing
- `ESignatureEnvelope` status tracking (sent/viewed/signed/declined/expired) correctly reflected back onto the parent `Contract`/`Quotation`

### Credit Limit Enforcement (the hard gate)
- Evaluated at `Invoice` creation (Sprint 28's flow): `Party.credit_limit` (or `Contract.credit_limit_override` if present) vs. current outstanding balance across unpaid invoices
- Over-limit blocks creation with a clear, explained reason shown to the requester — never silent, per Vol 13_0 §12.1's explicit instruction
- Explicit owner override path — logged, not silent, same audit discipline as every other approval-adjacent action in this plan

## Definition of Done

- [ ] Contract renewal alert verified firing at the correct configured lead time
- [ ] e-signature envelope sent, and at least one full sign cycle (sent → signed) verified against the chosen provider
- [ ] Credit limit gate verified blocking a real over-limit test invoice, with the reason correctly shown
- [ ] Owner override path verified working and logged
- [ ] `Contract.credit_limit_override` correctly takes precedence over `Party.credit_limit` when present, verified by test

## Dependencies

Sprint 28 (Invoice creation flow, for the credit-limit gate), Sprint 21 (e-signature provider decision).

## Risks

| Risk | Mitigation |
|---|---|
| e-signature provider's legal validity in the owner's jurisdiction isn't fully confirmed | Flag explicitly to the owner as a legal question outside this plan's technical scope — same "not a substitute for professional advice" boundary Vol 6_9 §5 already states for tax |
| Credit limit gate blocks a legitimate transaction incorrectly due to a stale outstanding-balance calculation | Compute outstanding balance the same way Sprint 29's AR ageing does — as a derived, query-time value, never cached, same discipline applied there |

## Safe to Carry Over

None — this is the plan's final sprint; any incomplete item here should be explicitly logged as open follow-on work in the Phase 3 close-out, mirroring how Phase 1/2 each closed with a stated set of real remaining gaps rather than declaring false completeness.

---

*End of Sprint 36. End of Phase 3 Sprint Plan.*
