# Sprint 17 — Active-Device Handoff & Primary Override UX Runbook

**Purpose:** documents what was built this sprint — the ordinary handoff confirmation flow, the primary-device forced-takeover flow, the demotion-detection mechanics, and the two backend/schema additions the UI needed to be meaningful — against Sprint 17's own DoD.

**Companion documents:** `Sprint_17_Active_Device_Handoff_And_Primary_Override_UX.md` (task breakdown), Vol 12_1 §6a (Active-Device Handoff Protocol), §6a.1–§6a.5. Builds directly on Sprint 15 (`devices`/`active_device_lock`, the four RPCs) and Sprint 16 (read-only enforcement at the data layer, the sync engine this sprint's UI drives).

---

## 1. What was built

The owner-facing handoff experience Sprint 15/16 didn't yet have a UI for: a confirmation-prompt decision engine (`@aifa/core/sync/handoff.ts`) shared between the ordinary and primary-override paths, the client-side wiring for both RPCs, a periodic demotion-detection poll, a minimal primary-device settings action, and a backend heartbeat RPC that the "is the active device genuinely in use" trigger condition turned out to depend on but nothing before this sprint had built. 165/165 tests pass (19/19 suites, 14 new) — see §5.

## 2. Design decisions this sprint had to resolve

**`last_seen_at` needed a heartbeat, or the "genuinely in use" trigger condition would be meaningless.** Vol 12_1 §6a.1/§6a.5 gate the fuller caution prompt on whether the current active device "looks like it's genuinely in use (`last_seen_at` within the last few minutes)." Sprint 15's `register_device` only ever sets `last_seen_at` once, at registration — nothing updates it afterward. Left as-is, every device would look permanently idle days after its first launch, and the caution prompt would never fire regardless of actual use. Added `touch_device_heartbeat(p_device_id, p_last_synced_server_seq)` (new SECURITY DEFINER RPC, `app/backend/schema.sql`) and call it once per successful sync cycle from `runMobileSyncCycle` — a sync-cycle cadence is "genuinely active" enough for a lightweight signal, and piggybacking on the cycle that's already running avoids a second timer purely for this.

**The confirmation-prompt decision logic lives in `@aifa/core`, not in the React Native component.** `resolveActivationConfirmation` and `describeReadOnlyReason` (`packages/core/src/sync/handoff.ts`) are pure functions with no RN/Alert dependency — same "shared engine, thin platform glue" split Sprint 13 established for the sync engine itself, and directly useful for Sprint 18/19's web client, which will need the identical rule set (primary always gets the lightweight prompt; non-primary gets the fuller caution prompt only when the current active device looks in-use; otherwise no prompt at all). This also makes the rules testable without mocking React Native's `Alert.alert`.

**No new `reason_code` column on `active_device_lock` for "the demoted device is told why."** Vol 12_1 §6a.5 asks that a primary-device takeover be distinguishable from an ordinary handoff on the demoted side. Rather than adding a broadcast payload field (a schema/Realtime change, and Realtime itself is still deferred this plan), the demoted device already has to look up the newly-active device's row (for its label) to render the banner at all — that same row's `is_primary` flag is a free, sufficient signal. `describeReadOnlyReason` branches on it directly.

**`runSyncCycle` now skips push, not just re-reads the gate, when a fresh pull reveals demotion (Vol 12_1 §6a.4's "detection" half).** Before this sprint, `pushOutbox` was called unconditionally every cycle — a device that captured writes offline, then reconnected and discovered it had been demoted, would have silently pushed those stale-context writes to the server exactly once, before Sprint 20's reconciliation/review logic could ever see them. `runSyncCycle` (in `@aifa/core/sync/syncClient.ts`) now inspects the lock snapshot its own pull just refreshed; if it names a different active device, push is skipped entirely and the outbox stays queued, with a new `skippedDueToDemotion` flag surfaced on the result for Sprint 20 to build its review UI against. `pushOutbox` itself is left unconditional — it's a primitive several Sprint 16 tests call directly and reasonably expect to always attempt what it's given; the demotion guard belongs at the orchestration layer that actually knows the lock state, not inside the primitive.

**A dedicated 30-second poll, separate from the existing reconnect-triggered sync.** `useSyncResume` (Sprint 16) only re-syncs on mount and on offline→online transitions — a device that stays continuously online would never re-check the lock between those two triggers, so a same-session demotion could go undetected indefinitely. `useDemotionPoll` (new) adds a lightweight, foreground-only timer that refreshes just the cached lock (`refreshActiveDeviceLock` — no full push/pull) every 30s. The exact interval is a documented, deliberately-simplified choice (same class as Sprint 4's `OVERDUE_THRESHOLD_DAYS`), consistent with the sprint's own risk register accepting poll-based latency as a known Phase 2 trade-off pending Realtime.

## 3. What was wired

| Piece | File | Notes |
|---|---|---|
| Confirmation-prompt rules | `packages/core/src/sync/handoff.ts` | Pure, platform-agnostic; `resolveActivationConfirmation`, `describeReadOnlyReason`, `isDeviceLikelyInUse` |
| Demotion-aware push skip | `packages/core/src/sync/syncClient.ts` | `PullResult.lockSnapshot`, `PushResult.skippedDueToDemotion`, `runSyncCycle`'s new guard |
| Primary takeover RPC call | `app/src/db/syncService.ts` | `requestPrimaryTakeover` — same pull-then-RPC shape as Sprint 16's `requestActivation`, calls `request_primary_takeover` |
| Primary reassignment RPC call | `app/src/db/syncService.ts` | `setPrimaryDevice` — calls `set_primary_device` |
| Live active-device lookup | `app/src/db/syncService.ts` | `getActiveDeviceInfo` — joins `active_device_lock` + `devices` for label/is_primary/last_seen_at, feeds the confirmation decision and the banner text |
| Device list for the settings action | `app/src/db/syncService.ts` | `getRegisteredDevices` |
| Heartbeat | `app/src/db/syncService.ts`, `app/backend/schema.sql` | `touchDeviceHeartbeat` client call + `touch_device_heartbeat` RPC; wired into `runMobileSyncCycle` |
| Lightweight lock-only refresh | `app/src/db/syncService.ts` | `refreshActiveDeviceLock`, used by the poll hook |
| Demotion poll | `app/src/hooks/useDemotionPoll.ts` (new) | 30s foreground-only timer |
| Read-only banner, updated | `app/src/components/ReadOnlyBanner.tsx` | Now runs the real confirm flow (`Alert.alert`) and branches to `requestActivation` or `requestPrimaryTakeover` |
| Minimal primary-device settings action | `app/src/components/PrimaryDeviceSettingsCard.tsx` (new) | Lists registered devices, "Set as primary" per non-primary row |

## 4. Definition of Done — verification

- **Fuller caution prompt for non-primary requests, only when the active device looks in-use; completes on confirm.** `handoff.test.ts` — `resolveActivationConfirmation` returns `kind: "caution"` only when `activeDeviceLastSeenAt` is within `ACTIVE_DEVICE_IN_USE_THRESHOLD_MS` (5 minutes) and the requester is non-primary; `kind: "none"` otherwise. The confirm path itself (`ReadOnlyBanner`'s `performActivation`) reuses Sprint 16's already-tested `requestActivation`, unchanged.
- **Demoted device transitions to read-only within a reasonable poll interval.** Covered two ways: (1) the existing reconnect-triggered `useSyncResume` cycle, whose `pullEnvelopes` already refreshes the cached lock every time (Sprint 16); (2) the new `useDemotionPoll`'s 30s foreground timer for the continuously-online case that (1) alone doesn't cover. The write gate (`assertWriteAllowed`) reads that same cache, so once either refreshes it, writes are blocked immediately — no separate "apply demotion" step needed.
- **Primary-device takeover shows only the lightweight confirmation, in every tested scenario including when the current active device is mid-session.** `handoff.test.ts` explicitly covers both an in-use and an idle current active device for a primary requester — `kind` is `"lightweight"` in both, never `"caution"`.
- **Primary-device takeover still blocks on an incomplete sync.** This precondition is enforced server-side by `request_primary_takeover` (Sprint 15's `not_caught_up` check, no compare-and-swap bypass for primary) — already concurrency-tested against a real simulated-Postgres instance in Sprint 15's own verification scripts (`sprint15_primary_race_test.py`). This sprint's client code (`requestPrimaryTakeover`) always pulls to the current checkpoint before calling the RPC, same as the ordinary path, introducing no client-side shortcut around that check. **Not independently re-run against a live database this sprint** — no live Supabase project is available in this sandbox (same standing limitation as every RPC-calling code path since Sprint 14); verified by inspection that the client passes `last_applied_server_seq` honestly and the RPC's own precondition is unchanged from Sprint 15.
- **A device that missed a demotion broadcast while offline detects this and transitions to read-only on reconnect.** `sync.test.ts`'s new `runSyncCycle` group: a device with local writes queued, discovering on its next pull that another device is now active, has its push skipped (`skippedDueToDemotion: true`) and its outbox left queued rather than silently pushed — detection and the "don't leak stale writes" half of §6a.4, exactly this sprint's declared scope (reconciliation UI is Sprint 20's).

## 5. Test summary

19/19 suites, 165/165 tests (14 new: 8 in `handoff.test.ts`, 6 added to `sync.test.ts`'s new `runSyncCycle` group). `tsc --noEmit` and `eslint` both clean (zero errors, zero warnings after `--fix`). Full pre-existing 151-test baseline unchanged and still passing — no gated repository function's signature or behaviour changed this sprint.

## 6. Device registration / DEK bootstrap — closed this sprint (addendum, same day)

Originally left open in this runbook's first version: nothing in the Sprint 13-20 breakdown ever called `initMobileSync`, so Sprint 16/17's UI was code-complete and unit-tested but not reachable in the running app. The owner asked for this fixed before Sprint 18. Closed as follows, kept deliberately minimal (no QR pairing, no dedicated first-run screen — a new "Sync" section inside the existing, already-optional Settings "Account" area):

- **`app/src/db/client.ts`** — four new SecureStore-backed helpers, same pattern as the existing `getLocalBusinessId`/`getDeviceEncryptionKey`: `getOrCreateSyncDeviceId` (this device's stable id for Sprint 15's registry — deliberately separate from the pre-cloud `aifa_local_business_id`), `getStoredSyncRecoveryCode`/`storeSyncRecoveryCode`, `hasCompletedSyncBootstrap`.
- **`app/src/db/syncBootstrap.ts`** (new) — `bootstrapSyncOnThisDevice` (runs once: derives the DEK from either this device's own key — the first-device path — or an owner-supplied recovery code from an existing device — the join path; calls Sprint 14's `reconcileLocalBusinessId`; registers the device via Sprint 15's `register_device`; stores the recovery code; calls `initMobileSync`) and `restoreSyncContextIfBootstrapped` (re-derives the DEK from the stored recovery code and re-establishes the SyncContext on every subsequent app launch — the DEK itself is never persisted, only the recovery code, matching the one-secret-in-SecureStore posture `aifa_db_key` already has).
- **`app/src/db/syncService.ts`** — `registerDevice`, wrapping Sprint 15's RPC.
- **`app/src/components/SyncSetupCard.tsx`** (new) — the one-time setup UI in Settings: a device-name field, a first-device/join-existing choice, and (for the join path) a recovery-code field with a pointer to the existing "reveal recovery code" control (Sprint 10) on the owner's other device.
- **`app/src/hooks/useActiveDeviceInfo.ts`** (new) — live active-device info (label/is_primary/last_seen_at) for `ReadOnlyBanner`, polled the same way `useDemotionPoll` refreshes the write-gate cache, but kept as a separate hook since it serves display, not the gate itself.
- **`app/src/screens/SettingsScreen.tsx`** — new "Sync" section, gated on being signed in (same non-gating posture as the existing Account section): shows `SyncSetupCard` until bootstrapped, then "Sync is enabled on this device" plus `PrimaryDeviceSettingsCard`.
- **`app/App.tsx`** — on every auth-session change, calls `restoreSyncContextIfBootstrapped`; when it succeeds, wires `useSyncResume`, `useDemotionPoll`, and `useActiveDeviceInfo` with real values and renders `ReadOnlyBanner` for real. Signing in and completing sync setup both stay fully optional — an owner who does neither sees the app exactly as before (the same permissive "no SyncContext" state `syncContext.ts` was always designed around).

Verified: `tsc --noEmit` and `eslint` both clean, full 19/19-suite, 165/165-test regression unchanged (this addendum touches only orchestration/UI code no existing test exercises — `syncBootstrap.ts` and `syncService.ts`'s RPC-calling functions are React Native/Supabase-touching glue, at the same "code-complete, not unit-tested, disclosed" tier as the rest of `syncService.ts` since Sprint 16, not exercisable without a live device and project). **Not exercised on a live device or against a real Supabase project** — same standing sandbox limitation as every RPC-calling path since Sprint 14.

## 7. What is still NOT covered (carried forward, consistent with Sprint 16's own list and this sprint's "Safe to Carry Over")

- **Full Devices panel** (every device's label/platform/last-seen/sync-state table, renaming, revocation) — explicitly Sprint 19's job per this sprint's own "Safe to Carry Over."
- **The actual reconciliation of a demoted device's queued writes** (Vol 12_1 §7, the owner-facing "N items captured before deactivation — review before sending" list) — explicitly Sprint 20's job; this sprint only built the detection/non-leak half.
- **Realtime broadcast of lock changes** — still deferred per the Phase 2 plan's own "Safe to Carry Over"; `useDemotionPoll`'s 30s timer is the poll-based substitute this plan always intended.
- **A more polished pairing UX** (e.g. QR-code recovery-code transfer instead of typing it in) — `SyncSetupCard` is deliberately minimal, matching this sprint's own "minimal device picker" scope; worth a Sprint 19 UX pass alongside the full Devices panel.

---

*End of Sprint 17 runbook.*
