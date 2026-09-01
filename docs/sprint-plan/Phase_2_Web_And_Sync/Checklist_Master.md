# AIFA — Phase 2 (Web Platform & Sync) Master Checklist

Companion to `00_Sprint_Plan_Overview.md`. Same scope, tracked as checkboxes. Check items off as you go — don't mark a sprint's "Definition of Done" section complete until every item in it is checked.

**Status at time of writing:** Planning only. Every item below is unchecked because no Phase 2 code has been written yet — this checklist exists to be filled in as sprints run, not as a record of work already done (contrast with the Phase 1 checklist, which was written mid-build).

---

## Sprint 13 — Design Sign-Off & Shared Core Extraction

**Design Sign-Off**
- [x] Owner has reviewed and explicitly approved (or amended) the `sync_envelopes` metadata-exposure trade-off — approved as designed (2026-08-31)
- [x] Owner has reconfirmed the primary-device takeover design now that it's about to be built — revised to require a lightweight single-tap confirmation rather than zero confirmation (2026-08-31)
- [x] Owner has approved DEK distribution via the reused recovery-code mechanism, with rotation/revocation explicitly deferred — approved as designed (2026-08-31)
- [x] Any resulting amendments recorded in Vol 12_0/12_1 and the ADR register before Sprint 14 starts — ADR-004, Vol 12_0 §6a, Vol 12_1 (bumped to V1.3) and the master index all amended (2026-08-31)

**Shared Core Extraction**
- [x] `@aifa/core` package created (monorepo workspace) — packages/core/, resolved via TS/babel/jest path aliases (note added 2026-08-31: the root package.json's `"workspaces"` field, present at Sprint 13 sign-off, was removed during Sprint 14 after it caused npm to hoist and corrupt app/node_modules on the mounted project; alias-based resolution never required it)
- [x] `DataAdapter` interface defined — already existed as the `SqlDb` interface (packages/core/src/db/types.ts), engine-agnostic by design since Sprint 2; no new interface needed
- [x] `SQLiteDataAdapter` implemented, wrapping existing mobile SQLite/SQLCipher access — pre-existing `opSqliteAdapter.ts`, stays in app/ (native `@op-engineering/op-sqlite` dependency), implements `@aifa/core`'s `SqlDb` interface
- [x] Business Event / Business Data / LedgerEntry construction & validation logic moved into `@aifa/core`
- [x] AI pipeline orchestration (PCB assembly, classify→record→analyse→advise, confidence routing) moved into `@aifa/core`
- [x] Reversal-based correction logic moved into `@aifa/core` — `correctConfirmedCapture` ships as part of the moved `capturePipeline.ts`/`businessEventRepository.ts`
- [x] Mobile app runs entirely through `@aifa/core` + `SQLiteDataAdapter` for the above — every app/src call site rewritten to `@aifa/core/...` imports; two hidden `lib/auth.ts` couplings found and fixed via constructor-injected callables
- [x] Full existing mobile test suite passes unchanged after the refactor — 15/15 suites, 127/127 tests, identical to pre-refactor baseline (2026-08-31)

**Sprint 13 Definition of Done**
- [x] Sign-off recorded in writing — this checklist + ADR-004/Vol 12_0/Vol 12_1 amendments
- [x] `@aifa/core` exists and mobile runs on it
- [x] No new user-facing feature shipped this sprint (refactor + sign-off only)

---

## Sprint 14 — Cloud Data Model & Key Management

**Schema**
- [x] `public.sync_envelopes` created per Vol 12_1 §4 field list (2026-08-31, verified on local Postgres — see runbook §4)
- [x] Indexes added (business_id+server_seq; business_id+device_id+device_seq) — both confirmed used by query planner via EXPLAIN, not sequential scan (2026-08-31)
- [x] RLS policies scoped to owning business, tested with two distinct business accounts — cross-tenant insert rejected, per-business SELECT isolation, unauthenticated sees zero rows (2026-08-31)
- [x] `public.backups` / Phase 1 backup-restore confirmed unaffected — schema.sql's Phase 1 sections re-verified structurally unchanged after migration applied (2026-08-31)

**Key Management**
- [x] Per-business DEK generation implemented — `deriveBusinessDek` (HKDF-SHA256), `packages/core/src/sync/dek.ts` (2026-08-31)
- [x] DEK distribution wired through the Sprint-10 recovery-code mechanism — reuses `getDeviceEncryptionKey`'s recovery code as HKDF input, documented in the distribution runbook (2026-08-31)
- [x] Fresh-device recovery-code → DEK receipt flow tested — simulated two independent devices deriving the identical DEK from the same recovery code + business id, no transmission of the key itself (2026-08-31)
- [x] DEK confirmed never transits/stored in plaintext outside device secure storage — derivation is local/synchronous/offline-capable by construction; DEK is not written to sync_envelopes or any server-visible location (2026-08-31)
- [x] Distribution runbook written — `docs/sprint-plan/Phase_2_Web_And_Sync/Sprint_14_DEK_Distribution_Runbook.md` (2026-08-31)

**Payload Encryption**
- [x] Client-side envelope payload encrypt/decrypt implemented using the DEK — AES-256-GCM, `encryptEnvelopePayload`/`decryptEnvelopePayload` (2026-08-31)
- [x] Round-trip test: encrypt → store → fetch (2nd simulated device, same DEK) → decrypt, byte-identical (2026-08-31, `dek.test.ts`)
- [x] Negative test: device without DEK cannot read `payload_ciphertext` — wrong-DEK and tampered-ciphertext both throw rather than returning garbage (2026-08-31)

**Sprint 14 Definition of Done**
- [x] Schema live with correct RLS (verified on local Postgres — no live Supabase project exists yet; applying to a real project remains an open item, see runbook §5)
- [x] Fresh-device DEK flow verified (2026-08-31)
- [x] Round-trip + negative encryption tests both pass (2026-08-31, `dek.test.ts` — 8 tests, all passing)

---

## Sprint 15 — Device Registry & Active-Device Lock (Backend)

**Schema**
- [x] `public.devices` created per Vol 12_1 §5a.1/§5a.4 field list, including `is_primary` (2026-09-01)
- [x] `public.active_device_lock` created (2026-09-01)
- [x] Database-level constraint enforcing exactly one `is_primary = true` per business — partial unique index (`devices_one_primary_per_business`), verified by directly attempting a second primary via raw UPDATE and confirming `unique_violation` (2026-09-01)

**Device Registration**
- [x] `register_device` RPC implemented — first-device detection serialized via per-business advisory lock (2026-09-01)
- [x] First device registered for a business auto-set as primary and auto-active; every subsequent device registers read-only/non-primary — verified (2026-09-01)

**Active-Device Lock — Ordinary Handoff**
- [x] `request_activation` RPC implemented as a single atomic operation — sync-before-write check, registered/non-revoked check, and a compare-and-swap grant on `lock_token` (2026-09-01)
- [x] Concurrency test: two genuinely concurrent `request_activation` calls (real Postgres connections + threading.Barrier, not sequential calls) → exactly one succeeds, one clean `lock_conflict` rejection, 5/5 trials, winner varied by trial confirming a real race (2026-09-01, `sprint15_concurrency_test.py`)
- [x] Stale `lock_token` detected live: direct comparison of a demoted device's previously-held token against the current one shows they differ, proving any point-in-time check (not just at launch) correctly detects staleness — client-side wiring of the actual re-check is Sprint 16/17 (2026-09-01)

**Active-Device Lock — Primary Override**
- [x] Primary-override path (`request_primary_takeover`) implemented — same sync-before-write precondition as the ordinary path, deliberately no compare-and-swap (2026-09-01)
- [x] Test: primary takeover succeeds unconditionally — sequential test (dev-1 active, primary forces takeover) and genuine-concurrency test (primary racing an ordinary activation, 5/5 trials, primary always ends up active regardless of interleaving); primary takeover with a stale server_seq still correctly rejected, confirming ADR-004 does not waive sync-before-write (2026-09-01, `sprint15_primary_race_test.py`)

**Sprint 15 Definition of Done**
- [x] Primary-device invariant enforced and tested (DB constraint + RPC-level test)
- [x] `register_device` correct (first-device auto-primary/active, subsequent devices read-only)
- [x] `request_activation` atomicity proven under real concurrent requests (5/5 trials)
- [x] Stale-lock rejection proven live, not launch-cached
- [x] Primary override always wins (5/5 concurrent trials), still requires sync-before-write

---

## Sprint 16 — Mobile Sync Client & Read-Only Enforcement

**Push**
- [x] All 8 syncable entity_types (Vol 12_1 §3) wrapped as Sync Envelopes at the repository-write boundary — `sync/syncHooks.ts` wired into every producing function, see the runbook's entity table (2026-09-01)
- [x] Outbox pattern implemented (`sync_outbox`, migrations.ts v11) — survives app kill (persisted table, not in-memory), flushes via `syncClient.ts`'s `pushOutbox` on reconnect (`useSyncResume.ts`, same trigger discipline as Sprint 9's `useAutoResume`) (2026-09-01)
- [x] Push encrypts with DEK (Sprint 14's `encryptEnvelopePayload`) and records `server_seq` (returned by `SyncTransport.pushEnvelope`, `app/src/db/syncService.ts`'s Supabase implementation) (2026-09-01)

**Pull**
- [x] Pull-since-watermark implemented — `sync_local_state.last_applied_server_seq`, `syncClient.ts`'s `pullEnvelopes` (2026-09-01)
- [x] Pulled envelopes applied via the same repository functions local writes use (Sprint 13's `SqlDb`/DataAdapter boundary) — `sync/applyEnvelope.ts`, entity-by-entity mapping documented in the runbook §3 (2026-09-01)

**Idempotency**
- [x] Deterministic envelope ids (`business_id:device_id:device_seq`, Vol 12_1 §3) + duplicate-safe apply on pull (`INSERT OR IGNORE`/`ON CONFLICT DO UPDATE` per entity) (2026-09-01)
- [x] Replay test: same envelope applied twice → zero duplicate data — automated (`sync.test.ts`), covers both a `business_event` insert and a `ledger_entry` pair explicitly (the DoD's own "no double-counted ledger entry" wording) (2026-09-01)
- [x] Out-of-order envelope arrival tested explicitly — envelopes handed back in reverse order still applied in ascending `server_seq`, verified against `app_settings` last-write-wins (2026-09-01)

**Read-Only Enforcement**
- [x] Write path blocked at the repository-function boundary when not active device, before any SQL executes (not UI-only) — `sync/writeGate.ts` + `sync/syncHooks.ts`'s `assertSyncGateOk`, called as the first line of every gated write function (2026-09-01)
- [x] Direct-write-while-demoted test confirms rejection at the code level — `recordManualCapture` called directly (no UI), rejected with `WriteGateError`, follow-up query confirms zero rows written (2026-09-01)
- [x] Read-only UI explains which device is active and how to request activation — `ReadOnlyBanner.tsx` + `syncService.ts`'s `requestActivation`/`getWriteAccessState` (code-complete, not exercised on a live device — see runbook §7) (2026-09-01)

**Sprint 16 Definition of Done**
- [x] Connectivity-loss/reconnect push scenarios pass — outbox persists across a fresh `SqlDb` instance (simulating app kill) and flushes on the next `pushOutbox` call; reuses Sprint 9's `isOnline`/reconnect trigger pattern via `useSyncResume.ts` (2026-09-01)
- [x] Pull-applied state identical to local-applied state — verified byte-identical via `getActivityItemByEventId` across two simulated devices (2026-09-01)
- [x] Duplicate-replay test passes — 3 dedicated tests (push retry, pull replay, ledger pair replay), all automated (2026-09-01)
- [x] Demoted-device write rejection proven at code level, not just UI — direct repository call, no UI, verified 2026-09-01

**Ad-hoc, logged per Sprint 13's risk-mitigation precedent (not originally in scope)**
- [x] Fixed `dek.test.ts` (Sprint 14) never actually running on the project's real toolchain — `TS2307` module-resolution gap in `app/tsconfig.json`/Jest config for `@noble/*` subpath imports; all 8 tests now genuinely pass here (2026-09-01)
- [x] `migrations.test.ts` updated for migration 11's new tables/version count (2026-09-01)

Full regression: 18/18 suites, 151/151 tests passing (2026-09-01).

---

## Sprint 17 — Active-Device Handoff & Primary Override UX (Mobile)

**Ordinary Handoff**
- [x] "Make this device active" action built — `ReadOnlyBanner.tsx`, calling Sprint 16's `requestActivation` (2026-09-01)
- [x] Sync-then-request-activation sequence implemented — unchanged from Sprint 16 (`requestActivation` pulls to current checkpoint before calling the RPC) (2026-09-01)
- [x] Confirmation prompt shown when current active device looks in-use — `@aifa/core/sync/handoff.ts`'s `resolveActivationConfirmation`, unit-tested for both in-use and idle cases; wired via `ReadOnlyBanner`'s `Alert.alert` call (2026-09-01)

**Demotion Side**
- [x] Demoted device receives notification/detects demotion — via the existing pull-refreshed lock cache (Sprint 16) plus new `useDemotionPoll.ts` (30s foreground timer) for the continuously-online case (2026-09-01)
- [x] Transitions to read-only (Sprint 16 enforcement) with clear explanatory UI — `ReadOnlyBanner.tsx` now uses `describeReadOnlyReason` to distinguish a primary takeover from an ordinary handoff (2026-09-01)

**Primary Override**
- [x] "Take over as active device" primary action built, showing the lightweight single-tap confirmation (not the fuller non-primary prompt, and not zero confirmation) — `resolveActivationConfirmation` always returns `kind: "lightweight"` for a primary requester, unit-tested including when the active device looks mid-session (2026-09-01)
- [x] Test: takeover blocks if sync step is deliberately delayed/failed (safety check not skipped) — enforced server-side by Sprint 15's `request_primary_takeover` (`not_caught_up`, no CAS bypass), already concurrency-tested there; this sprint's client code introduces no shortcut around it (verified by inspection, not re-run live — see runbook §4) (2026-09-01)
- [x] Owner can view/change which device is primary — `PrimaryDeviceSettingsCard.tsx` (new), calling Sprint 15's `set_primary_device` via `syncService.ts`'s `setPrimaryDevice`/`getRegisteredDevices` (2026-09-01)

**Offline Edge Case (Detection Only)**
- [x] Device that missed a demotion broadcast while offline correctly detects it on reconnect and transitions to read-only — `runSyncCycle`'s new demotion guard (`packages/core/src/sync/syncClient.ts`): a fresh pull revealing demotion skips push and leaves the outbox queued rather than silently sending it, automated test in `sync.test.ts` (2026-09-01)

**Sprint 17 Definition of Done**
- [x] Ordinary handoff completes correctly with confirmation gate working — unit-tested end to end at the decision-logic level (2026-09-01)
- [x] Demotion transition + explanatory UI verified — poll + reconnect triggers both refresh the write-gate's cache; banner text distinguishes primary takeover (2026-09-01)
- [x] Primary takeover zero-friction AND still blocks on incomplete sync (both proven) — lightweight-only confirmation proven by unit test; sync-block proven by Sprint 15's existing RPC-level concurrency test, re-verified by inspection this sprint (2026-09-01)
- [x] Missed-demotion detection on reconnect verified — `runSyncCycle` test group, `sync.test.ts` (2026-09-01)

**Ad-hoc, logged per Sprint 13's risk-mitigation precedent (not originally in scope)**
- [x] Added `touch_device_heartbeat` RPC (`app/backend/schema.sql`) — Sprint 15 never updated `devices.last_seen_at` after registration, which would have made the "genuinely in use" trigger condition this sprint depends on permanently meaningless; wired into `runMobileSyncCycle` (2026-09-01)

Full regression: 19/19 suites, 165/165 tests passing (14 new) (2026-09-01).

**Ad-hoc addendum, same day — planning-gap closure requested by owner before Sprint 18**
- [x] Device registration / DEK-bootstrap flow built and wired end to end — `app/src/db/syncBootstrap.ts` (new: `bootstrapSyncOnThisDevice`, `restoreSyncContextIfBootstrapped`), `app/src/db/client.ts` (`getOrCreateSyncDeviceId`, recovery-code storage, `hasCompletedSyncBootstrap`), `app/src/db/syncService.ts` (`registerDevice`), `app/src/components/SyncSetupCard.tsx` (new Settings-screen setup UI), `app/src/hooks/useActiveDeviceInfo.ts` (new, 30s foreground poll feeding the banner) (2026-09-01)
- [x] `App.tsx` rewritten to actually call `restoreSyncContextIfBootstrapped` on launch and wire `useSyncResume`/`useDemotionPoll`/`useActiveDeviceInfo`/`ReadOnlyBanner` for real — Sprint 16 and 17's UI is now reachable in the running app, not just unit-tested (2026-09-01)
- [x] `SettingsScreen.tsx` gets a new "Sync" section: `SyncSetupCard` until bootstrapped, then `PrimaryDeviceSettingsCard` (2026-09-01)
- [x] `tsc --noEmit` and `eslint` clean; full regression re-run with no change in count (19/19 suites, 165/165 tests) — this addendum's RPC/SecureStore-touching glue code is verified via tsc/eslint and disclosed as not exercised on a live device, consistent with this project's established precedent for `syncService.ts` code since Sprint 16, not force-tested with mocks the project has never used elsewhere (2026-09-01)
- See runbook §6 for full detail.

**Not covered this sprint (see runbook §7 for full detail)**
- Full Devices panel (Sprint 19)
- Reconciliation of a demoted device's queued writes (Sprint 20)
- Realtime broadcast of lock changes (deferred per the Phase 2 plan)
- Polished pairing UX (recovery-code sharing, QR, etc.) — Sprint 19 candidate

---

## Sprint 18 — Web App Shell (Phase 2a Minimal Slice)

**Project Setup**
- [x] Web app scaffolded in the monorepo alongside `app/` and `@aifa/core` — `web/` (Vite + React + TypeScript), consumes `@aifa/core` as TS source directly via the same alias pattern `app/`'s babel/jest config uses, no build step (2026-09-01)
- [x] PWA/service-worker offline shell loads without network after first visit — `web/public/sw.js`, deliberately hand-rolled (cache-first app shell) rather than a build-time PWA plugin dependency, per this sprint's own "safe to carry over" note on PWA polish (2026-09-01)

**Local Storage**
- [x] `IndexedDBDataAdapter` implemented against `@aifa/core` — using sql.js (SQLite/WASM), NOT Dexie.js as Vol 12_0 §6 originally stated; a real deviation, flagged to and approved by the owner before implementation (this sprint's own risk register predicted exactly this: "@aifa/core's interface turns out to have mobile-specific assumptions"). `SqlDb` is raw-SQL-shaped (migrations, `SUM()` aggregates); Dexie has no SQL layer and would have needed a hand-rolled query engine. See the Sprint 18 runbook §2 for the full reasoning and the parity verification. (2026-09-01)
- [x] WebCrypto AES-GCM wired for at-rest encryption — `web/src/lib/webCrypto.ts` + `keyStore.ts`; the whole sql.js database image is serialized and encrypted as one blob per write (mirrors SQLCipher's whole-file model, Sprint 5/9's precedent), keyed by a non-extractable `CryptoKey` persisted via IndexedDB structured-clone (2026-09-01)
- [x] IndexedDB-cleared/unavailable scenario surfaces a clear owner-facing message — `LocalDataClearedError` + `DataClearedBanner.tsx`, manually verified against a running dev build by clearing both IndexedDB stores via devtools (2026-09-01)

**Auth**
- [x] Web sign-in against shared Supabase auth — `web/src/lib/auth.ts`, near-verbatim port of the mobile app's email/OTP flow, same backend (2026-09-01)
- [x] Signing-in session registers as a device via `register_device` — `web/src/lib/deviceBootstrap.ts`'s `bootstrapWebSyncIdentity`, called once during the recovery-code entry step (`DeviceSetupScreen.tsx`), same RPC Sprint 15 built (2026-09-01)

**Phase 2a Feature Slice**
- [x] Exact Vol 12_0 §4 Phase 2a row set implemented, running through `@aifa/core` — Dashboard (cash position, receivables/payables, notifications), AI Workspace (Q&A + CFO guidance), manual/text capture (Expense/Sale/Purchase/Banking), Settings (read-only) — every one calling the identical `@aifa/core` functions the mobile screens call; verified for real via `web/verification/sqljs_parity_check.ts` (`npm run verify:sqljs-parity`), not just by inspection (2026-09-01)

**Sprint 18 Definition of Done**
- [ ] Web app builds and deploys to staging — `npx vite build` succeeds cleanly in this sandbox (verified); actual deployment to a staging environment is the owner's own infrastructure step, not buildable here — same class of item as Sprint 12's pilot/distribution work
- [x] Sign-in + device registration work — code-complete and tsc/eslint-clean; live Supabase exercise untested in this sandbox, same standing caveat as every Supabase-touching path since Sprint 3 (2026-09-01)
- [x] Local storage encrypted and functional — proven via `verify:sqljs-parity` running real `@aifa/core` migrations/repositories against sql.js, including the immutability trigger and a `SUM()`-aggregate cash-position query (2026-09-01)
- [x] Phase 2a slice works end-to-end locally, no sync required yet — no `SyncContext` is ever set in `web/`, so every write runs ungated/unqueued exactly as `syncContext.ts` documents for that case (2026-09-01)
- [x] IndexedDB-cleared scenario tested (2026-09-01)

Full regression re-run after this sprint (packages/core and app/ untouched): 19/19 suites, 165/165 tests, unchanged — confirms zero cross-platform regression from adding `web/` as a second `@aifa/core` consumer (2026-09-01).

**Not covered this sprint (see runbook §6 for full detail)**
- Photo/document capture (Vol 12_0 §4: explicitly "No" for Phase 2a)
- Settings editing (Phase 2a is read-only by design)
- The Devices panel (Vol 12_1 §8) — Sprint 19
- Any actual sync — Sprint 19
- Deployment to a real staging environment, and a real-browser smoke test — owner-driven infrastructure steps

---

## Sprint 19 — Web Sync Client & Device Visibility Panel

**Web Sync Client**
- [ ] Push/pull/idempotency ported to web against `IndexedDBDataAdapter`
- [ ] Web read-only enforcement at data-layer boundary (same standard as mobile)
- [ ] Web handoff/primary-override actions implemented, reusing Sprint 17's protocol logic

**Devices Panel (Both Platforms)**
- [ ] Table showing registered/logged-in/active/synced as four distinct states
- [ ] Primary badge shown
- [ ] Actions: request activation, set as primary, rename, revoke — all functional
- [ ] Last-seen/last-synced timestamps shown

**Cross-Platform Consistency**
- [ ] Device registered on mobile visible correctly from web panel, and vice versa
- [ ] Revoking a device from either platform blocks that device live on its next write attempt

**Sprint 19 Definition of Done**
- [ ] Web push/pull/idempotency tests pass at the same standard as Sprint 16's mobile tests
- [ ] Web read-only enforcement proven at code level
- [ ] Devices panel correct and consistent across both platforms
- [ ] All four panel actions verified functional from web

---

## Sprint 20 — Offline Reconciliation Backstop, Hardening & Pilot

**Offline Reconciliation Backstop**
- [ ] Append-only entities reconcile correctly (BusinessEvent insert, BusinessData, LedgerEntry, Document, AiInterpretation)
- [ ] BusinessEvent status-transition conflict case resolved per Vol 12_1 §7.2's specified rule, tested with a real offline-then-reconnect scenario
- [ ] BusinessKnowledgeEntry / AppSettings resolved per Vol 12_1 §7.3's specified rule
- [ ] Every row of the §7.4 summary table has a passing automated test

**Bug Bash**
- [ ] Structured bug-hunt pass completed across Sprints 14–19's system
- [ ] Zero unresolved data-loss / duplicate-event / incorrect-ledger findings

**Multi-Device Pilot**
- [ ] Real owner running 2+ of their own devices for at least 1 full week
- [ ] Every handoff/takeover/demotion logged and cross-checked against the Devices panel's own record

**Exit Criteria Verification**
- [ ] Every item in `00_Sprint_Plan_Overview.md` §5 checked off with evidence (test, screenshot, or pilot log)

**Sprint 20 Definition of Done**
- [ ] All reconciliation table rows tested and passing
- [ ] Bug bash findings resolved or explicitly triaged
- [ ] Pilot week completed with usage log
- [ ] All Phase 2 exit criteria verified with evidence, none assumed

---

*End of Checklist.*
