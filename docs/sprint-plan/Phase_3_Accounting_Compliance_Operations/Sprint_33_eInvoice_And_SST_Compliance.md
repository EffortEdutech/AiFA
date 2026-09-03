# Sprint 33 — e-Invoice & SST Compliance

**Duration:** Weeks 25–26 (of Phase 3)
**Architecture references:** Vol 13_0 §9 (e-Invois & SST)

---

## Theme

Sub-phase 3d, alone — deliberately the highest external-dependency, highest-compliance-risk sprint short of Payroll, and sequenced after Sales/Inventory exist to actually submit against, per Vol 13_0 §13's own reasoning. This sprint's Definition of Done targets the LHDN MyInvois **sandbox**, not production, per this plan's Overview §3 boundary.

## Objectives

An invoice from Sprint 28/29 can be submitted to LHDN's MyInvois sandbox, validated, and produce a QR code; a consolidated invoice batch can be generated with one action; SST is computed and shown per transaction.

## Task Breakdown

### Schema
- `public.e_invoice_submissions`, `public.sst_transactions`, `public.sst_returns` per Vol 13_0 §9

### Finance PKA
- `regulations/MY-EINVOICE-RULES-<version>.json` and `regulations/MY-SST-RATES-<version>.json` as versioned Knowledge Objects (Vol 6_9 §4's existing pattern, extended per Vol 13_0 §9)

### Integration
- LHDN MyInvois sandbox API integration — submission, validation polling, UUID/QR code retrieval on success, rejection handling with the actual IRB response surfaced to the owner (never swallowed)
- Consolidated invoice batch generation — one `EInvoiceSubmission(submission_type=consolidated)` per period over eligible non-B2B invoices, per LHDN's own provision
- SST computation wired into `Invoice`/`PaymentVoucher` line items using `sst_code`/rate from the Finance PKA rule set

### Boundary
- Explicit, in-product statement of the Vol 6_9 §5 advice boundary — AiFA computes and organises, it is not a substitute for a licensed tax professional — surfaced here concretely, not just architecturally

## Definition of Done

- [ ] At least one real invoice validates successfully end to end against the LHDN MyInvois sandbox, including QR code generation
- [ ] Consolidated invoice batch generation verified for at least one test period
- [ ] SST computed correctly against at least three different SST codes/rates
- [ ] A deliberately malformed/rejected submission is handled gracefully with the real IRB rejection reason shown, not a generic error
- [ ] Production cutover explicitly NOT attempted this sprint — gated on the owner's own completed LHDN registration per this plan's Overview §3

## Dependencies

Sprint 28/29 (real invoices to submit), Sprint 21 (owner's LHDN sandbox registration should already be underway per the sign-off sprint's task).

## Risks

| Risk | Mitigation |
|---|---|
| LHDN sandbox API behaves differently from its documentation, or the owner's sandbox registration isn't ready in time | This sprint's start date has slack built into the sub-phase ordering (Vol 13_0 §13); if registration isn't ready, work on Sprint 34 (Payroll, independent of this) rather than blocking |
| SST rate/code rules change or were misunderstood | Versioned Finance PKA rule set (not inline code) means a correction is a data update, not a code change — verify this update path works, not just the initial rule set |

## Safe to Carry Over

Automatic SST return submission ("hantar ke Kastam") can stay a generated-document-for-manual-submission step this sprint if a direct Kastam API integration isn't feasible yet; SST *computation* is the hard requirement, the submission channel can be lower-fidelity initially.

---

*End of Sprint 33.*
