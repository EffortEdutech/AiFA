# Sprint 8 — Business Knowledge Heuristics & Notifications

**Duration:** Weeks 15–16
**Architecture references:** Vol 4_2 §3.1 (Phase 1 BKEE heuristics), Vol 11_1 §7 (schema), Vol 7_5 (Notification & AI Recommendation Architecture)

---

## Theme

By now the app has real usage patterns to learn from (a given vendor keeps getting the same category, for instance). This sprint adds the lightweight memory that makes AIFA feel like it's paying attention, plus the proactive notification layer that brings guidance to the owner instead of waiting to be asked.

## Objectives

Repeated confirmations raise AIFA's confidence for that specific pattern; the owner receives a small number of well-prioritised notifications instead of having to check the app to find out something needs attention.

## Task Breakdown

### Business Knowledge Heuristics (Phase 1, per Vol 4_2 §3.1)
- Implement `BusinessKnowledgeEntry` per Vol 11_1 §7
- Vendor-to-category mapping heuristic: after 3 consecutive confirmations of the same mapping, mark it trusted and feed it into the BIE's confidence calculation (Vol 2_2 §4.1) as a confidence booster
- No general-purpose pattern engine — just this one heuristic, implemented directly

### Notifications (Basic, per Vol 0_1 §4)
- Action-needed notifications (e.g., overdue invoice) — reuses the Sprint 7 CFO guidance logic as the trigger source
- Confirmation-request notifications (a low-confidence draft awaiting owner input)
- Respect a simple quiet-hours setting (built fully in Sprint 10; a basic on/off is enough here)
- Prioritisation: at most a small, fixed number of notifications surfaced per day (Vol 7_5 §3) — no notification flooding

## Definition of Done

- [ ] A vendor confirmed 3 times in a row is auto-categorised on the 4th occurrence, verified by a test scenario
- [ ] Trusted mappings measurably raise BIE confidence scores in test cases
- [ ] Notifications fire for genuinely actionable conditions and do not fire for non-issues (tested against both cases)
- [ ] Notification volume stays within the fixed daily cap even when multiple conditions are true simultaneously

## Dependencies

Sprint 3's confidence-threshold logic (now extended, not replaced) and Sprint 7's CFO guidance triggers.

## Risks

| Risk | Mitigation |
|---|---|
| Over-eager auto-categorisation erodes trust if the heuristic is too aggressive | 3-confirmation threshold is a starting config (Vol 0_1 §3.4) — instrument and be ready to raise it |
| Notification fatigue | The daily cap and prioritisation logic are not optional polish — treat them as part of Definition of Done, not a nice-to-have |

## Safe to Carry Over

Quiet-hours configuration UI can be a hardcoded default (e.g., 9pm–8am) this sprint; full owner configurability lands in Sprint 10.

---

*End of Sprint 8.*
