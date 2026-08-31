# AIFA — Phase 1 (MVP) Sprint Plan
## Overview

**Prepared:** 1 August 2026
**Scope authority:** `docs/architecture/v2.0/Vol_0_1_MVP_Phased_Delivery_Roadmap.md` — this plan builds *only* what that volume marks Phase 1. Nothing from Phase 2 or Phase 3 appears here except where explicitly noted as a deferred stub.
**Companion document:** `Checklist_Master.md` in this folder — the same work, as trackable checkboxes.

---

## 1. Purpose

This is the execution plan that turns the Phase 1 scope in Vol 0_1 into 12 sequential two-week sprints, ending in a pilot-ready MVP: a mobile app where a business owner can capture a Business Event by voice, text, or photo; have it interpreted and recorded as a proper double-entry transaction; and see an honest, explainable dashboard and a small set of AI CFO observations — for the Sales, Purchase, Expense, and Banking domains only.

## 2. Assumptions

| Assumption | Detail |
|---|---|
| Team | Solo or near-solo (1–2 people, full-stack). Sprints are sequenced **serially** — this plan does not assume parallel workstreams across separate mobile/backend/AI people. If a second person joins, sprints can compress by running the "Mobile/UX" and "Backend/Data" task groups within a sprint in parallel rather than by adding more people to unrelated sprints. |
| Cadence | 2-week sprints, 12 sprints, ≈ 24 weeks (~6 months) to a pilot-ready MVP. This is a planning estimate assuming focused, largely unblocked time — real calendar time typically runs longer once life, debugging surprises, and API/vendor friction are accounted for. Treat sprint numbers as sequence, not a calendar guarantee. |
| Tech stack | As decided in `Vol_11_0_Technology_Stack_Decisions.md`: React Native or Flutter, SQLite + SQLCipher, a single cloud AI model (vendor-configurable), Supabase-style backend for auth/backup/storage. |
| Data schema | As defined in `Vol_11_1_MVP_Data_Schema.md` — every sprint that touches data should build against those field definitions directly rather than re-deriving structure. |
| Starting point | Zero code as of this plan's writing. Sprint 1 starts from an empty repository. |

## 3. What Is Explicitly Out of Scope for This Plan

Per Vol 0_1's phase map, none of the following appear in Sprints 1–12. They are listed here so scope creep is visible and deliberate if it happens:

- Inventory, Asset, Payroll, Project, and Tax-filing operations (Vol 6_5–6_9) — Phase 2
- Local/on-device AI model execution and local-vs-cloud routing (Vol 5_1) — Phase 2
- Live multi-device sync (only backup/restore ships in Phase 1) — Phase 2
- Team access / multi-user roles (Vol 8_1) — Phase 2
- Third-party integrations (bank feeds, POS, etc., Vol 8_3) — Phase 2
- Signed/distributed Finance PKA packages, PKA update/rollback (Vol 8_5) — Phase 2
- Configurable AI autonomy levels (Vol 7_7 Section 3) — Phase 2 (Phase 1 always requires confirm/correct per the thresholds in Vol 2_2, Section 4.1)
- Everything in Series 9 (Developer & Extension) and Series 10 (Enterprise & Future Vision) — Phase 3

## 4. Sprint Index

| Sprint | Theme | Primary Architecture References |
|---|---|---|
| 1 | Foundation & Setup | Vol 11_0, Vol 7_0, Vol 3_0 §4.1, Vol 8_1 |
| 2 | Business Event Data Layer & Manual Capture | Vol 4_0, Vol 7_1, Vol 11_1 §2–3 |
| 3 | AI Pipeline v1 — Expense Interpretation | Vol 2_2, Vol 3_1, Vol 5_2 §4.1, Vol 6_3 |
| 4 | Financial Data / Ledger & Dashboard v1 | Vol 4_1, Vol 11_1 §4, Vol 7_3 |
| 5 | Photo Capture, OCR/Vision & Documents | Vol 7_1 §5.1, Vol 7_6, Vol 11_1 §5 |
| 6 | Sales & Purchase Domains | Vol 6_1, Vol 6_2 |
| 7 | Banking, CFO Guidance v1 & AI Workspace | Vol 6_4, Vol 2_4, Vol 0_1 §6, Vol 7_2 |
| 8 | Business Knowledge Heuristics & Notifications | Vol 4_2 §3.1, Vol 11_1 §7, Vol 7_5 |
| 9 | Offline Robustness & Backup/Restore | Vol 7_4, Vol 4_4, Vol 8_4 |
| 10 | Security, Settings & Data Rights | Vol 8_2, Vol 7_7, Vol 8_1 |
| 11 | Observability & Polish | Vol 8_6, Vol 5_3, Vol 1_2 |
| 12 | Pilot Readiness & Launch | Cross-cutting — see Sprint 12 |

## 5. MVP Exit Criteria ("Definition of Phase 1 Done")

Phase 1 is complete when all of the following are simultaneously true, not when the sprint count runs out:

1. A business owner can capture a Business Event by voice, text, or photo, fully offline, with nothing ever lost.
2. Sales, Purchase, Expense, and Banking (manual) events are interpreted by the AI pipeline and recorded as correct, balanced double-entry transactions, with confidence-based auto-record / confirm / clarify behaviour per Vol 2_2 §4.1.
3. The dashboard shows an accurate cash position, money in/out trend, and receivables/payables lists, computed from real recorded data — no placeholder numbers.
4. The AI CFO surfaces the reduced Phase 1 guidance set (Vol 0_1 §6) with a working explainability trail (every figure traces to its Business Event).
5. Data is encrypted at rest, backed up, and restorable on a new device login.
6. The app has been used by at least one real business owner outside the build team for at least two consecutive weeks without data loss or a trust-breaking AI error.

## 6. Program-Level Risks

| Risk | Why It Matters | Mitigation |
|---|---|---|
| Solo-developer bus factor | Single point of failure for all delivery | Keep architecture docs and this plan as the source of truth so work is resumable by anyone, including a future collaborator |
| Cloud AI cost per event | Every capture and advisory turn costs a model call; margins depend on this | Track cost-per-event from Sprint 3 onward; revisit model choice (Vol 11_0 §4) if it threatens unit economics |
| OCR/vision accuracy on real receipts | Core value proposition depends on this working well enough to trust | Validate accuracy against real receipts starting Sprint 5, not just clean test images; the fallback in Vol 7_1 §5.1 is the safety net, not the target experience |
| Confidence threshold mistuning | Too aggressive auto-recording erodes trust; too conservative makes the app tedious | Treat the Vol 2_2 §5.1 thresholds as a tunable config from day one, and watch real confirm/correct rates starting Sprint 4 |
| Scope creep back toward the full architecture | The full 62-volume vision is compelling and it's tempting to build more of it early | Vol 0_1 Section 3 exists specifically to prevent this; any sprint that starts pulling in Phase 2/3 work should be flagged, not silently absorbed |

## 7. How to Use This Plan

Each sprint document states a theme, objectives, a task breakdown by area, a Definition of Done, dependencies on prior sprints, and sprint-specific risks. Work through them in order — later sprints assume earlier ones are functionally complete, not just started. If a sprint runs long, prefer trimming a lower-priority task within it (each sprint doc flags what's safe to carry over) over skipping ahead, since most sprints build directly on the previous one's data model or UX shell.

---

*End of Overview.*
