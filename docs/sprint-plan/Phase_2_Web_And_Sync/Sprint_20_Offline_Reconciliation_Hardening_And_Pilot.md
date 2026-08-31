# Sprint 20 — Offline Reconciliation Backstop, Hardening & Pilot

**Duration:** Weeks 15–16 (of Phase 2)
**Architecture references:** Vol 12_1 §7 (Reconciling Offline Writes — the Backstop Case); Phase 2 exit criteria (Overview §5)

---

## Theme

This sprint doesn't build new architecture — same posture as Phase 1's Sprint 12. It builds the one remaining piece (the offline-demoted-device reconciliation backstop), then proves the eight sprints before it actually add up to a system that behaves correctly under real multi-device use, per Vol 12_1 §7's entity-by-entity table.

## Objectives

The narrow but real edge case — a device that captured data offline before learning it had been demoted — reconciles correctly for every entity type per Vol 12_1 §7.4's summary table, and a real multi-device pilot validates every Phase 2 exit criterion with evidence.

## Task Breakdown

### Offline Reconciliation Backstop
- Implement entity-by-entity per Vol 12_1 §7: append-only entities (BusinessEvent insert, BusinessData, LedgerEntry, Document, AiInterpretation) reconcile by straightforward append — no real conflict possible by construction
- The one genuine conflict case — a BusinessEvent status transition (confirm/correct) made offline by a now-demoted device — implement the specific resolution rule Vol 12_1 §7.2 specifies, not an improvised one
- Genuinely mutable, low-stakes entities (BusinessKnowledgeEntry, AppSettings) — implement the simpler last-write-wins-or-equivalent rule Vol 12_1 §7.3 specifies
- Test every row of the §7.4 summary table explicitly, not just the cases that seemed hardest

### Bug Bash
- Structured bug-hunting pass across the full sync/lock/handoff system built in Sprints 14–19, prioritising anything that could cause data loss, a silently duplicated Business Event, or an incorrect ledger figure — launch-blocking by definition, same standard as Phase 1's Sprint 12

### Multi-Device Pilot
- Run the pilot with at least one real owner (ideally the same pilot relationship from Phase 1, or a new one) using two or more of their own devices — for example phone plus laptop browser — for at least one full week
- Log every handoff, every takeover, every demotion, and cross-check against the Devices panel's own record of what happened

### Exit Criteria Verification
- Walk through every item in this plan's Overview §5 explicitly and confirm each one with evidence (a test, a screenshot, a pilot usage log) — not from memory, same discipline Phase 1's Sprint 12 used

## Definition of Done

- [ ] Every row of Vol 12_1 §7.4's entity summary table has a passing automated test for its reconciliation behaviour
- [ ] The BusinessEvent status-transition conflict case specifically is tested with a real offline-then-reconnect scenario, not just unit-level logic
- [ ] Zero data-loss and zero incorrect-ledger incidents found during the bug bash that remain unresolved
- [ ] A real multi-device pilot has run for at least one full week with a usage log
- [ ] Every Phase 2 exit criterion (Overview §5) is checked off with evidence
- [ ] The metadata-exposure trade-off and DEK-reuse approach (signed off in Sprint 13) have held up under real pilot usage without surfacing a problem the owner wasn't told to expect

## Dependencies

All prior Phase 2 sprints — this is the integration and validation point for the entire plan, exactly as Phase 1's Sprint 12 was for that plan.

## Risks

| Risk | Mitigation |
|---|---|
| Pilot reveals the lightweight primary-takeover confirmation still feels too easy to trigger by accident, or conversely too much friction, in practice | This is exactly what Vol 12_1 §12 flagged as worth re-confirming once there's real usage — treat pilot feedback on this specifically as a first-class finding, not noise; the confirmation copy/timing is a small, cheap thing to tune post-pilot |
| Pilot user churns before a full week | Have a backup pilot candidate identified in advance, same mitigation Phase 1 used |
| Real usage reveals a genuine gap in the §7 reconciliation table (an entity type or scenario not anticipated) | Log it explicitly as a follow-up ADR candidate rather than patching it ad hoc mid-pilot |
| "Done" gets declared on sprint-count exhaustion rather than actual evidence | Same discipline as Phase 1's Sprint 12 — the Definition of Done above is evidence-based specifically to prevent this |

## After This Sprint

Phase 2 (Web Platform & Multi-Device Sync) is complete per this plan's scope. The next planning artefact is either a Phase 2b full-parity scoping pass (Vol 12_0 §4) or a DEK rotation/revocation design pass (the open item carried since Vol 12_1 §12 was first written) — informed by real pilot feedback, not a resumption of this plan.

---

*End of Sprint 20 — End of Phase 2 (Web & Sync) Sprint Plan.*
