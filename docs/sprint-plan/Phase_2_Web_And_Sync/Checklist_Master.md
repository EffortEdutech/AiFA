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
- [ ] `public.devices` created per Vol 12_1 §5a.1/§5a.4 field list, including `is_primary`
- [ ] `public.active_device_lock` created
- [ ] Database-level constraint/trigger enforcing exactly one `is_primary = true` per business

**Device Registration**
- [ ] `register_device` RPC implemented
- [ ] First device registered for a business auto-set as primary

**Active-Device Lock — Ordinary Handoff**
- [ ] `request_activation` RPC implemented as a single atomic operation
- [ ] Concurrency test: two near-simultaneous `request_activation` calls → exactly one succeeds, repeatably
- [ ] Stale `lock_token` detected and rejected on next write attempt (live re-check, not launch-only)

**Active-Device Lock — Primary Override**
- [ ] Primary-override path implemented, same atomicity + sync-before-write precondition
- [ ] Test: primary takeover succeeds unconditionally against a device mid-write or holding an unexpired lock

**Sprint 15 Definition of Done**
- [ ] Primary-device invariant enforced and tested
- [ ] `register_device` correct
- [ ] `request_activation` atomicity proven under real concurrent requests
- [ ] Stale-lock rejection proven live, not launch-cached
- [ ] Primary override always wins, still requires sync-before-write

---

## Sprint 16 — Mobile Sync Client & Read-Only Enforcement

**Push**
- [ ] All syncable mutation types wrapped as Sync Envelopes
- [ ] Outbox pattern implemented (survives app kill, flushes on reconnect)
- [ ] Push encrypts with DEK and records `server_seq`

**Pull**
- [ ] Pull-since-watermark implemented
- [ ] Pulled envelopes applied via `@aifa/core` `DataAdapter` (not a separate path)

**Idempotency**
- [ ] Deterministic envelope ids + duplicate-safe apply on pull
- [ ] Replay test: same envelope applied twice → zero duplicate data
- [ ] Out-of-order envelope arrival tested explicitly

**Read-Only Enforcement**
- [ ] Write path blocked at `DataAdapter`/`@aifa/core` boundary when not active device (not UI-only)
- [ ] Direct-write-while-demoted test confirms rejection at the code level
- [ ] Read-only UI explains which device is active and how to request activation

**Sprint 16 Definition of Done**
- [ ] Connectivity-loss/reconnect push scenarios pass
- [ ] Pull-applied state identical to local-applied state
- [ ] Duplicate-replay test passes
- [ ] Demoted-device write rejection proven at code level, not just UI

---

## Sprint 17 — Active-Device Handoff & Primary Override UX (Mobile)

**Ordinary Handoff**
- [ ] "Make this device active" action built
- [ ] Sync-then-request-activation sequence implemented
- [ ] Confirmation prompt shown when current active device looks in-use

**Demotion Side**
- [ ] Demoted device receives notification/detects demotion
- [ ] Transitions to read-only (Sprint 16 enforcement) with clear explanatory UI

**Primary Override**
- [ ] "Take over as active device" primary action built, showing the lightweight single-tap confirmation (not the fuller non-primary prompt, and not zero confirmation)
- [ ] Test: takeover blocks if sync step is deliberately delayed/failed (safety check not skipped)
- [ ] Owner can view/change which device is primary

**Offline Edge Case (Detection Only)**
- [ ] Device that missed a demotion broadcast while offline correctly detects it on reconnect and transitions to read-only

**Sprint 17 Definition of Done**
- [ ] Ordinary handoff completes correctly with confirmation gate working
- [ ] Demotion transition + explanatory UI verified
- [ ] Primary takeover zero-friction AND still blocks on incomplete sync (both proven)
- [ ] Missed-demotion detection on reconnect verified

---

## Sprint 18 — Web App Shell (Phase 2a Minimal Slice)

**Project Setup**
- [ ] Web app scaffolded in the monorepo alongside `app/` and `@aifa/core`
- [ ] PWA/service-worker offline shell loads without network after first visit

**Local Storage**
- [ ] `IndexedDBDataAdapter` implemented (Dexie.js) against `@aifa/core`
- [ ] WebCrypto AES-GCM wired for at-rest encryption
- [ ] IndexedDB-cleared/unavailable scenario surfaces a clear owner-facing message

**Auth**
- [ ] Web sign-in against shared Supabase auth
- [ ] Signing-in session registers as a device via `register_device`

**Phase 2a Feature Slice**
- [ ] Exact Vol 12_0 §4 Phase 2a row set implemented, running through `@aifa/core`

**Sprint 18 Definition of Done**
- [ ] Web app builds and deploys to staging
- [ ] Sign-in + device registration work
- [ ] Local storage encrypted and functional
- [ ] Phase 2a slice works end-to-end locally, no sync required yet
- [ ] IndexedDB-cleared scenario tested

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
