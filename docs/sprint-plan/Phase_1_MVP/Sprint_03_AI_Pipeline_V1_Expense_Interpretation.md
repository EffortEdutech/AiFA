# Sprint 3 — AI Pipeline v1: Expense Interpretation

**Duration:** Weeks 5–6
**Architecture references:** Vol 2_2 (Bookkeeping Intelligence Engine), Vol 3_1 (KRCE), Vol 5_2 §4.1 (Phase 1 single-pipeline shape), Vol 6_3 (Expense Operations)

---

## Theme

This is the sprint where AIFA starts actually doing the thing it promises. Scope is deliberately narrowed to one domain (Expense — the MVP wedge per Vol 0_1 §4) so the AI pipeline's shape gets proven before being replicated across Sales, Purchase, and Banking in later sprints.

## Objectives

A captured Expense-domain Business Event is automatically classified and recorded (or routed to confirm/clarify) by a real AI call — no more manual-only entry for expenses.

## Task Breakdown

### PCB Assembly (Phase 1 minimal form)
- Implement PCB construction per Vol 11_1 §6: user_intent, relevant_rules (from the Expense `accounting_rules.json`), business_context, source_references, pka_version, limitations
- Ensure only the relevant slice of data is included — no full-database dumps, even in Phase 1's simplified form (Vol 3_1 §6 still applies)

### AI Pipeline (single orchestrated call chain, Vol 5_2 §4.1)
- Implement the classify → record chain as one pipeline (not separate agents yet)
- Wire the cloud AI model integration (Vol 11_0 §4) for both text and structured classification calls
- Implement the confidence thresholds exactly per Vol 2_2 §4.1: ≥90% auto-record, 60–89% draft+confirm, <60% clarifying question
- Implement the clarifying-question UX: a specific question, not a generic "please review"

### Bookkeeping Output
- Map classified expenses to the Phase 1 chart-of-accounts subset (Vol 11_1 §4.1)
- Generate the corresponding `LedgerEntry` rows (built fully in Sprint 4, but the BIE output contract should be finalised now)
- Every entry links back to its Business Event ID (Vol 2_2 §6)

### Explainability
- Every AI-produced result stores its source_references and relevant_rules so a "why" view is possible later (Vol 5_3) — the UI for this comes in Sprint 11, but the data must be captured now or it's lost

## Definition of Done

- [ ] Capturing an expense (text mode) results in a real AI classification, not a stub
- [ ] Confidence thresholds route correctly to auto-record / draft-confirm / clarify in test cases for each band
- [ ] A misclassified draft can be corrected by the owner, and the correction is stored
- [ ] Every AI decision has a traceable source_reference persisted in the data layer
- [ ] Cost-per-event for a typical expense capture is measured and logged (feeds the program-level cost risk in the Overview)

## Dependencies

Sprint 2's `BusinessEvent`/`BusinessData` layer and manual capture flow (this sprint upgrades that flow with real interpretation).

## Risks

| Risk | Mitigation |
|---|---|
| Confidence thresholds are wrong on day one | Expected — instrument confirm/correct rates from the start so they can be tuned with real data, don't treat the initial numbers as final |
| Scope creep into building all four agents (Vol 5_2's full target) | Explicitly build the single-pipeline Phase 1 version; splitting into agents is a Phase 2 decision, not a Sprint 3 one |
| AI latency makes capture feel slow | Measure round-trip time; if it's bad, a "processing" state in the UI is the Phase 1 answer, not premature optimisation |

## Safe to Carry Over

Cost-per-event dashboarding/reporting tooling can be informal (a log line) in this sprint and formalised later.

---

*End of Sprint 3.*
