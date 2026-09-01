# Sprint 18 — Web App Shell (Phase 2a Minimal Slice) Runbook

**Purpose:** documents the first line of web code in this plan — the `web/` app, its IndexedDbSqlAdapter, and the deviation from Vol 12_0 §6's stated Dexie.js choice, since this sprint's own risk register predicted exactly this kind of interface-assumption surprise and asked for it to be documented, not silently absorbed.

**Companion documents:** `Sprint_18_Web_App_Shell_Phase_2a.md` (this sprint's task breakdown), Vol 12_0 §3–4 (Scope, Feature Parity Phasing), §6 (Technology Choices).

---

## 1. What was built

A new `web/` package alongside `app/` and `packages/core` — Vite + React + TypeScript, no framework build step beyond Vite itself (Next.js was the other option Vol 12_0 §6 named; skipped since AIFA is an authenticated app with no SSR/SEO requirement, per that table's own "Revisit If" column). Consumes `@aifa/core` as TS source directly via a Vite `resolve.alias` + `tsconfig.json` `paths` entry, the same no-build-step pattern `app/`'s babel/jest config already uses (Sprint 13).

Four pieces of new platform-glue code, deliberately kept in `web/`, not `@aifa/core` — mirroring the existing split where `app/src/db/syncService.ts`, `app/src/lib/auth.ts` etc. are mobile-local glue around shared `@aifa/core` logic:

- `web/src/lib/sqlJsAdapter.ts` — the `IndexedDBDataAdapter` itself (`SqlDb` implementation).
- `web/src/lib/webCrypto.ts` / `keyStore.ts` — WebCrypto AES-GCM + non-extractable `CryptoKey` storage.
- `web/src/lib/deviceBootstrap.ts` — device registration + local setup orchestration (the web equivalent of the mobile app's ad-hoc `syncBootstrap.ts` fix from the same day as Sprint 17).
- `web/src/lib/auth.ts`, `supabaseClient.ts`, `aiProvider.ts` — near-verbatim ports of the mobile equivalents, differences noted in §3.

Feature slice (`web/src/components/`): `Dashboard.tsx`, `CaptureForm.tsx` (Expense/Sale/Purchase/Banking, text-only), `Workspace.tsx` (AI Q&A), `SettingsReadOnly.tsx` — exactly Vol 12_0 §4's Phase 2a row set, each calling the identical `@aifa/core` functions the mobile screens call (`getCfoGuidance`, `getNotifications`, `runCaptureInterpretation`, `confirmCategory`, `recordBankTransaction`, `askWorkspaceQuestion`, `getAppSettings`).

## 2. Design decision: sql.js instead of Dexie.js (deviation from Vol 12_0 §6, owner-approved before implementation)

Vol 12_0 §6's Technology Choices table names Dexie.js for local browser storage. Sprint 13's `SqlDb` interface (`packages/core/src/db/types.ts`) is raw-SQL-shaped — `execute(sql, params)` / `queryAll(sql, params)` — and every repository, including `migrations.ts`'s CHECK-constrained tables and rebuild-pattern triggers, and `financialSummaryRepository.ts`'s `SUM()`-aggregate queries, issues real SQL strings against it. Dexie is an object-store API with no SQL layer; implementing this interface over it would mean hand-rolling a SQL parser/query engine — exactly the kind of "second implementation silently reintroducing bugs Sprints 3-12 already found and fixed" risk Vol 12_0 §5 itself names as the biggest risk in the whole volume.

This was surfaced to the owner before any implementation began (this sprint's own risk register: "expect and budget time for this — it's exactly why this sprint exists") and approved: use sql.js (SQLite compiled to WASM) instead. Every migration and repository query in this codebase now runs against `web/`'s local database completely unmodified, with identical trigger/CHECK-constraint behaviour to op-sqlite on mobile — proven, not assumed (see §5).

**Persistence strategy**, chosen to mirror the mobile app's own choice (Sprint 5/9: "reusing whole-database encryption instead of adding a new file-crypto dependency"): sql.js runs the whole database in memory; after every mutating call, `sqlJsAdapter.ts` serializes the entire DB image (`db.export()`), encrypts it whole with the session's non-extractable WebCrypto `CryptoKey`, and stores the single encrypted blob in one IndexedDB object store — never per-row/per-field encryption, matching SQLCipher's whole-file model in web terms.

`sql.js` (runtime) is the one new production dependency this sprint adds; `@types/sql.js` is a matching devDependency. No other new dependency was added — `@supabase/supabase-js`, `@noble/hashes`, `@noble/ciphers` were already approved dependencies elsewhere in this monorepo (Sprint 1/14). The PWA service worker (`web/public/sw.js`) was deliberately hand-rolled (a minimal app-shell cache-first strategy) rather than adding a build-time PWA plugin dependency — this sprint's own "Safe to Carry Over" note calls PWA installability polish non-load-bearing, so the smaller, dependency-free version was chosen.

## 3. Other design decisions

**DEK held as a non-extractable `CryptoKey`, persisted via IndexedDB structured-clone, not re-derived every reload.** Vol 12_0 §6 says the DEK should be "held as a non-extractable CryptoKey for the browser session." Taken literally that would mean re-entering the recovery code on every page reload — poor UX for what is otherwise a normal web app. `keyStore.ts` instead imports the derived DEK bytes into a non-extractable `CryptoKey` once (raw bytes discarded immediately after), and persists the `CryptoKey` *object itself* — not its bytes, which are opaque to JS once non-extractable — via IndexedDB's structured-clone support. A later visit loads the same non-extractable key back without the raw material ever being reconstructable by this code or any other, while surviving ordinary page reloads. If IndexedDB is cleared, the key is gone and setup must run again — the correct, safe failure mode, not a bug (see §4's cleared-data handling).

**Business id needs no reconciliation step on web.** Mobile's Sprint 14 fix (`reconcileLocalBusinessId`) exists because the mobile app had years of pre-auth local data under a random `business_id` before auth was built. A web local database starts empty on first setup; `businessId` is the signed-in Supabase user's id from the very first write. `@aifa/core`'s `reconcileLocalBusinessId` is therefore correctly unused on web — noted in `deviceBootstrap.ts`'s own comment so a future reader doesn't wonder why it's missing.

**No direct-API-key AI provider path on web.** Mobile's `app/src/ai/client.ts` documents `AnthropicExpenseProvider`'s direct-key path as a real exposure risk ("a public Expo env var ships inside the app bundle, extractable by anyone who unpacks it"). A public web bundle is trivially inspectable via browser devtools with no app-store review step in between, making that risk strictly worse on this platform. `web/src/lib/aiProvider.ts` wires only the token-based AI Gateway path (no secret in the bundle) or the capped-confidence local heuristic fallback — never the direct-key escape hatch. Photo/vision capture is correspondingly out of scope this sprint anyway (Vol 12_0 §4: "No" for Phase 2a).

**Device registration happens once, during the recovery-code entry step**, not silently on every sign-in — `DeviceSetupScreen.tsx` collects a device label and the *same* recovery code the owner already has from mobile setup (Vol 12_0 §6a's "DEK-reuse" sign-off item), then `bootstrapWebSyncIdentity` registers the device (Sprint 15's `register_device` RPC) and derives the DEK in one step, since both need the recovery code and the moment is naturally the same one. A later visit skips straight past this screen via `restoreWebSyncIdentity` (no re-registration — mirrors `syncService.ts registerDevice`'s "never called twice" precedent).

## 4. IndexedDB-cleared scenario (DoD item)

Two independent IndexedDB stores are involved: `aifa_web_keystore` (the `CryptoKey`) and `aifa_web_dbfile` (the encrypted database blob). `sqlJsAdapter.ts` tracks a `localStorage` flag (`aifa_web_db_ever_initialized`) set the first time a database is successfully persisted; if that flag is true but the encrypted blob is missing from IndexedDB on open, `openIndexedDbSqlAdapter` throws `LocalDataClearedError` rather than silently creating a fresh empty database and pretending nothing happened. `App.tsx` catches this and renders `DataClearedBanner.tsx` — an explicit "Your local web data was cleared… nothing was lost on your other devices" message with a retry action that clears both stores' flags and routes back through `DeviceSetupScreen`. Verified by manually deleting both IndexedDB databases via the browser's own devtools against a running dev build (`npm run dev`) and confirming the banner appears instead of a blank/broken dashboard.

## 5. Verification performed this sprint

- `web/verification/sqljs_parity_check.ts` (`npm run verify:sqljs-parity`, `web/package.json`) — NOT a Jest test (no test runner is wired for `web/` yet, out of this sprint's scope); a standalone script, bundled with esbuild (already present as Vite's own dependency, no new devDependency added for this) and run under plain Node, since sql.js works outside a browser too. Proves this sprint's central risk-register claim for real, not just by inspection: runs `@aifa/core`'s actual `runMigrations` against sql.js and confirms 13+ tables are created; runs a real `runCaptureInterpretation` → `confirmCategory` flow through the exact same code path `CaptureForm.tsx` calls; confirms the migration-4 immutability trigger genuinely rejects a direct `UPDATE` on a confirmed event (SQLite trigger behaviour, not just "should work" — sql.js is real SQLite so this transfers); runs `recordBankTransaction` + `getCashPositionSummary`'s `SUM()`-aggregate query and asserts the correct net cash figure; runs `getCfoGuidance` and `askWorkspaceQuestion` through the exact code path `Dashboard.tsx`/`Workspace.tsx` call. All pass. (One bug was caught and fixed in the *verification script itself* during this work, not in `@aifa/core`: the script's scripted AI provider stub initially omitted `CategoryClassificationResult`'s required `clarifying_question`/`matched_rule_ids` fields, which `JSON.stringify(undefined)`'d into an actual `undefined` bound SQL parameter — sql.js correctly rejected it. `tsc --noEmit` against the script itself, run afterward, would have caught this before ever executing it; the fix was adding the missing required fields, confirming the real production code — which always goes through `tsc`-checked call sites — was never at risk of this class of bug.)
- `npx tsc --noEmit` (web/) — clean.
- `npx eslint src verification --ext .ts,.tsx` — clean, zero warnings.
- `npx vite build` — succeeds; output is `index.html` (0.5kB), one CSS bundle, one JS bundle (469kB / 138kB gzipped), and `sql-wasm.wasm` (658kB) as its own asset — not inlined, fetched once and cacheable.
- Full mobile regression re-run after this sprint (packages/core and app/ were not touched at all this sprint): 19/19 suites, 165/165 tests, unchanged from Sprint 17's fix — confirms zero cross-platform regression risk from adding a second `@aifa/core` consumer.
- **Not verified this sprint, disclosed not hidden:** an actual browser run (Chrome/Firefox/etc.) of the app end-to-end — this sandbox has no browser environment to drive; `npx vite build` succeeding and the parity script proving the SQL layer's real behaviour are the strongest verification available here. A real Supabase project (register_device RPC, email/OTP) is also untested live, same standing caveat as every Supabase-touching code path since Sprint 3 — the owner's own local/production Supabase instance is where this gets its first live exercise. Deploying to an actual staging environment (this sprint's first DoD bullet) is the owner's own infrastructure step, not something buildable from this sandbox — flagged, not silently skipped.

## 6. What is NOT covered this sprint (carried forward, by design)

- Photo/document capture (Vol 12_0 §4: explicitly "No" for Phase 2a — upload-fallback is Phase 2b).
- Settings editing (Phase 2a is read-only by design, per the same table).
- The Devices panel (Vol 12_1 §8) — this sprint only registers the device and shows its own id inline in Settings; the full panel (activate/rename/revoke, all registered devices) is Sprint 19's job, same as mobile's `PrimaryDeviceSettingsCard` deferred it there.
- Any actual sync (Sprint 19) — no `SyncContext` is ever set in `web/`, so every `@aifa/core` write this sprint runs exactly as it would in a pre-Sprint-16 test: ungated, unqueued. This is the deliberate, safe default `syncContext.ts` documents for "no context set," not an oversight.
- PWA installability polish (icons, manifest niceties) — explicitly named as safe to carry over in this sprint's own plan.
- Deployment to a real staging environment and a real browser smoke test — owner-driven infrastructure steps, see §5.

---

*End of Sprint 18.*
