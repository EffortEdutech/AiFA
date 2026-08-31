# Sprint 16 — Mobile Sync Client & Read-Only Enforcement

**Duration:** Weeks 7–8 (of Phase 2)
**Architecture references:** Vol 12_1 §3 (Sync Envelope), §6 (Sync Flow), §6.3 (Idempotency)

---

## Theme

The mobile app becomes the first real client of the sync envelope and lock infrastructure built in Sprints 14–15: it pushes local changes as envelopes, pulls remote ones, and — critically — actually stops writing when it isn't the active device, rather than just displaying a state that says it should.

## Objectives

The mobile app pushes and pulls sync envelopes correctly and idempotently, and genuinely refuses local writes when demoted, not merely showing a read-only label while the write path stays open.

## Task Breakdown

### Push (local change → cloud)
- Every local mutation that should sync (Business Event insert, status transition, Business Data/LedgerEntry/Document/AiInterpretation writes, BusinessKnowledgeEntry/AppSettings upserts) gets wrapped into a Sync Envelope per Vol 12_1 §3's `entity_type`/`op` model
- Outbox pattern: envelopes queue locally before push, survive app kill, and flush on reconnect — reusing the Sprint-9 offline-queue pattern rather than inventing a new one
- Push implementation: encrypt payload with the DEK (Sprint 14), send to `public.sync_envelopes`, get back `server_seq`

### Pull (cloud → local)
- Poll (or equivalent) for new envelopes since the device's `last_synced_server_seq`, apply them to local storage via `@aifa/core`'s `DataAdapter`, advance the local watermark
- Applying a pulled envelope must go through the same validation/construction logic as a local write (via `@aifa/core`), not a separate deserialisation path that could drift from it

### Idempotency
- Deterministic envelope ids + `INSERT OR IGNORE`-equivalent handling on both push (server side, already covered by Sprint 14/15's schema) and pull (client side) — reusing the pattern from Sprint 6/7/12's existing idempotent-write code, per Vol 12_1 §6.3
- Test: replay the same envelope twice (simulating a retried push or a duplicate pull), confirm no duplicate Business Event / double-counted ledger entry results

### Read-Only Enforcement
- On app launch and on every write attempt, check current lock state (via Sprint 15's live re-check, not a cached value) before allowing a write
- When not the active device: block the write path at the `DataAdapter` / `@aifa/core` boundary, not just in the UI — a UI that hides the "Save" button but leaves the underlying write function callable is not read-only enforcement
- Clear, honest UI state when read-only: the owner sees why (which device is active) and how to reclaim (request activation), not just a generic disabled screen

## Definition of Done

- [ ] Every syncable local mutation produces a correctly-formed Sync Envelope and reaches the cloud on reconnect, verified via the Sprint-9-style connectivity-loss test scenarios reused here
- [ ] Pulled envelopes apply through `@aifa/core`, producing state identical to the same change made locally
- [ ] Replaying a duplicate envelope (push or pull) is proven to produce zero duplicate data — automated test, not manual spot-check
- [ ] A demoted device's write path is confirmed blocked at the code level (attempt a write directly against the adapter, not just via UI, and confirm it's rejected)
- [ ] Read-only UI state clearly explains which device is active and how to request activation

## Dependencies

Sprint 13 (`@aifa/core` must exist as the shared validation/construction layer pulled envelopes apply through), Sprint 14 (`sync_envelopes` schema + DEK), Sprint 15 (lock state to check against).

## Risks

| Risk | Mitigation |
|---|---|
| Read-only enforcement gets implemented as a UI-only gate, reopening the exact concurrent-write problem ADR-003 exists to prevent | Explicit test that attempts a write directly against the data layer while demoted, bypassing the UI entirely |
| Idempotency logic works for the common case but not for envelopes that arrive out of order | Test out-of-order envelope arrival explicitly, not just duplicate/retry |
| Outbox grows unbounded if push keeps failing (e.g. DEK issue, network flapping) | Surface a clear "N items waiting to sync" state to the owner rather than failing silently, consistent with Vol 12_1's device-visibility principle even before Sprint 19's dedicated panel exists |

## Safe to Carry Over

Push/pull transport can be plain HTTP polling in this sprint, per the Overview's explicit deferral of Realtime — don't let transport optimisation block this sprint's correctness work.

---

*End of Sprint 16.*
