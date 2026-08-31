# Sprint 15 — Device Registry & Active-Device Lock (Backend)

**Duration:** Weeks 5–6 (of Phase 2)
**Architecture references:** Vol 12_1 §5a (Device Registry & the Active-Device Lock); ADR-003, ADR-004

---

## Theme

The single most load-bearing piece of new infrastructure in this whole plan: a server-held lock that guarantees exactly one device can write at a time, plus the primary-device override on top of it. This sprint builds and stress-tests the backend in isolation, with no mobile or web UI depending on it yet — because if the lock's atomicity is wrong, it's far cheaper to find that out now than after two client apps are built against it.

## Objectives

`public.devices` and `public.active_device_lock` exist and work correctly under concurrent requests, including the primary-device forced-takeover path, verified with deliberate race-condition tests before any client code depends on them.

## Task Breakdown

### Schema
- Create `public.devices` per Vol 12_1 §5a.1/§5a.4: `device_id`, `business_id`, `device_label`, `platform`, `registered_at`, `last_seen_at`, `last_synced_server_seq`, `is_primary` (boolean, default false), `revoked_at`
- Create `public.active_device_lock`: `business_id` (PK), `active_device_id`, `lock_token`, `acquired_at`
- Constraint or trigger enforcing exactly one `is_primary = true` row per `business_id` — this is a correctness invariant, not just a UI convention

### Device Registration
- `register_device` RPC: a new device presents identity + recovery-code-derived credentials, gets a `device_id`, and is inserted into `public.devices` (Vol 12_1 §5a.3)
- First device registered for a business is automatically primary; ownership can be reassigned later (owner action, not built in this sprint unless trivial)

### Active-Device Lock — Ordinary Handoff
- `request_activation` RPC: the requesting device asserts it has synced to the cloud's current state (server_seq check against `public.sync_envelopes`), then the server atomically grants the lock — update `active_device_lock`, issue a new `lock_token`
- This must be a single atomic operation (transaction or equivalent), not a check-then-write with a race window — this is the specific risk Sprint 13/§12 flagged
- Deliberate concurrency test: fire two near-simultaneous `request_activation` calls from different simulated devices, confirm exactly one succeeds and the other receives a clear rejection, never both succeeding or the lock ending in an inconsistent state
- Every device holding a stale `lock_token` must be able to detect this on its next write attempt (live re-check, not just at launch — Vol 12_1's explicit requirement)

### Active-Device Lock — Primary Override
- Primary-device variant of `request_activation`: same atomic grant, same sync-before-write precondition (ADR-004 — this is not waived for primary); the client-side confirmation UX (a lightweight single-tap prompt for primary vs. a fuller caution prompt for non-primary, per the 2026-08-31 amendment) is a Sprint 17 concern — this sprint verifies the backend applies no different safety rule for primary, only a different response the client uses to choose which prompt to show
- Test: primary device takes over from a device that is mid-write or has an unexpired lock — confirm the primary always wins, unconditionally, per ADR-004

## Definition of Done

- [ ] `public.devices` enforces exactly one primary device per business (tested, not just documented)
- [ ] `register_device` correctly onboards a new device and sets primary status per the first-device rule
- [ ] `request_activation` is verified atomic under concurrent requests (the race-condition test above passes repeatably, run more than once)
- [ ] A device holding a stale lock token is detected and rejected on its next write attempt, not just at its next app launch
- [ ] Primary-device forced takeover always succeeds regardless of current lock holder, and still requires the sync-before-write precondition
- [ ] No mobile or web client code depends on this yet — backend-only, verified via direct RPC calls / test harness

## Dependencies

Sprint 14 (`public.sync_envelopes` must exist for the sync-before-write precondition check to have something real to check against).

## Risks

| Risk | Mitigation |
|---|---|
| Atomicity looks correct in manual testing but breaks under real network timing | Use an actual concurrency test (parallel requests, not sequential calls that happen to be close in time) — a manual click-two-buttons-quickly test is not sufficient evidence |
| Primary-device invariant (exactly one true) gets violated by a bug in a future sprint that touches `public.devices` | Enforce it at the database constraint/trigger level, not just in application code, so it can't silently drift |
| "Live re-check" of write permission is expensive if implemented as a query on every single write | Note this as a Sprint 20 hardening/performance item if it becomes a real bottleneck — correctness first, optimise once real usage patterns exist |

## Safe to Carry Over

Owner-facing device revocation/renaming flows can be a thin RPC in this sprint and a polished UI later (Sprint 19) — the backend contract matters more here than the UI.

---

*End of Sprint 15.*
