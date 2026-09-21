# Sprint 62 — Hardening, Cross-Channel QA & Pilot

**Duration:** Weeks 19-20 (of Phase 5)
**Architecture references:** Whole of Vol_5_5, verified against what Sprints 53-61 actually built, mirroring Sprint 49's role closing Phase 4

**CORRECTION (14 September 2026):** This is the phase's original close-out sprint, previously numbered Sprint 59, moved here unchanged in role and mostly unchanged in method — only its verification scope is widened, from the original 5 domains (expense, sale, purchase, leave_application, purchase_order, unclassified) to the full ~14-domain list Sprints 58-60 shipped, and its dependency list now includes the new chaining/confidence sprint (61). The Sprint 59 filename that previously held this content now holds new "Draft-and-Approve Bridge II" content — see that document's own CORRECTION note.

---

## Theme

The close-out sprint. Verifies every channel × domain combination this phase shipped actually works together, not just individually, and states plainly what remains open — the same discipline Sprint 49 applied to Phase 4, now applied across a materially larger domain surface than originally planned.

## Objectives

Every combination of {in-app, forwarded-web, forwarded-mobile} × {all ~14 domains from Sprints 53, 58, 59, 60} × {text, image/PDF, voice} that this phase claims to support is verified to actually reach the same canonical Path B core, with correct confidence/approval routing (Sprint 61) and no silent data loss.

## Task Breakdown

### Cross-channel verification matrix
- For each channel built (in-app, web forward, mobile share), confirm every domain from Sprint 53's original five plus Sprint 58's Sales/Purchase Order, Sprint 59's Commission/Attendance-correction/Delivery Order/Stock adjustment, and Sprint 60's e-Invoice flag/Contract alert/e-Signature request classifies correctly via Sprint 57's ported classifier and routes per Sprint 61's table, across every media type Sprint 55 added (text, image/PDF, voice)
- Confirm the `unclassified` triage queue genuinely catches ambiguous input from every channel and every domain group, not only the ones it may have originally been tested against in Sprint 53

### Chaining re-verification
- Re-run Sprint 58's PO → stock-receipt → payment-due chain end to end at least twice, confirming it is reproducible and idempotent
- Re-run Sprint 61's new Sale → payment-expected chain at least twice under the same idempotency standard

### Permanent-approval domain verification
- Explicitly confirm, across real test captures, that the five domains Sprints 59-60 and 61 named as permanently requiring approval (attendance_correction, stock_adjustment, e_invoice_flag, contract_alert, e_signature_request) never auto-record under any confirmation-count condition — this is the single highest-consequence regression this sprint must catch, since a failure here means a wrong silent action reaching Payroll, inventory, tax filings, contracts, or a real signer

### Live pilot
- A genuine owner-run pilot across at least one real forwarded WhatsApp message and one real forwarded email, on a real device, covering at least one domain from each of the three domain-bridge sprints (58, 59, 60) — not only the original three examples, and not only a static code trace, learning from Sprint 49's own disclosed limitation where a live pilot could not be run from this session's environment

### Documentation close-out
- Update Vol_5_5's own "Status" line from Draft to reflect what actually shipped vs. what remains aspirational, across the full revised domain list
- Phase 5 close-out note in `Checklist_Master.md`, naming every real open gap honestly (voice notes, true unattended inbound, PO partial-receipt/amendment, e-Invoice/SST tax-code determination, multi-recipient e-signature, payroll-run automation) — none silently declared resolved
- Bring `Checklist_Master.md` and `Vol_5_5_Universal_Input_Architecture.md` in line with the 14 September 2026 revision, closing the follow-up flagged in `00_Sprint_Plan_Overview.md`

## Definition of Done

- [ ] Full channel × domain verification matrix completed and recorded across all ~14 domains, gaps named explicitly where found — **OPEN, disclosed**: this requires the real Quick Capture/Forward-to-AiFA UI on the owner's actual running app, which this cloud session cannot drive (same limitation Sprint 49 disclosed for Phase 4's close-out). Handed to the owner as `Sprint_62_Pilot_And_UI_Checklist.md`, Part 1 — not silently assumed passing.
- [x] PO chaining and Sale → payment-expected chaining each re-verified idempotent across at least two full runs — live-verified 16 September 2026 via `sprint62_regression_test.sql`: a SECOND, fully independent PO (PO-000003) and sale (QTN-000002/INV-000002) were run end to end, reproducing Sprint 61's own first-run shape exactly. Idempotency itself (not just reproducibility) was also proven directly: re-calling `confirm_purchase_order_receipt`, `mark_purchase_order_paid`, and `record_payment` on already-completed records was confirmed to fail cleanly (`purchase_order_not_approved`, `purchase_order_not_ready_for_payment`, `payment_exceeds_outstanding_balance` respectively) rather than silently duplicating a `chained_intakes` row — `count(*)` checks confirmed exactly 2 rows for the PO chain and exactly 1 for the sale chain both before and after the rejected re-calls.
- [x] The five permanent-approval domains verified to never auto-record, across real test captures — live-verified 16 September 2026: Sprint 61 only sampled one domain (`stock_adjustment`) as its proof of concept; this sprint swept the remaining four (`attendance_correction`, `e_invoice_flag`, `contract_alert`, `e_signature_request`) explicitly, each independently reaching `confirmation_count = 3` while `is_trusted` stayed `false` for every one — the exclusion is confirmed uniform across all five, not just the one Sprint 61 happened to pick.
- [ ] At least one real owner-run pilot completed on a real device for at least one forwarded channel, covering domains from each of Sprints 58-60 — **OPEN, disclosed**: genuinely requires the owner's own phone and a real forwarded WhatsApp message/email, which this session has no access to. Handed to the owner as `Sprint_62_Pilot_And_UI_Checklist.md`, Part 4 — the same honest gap Sprint 49 named for Phase 4, not resolved differently here because the underlying constraint (this session has no device) hasn't changed.
- [x] `npm run typecheck` and `npm run lint` pass clean across `web/` and `app/` — trivially true: this sprint added no new code (it is a pure QA/verification sprint against Sprint 61's already-clean, already-typechecked code), so there is nothing new to break; last confirmed clean by the owner at Sprint 61's close.
- [x] Vol_5_5, `Checklist_Master.md`, and `00_Sprint_Plan_Overview.md` all agree on the actual shipped state, not aspirational state — reconciled 16 September 2026 (see each file's own update).

## Close-out note (16 September 2026)

This sprint's SQL-verifiable scope (chaining idempotency across two independent
runs each, plus the full five-domain permanent-approval sweep) is genuinely
done, live-verified against the owner's real Supabase project the same way
every sprint since 58 has been. The two DoD items that need the owner's real
device and real running app UI — the full channel × domain matrix and the
real forwarded-WhatsApp/email pilot — are **explicitly left open**, not
assumed passing, per this sprint's own stated discipline (see Risks table:
"a live device pilot may again be unavailable from this session's own
environment... treat an owner-run pilot... as the real verification step").
A written checklist (`Sprint_62_Pilot_And_UI_Checklist.md`) was handed to the
owner covering exactly those two items, to be run whenever convenient and
folded back into this close-out once reported.

One clarification surfaced while running the second PO/sale chains that is
worth recording precisely, since it affects how any future SQL-editor
regression test against this schema must be written: `approval_tasks.status`
does NOT accept the value `'pending'` — its check constraint only allows
`'pending_approval'`, `'approved'`, `'rejected'`, `'auto_approved'`. This
sprint's test script originally assumed `'pending'` (copied loosely from
general terminology, not checked against the actual constraint first) and
had to be corrected live against `pg_get_constraintdef` before the
approve-trigger toggle (needed because of this same business's known
auto-approve-on-INSERT quirk, disclosed at Sprint 61's close) would work.
Not a schema bug — the schema was already correct — but a test-writing
lesson, now corrected in the delivered script.

## Dependencies

All prior Phase 5 sprints (53-61).

## Risks

| Risk | Mitigation |
|---|---|
| A cross-channel matrix nearly three times the size of the original plan's could reveal many small bugs late, tempting a rushed "fix everything" scramble | Apply the same Risk-table triage rule Sprint 49 used: fix anything shell-level/cross-cutting inline; log anything module-specific and non-blocking as a disclosed open item rather than scope-creeping the sprint |
| A live device pilot may again be unavailable from this session's own environment, as it was for Sprint 49 | State that limitation plainly if it recurs, and treat an owner-run pilot (on their own machine) as the real verification step, exactly as Sprint 49 recommended for Phase 4 |
| The permanent-approval domain check is new to this sprint and easy to under-test if treated as "just another domain" in the matrix | Called out as its own explicit task above, not folded silently into the general matrix — a failure here is the single most consequential possible finding in this sprint |

## Safe to Carry Over

Nothing by design — this is the phase's own close-out sprint; anything not resolvable here becomes an explicitly logged open item for whatever comes after Phase 5, not a carryover within this phase.

---

*End of Sprint 62. End of Phase 5 Sprint Plan (revised 14 September 2026).*
