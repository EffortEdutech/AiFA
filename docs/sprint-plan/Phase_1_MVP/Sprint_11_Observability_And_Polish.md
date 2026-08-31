# Sprint 11 — Observability & Polish

**Duration:** Weeks 21–22
**Architecture references:** Vol 8_6 (Observability & Diagnostics, Phase 1 minimal), Vol 5_3 (AI Context Management — explainability surface), Vol 1_2 (UX Architecture)

---

## Theme

Everything works by now, in the sense that the happy paths are done. This sprint is about the app surviving contact with real, messy usage: knowing when something breaks, showing the "why" behind every number, and fixing the rough edges that accumulated across ten sprints of feature-first work.

## Objectives

Basic crash/error visibility exists for the build team; every figure the owner sees has a working "why" drill-down; known UX rough edges from prior sprints are resolved.

## Task Breakdown

### Observability (Minimal, Vol 0_1 Series 8 note)
- Basic crash reporting integration
- API/AI-call error logging (failures, timeouts, cost tracking continued from Sprint 3)
- A simple owner-facing diagnostics view: last backup time, sync/queue status (Vol 8_6 §4) — not a full dashboard, just enough to self-diagnose "is something wrong"

### Explainability Surface (finishing Vol 5_3's requirement)
- Build the "why" drill-down UI that every figure has been quietly storing source_references for since Sprint 3
- Tapping any dashboard figure, ledger entry, or AI recommendation shows its originating Business Event and the PKA rule that governed it
- Low-confidence or "insufficient context" states are visibly distinguished from confident ones, not presented identically (Vol 5_3 §3)

### Polish Pass
- Sweep every screen for empty states, loading states, and error states — these are commonly skipped under feature pressure and need dedicated attention
- Revisit the capture failure handling from Sprint 5 with fresh eyes; confirm it still feels honest, not broken
- Accessibility basics (readable text sizes, sufficient contrast) — not a full audit, but not ignored either

## Definition of Done

- [ ] Crash reports and AI-call errors are visible to the build team, not silent
- [ ] Every owner-facing figure has a working, accurate "why" drill-down
- [ ] Low-confidence states are visually distinct from confident ones throughout the app
- [ ] A full click-through of every screen finds no missing empty/loading/error state

## Dependencies

Explainability data captured since Sprint 3; every feature sprint's screens (this sprint audits and completes them).

## Risks

| Risk | Mitigation |
|---|---|
| "Polish" scope balloons indefinitely | Time-box to this sprint; anything not done becomes an explicit, tracked Sprint 12 or post-launch item, not silent slippage |
| Explainability UI reveals gaps in what was actually stored earlier | Expected — this is exactly why explainability data was required as part of Definition of Done in Sprints 3, 6, and 7 |

## Safe to Carry Over

Accessibility beyond the basics and full visual design polish can move to a post-Phase-1 backlog explicitly, rather than blocking pilot readiness.

---

*End of Sprint 11.*
