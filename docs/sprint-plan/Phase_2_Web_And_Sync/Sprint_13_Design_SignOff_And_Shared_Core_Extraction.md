# Sprint 13 — Design Sign-Off & Shared Core Extraction

**Duration:** Weeks 1–2 (of Phase 2)
**Architecture references:** Vol 12_0 §5 (Shared Business Logic), §6 (Technology Choices); Vol 12_1 (full document, review pass); ADR-002/003/004

---

## Theme

Before any cloud schema changes or new UI, this sprint does two things that de-risk everything after it: get explicit owner sign-off on the parts of Series 12 that are still genuinely open decisions, not just implementation detail — and pull the mobile app's business logic into a shared `@aifa/core` package so the web app (Sprint 18) has something real to build against instead of a second, divergent implementation.

## Objectives

The owner has explicitly reviewed and approved (or amended) the open governance questions in Vol 12_1, and `@aifa/core` exists as a working package that the mobile app runs against with zero behaviour change.

## Task Breakdown

### Design Sign-Off (do this first — it can change scope downstream)
- Walk the owner through Vol 12_1 §4's metadata-exposure trade-off (the server now sees structured per-row metadata under `sync_envelopes`, versus the old opaque `backups` blob) and get an explicit yes/no, not an assumed one
- Confirm the primary-device takeover UX (ADR-004) still reflects the owner's intent now that it's about to become real, not hypothetical — **resolved during this sign-off (2026-08-31): the original "zero confirmation" design was revised to a lightweight single-tap confirmation, to guard against an accidental takeover from a stray tap; ADR-004 and Vol 12_1 §6a.5 have been amended accordingly (Vol 12_1 is now Version 1.3)**
- Confirm DEK distribution via the reused Sprint-10 recovery-code mechanism is acceptable as the Phase 2 launch approach, with rotation/revocation explicitly deferred (Vol 12_1 §12)
- Record any changes as amendments to Vol 12_1/Vol 12_0 and a note in the ADR register before Sprint 14 starts — do not let schema work start against a design that just changed underneath it

### Shared Core Extraction (`@aifa/core`)
- Identify the business logic currently living only in the mobile app that both platforms need: Business Event/Business Data/LedgerEntry construction and validation, the AI pipeline orchestration (PCB assembly, classify→record→analyse→advise), confidence-threshold routing, reversal-based correction logic (Vol 12_0 §5)
- Define the `DataAdapter` interface (read/write/query operations the core logic needs, implemented separately per platform)
- Implement `SQLiteDataAdapter` as the mobile-side adapter, wrapping the existing SQLite/SQLCipher access — this should be a refactor, not a rewrite, of what Sprint 2–4's mobile code already does
- Move the identified logic into `@aifa/core`, with the mobile app now calling through the adapter interface
- Full regression pass: every existing mobile unit/integration test still passes unchanged in behaviour

### Repo Structure
- Set up `@aifa/core` as its own package (monorepo workspace or equivalent) so it can be imported by both `app/` (mobile) and the not-yet-created web app
- Update `AGENTS.md` if the repo shape changes in a way that affects the operating rules (new package location, new build/test commands)

## Definition of Done

- [x] Owner has explicitly signed off on the metadata-exposure trade-off, the primary-device takeover design (amended to a lightweight confirmation), and the DEK-reuse approach — recorded in writing (2026-08-31), not verbal
- [ ] `@aifa/core` exists as a real package with the `DataAdapter` interface defined
- [ ] Mobile app runs entirely through `@aifa/core` + `SQLiteDataAdapter` for the logic identified above
- [ ] Every existing mobile test (from Phase 1 sprints) still passes with identical behaviour after the refactor
- [ ] No new user-facing feature has shipped yet — this sprint is refactor + sign-off only, deliberately

## Dependencies

Phase 1 MVP complete and stable. This sprint is the foundation every later sprint in this plan builds on — Sprint 18 (web shell) cannot start meaningfully until `@aifa/core` exists.

## Risks

| Risk | Mitigation |
|---|---|
| The extraction turns into a larger rewrite than planned once real coupling between mobile UI and business logic is discovered | Time-box the extraction; if a piece of logic resists clean separation, leave it mobile-only for now and flag it as a Sprint 18 blocker rather than letting this sprint run indefinitely |
| Sign-off conversation surfaces a real design change (e.g. owner wants metadata exposure minimised further) | Better to find this now than after Sprint 14 builds the schema — treat a design change here as this sprint's most valuable possible outcome, not a delay |
| Regression pass finds an existing Phase 1 bug unrelated to this refactor | Log it, fix it if small, don't let unrelated bug-fixing scope-creep this sprint |

## Safe to Carry Over

Not every piece of business logic needs to move into `@aifa/core` in this sprint — logic Sprint 18's minimal web slice won't touch yet (e.g. Sprint 8's Business Knowledge heuristics) can stay mobile-only until the web app actually needs it.

---

*End of Sprint 13.*
