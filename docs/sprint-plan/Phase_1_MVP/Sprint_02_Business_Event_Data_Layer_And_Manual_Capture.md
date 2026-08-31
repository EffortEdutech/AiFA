# Sprint 2 — Business Event Data Layer & Manual Capture

**Duration:** Weeks 3–4
**Architecture references:** Vol 4_0 (Business Data Architecture), Vol 7_1 (Business Event Capture Architecture), Vol 11_1 §2–3 (schema)

---

## Theme

Before any AI is involved, the canonical data spine (ADR-001: Business Events are the source of truth) needs to exist and be trustworthy. This sprint builds that spine using the simplest capture mode — manual text entry — so the data layer can be validated without also debugging AI behaviour at the same time.

## Objectives

An owner can manually log a Business Event (as a simple form, not yet AI-interpreted) and see it persist locally, immutably, with a real Business Event ID.

## Task Breakdown

### Data Layer
- Implement the `BusinessEvent` table exactly per Vol 11_1 §2 (id format `BE-YYYYMMDD-NNNN`, status enum, immutability)
- Implement the `BusinessData` table per Vol 11_1 §3
- Enforce immutability at the data-access layer: no update path exists for a confirmed `BusinessEvent`, only insert of a new superseding event (Vol 4_0 §7)
- Write unit tests proving a confirmed event cannot be mutated in place

### Capture UX (Manual/Text Mode Only)
- Build the "Capture" screen's text-entry path per Vol 7_1 §2 (text mode)
- Simple structured quick-entry form as the Phase 1 fallback referenced in Vol 7_1 §5.1 (this doubles as the OCR-failure fallback UI built ahead of Sprint 5)
- On submit: create a `BusinessEvent` (status `confirmed` for now, since there's no AI interpretation yet) and a corresponding manually-entered `BusinessData` row
- Capture is reachable from anywhere in the app shell within one interaction (Vol 7_0 §3, Vol 7_1 §4)

### Activity Feed (minimal)
- A simple reverse-chronological list of captured Business Events — not the full dashboard yet (that's Sprint 4), just enough to verify capture is working end to end

## Definition of Done

- [ ] Manual text capture creates a correctly-formed `BusinessEvent` + `BusinessData` pair matching Vol 11_1 exactly
- [ ] Attempting to edit a confirmed event in code is structurally impossible, not just discouraged by convention
- [ ] Capture is reachable in one tap/interaction from every top-level screen
- [ ] A basic activity feed shows captured events in order
- [ ] Everything above works with the device in airplane mode

## Dependencies

Sprint 1's local database and navigation shell.

## Risks

| Risk | Mitigation |
|---|---|
| Under-designing the schema now creates painful migrations later | Build exactly to Vol 11_1, not an approximation — deviations should be a deliberate ADR, not drift |
| Temptation to add AI interpretation early | Resist — Sprint 3 exists specifically to isolate that complexity |

## Safe to Carry Over

Activity feed visual polish can slip to Sprint 4 when the real dashboard is built.

---

*End of Sprint 2.*
