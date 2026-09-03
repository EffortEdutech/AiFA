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

- [x] Contract renewal alert verified firing at the correct configured lead time — verified NOT due one day before `trigger_date` and due exactly on it, while `end_date` is still 30+ days away
- [ ] e-signature envelope sent, and at least one full sign cycle (sent → signed) verified against the chosen provider — **OPEN, see Outcomes**: the full sent→viewed→signed cycle is verified against a provider-agnostic STUB (the owner's own explicit choice this sprint), not a real vendor sandbox; no live provider credentials exist in this session.
- [x] Credit limit gate verified blocking a real over-limit test invoice, with the reason correctly shown
- [x] Owner override path verified working and logged
- [x] `Contract.credit_limit_override` correctly takes precedence over `Party.credit_limit` when present, verified by test

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

## Outcomes (recorded 3 September 2026)

**Status: PARTIALLY COMPLETE.** DoD item 2 (e-signature verified against the actually-chosen provider) stays explicitly open — this session has no live vendor credentials and cannot fabricate a passing sandbox run. Every other DoD item shipped and was verified end to end, including this plan's one hard system-level blocking gate (credit limit enforcement).

### Owner decision (asked via AskUserQuestion, not a disclosed implementation detail)

Vol 13_0 §14 Open Item 5 explicitly deferred the e-signature vendor decision to "closer to Sprint 36." This session has no live API credentials for DocuSign, Dropbox Sign, or any other real e-signature vendor, and cannot fabricate a passing sandbox run and call it verified. The owner was asked directly how to proceed, with three options: (a) build a provider-agnostic stub now, simulating the full sent→viewed→signed lifecycle server-side, wire in a real vendor later; (b) supply real provider credentials now; (c) skip e-signature this sprint entirely, logged as an open gap. **The owner chose (a), provider-agnostic** — not modelled after any single vendor's API shape. `e_signature_envelopes.provider` defaults to `'generic'` and accepts any string for forward compatibility once a real vendor is chosen, but nothing in this migration calls a real external API. DoD item 2 remains open pending real credentials — the same posture as Sprint 33's LHDN MyInvois stub and Sprint 34's Maybank2u bulk-file format.

### What shipped

- **Schema** (`app/backend/migrations/sprint36_legal_and_commercial.sql`, appended to `app/backend/schema.sql`, 9384 → 9994 lines): `public.contracts` plus `create_contract` (opens an ApprovalTask, generates a `ContractAlert` at creation time when `end_date`/`renewal_notice_days` are both given) and its rejection-sync trigger (deletes the draft row — Contract's own `status` enum has no `rejected` value, same precedent as Sprint 35's OvertimeRecord/CommissionCalculation); `public.contract_alerts` plus `list_due_contract_alerts` (surfaces alerts whose `trigger_date` lead time has been reached, stamping `notified_at`) and `acknowledge_contract_alert`; `public.e_signature_envelopes` plus `create_esignature_envelope`/`mark_esignature_envelope_viewed`/`mark_esignature_envelope_signed`/`mark_esignature_envelope_declined`, correctly reflecting signed status back onto the parent Contract (→ 'active') or Quotation (→ 'accepted'); and the credit limit gate — a new private `_create_invoice_from_quotation` helper shared by the UNCHANGED `convert_quotation_to_invoice(uuid)` (Sprint 28's own public signature, so every existing caller is automatically covered by the gate) and a new, separately-named `convert_quotation_to_invoice_with_credit_override` (gated on `settings`/`configure`, always logs to the new `public.credit_limit_override_log` table).
- **Client-side transport**: `packages/core/src/sync/legalCommercialTransport.ts` — RPC wrappers for the full Contract/ContractAlert/ESignatureEnvelope lifecycle and both invoice-creation paths, with header and inline caveats on the provider-agnostic stub and the credit-limit-exceeded error needing explicit (never automatic) handling. Type-checked clean via `tsc --noEmit` in `packages/core` — no errors reference this file (remaining errors are the same pre-existing, unrelated ones noted in every recent sprint's Outcomes: `dek.ts`'s `@noble/*` module resolution, `testAdapter.ts`'s `node:sqlite` typing, `process`-typing in the AI provider files).
- **Verification**: `app/backend/verification/sprint36_legal_commercial_test.py` — 26 checks, all passing on the first run, run against a fresh local Postgres database, then re-verified in a full clean-room replay of the actual shipped `schema.sql`. The lead-time-vs-exact-expiry-date distinction (this sprint's own central DoD nuance) was checked one day before and exactly on `trigger_date` while `end_date` was still 30+ days out; the credit limit gate was checked both blocking and, via the explicit override path, succeeding-and-logging; `Contract.credit_limit_override` precedence was checked against a limit that would have blocked the same invoice under the Party's own (lower) `credit_limit`.

### Bugs found and fixed this sprint

None — the migration applied cleanly with zero errors and zero unexpected notices on every run, and all 26 verification checks passed on the first execution. The recurring 63-character RLS-policy-name limit was checked proactively before the first apply (per the lesson from Sprints 33-35); one policy name ("...settings/accounting view can see override log", 65 chars) was shortened before any test began.

### Disclosed decisions (implementation-detail level, not escalated)

- Contract creation routes through the same generalised `ApprovalTask` engine every other capture-then-approve action in this schema uses (Vol 13_0 §3.3), even though §12's own schema block gives Contract no explicit domain-flow prose — read from the SoD policy seed already treating `legal_contract` as threshold-free/always-gated, the same sensitivity tier as `payroll`.
- `ContractAlert` generation is a single row created at `create_contract` time (`alert_type` = `'renewal_upcoming'` if `auto_renew`, else `'expiring'`), not a scheduled/nightly job — there is no background-job runner anywhere in this stack; "firing" is modelled as `list_due_contract_alerts` surfacing due alerts on demand, the same on-demand-RPC-instead-of-a-real-scheduler posture as Sprint 35's overtime derivation. Auto-generating a follow-up `'expired'` alert once `end_date` has actually passed is out of this sprint's scope — a real, disclosed gap.
- The credit limit gate is enforced inside a new private `_create_invoice_from_quotation` helper rather than a boolean parameter threaded through the normal `convert_quotation_to_invoice` call — the override is a separately-named RPC an app screen has to deliberately call, gated on `settings`/`configure`, mirroring the "no ambient bypass" posture Sprint 34 used for the payroll auto-approval hard-block.
- Outstanding balance is computed exactly the way Sprint 29's `ar_ageing_detail` already does (`sum(outstanding_balance) where status not in ('draft','cancelled','paid')`) — a derived, query-time value, never cached, per this sprint's own named Risk mitigation.
- `mark_esignature_envelope_declined` does not cascade any status change back onto the parent Contract/Quotation — a declined signature leaves the parent exactly where it was (still `pending_signature`/`sent`), letting the owner decide whether to re-send, amend, or abandon it, rather than the system guessing.

### Phase 3 close-out note

This was the sprint plan's final sprint. The one real remaining gap across the whole plan that traces back to an external dependency this session structurally cannot satisfy on its own is e-signature vendor verification (this sprint's DoD item 2) — alongside the similarly-scoped open items from Sprint 33 (LHDN MyInvois sandbox) and Sprint 34 (Maybank2u bulk-file format), and Sprint 35's DoD item 1 (a real GPS/offline-queue device test). All four are consistently disclosed, not silently marked complete, across their respective sprint docs and `Checklist_Master.md`.

---

*End of Sprint 36. End of Phase 3 Sprint Plan.*
