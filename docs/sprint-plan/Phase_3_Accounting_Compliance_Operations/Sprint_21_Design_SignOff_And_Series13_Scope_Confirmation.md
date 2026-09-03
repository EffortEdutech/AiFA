# Sprint 21 — Design Sign-Off & Series 13 Scope Confirmation

**Status: ✅ COMPLETE — 2 September 2026**
**Duration:** Weeks 1–2 (of Phase 3)
**Architecture references:** Vol 13_0, Vol 13_1, Vol 13_2, Vol 13_3 (full, review pass)

---

## Theme

Before any schema or code, get the owner's explicit sign-off on every open decision Series 13 deliberately left open, the same way Sprint 13 did for Phase 2. This sprint changes nothing in the codebase — its output is a set of resolved decisions the next 15 sprints build against.

## Objectives

Every Open Item across Vol 13_0 §14, Vol 13_1 §11, Vol 13_2 §8, and Vol 13_3 §10 that blocks a near-term sprint has an explicit owner answer, recorded in writing, with any resulting change amended into the source volume before Sprint 22 starts.

## Task Breakdown

### Walk the Open Items That Block Sub-phase 3a (do these first)
- Vol 13_1 §11.5 — confirm the owner agrees Sprints 21–25 (roles/approval foundation) must land before any module sprint, even though it delays visible feature delivery
- Vol 13_1 §11.1 — confirm the owner understands Sprint 22 is a *design review*, not a finished crypto implementation, and agrees to that sequencing
- Vol 13_2 §8.1 — confirm default `SegregationOfDutiesPolicy` domains/thresholds are acceptable as Vol 13_2 §4.3 proposed, or get the owner's actual RM figures
- Vol 13_3 §10.1 — same threshold question, for when policies get seeded

### Walk the Open Items That Block Sub-phase 3b–3e (resolve now so later sprints aren't blocked mid-sprint)
- Vol 13_0 §14.1 — team/role model timing: confirmed resolved by Series 13 existing at all; note the resolution in Vol 13_0 itself
- Vol 13_0 §14.2 — WhatsApp send mechanism: Business Platform (Cloud API) vs. click-to-chat (Vol 13_0 §4.1) — owner decision, has lead-time consequences for Sprint 28
- Vol 13_0 §14.3 — confirm the owner will start LHDN MyInvois sandbox registration in parallel with Sub-phase 3b/3c, not wait until Sprint 33
- Vol 13_0 §14.4 — which Malaysian bank's bulk-payment file format to build first (Sprint 34)
- Vol 13_0 §14.5 — e-signature provider selection for Sprint 36 (or confirm deferral of Module I's e-signature piece if no provider decision is ready yet)
- Vol 13_0 §14.7 — acknowledge the `ChartOfAccounts` migration (Sprint 26) as its own reviewed step, not folded silently into general schema work

### Fix the Named Gap
- Vol 13_2 §8.1 flagged that Purchase Operations (Vol 6_2) never got its own Vol 13_0 module section the way Sales did — add a short Vol 13_0 addendum (or a Vol 13_0 §4a) giving Purchase the same document-header/line treatment as Sales, at minimum enough to support Sprint 27's auto-cost-from-purchase-invoice feature later

### Record Outcomes
- Amend Vol 13_0/13_1/13_2/13_3 in place for every decision above that changes what those volumes say (mirroring how Sprint 13 amended Vol 12_1 to V1.3 after its own sign-off)
- Update this plan's `Checklist_Master.md` sign-off section with the recorded decisions and today's date

## Outcomes (recorded 2 September 2026)

| Decision | Resolution |
|---|---|
| Sub-phase 3a sequencing | Confirmed — foundation before any module sprint |
| Sprint 22 scope | Confirmed — design review, not a finished crypto spec |
| SoD threshold: expense/PV | RM 500 |
| SoD threshold: sales | RM 2,000 |
| WhatsApp send mechanism | Click-to-chat |
| LHDN MyInvois sandbox | Not yet started; owner begins in parallel with 3a/3b |
| Bulk payment file format (Sprint 34) | Maybank2u |
| e-Signature provider (Sprint 36) | Deferred — revisit closer to that sprint |
| ChartOfAccounts migration | Acknowledged as its own reviewed step (Sprint 26) |
| Purchase Operations gap | Closed — Vol 13_0 §4a added |

All four Series 13 volumes (13_0, 13_1, 13_2, 13_3) amended in place to V1.1 with these decisions recorded directly against the sections they resolve.

## Definition of Done

- [x] Every Open Item listed above has an explicit recorded owner decision (not an assumed default)
- [x] Any volume amendments are made and dated
- [x] The Purchase Operations gap is closed with at minimum a stub module section
- [x] No schema or code has been written this sprint

## Dependencies

Phase 2 exit criteria met. This sprint is the gate for Sprint 22.

## Risks

| Risk | Mitigation |
|---|---|
| Owner sign-off surfaces a scope disagreement (e.g. wants a different sub-phase order) | Better found now — treat it as this sprint's most valuable possible outcome, exactly as Sprint 13 did, and re-sequence the Sprint Index in `00_Sprint_Plan_Overview.md` before Sprint 22 starts |
| Some Open Items genuinely can't be resolved yet (e.g. e-signature provider needs vendor research first) | Record as "deferred, blocks Sprint N specifically" rather than forcing a premature decision — Sprint 36's own Dependencies section should reflect this if it happens |

## Safe to Carry Over

None of this sprint's work is safe to skip — it is entirely gating decisions, not implementation, so "carrying over" isn't applicable the way it is for later sprints. If a specific Open Item can't be resolved in the two weeks, it is explicitly deferred (see Risks) rather than the sprint being called done anyway.

---

*End of Sprint 21.*
