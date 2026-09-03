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

- [ ] At least one real invoice validates successfully end to end against the LHDN MyInvois sandbox, including QR code generation — **OPEN.** See Outcomes below: no LHDN MyInvois sandbox credentials were available this sprint; the owner chose to build the full state machine against a stubbed/simulated response instead. Not met.
- [x] Consolidated invoice batch generation verified for at least one test period
- [x] SST computed correctly against at least three different SST codes/rates
- [ ] A deliberately malformed/rejected submission is handled gracefully with the real IRB rejection reason shown, not a generic error — **OPEN.** The state machine correctly surfaces whatever the client reports (never swallowed) and this was verified against a *simulated* IRB rejection payload; it has not been verified against a real IRB response. Not met.
- [x] Production cutover explicitly NOT attempted this sprint — gated on the owner's own completed LHDN registration per this plan's Overview §3

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

## Outcomes (recorded 2026-09-03)

**Status: PARTIALLY COMPLETE.** This is the first sprint in the entire engagement where full completion is not being claimed — DoD items 1 and 4 stay explicitly open (unchecked above), not silently marked done. Everything else shipped and was verified end to end.

### Owner decision (asked via AskUserQuestion, not a disclosed implementation detail)

This sprint's DoD requires submitting a real invoice to LHDN's MyInvois **sandbox** and getting back a real UUID/QR code, plus a real IRB rejection reason for a malformed submission. That needs real LHDN MyInvois sandbox API credentials (client ID/secret or certificate) that this session does not have and cannot fabricate — exactly the "Honest open dependency" Vol 13_0 §9 itself names. The owner was asked directly how to proceed, with three options: (a) supply real sandbox credentials, (b) build it stubbed now, wire in credentials later, (c) skip to Sprint 34 per this sprint's own named risk-mitigation fallback. **The owner chose (b): build it stubbed, wire in credentials later.**

Built to that agreed scope: the full schema, Finance PKA rule sets, SST computation, the complete e-Invoice submission state machine, and a real `MyInvoisClient` interface (with a `StubMyInvoisClient` implementation) — all built and verified against a simulated MyInvois response, not the live sandbox. DoD items 1 and 4 remain open pending real credentials.

### What shipped

- **Schema** (`app/backend/migrations/sprint33_einvoice_sst_compliance.sql`, appended to `app/backend/schema.sql`, 6926 → 7572 lines): `public.sst_rates` (real reference table, mirrors the Finance PKA JSON); `public.e_invoice_submissions` + `public.e_invoice_submission_lines`; `create_einvoice_submission`, `generate_consolidated_einvoice_batch`, `submit_einvoice`, `record_einvoice_submission_result`; `public.sst_transactions`, `compute_sst_for_invoice`, `compute_sst_for_payment_voucher` (plus a new nullable `payment_vouchers.sst_code` column); `public.sst_returns`, `create_sst_return`, `submit_sst_return`.
- **Finance PKA**: `packages/core/pka/regulations/MY-EINVOICE-RULES-1.0.0.json` and `MY-SST-RATES-1.0.0.json` — both explicitly disclose in their own `source_note` that they are first-draft/illustrative, not sourced from a live LHDN/Kastam feed this sprint, and both carry Vol 6_9 §5's advice boundary verbatim.
- **Client-side transport**: `packages/core/src/sync/eInvoiceSstTransport.ts` — RPC wrappers for the full state machine and SST computation, a real `MyInvoisClient` interface, `StubMyInvoisClient` (the simulated implementation actually wired up this sprint), and an exported `TAX_ADVICE_BOUNDARY_STATEMENT` constant surfacing Vol 6_9 §5 concretely, per this sprint's own "Boundary" task item. Type-checked clean via `tsc --noEmit` in `packages/core` — no errors reference this file (remaining errors are pre-existing, unrelated to this sprint: `dek.ts`'s `@noble/*` module resolution, `testAdapter.ts`'s `node:sqlite` typing, and `process`-typing errors in the AI provider files).
- **Verification**: `app/backend/verification/sprint33_einvoice_sst_test.py` — 21 checks, all passing after two bug fixes (below), run against a fresh local Postgres database seeded via the same `auth_sim.sql` harness used since Sprint 23, then re-verified in a full clean-room replay of the actual shipped `schema.sql`. The script's own header and footer prominently disclose that it does NOT and cannot verify DoD items 1 and 4.

### Bugs found and fixed this sprint

1. **Historic Sprint 28 bug, `public.create_quotation`**: accepted an optional `tax_code` key on each line of its `p_lines` jsonb argument but never extracted or persisted it into `quotation_lines.tax_code` — so no invoice created through the normal Quotation → Invoice flow could ever end up with a populated `tax_code`, silently starving `compute_sst_for_invoice` of anything to compute against no matter what the caller supplied. Not caught by Sprint 28's own test suite (it never asserted on `tax_code`). Found via `compute_sst_for_invoice` returning zero rows against a line that was clearly given a tax code. Fixed in this migration by extracting and persisting `tax_code`, matching the existing `product_id` nullif-on-empty pattern. Disclosed in the migration's own header note 8.
2. **Self-introduced test bug**: a dead/broken block in the draft verification script used Python's `expr if False else None` instead of simply deleting an unused check, which would have raised `TypeError: unsupported operand type(s) for &=: 'bool' and 'NoneType'` at runtime. Caught before the script was ever run against real data; removed.
3. **Test design issue, not a schema bug**: the first draft of the consolidated-batch test (section B) reused the same two B2C invoices already exercised in sections A/D, which by that point each already had an *active* individual e-invoice submission — and `generate_consolidated_einvoice_batch`'s own guard (an invoice already individually submitted must not also be folded into a consolidated batch — sound, correct behaviour, just previously undisclosed as its own note) correctly excluded both, leaving zero eligible invoices and raising `no_eligible_non_b2b_invoices_found_for_period`. Fixed by using two fresh, untouched B2C invoices for the consolidated-batch test, and the test now explicitly asserts that the two already-submitted invoices are (correctly) excluded too.

### Disclosed decisions (implementation-detail level, not escalated)

- `sst_rates` as a real server-side table mirroring the Finance PKA JSON, rather than parsing the JSON at request time.
- SST computed via an explicit follow-up call (`compute_sst_for_invoice` / `compute_sst_for_payment_voucher`), not inlined into Sprint 28/30's own `create_quotation`/`create_payment_voucher`.
- No ledger posting of SST this sprint (DoD only requires correct computation, not posting; no double-counting risk since Sprint 28/30's ledger postings already use each document's `grand_total`).
- Consolidated e-Invoice eligibility ("non-B2B") mapped onto `Party.tin` presence/absence — an approximation of LHDN's real eligibility rule using existing schema fields.
- `e_invoice_submission_lines` added as a necessary table beyond Vol 13_0 §9's literal schema, to make a consolidated batch's contents auditable.
- `submit_einvoice` / `record_einvoice_submission_result` split state (Postgres) from the actual HTTP call (client-side `MyInvoisClient`) — consistent with every other external-facing action in this schema; Postgres never makes outbound HTTP calls here.
- `SstReturn` submission stays the explicitly-allowed lower-fidelity carry-over ("Safe to Carry Over" above) — a status-flip, not a real Kastam API integration.

### What's next: Sprint 34 (Payroll & Statutory Contributions)

Per the sprint plan sequence. Per standing project rules, payroll/HR data is high-sensitivity and payroll approval must **never** auto-approve regardless of AI confidence (Vol 13_0 §10) — to be kept firmly in mind throughout that sprint. Sprint 34 does not begin without the owner's separate explicit go-ahead.

---

*End of Sprint 33.*
