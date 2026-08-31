# Sprint 12 — Pilot Readiness & Launch

**Duration:** Weeks 23–24
**Architecture references:** Cross-cutting — validates Vol 0_1 §5 (MVP Exit Criteria) in full

---

## Theme

This sprint doesn't build new architecture — it proves the eleven sprints before it actually add up to the product Vol 0_1 promised, with a real business owner using it under real conditions.

## Objectives

At least one real business owner outside the build team uses AIFA for genuine day-to-day capture for two consecutive weeks, and every MVP Exit Criterion in the Overview (Section 5) is verifiably true.

## Task Breakdown

### Pilot Onboarding
- A simple first-run onboarding flow: account creation, business profile setup, a short explanation of how capture works
- Identify and onboard at least one real pilot business owner (ideally someone genuinely running an SME, not a friendly tester who already knows how the app works)

### Bug Bash
- Dedicated, structured bug-hunting pass across the full app, informed by real pilot usage as it happens, not just internal testing
- Prioritise anything that causes data loss, incorrect financial figures, or a broken confirm/correct loop — these are launch-blocking by definition

### Distribution
- Package the app for internal/beta distribution (e.g., TestFlight, Play Console internal testing track) appropriate to the chosen platform
- Confirm the backend project is on a production (not just development) configuration

### Exit Criteria Verification
- Walk through every item in `00_Sprint_Plan_Overview.md` Section 5 explicitly and confirm each one with evidence (a test, a screenshot, a pilot usage log) — not from memory

## Definition of Done

- [ ] A real pilot business owner has used AIFA daily for two consecutive weeks
- [ ] Zero data-loss incidents and zero incorrect-ledger incidents during the pilot window
- [ ] Every MVP Exit Criterion (Overview §5) is checked off with evidence, not assumed
- [ ] The app is distributed via a real (even if limited) release channel, not just a development build

## Dependencies

All prior sprints — this is the integration and validation point for the entire Phase 1 plan.

## Risks

| Risk | Mitigation |
|---|---|
| Pilot user churns before two weeks | Have a backup pilot candidate identified in advance |
| Real usage reveals a Phase 1 scope gap (a domain or workflow that turns out to matter more than expected) | Log it explicitly as a Phase 2 candidate rather than scrambling to build it mid-pilot — the pilot's job is to surface these, not fix them immediately |
| "Done" gets declared on sprint-count exhaustion rather than actual criteria | The Definition of Done above is exit-criteria-based specifically to prevent this — don't ship on a calendar, ship on evidence |

## After This Sprint

Phase 1 is complete. The next planning artefact is a Phase 2 scoping pass, informed by real pilot feedback and revisiting Vol 0_1's Phase 2 list (multi-device sync, team access, inventory/payroll/tax domains, local AI, richer analytics) — not a resumption of this plan, since this plan's job ends here.

---

*End of Sprint 12 — End of Phase 1 Sprint Plan.*
