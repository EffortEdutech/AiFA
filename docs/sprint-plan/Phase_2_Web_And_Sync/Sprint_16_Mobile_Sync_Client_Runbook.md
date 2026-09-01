# Sprint 16 — Mobile Sync Client & Read-Only Enforcement Runbook

**Purpose:** documents what was built this sprint — the sync engine in `@aifa/core`, its wiring into every syncable repository write function, and the mobile-side transport — against Sprint 16's own DoD, which explicitly requires automated proof (duplicate-replay idempotency, a demoted device's write rejected "at the code level, not just via UI"), not a manual spot-check.

**Companion documents:** `Sprint_16_Mobile_Sync_Client_And_Read_Only_Enforcement.md` (task breakdown), Vol 12_1 §3 (Sync Envelope), §6 (Sync Flow), §6.3 (Idempotency), §6a.3 (write gate). Builds directly on the Sprint 14 (`sync_envelopes` schema, DEK) and Sprint 15 (`active_device_lock`, RPCs) runbooks.

---

## 1. What was built

A platform-agnostic sync engine in `packages/core/src/sync/` (outbox, push, pull, write gate, envelope application), wired transparently into every repository write function Vol 12_1 §3 names as syncable, plus a Supabase-backed `SyncTransport` implementation and minimal UI wiring in `app/`. 151/151 existing + new Jest tests pass (18/18 suites) — see §5.

## 2. Design decisions this sprint had to resolve

**Ambient sync context instead of threading parameters everywhere (`sync/syncContext.ts`).** Vol 12_1 §6a.3 requires the write gate to sit at the data-layer boundary, not the UI. The only real boundary every write already passes through is the repository functions in `db/*.ts` — but they are plain `(db, ...)` functions called from many places (`ai/capturePipeline.ts`, `ai/expensePipeline.ts`, `bankingRepository.ts`, screens). Threading `businessId`/`deviceId`/DEK through every call site would have been a much larger, riskier change than this sprint's scope, and unnecessary: Phase 1 already assumes one business, one device, one DEK per running app instance. So a small ambient `SyncContext`, set once at app startup, is read by the repository functions themselves. It is deliberately permissive when unset — no context means every write proceeds exactly as before, ungated and unqueued — which is what keeps all 151 pre-Sprint-16 tests passing unchanged (none of them set a context) while making the gate and outbox fully real once a context IS set.

**The gate must run *before* the SQL, not after — a real bug caught by the test suite, not assumed away.** The first working version called the gate-and-enqueue helper after the row was already written, discovered because the "demoted device's write is blocked at the code level" test asserted zero rows existed post-rejection and found one. Fixed by splitting the single helper into two: `assertSyncGateOk` (called as the first line of every gated function, before any `db.execute`) and `enqueueSyncableWrite` (called after, once the written row's shape is known). A write rejected by the gate now never touches the database at all.

**A second ambient flag suppresses the gate/outbox during pulled-envelope application (`isApplyingPulledEnvelopeNow`).** Vol 12_1 §6.2's pull step must apply unconditionally — a read-only device "keeps pulling normally" — and a pulled write must never be re-queued into this device's own outbox (that would create an infinite relay loop between devices). `applyEnvelope.ts` wraps every apply call in `runAsPulledEnvelopeApplication`, and `assertSyncGateOk`/`enqueueSyncableWrite` both no-op while that flag is set.

**Per-entity idempotent "apply" variants, added only where the existing local-write function couldn't be reused as-is.** Vol 12_1 §6.2 asks that pulled envelopes "go through the same repository function local writes already use." Several already qualified without any change — `ledgerRepository.createLedgerEntries`/`businessEventRepository.setBusinessEventStatus`/`setSupersededBy` are id-deterministic or naturally idempotent, so `applyEnvelope.ts` calls them directly. Three entities mint their own id or merge against *current* local state at write time — `insertEventAndData` (per-day sequence id), `recordAiInterpretation` (`Date.now()`-based id), `recordVendorCategoryConfirmation`/`updateBusinessProfile`/`updateNotificationPreferences` (merge against whatever is locally current, which is the wrong basis for applying a remote change per §7.3's "last write wins by server_seq"). For these, a small sibling function was added in the *same* module — `applyPulledBusinessEvent`/`applyPulledBusinessData`, `applyPulledAiInterpretation`, `applyPulledBusinessKnowledgeEntry`, and `writeSettings` (already existed, now exported) — each taking the envelope's fully-formed row and applying it via `INSERT OR IGNORE` or `ON CONFLICT DO UPDATE`. `documentRepository.saveDocument` needed one small fix (`INSERT` → `INSERT OR IGNORE`) rather than a new function, since its id was already deterministic.

**`business_event`'s `raw_input_ref` photo-capture backfill is not separately synced.** `attachExpenseBusinessData` (Sprint 5's two-phase photo capture) both inserts `business_data` (synced) and backfills `business_events.raw_input_ref` on the already-created event. Vol 12_1 §3's `op` enum has no "update" variant for `business_event`, only `insert`/`status_transition` — a second `insert` envelope would be silently ignored remotely (insert never overwrites, by design). Documented here as a narrow, deliberate gap specific to this one two-phase write, not a general sync limitation.

## 3. What was wired, entity by entity (Vol 12_1 §3's list)

| Entity | Gated local write(s) | Pull-apply path |
|---|---|---|
| `business_event` (insert) | `recordManualCapture`, `recordCaptureQueued`, `createQueuedPhotoEvent` | `applyPulledBusinessEvent` (new) |
| `business_data` (insert) | same three, plus `attachExpenseBusinessData` | `applyPulledBusinessData` (new) |
| `business_event_status_transition` | `setBusinessEventStatus`, `setSupersededBy` | same functions, reused directly (idempotent by construction) |
| `ledger_entry` (insert) | `createLedgerEntries`, `reverseLedgerEntries` | `applyPulledLedgerEntry` (new — id-deterministic derivation doesn't fit reversal ids cleanly, see code comment) |
| `document` (insert) | `saveDocument` | same function, reused directly (fixed to `INSERT OR IGNORE`) |
| `ai_interpretation` (insert) | `recordAiInterpretation` | `applyPulledAiInterpretation` (new) |
| `business_knowledge_entry` (upsert) | `recordVendorCategoryConfirmation` | `applyPulledBusinessKnowledgeEntry` (new) |
| `app_settings` (upsert) | `updateBusinessProfile`, `updateNotificationPreferences`, `recordBackupCompleted` | `writeSettings` (exported, reused directly) |

## 4. Sync engine modules (`packages/core/src/sync/`)

- `envelope.ts` — `SyncEntityType`/`SyncOp`, deterministic `buildEnvelopeId` (`business_id:device_id:device_seq`, Vol 12_1 §3), and the `SyncTransport` interface — the one seam to the network, matching Sprint 13's DataAdapter discipline.
- `outbox.ts` — `enqueueOutboxEnvelope` (encrypts with the DEK, Sprint 14's `encryptEnvelopePayload`), `listPendingOutbox`, `removeOutboxEnvelope`, `countPendingOutbox`.
- `localState.ts` — `sync_local_state` (device_seq counter, pull checkpoint) and `sync_lock_cache` (this device's last-known `active_device_lock`) bookkeeping. Both self-bootstrap (`INSERT OR IGNORE`) rather than requiring callers to remember an init step — a real bug caught during testing when the very first envelope enqueue produced a colliding `device_seq` because no row existed yet for the `UPDATE` to match.
- `writeGate.ts` — `assertWriteAllowed`, throws `WriteGateError` when the cached lock names a different device. Defaults open when no lock has ever been cached (a device that never received a lock broadcast can't have been demoted; the very first device on a business is auto-active with nothing to demote it from).
- `syncHooks.ts` — the two calls repository functions make: `assertSyncGateOk` (before any SQL) and `enqueueSyncableWrite` (after).
- `applyEnvelope.ts` — decrypts and routes a pulled envelope by `entity_type`/`op` to the table in §3 above.
- `syncClient.ts` — `pushOutbox` (oldest `device_seq` first, stops at first failure to preserve ordering), `pullEnvelopes` (applies in ascending `server_seq`, advances the checkpoint after each envelope individually — not once at the end — and refreshes the lock cache), `runSyncCycle` (pull then push).
- `migrations.ts` version 11 — `sync_outbox`, `sync_local_state`, `sync_lock_cache` (all local-only bookkeeping; none of this itself syncs).

## 5. Verification performed this sprint

All verification ran against the project's real toolchain (`npm test` in `app/`, node:sqlite via `testAdapter.ts`, the same discipline every other repository test in this codebase uses) — not a separate reimplementation. New file: `app/src/db/__tests__/sync.test.ts`, 12 tests, all passing, against a fake in-memory `SyncTransport`:

- **Push**: a manual capture produces exactly the expected outbox envelopes, cleared once pushed; a write made with no sync context set produces zero outbox activity (backward compatibility with every pre-Sprint-16 call site).
- **Pull**: a `business_event`/`business_data` pair captured on a simulated device A is applied on device B and produces byte-identical field values via the same repository construction logic (`getActivityItemByEventId`).
- **Out-of-order arrival**: envelopes handed back by the transport in reverse order are still applied in ascending `server_seq` — verified against `app_settings`' last-write-wins semantics (§7.3).
- **Duplicate replay — automated, not manual** (the DoD's explicit wording): a push retry of an already-acknowledged envelope is a no-op; applying the same pulled envelope twice inserts a `business_event` row exactly once; applying a pair of `ledger_entry` envelopes twice each produces exactly the debit+credit pair, not four rows.
- **Write gate at the code level, not the UI**: `assertWriteAllowed` unit-tested directly for both the reject and allow cases; `recordManualCapture` (the same function the Capture screen calls) is called *directly*, with no UI involved, while the cached lock names a different device — it rejects with `WriteGateError`, and a follow-up query confirms **zero rows were written**, proving the gate runs before the SQL, not after. The same device, once the cache is refreshed to name it active, can write again. A pulled envelope is confirmed to still apply on a device that believes itself demoted (§6a.3: "keeps pulling normally").

Full regression: **18/18 suites, 151/151 tests pass** (up from 17/139 at Sprint 15's close — the 8 new tests beyond `sync.test.ts`'s 12 are `dek.test.ts`'s pre-existing suite, see §6 below), including `migrations.test.ts` updated for the new migration 11 tables/version.

## 6. Ad-hoc fixes made this sprint (not originally in scope, logged per Sprint 13's own risk-mitigation precedent)

- **`dek.test.ts` (Sprint 14) had never actually run on the project's real toolchain.** It failed with `TS2307: Cannot find module '@noble/ciphers/aes.js'` — `app/tsconfig.json` inherited `moduleResolution: "node"` (classic) from `expo/tsconfig.base`, which does not understand the `exports` subpath map these packages use. Fixed with explicit `paths` entries in `app/tsconfig.json` (for `tsc`/`ts-jest` type-checking) and matching `moduleNameMapper` entries in `app/package.json`'s Jest config (for Jest's own runtime module resolution, which does not consult `tsconfig.json`). This was discovered only because this sprint needed to run the real test suite for the first time since the user's own `npm install`; Sprint 14's "8 tests, all passing" checklist note was accurate for wherever it was last verified, but not for this environment until now. All 8 `dek.test.ts` tests now genuinely pass here.
- **`migrations.test.ts` updated** for the new table list and migration count (10 → 11) — a mechanical, expected update, not a bug.

## 7. What is explicitly NOT covered by this sprint

- **Device registration and DEK-session bootstrap are still not wired into the app.** Nothing calls Sprint 15's `register_device` RPC, and no recovery-code-entry screen exists to derive/hold the Business DEK for a running app session (Vol 12_1 §5/§9) — this gap predates this sprint (Sprint 14/15 built the primitives; no sprint has wired the auth-flow UI yet) and is real, separate scope, not something this sprint's own DoD asked for. Until it exists, `app/src/db/syncService.ts`'s `initMobileSync` has nothing to be called with, and every device's `SyncContext` stays unset — the same safe "no context" state every existing Phase 1 screen already runs in.
- **The Devices panel (Vol 12_1 §8)** — every device's label/platform/status/sync-state table — is Sprint 19's job.
- **The fuller handoff caution-prompt UX and primary-device takeover (§6a.5)** — `ReadOnlyBanner.tsx` wires the plain "Make this device active" action (`request_activation` only) with no in-use warning or primary/non-primary distinction; per the Sprint 15 runbook's own scoping, that UX is Sprint 17's.
- **Realtime.** Push/pull is plain request/response, per this sprint's own "Safe to Carry Over" — Realtime subscriptions remain a later transport optimisation, not a correctness dependency.
- **`app/src/db/syncService.ts` is code-complete against the documented Supabase client and Sprint 14/15 schema, but not exercised against a live project or device** — same class of limitation as `backupService.ts`/`auth.ts` since Sprint 9/10; this sandbox has no live Supabase project or device/simulator to run it against.
- **Section 6a.4's offline-demoted-device "review before sending" list** is not built — the `sync_outbox.written_as_active_device_id` column needed to identify those rows exists (this sprint), the review UI itself does not.

---

*End of Sprint 16 Runbook.*
