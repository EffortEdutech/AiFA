# Sprint 17 — Active-Device Handoff & Primary Override UX (Mobile)

**Duration:** Weeks 9–10 (of Phase 2)
**Architecture references:** Vol 12_1 §6a (Active-Device Handoff Protocol), including §6a.5 (Primary Device Override)

---

## Theme

Sprint 15 built the backend lock and Sprint 16 made the mobile app respect it; this sprint builds the actual owner-facing experience of switching which device is active — the handoff flow, the "someone else is trying to take over" notification on the demoted side, and the zero-friction primary-device override.

## Objectives

An owner can, from the mobile app, request to become the active device and see the correct sequence play out (sync first, then grant, then the other device visibly stalls) — and if they're on their primary device, reclaim active status with only a lightweight single-tap confirmation (not the fuller non-primary caution prompt, and not zero confirmation), while everyone else still gets demoted correctly.

## Task Breakdown

### Ordinary Handoff (Non-Primary Requesting Device)
- "Make this device active" action, visible from wherever device state is already surfaced (this sprint can use a minimal version of what Sprint 19 will build out fully)
- Trigger flow per Vol 12_1 §6a.2: requesting device syncs to cloud's current state → calls `request_activation` (Sprint 15) → on grant, becomes active
- Confirmation prompt shown when the current active device looks in-use (per Vol 12_1 §6a.1's trigger condition) — this is the UX gate that primary devices skip, built explicitly here so Sprint 17 can prove the primary path skips it correctly rather than never having it to skip

### Demotion Side
- The now-demoted device receives the broadcast/notification that it's no longer active (poll-based is fine per this plan's deferred-Realtime decision) and transitions to the read-only state Sprint 16 already enforces at the data layer
- UI clearly states what happened: which device is now active, when, and that any offline writes made before this point will reconcile automatically (sets expectations for the Sprint 20 backstop case, without needing to explain the mechanism)

### Primary Device Override
- "Take over as active device" action for the primary device — same underlying `request_activation` call, but using the primary-override path Sprint 15 built, and showing the lightweight single-tap confirmation ("Take over as active device now?" / one Confirm action) regardless of the current active device's in-use state, rather than the fuller non-primary caution prompt
- Verify: the sync-before-write step still runs and still blocks the takeover from completing if sync hasn't finished — what primary status removes is the fuller caution prompt's detail and read-then-decide friction, not the safety check, and not confirmation itself (ADR-004 as amended 2026-08-31, restated concretely here in UI terms)
- Owner can view and change which device is primary (simple settings action — full device-management polish is Sprint 19)

### Offline Edge Case (Groundwork Only)
- Confirm the demoted device correctly detects, on next reconnect, that it missed a demotion broadcast while offline (Vol 12_1 §6a.4) — detection and correct read-only transition only; the actual reconciliation of any writes it made in the meantime is Sprint 20's job, not this sprint's

## Definition of Done

- [ ] Requesting activation from a non-primary device shows the fuller caution prompt when the current active device is in-use, and completes the sync-then-grant sequence correctly on confirm
- [ ] The demoted device transitions to read-only within a reasonable poll interval and clearly explains why
- [ ] Primary-device takeover shows only the lightweight single-tap confirmation (never the fuller non-primary prompt), in every tested scenario including when the current active device is mid-session
- [ ] Primary-device takeover is confirmed to still block on an incomplete sync — tested by deliberately delaying/failing the sync step and observing the takeover does not complete early
- [ ] A device that missed a demotion broadcast while offline correctly detects this and transitions to read-only on reconnect, before Sprint 20's reconciliation logic runs

## Dependencies

Sprint 15 (backend lock + primary-override RPC), Sprint 16 (read-only enforcement at the data layer this UI triggers).

## Risks

| Risk | Mitigation |
|---|---|
| The lightweight primary confirmation gets implemented as "no safety check" by mistake, since simplifying a UI step is an easy place to accidentally remove the check behind it | The specific test above (delay sync, confirm takeover blocks) exists precisely to catch this |
| Owner finds the read-only demotion confusing or alarming in practice, even though it's working as designed | Sprint 17's copy/UI review should be tested informally with the owner before Sprint 20's pilot, not left until the pilot to discover it reads badly |
| Poll-based demotion notification feels laggy | Acceptable for this plan (Realtime is explicitly deferred) — note actual observed latency for Sprint 20's pilot write-up rather than trying to fix it here |

## Safe to Carry Over

Full device-list/settings polish (renaming devices, revoking a lost device, seeing last-seen timestamps) is Sprint 19's job — this sprint only needs the minimum device picker required to demonstrate the handoff and override flows.

---

*End of Sprint 17.*
