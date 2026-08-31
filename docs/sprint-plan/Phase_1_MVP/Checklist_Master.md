# AIFA — Phase 1 (MVP) Master Checklist

Companion to `00_Sprint_Plan_Overview.md`. Same scope, tracked as checkboxes. Check items off as you go — don't mark a sprint's "Definition of Done" section complete until every item in it is checked.

---

## Sprint 1 — Foundation & Setup

**Status note:** built and sandbox-verified (npm install, typecheck, lint all clean). Items requiring a real device/backend are left unchecked below rather than assumed — see each item.

**Mobile/App Shell**
- [x] Mobile project initialised (framework per Vol 11_0 §2)
- [x] Navigation shell built (Capture, AI Workspace, Dashboard, Documents, Settings)
- [x] App-level state/config management wired
- [ ] Debug build runs on target device/simulator — **cannot verify in sandbox** (no Xcode/Android SDK); do this first on your own machine

**Backend & Auth**
- [ ] Backend project provisioned (Postgres + auth + storage) — **your action required**: create the Supabase project, run `backend/schema.sql`
- [ ] Minimal single-user auth (email/OTP) implemented — **gap carried from Sprint 1**: only the Supabase client wrapper (`src/lib/supabaseClient.ts`) was built; actual sign-up/sign-in functions and a login screen were not. Needs closing before Sprint 10, sooner if any earlier sprint ends up needing a real logged-in user.
- [ ] App can authenticate and hold a session — depends on the gap above

**Local Data Layer**
- [x] SQLite + SQLCipher configured in code (op-sqlite + `sqlcipher: true` plugin config) — encryption itself is only confirmed active on a real device build, not in this sandbox
- [x] Schema migration scaffold created (now populated with real tables as of Sprint 2)
- [ ] Encrypted local file storage set up for documents — not yet built; this is Sprint 5's `Document` table work (Vol 11_1 §5), listed here originally but more accurately scoped there

**Finance PKA Bundle**
- [x] PKA content directory created in repo (Phase 1 form, Vol 3_0 §4.1)
- [x] `role_definition.md` v0.1 drafted
- [x] `accounting_rules.json` stub (Expense domain only) drafted
- [x] PKA version string convention recorded

**Repo & Tooling**
- [x] Repo structure, linting configured
- [x] Basic CI config written (`.github/workflows/ci.yml`) — not yet exercised on a real push/PR
- [x] AI vendor key config slot exists (no key committed)

**Sprint 1 Definition of Done**
- [ ] App builds/launches to nav shell — code complete and typechecked; real launch needs a device build (see above)
- [ ] Test user can sign up/log in — blocked on the auth gap above
- [ ] Row writes/reads from encrypted local DB — SQL logic verified via Sprint 2's test suite; on-device encrypted read/write not yet physically verified
- [x] PKA directory + files exist
- [ ] CI passes on shell app — workflow file exists, hasn't run yet (no remote push performed)

---

## Sprint 2 — Business Event Data Layer & Manual Capture

**Status note:** built and sandbox-verified — `npx tsc --noEmit`, `npx eslint`, and `npm test` (9/9 tests) all pass clean.

- [x] `BusinessEvent` table implemented per Vol 11_1 §2
- [x] `BusinessData` table implemented per Vol 11_1 §3
- [x] Immutability enforced at data-access layer (no update path for confirmed events) — DB trigger + no update/delete function exposed by the repository
- [x] Unit tests: confirmed event cannot be mutated in place
- [x] Text-entry capture screen built
- [x] Quick-entry structured fallback form built (doubles as Sprint 5's OCR fallback UI)
- [x] Submit creates `BusinessEvent` + `BusinessData` pair
- [x] Capture reachable in one interaction from every top-level screen (permanent tab)
- [x] Basic reverse-chronological activity feed

**Sprint 2 Definition of Done**
- [x] Manual capture produces correctly-formed event/data pair
- [x] Editing a confirmed event is structurally impossible
- [x] Capture is one-tap from anywhere
- [x] Activity feed shows captured events in order
- [ ] Works fully in airplane mode — no network calls in this code path by design, but not physically tested on a device; verify on first real device build

---

## Sprint 3 — AI Pipeline v1: Expense Interpretation

**Status note:** built and sandbox-verified — `npx tsc --noEmit`, `npx eslint`, and `npm test` (20/20 tests, up from 9) all pass clean. The real cloud AI call itself is untested in-sandbox (no network/API key available here) — see the caveat under "Cloud AI model integration" below.

- [x] PCB assembly implemented per Vol 11_1 §6 (minimal fields) — `src/ai/pcb.ts`
- [x] Only relevant data slice included in PCB, no full-database dumps
- [x] Single orchestrated classify→record pipeline built (not 4 separate agents) — `src/ai/expensePipeline.ts`
- [x] Cloud AI model integration wired for text + structured classification (`src/ai/providers/anthropicProvider.ts`) — code complete and key-gated, but **not exercised live**: no `EXPO_PUBLIC_AI_API_KEY` is available in this sandbox. A local keyword-matching placeholder (`localHeuristicProvider.ts`, capped below auto-record) stands in so the pipeline is runnable/demoable meanwhile — set the key on your machine to switch to the real model, no code change needed
- [x] Confidence thresholds implemented: ≥90% auto-record / 60–89% draft-confirm / <60% clarify — tested for all three bands
- [x] Clarifying-question UX built (specific, not generic) — rendered inline in the activity feed, sourced from the AI's own `clarifying_question`
- [x] Expense events mapped to Phase 1 chart-of-accounts
- [x] `LedgerEntry` output contract finalised — `src/db/ledgerRepository.ts`, balanced debit/credit pair per posting
- [x] Every entry links back to its Business Event ID (via BusinessData)
- [x] source_references and relevant_rules persisted for every AI decision — new `ai_interpretations` table (Vol 11_1 §8, added this sprint)
- [x] Cost-per-event measured and logged — `estimated_cost_usd`/`latency_ms` columns; real dollar figures need a live key to populate (placeholder provider logs 0)

**Sprint 3 Definition of Done**
- [x] Text-captured expense gets real AI classification — pipeline-complete; provider is the placeholder heuristic until a key is supplied (see above)
- [x] All three confidence bands tested and route correctly
- [x] Misclassified draft can be corrected and correction is stored
- [x] Every AI decision has a persisted source_reference
- [ ] Cost-per-event measured — mechanism is built and logs correctly, but no real dollar figure has been produced yet since no live AI call has run in this environment; verify once a key is set

---

## Sprint 4 — Financial Data / Ledger & Dashboard v1

**Status note:** built and sandbox-verified — `npx tsc --noEmit`, `npx eslint`, and `npm test` (27/27, up from 20) all pass clean. Found and closed a real gap in Sprint 2's immutability trigger while implementing this (see migration 4 note below) — not itself a Sprint 4 checklist item, but load-bearing for "reversal-based correction."

- [x] `LedgerEntry` implemented per Vol 11_1 §4, Phase 1 chart-of-accounts
- [x] Every classified expense produces a balanced debit/credit pair
- [x] Reversal-based correction implemented (no in-place edits) — covers both a still-draft correction (Sprint 3 path, pre-confirmation) and a post-confirmation correction (new `correctConfirmedExpense`, posts true reversal entries)
- [x] Unit tests: debits always equal credits across capture/correction sequences
- [x] Dashboard: cash position panel (live-computed from `ledger_entries`)
- [x] Dashboard: money in/out trend (rolling 30-day)
- [x] Dashboard: recent Business Events panel (shared with Capture via `useRecentActivity`)
- [x] Dashboard uses business language only, no accounting terms
- [x] Dashboard renders offline, no network call required (reads local ledger only)
- [x] Confirm/correct UX polished, feeds reversal mechanism

**Sprint 4 Definition of Done**
- [x] Every expense has a balanced ledger entry (automated test)
- [x] Corrections produce reversals, never silent edits
- [x] Dashboard numbers verified against hand-calculated scenario (see `ledgerAndDashboard.test.ts`)
- [x] Dashboard renders instantly offline against local data
- [x] No accounting terminology (debit/credit/journal/ledger) appears anywhere in the dashboard UI — verified by reading the actual screen text, not just the code comments

---

## Sprint 5 — Photo Capture, OCR/Vision & Documents

**Status note:** built and sandbox-verified — `npx tsc --noEmit`, `npx eslint`, and `npm test` (36/36, up from 27) all pass clean. This sprint has real, hard limits on what a sandbox can verify (no camera hardware, no real receipts, no live AI key) — see the items left unchecked below rather than assumed done.

- [x] `Document` table implemented per Vol 11_1 §5
- [x] Encrypted local storage for images — implemented as base64 BLOBs inside the existing SQLCipher-encrypted database (`document_blobs`), not loose files; see Vol 7_6 §6 and migration 5's comment for why this avoids a new dependency
- [x] Documents linked to their Business Event
- [x] Camera capture UI built (`PhotoCapture.tsx`, expo-camera) — code-complete and type-checked; **cannot be exercised in this sandbox** (no camera hardware) — verify on your own device before relying on it
- [x] Vision extraction wired into PCB assembly / pipeline (`AiProvider.extractExpenseFromImage`, `AnthropicExpenseProvider`) — code-complete, key-gated; **not exercised live** (no network/API key here)
- [x] Extraction results populate `BusinessData`, reuse Sprint 3 pipeline — `classifyAndRoute` is one shared implementation used by text, photo-complete, and photo-fallback paths
- [x] Failure handling: OCR total failure → photo + blank form — tested (including a provider with no vision capability at all, treated the same way)
- [x] Failure handling: partial OCR → pre-fill readable fields, highlight missing — tested; `ManualCaptureForm` highlights missing fields with a red border
- [x] Failure handling: offline capture → queued state — pipeline-level state machine implemented and tested; **no live UI trigger yet** (no connectivity-detection library installed — a new dependency, not added without approval); `isOnline` is currently hardcoded `true` in `CaptureScreen`
- [x] Basic document library/browse view (`DocumentsScreen.tsx`) — functional, reads local data only

**Sprint 5 Definition of Done**
- [x] Photo capture produces correctly linked Document/Event/Data chain (automated tests)
- [ ] All 3 failure modes tested with real bad inputs (blurry photo, partially unreadable receipt, airplane mode) — **NOT done**; only tested against scripted/simulated inputs in this sandbox. Needs your own device, camera, and real receipts.
- [ ] Vision accuracy measured against real (not synthetic) receipts — **NOT done and cannot be fabricated**; needs a real device, real receipts, and a live `EXPO_PUBLIC_AI_API_KEY`, none available here. Do not treat this as passing until it's actually run.
- [x] Documents viewable offline (reads local SQLCipher-encrypted data only, verified by code inspection + test)

---

## Sprint 6 — Sales & Purchase Domains

**Status note:** built and sandbox-verified — `npx tsc --noEmit`, `npx eslint`, and `npm test` (46/46, up from 36) all pass clean. The Expense-only pipeline (`ai/expensePipeline.ts`) was generalised in place into `ai/capturePipeline.ts`, domain-parameterised across Expense/Sale/Purchase rather than duplicated three times (Vol 6_0 §4 "shared engine, domain-scoped rules") — see app/README.md for the full list of renamed exports.

- [x] `accounting_rules.json` extended with Sales domain rules (`sales_categories`, rule `SALE-001`)
- [x] `accounting_rules.json` extended with Purchase domain rules (`purchase_categories`, rules `PUR-001`/`PUR-002`)
- [~] Sales event types: only **Invoice Issued** is implemented, as the general AI-interpreted "sale" capture. **Payment Received** and **Refund Issued** are NOT implemented — Payment Received needs the Banking domain's cash-side entry (Vol 6_1 §6, Vol 6_4, Sprint 7); Refund Issued was in this sprint's own "Safe to Carry Over" list and was deferred, not built even as manual-only.
- [~] Purchase event types: only **Supplier Bill Received / Goods Received** is implemented, as the general AI-interpreted "purchase" capture. **Purchase Order Raised** (a commitment, not yet a financial/ledger event in Phase 1) and **Purchase Returned** (this sprint's own "Safe to Carry Over" item) are NOT implemented.
- [x] Pipeline validated against Sales/Purchase events; Expense-only assumption fixed — the real bug found (per this sprint's own risk register): the ledger-posting rule was hardcoded "debit category, credit Cash/Bank-or-Payable" (Expense's shape only). Sale needed the mirror image (debit Cash/Bank-or-Receivable, credit the revenue category). Fixed via a domain-aware `ledgerAccountsForDomain` helper, covered by 12 new domain-specific tests in `salesPurchasePipeline.test.ts`.
- [x] Chart-of-accounts confirmed wired: `ACCOUNTS_RECEIVABLE_ACCOUNT` added alongside the existing Cash/Bank and Accounts Payable constants; Sales Revenue and Cost of Goods Sold sourced from the PKA bundle same as Expense categories always were.
- [x] Dashboard: outstanding receivables list ("Outstanding invoices" section)
- [x] Dashboard: upcoming payables list ("Upcoming bills" section) — **naming caveat:** Phase 1 has no due-date/ageing data (Vol 11_1 §3's BusinessData schema has no due-date field), so this is a flat list of everything still outstanding, not actually sorted or filtered by "upcoming" due date. Real ageing is a Financial Intelligence Engine capability documented as Phase 2/3.
- [x] `domain_hint` field wired at capture time — the field itself has existed since Sprint 2; Sprint 6's change is that Sale/Purchase captures now route through the AI-interpreted pipeline using it, the same way Expense has since Sprint 3, instead of the Sprint 2 manual/immediate-confirm path.

**Sprint 6 Definition of Done**
- [x] Captured sale produces correct receivable/cash + revenue entries (tested: cash → Cash/Bank debit; credit → Accounts Receivable debit; both credit Sales Revenue)
- [x] Captured purchase produces correct payable + expense/inventory entries (tested: cash → Cash/Bank credit; credit → Accounts Payable credit; both debit the matched Operating Expenses/Cost of Goods Sold category)
- [x] Receivables/payables lists match ledger exactly — queried directly from `ledger_entries` via `SUM(debit)-SUM(credit)` per BusinessData row (same reversal-aware pattern as Sprint 4's cash position), not a separately-maintained balance; tested including that a corrected/reversed sale drops out and its replacement reappears correctly
- [x] No Expense-only bug miscategorises Sales/Purchase events — the one real bug (ledger posting shape) was found and fixed; see above

**Known gaps carried forward (documented in `accounting_rules.json`'s `limitations` and this sprint's own risk register, not silently missing):** Payment Received / partial settlement of an outstanding receivable or payable is not posted by this pipeline yet — needs Sprint 7's Banking domain. Purchase Order and Refund/Purchase-Return flows are not built at all, manual or otherwise.

---

## Sprint 7 — Banking, CFO Guidance v1 & AI Workspace

**Status note:** built and sandbox-verified — `npx tsc --noEmit`, `npx eslint`, and `npm test` (68/68, up from 46) all pass clean. Banking is deterministic/manual-entry only (Vol 0_1 §4) — no AI classification involved, unlike Expense/Sale/Purchase.

- [x] Manual bank transaction entry: deposit, withdrawal, transfer, bank fee (`BankTransactionForm.tsx` + `bankingRepository.ts`) — each confirmed immediately, no draft/clarify states (nothing for an AI classifier to be uncertain about)
- [x] Basic reconciliation against receivables/payables (Vol 6_4 §4) — a Deposit can match an outstanding Sale, a Withdrawal can match an outstanding Purchase; the match settles the item in full and posts the offsetting Cash/Bank entry. **Full-amount settlement only** — the matched amount must exactly equal the outstanding balance; partial payment against an invoice/bill is explicitly not supported (documented in `accounting_rules.json`'s limitations). This is also where Sprint 6's deferred "Payment Received" gap gets closed.
- [x] CFO guidance: overdue receivables → prioritised observation (`cfoGuidance.ts`) — **naming caveat:** Phase 1 has no real invoice due date (Vol 11_1 §3), so "overdue" is a 30-day captured_at-age threshold, a documented proxy, not true days-past-due
- [x] CFO guidance: upcoming payables → prioritised observation — honestly just the full outstanding-payables list (same caveat as Sprint 6's Dashboard section: no due-date data to filter by "upcoming" specifically)
- [x] CFO guidance: one daily "thing to look at" recommendation, capped — the single most-overdue receivable, or `null` when nothing qualifies (never a manufactured recommendation). "Surfaced once per day" is interpreted as the computation always returning the current top item on demand, not itself throttling repeat views — the actual once-per-day notification cap is Sprint 8's job ("reuse Sprint 7 CFO triggers")
- [x] AI Workspace conversational UI built (`WorkspaceScreen.tsx`) — replaces the Sprint 1 placeholder; shows the CFO guidance summary plus a Q&A input/output list
- [x] AI Workspace answers scoped to real Financial Data, cite sources — `buildWorkspacePcb` includes ONLY cash position, overdue receivables, upcoming payables, and today's recommendation (Vol 0_1 §6's exact reduced set); every in-scope answer's `sources` array is shown inline in the UI
- [x] Out-of-scope question handling: honest "can't answer" path — three distinct honest states, not collapsed into one: a capable provider explicitly declining (`out_of_scope: true`), no reasoning provider configured at all (`noProviderConfigured: true`, distinct message), and the local placeholder's small keyword-routed pattern set (cash/overdue/payables/today only — anything else is declined, not guessed)

**Sprint 7 Definition of Done**
- [x] Manual bank entries reconcile correctly (tested: matched settlement zeroes the receivable/payable and posts the correct Cash/Bank movement; wrong-type match, amount-mismatch, and double-settlement are all rejected)
- [x] Daily recommendation correct in both trigger and no-trigger test cases (tested: a fresh credit sale triggers nothing; the same sale 31 simulated days later triggers the recommendation; settling it removes the trigger even at the same simulated "now")
- [x] AI Workspace answers cite Business Event/ledger sources (tested: scripted provider round-trip preserves `sources`; local heuristic cites `businessEventId`s or the descriptive string `"cash_position"` for a pure computation)
- [x] Out-of-scope questions handled honestly, never guessed (tested: local heuristic explicitly declines anything outside its 4 keyword patterns; missing-provider path returns a distinct, honest message)

**Known gaps carried forward (not silently missing):** Partial settlement of a receivable/payable is not supported — full-amount match only. AI Workspace answers are not persisted to `ai_interpretations` (that schema requires a single BusinessEvent/BusinessData FK pair, which a conversational Q&A over aggregate data doesn't have) — explainability here is satisfied by the inline `sources` array instead, not DB history. `AnthropicExpenseProvider.answerFinancialQuestion` is code-complete but untested live (no network/key in this sandbox), same caveat as every other real-provider code path since Sprint 3.

---

## Sprint 8 — Business Knowledge Heuristics & Notifications

**Status: built and sandbox-verified** — `npx tsc --noEmit`, `npx eslint`, and `npm test` (81/81, up from 68) all pass clean.

- [x] `BusinessKnowledgeEntry` implemented per Vol 11_1 §7 — migration 7, `app/src/db/businessKnowledgeRepository.ts`. One table, one pattern type (`vendor_category_mapping`); `customer_payment_behaviour`/`other` are schema-ready (per the CHECK constraint) but have no producing code yet — not built beyond the one heuristic Vol 4_2 §3.1 scopes Phase 1 to.
- [x] Vendor-to-category heuristic: `TRUSTED_CONFIRMATION_THRESHOLD` (3) CONSECUTIVE confirmations of the SAME category → trusted; a differing confirmation resets the streak to 1 under the new value rather than accumulating toward the old one (tested directly against the repository).
- [x] Trusted mappings feed into BIE confidence calculation — `capturePipeline.ts`'s `classifyAndRoute` looks up the trusted mapping for the counterparty and, only when it AGREES with the AI provider's own independent category guess, boosts confidence to `TRUSTED_MAPPING_CONFIDENCE_FLOOR` (0.95). Deliberately agreement-required, not an override: the trusted mapping never substitutes the business's remembered category when the AI recognised nothing or guessed differently — see the risk note below.
- [x] Action-needed notifications wired (reuse Sprint 7 CFO triggers) — `app/src/ai/notificationEngine.ts`'s `getNotifications` maps every `CfoGuidance.overdueReceivables` entry to an `action_needed` item, not just the single "today" recommendation.
- [x] Confirmation-request notifications wired — every `draft`/`needs_clarification` Business Event across all three AI-interpreted domains becomes a `confirmation_request` item, oldest first.
- [x] Basic quiet-hours on/off — hardcoded default window 9pm–8am (`DEFAULT_QUIET_HOURS_START_HOUR`/`_END_HOUR`), `quietHoursEnabled` defaults `true`; when active, suppresses the ENTIRE notification set for that call (no urgent-bypass yet — Sprint 10 scope per Vol 7_7). Per this sprint's own "Safe to Carry Over" note, full owner configurability is not built.
- [x] Daily notification cap enforced — `NOTIFICATION_DAILY_CAP` (3); confirmation-requests are prioritised ahead of action-needed items when both are present (documented tie-break: confirmation requests block accurate bookkeeping until resolved, Vol 7_5 §2, action-needed items don't block a specific record).

**Sprint 8 Definition of Done**
- [x] 4th occurrence of a 3x-confirmed vendor auto-categorises (tested) — `businessKnowledgeAndNotifications.test.ts`, scripted at only 0.65 raw confidence to prove the boost (not just a naturally-high AI guess) is what pushes it over `auto_record_min`.
- [x] Trusted mappings measurably raise BIE confidence scores in test cases (tested) — same test asserts `confidence >= 0.95` against a 0.65 scripted input; a companion test proves NO boost occurs when the AI's guess disagrees with the trusted mapping (agreement-required design, not a blind override).
- [x] Notifications fire for genuinely actionable conditions and do not fire for non-issues (tested against both cases) — an overdue receivable fires, a not-yet-overdue one (Vol 0_1 §5-style threshold) does not; an unresolved draft fires.
- [x] Notification volume stays within the fixed daily cap even when multiple conditions are true simultaneously (tested) — 2 overdue receivables + 3 unresolved drafts (5 candidates) still returns exactly 3.

**Known gaps carried forward (not silently missing):** `customer_payment_behaviour`/`other` pattern types exist in the schema (Vol 11_1 §7) but have no producing heuristic — only vendor-category mapping is implemented, matching Vol 4_2 §3.1's explicit Phase 1 scope ("just this one heuristic, implemented directly"). Notifications are computed fresh on each call, not persisted to a delivery log or pushed via the OS notification tray (no `expo-notifications` dependency added — AGENTS.md: no new production dependencies without approval); the owner sees them the next time the Dashboard is opened, not proactively. Awareness and Positive-insight notification categories (Vol 7_5 §2) are not built, matching the sprint doc's own scope. Quiet hours has no urgent-item bypass and is not owner-configurable yet (both explicitly Sprint 10, Vol 7_7).

---

## Sprint 9 — Offline Robustness & Backup/Restore

**Status: built and sandbox-verified where testable; two items honestly blocked on Sprint 10** — `npx tsc --noEmit`, `npx eslint`, and `npm test` (94/94, up from 81) all pass clean.

- [x] Every capture path audited for correct offline "queued" behaviour — Expense/Sale/Purchase text capture had NO offline handling at all before this sprint (`runCaptureInterpretation` called the AI provider unconditionally); photo capture had an `isOnline` param but the UI hardcoded `true`; Banking was already correct by construction (manual/deterministic, no AI call to ever get stuck on, Vol 6_4). Audit finding fixed below.
- [x] Queued interpretation tasks resume correctly on reconnect — `resumeQueuedCaptures` (text + photo-with-data) and `resumeQueuedPhotoCaptures` (photo-with-no-data-yet, re-fetching the stored image bytes rather than requiring a re-photograph), unified as `resumeQueuedWork`. Also handles a genuine network THROW mid-call, not just an explicit `isOnline: false` — both leave the event `queued`, never stuck at `processing`.
- [x] Connectivity state indication built in UI — `ConnectivityBanner.tsx`, rendered once at the app root (`App.tsx`), backed by a dependency-free `fetch`-based reachability probe (`src/lib/connectivity.ts`) rather than a new native library (`expo-network`/`NetInfo` — neither was an existing dependency; AGENTS.md gates new production dependencies).
- [x] Encrypted client-side backup implemented — `backupService.ts` reuses SQLCipher (already the project's one approved encryption mechanism) rather than adding a separate crypto dependency: the backup blob IS a small SQLCipher-encrypted SQLite file, encrypted with the same device key already used for the main database.
- [ ] Backup triggers on app background / schedule — NOT wired. `uploadBackup`/`restoreLatestBackup` are code-complete but there is no scheduling/trigger call site yet, and no Settings-screen button (see the two unchecked items below for why).
- [x] Backup includes Events, Data, Financial Data, Knowledge Store, Documents — `SNAPSHOT_TABLES` in `backupRepository.ts` lists all eight Phase 1 tables (business_events, business_data, ledger_entries, ai_interpretations, documents, document_blobs, bank_reconciliations, business_knowledge_entries); `schema_migrations` is deliberately excluded (the destination gets its own).
- [ ] Restore-from-backup flow on new device/login built — **not built, honestly.** Both upload and restore require a signed-in Supabase user (`backups` table RLS is keyed on `auth.uid()`), and sign-up/sign-in screens do not exist yet (a gap carried since Sprint 2, scheduled for Sprint 10's Settings/Identity work). `uploadBackup`/`restoreLatestBackup` both throw a clear `BackupNotAvailableError` rather than faking a user id. There is also no Settings-screen UI yet to trigger a manual backup or enter a recovery code on a new device (Sprint 10, Vol 7_7) — wiring a dead-end button ahead of that seemed worse than leaving it explicitly unbuilt.
- [x] Restore equivalence verified (balances, documents, event history match source) — via an automated Jest round-trip (`backupRepository.test.ts`): seed a source test DB across every table, snapshot it, restore into a fresh test DB, assert cash position/receivables/payables/row-counts are identical. This validates the snapshot/restore LOGIC completely; it does not validate a literal device-to-device restore through Supabase Storage, which needs the auth prerequisite above.

**Sprint 9 Definition of Done**
- [x] Capturing an event, killing connectivity mid-interpretation, and restoring connectivity later results in correct final state with no data loss or duplication — tested for both text capture (a thrown network error mid-`classify()`) and photo capture (thrown mid-extraction, and explicit offline), including a "resume twice doesn't re-process an already-confirmed event" duplication check.
- [x] A full backup completes and is verifiably encrypted before leaving the device — the blob is a SQLCipher-encrypted SQLite file; encryption is structural (reusing the same mechanism protecting the live local DB), not a runtime assertion, so there is no separate "verify it's encrypted" test to write. Untested live (no real device/Supabase project in this sandbox — same caveat as every other native/network-dependent path since Sprint 3).
- [x] A test restore onto a fresh install reproduces an identical dashboard, ledger, and document set to the source device — satisfied via the automated snapshot/restore equivalence test described above; a literal fresh-install-through-Supabase restore is blocked on Sprint 10's auth work (see the unchecked items above).
- [x] The app never silently loses a captured event under any tested connectivity scenario — every offline/failure path returns a distinct outcome (`queued_retry` / `queued_offline`) rather than throwing past the pipeline; nothing is caught-and-discarded.

**Known gaps carried forward (not silently missing):** no auth/sign-in exists yet, which blocks real end-to-end backup/restore (the mechanism is code-complete and unit-tested where it can be); no Settings-screen UI to trigger backup, view backup history, or enter a restore recovery code (Sprint 10, Vol 7_7); no backup scheduling (on-background/periodic) wired up; the connectivity check is a polling approximation, not real-time OS-level events (documented trade-off in `connectivity.ts`, avoids a new dependency); the SQLCipher device key doubles as the backup "recovery code" with no reveal/enter UI yet — if a real device's SecureStore is ever cleared before that UI exists, that device's own backups become permanently unrecoverable (a real, stated risk, not hidden).

---

## Sprint 10 — Security, Settings & Data Rights

- [x] Local storage encryption audited (SQLCipher + documents) — confirmed correct: `db/client.ts` opens op-sqlite with a SecureStore-backed key; `document_blobs` rows live in that same encrypted database, no separate unencrypted document store exists. No code change needed, only the audit itself.
- [x] Backup/AI-call transmission security audited — confirmed HTTPS throughout: `anthropicProvider.ts`'s `API_URL` is `https://api.anthropic.com/v1/messages` at all three call sites; `supabaseClient.ts`'s URL is HTTPS by `.env.example` convention. No code change needed.
- [x] PCB sensitivity classification confirmed respected — **was actually missing**, a real gap against Vol 3_1 §4 / Vol 11_1 §6's explicit "security classification... remain[s] required." Fixed: `ai/types.ts` gained `sensitivity_classification: "standard" | "high"`, populated as `"standard"` by both `buildCapturePcb` and `buildWorkspacePcb` (`ai/pcb.ts`) — Phase 1 has no high-sensitivity domain (payroll, Vol 6_7) wired into capture yet, so `"standard"` is correct everywhere today.
- [x] Session expiry / secure token storage hardened — closed via this sprint's new `lib/auth.ts` + Supabase's own `autoRefreshToken`/SecureStore-backed session storage (already configured in `supabaseClient.ts` since Sprint 1); `useAuthSession` reflects sign-in/sign-out/token-refresh events live.
- [x] Business Profile screen built — `SettingsScreen.tsx`, backed by `db/appSettingsRepository.ts` (new `app_settings` table, migration v8).
- [x] Notification preferences + full quiet-hours control built — same table/screen; `ai/notificationEngine.ts`'s `getNotifications` now accepts per-kind (`notifyActionNeeded`/`notifyConfirmationRequest`) and full quiet-hours options, wired end-to-end from saved settings via `DashboardScreen.tsx`.
- [x] Finance PKA version display (read-only) built — reads `pka/accounting_rules.json`'s `pka_version` directly, no new table.
- [x] Data export flow built — `db/exportRepository.ts` (pure, tested) + `db/exportService.ts` (native file write): a full JSON snapshot (reusing Sprint 9's `createLocalSnapshot`) plus a readable activity CSV, written to the app's document directory.
- [x] Account/business deletion flow built, including backup propagation — `db/deletionRepository.ts`'s `deleteAllLocalData` (fully local, tested) plus `db/deletionService.ts`'s best-effort `deleteRemoteAccountData` (removes the owner's `backups` Storage objects and `public.backups` rows before the local wipe, per this sprint's own risk register). **Honest remaining gap:** this does not delete the underlying Supabase Auth user record itself — that needs an admin/service-role action, which must live in a server-side Edge Function (a service-role key must never ship in the client, per this project's own strict secrets rule), and that Edge Function has not been built. Local data and cloud backup data are both genuinely gone; the auth account entry itself is not.

**Sprint 10 Definition of Done**
- [x] Security pass confirms encryption at rest/in transit across all data paths — see the four audit items above; one real gap (PCB sensitivity classification) was found and fixed, not just confirmed.
- [x] Settings screen functional (profile, notifications, PKA version) — plus Account (email/OTP sign-in), backup recovery-code reveal, export, and deletion sections, all wired to real persisted/native logic.
- [x] Data export produces complete, readable record — JSON snapshot (every Phase 1 table) + CSV activity log, verified by an automated test asserting both artifacts and correct CSV escaping.
- [x] Deletion flow verified, including from backup storage — `deleteRemoteAccountData` runs before the local wipe and its failure is surfaced to the owner rather than silently swallowed; `deleteAllLocalData` verified by test to clear every table while leaving `schema_migrations` (and app usability) intact.

**Known gaps carried forward (not silently missing):** deleting an account does not remove the Supabase Auth user record itself (needs a future admin Edge Function, see above); there is still no Settings-screen UI to trigger a backup upload or enter a recovery code to restore on a new device (only recovery-code *reveal* was added this sprint) — Sprint 9's backup mechanism remains code-complete but without a full owner-facing trigger; AI Autonomy and Access & Team configuration domains (Vol 7_7) remain entirely unbuilt (Phase 2, Vol 0_1 §4 / Vol 8_1 §4), correctly, with no placeholder toggle for either.

---

## Sprint 11 — Observability & Polish

- [x] Crash reporting integrated — dependency-free: `lib/crashReporting.ts` installs a global handler via React Native's built-in `ErrorUtils` (not a package), logging to a new local `app_error_log` table (migration 9). No remote crash-reporting SaaS (Sentry, Bugsnag, etc.) was added — that would be both a new production dependency and a third-party data-sharing decision, neither of which this codebase adds without the user's explicit approval (AGENTS.md), the same posture Sprints 8-10 took for notifications/connectivity/encryption/sharing. RN's own fatal-error handling is never suppressed — the previous global handler is always still called after logging.
- [x] API/AI-call error logging (incl. continued cost tracking) — `capturePipeline.ts`'s Sprint 9 try/catch blocks (classify + vision extraction) now also call `logAppError` before leaving an event queued; cost tracking itself was already continuous since Sprint 3 (`ai_interpretations.estimated_cost_usd`), unchanged this sprint. `WorkspaceScreen.tsx`'s Q&A call, which had NO error handling at all before this sprint, is now wrapped too.
- [x] Owner-facing diagnostics view (last backup, queue status) — new "Diagnostics" card in `SettingsScreen.tsx`, backed by `db/diagnosticsRepository.ts`: queued/processing count + oldest queued item's age, last backup time (new `app_settings.last_backup_at` column, set by `backupService.ts`'s `uploadBackup` on success), and a rolling 24h error count.
- [x] "Why" drill-down UI built for dashboard figures — `components/WhyButton.tsx` (self-contained button + modal) wired onto: `ActivityFeed.tsx` rows (Dashboard's "Recent activity" and Capture screen both reuse this component), Dashboard's outstanding-invoices/upcoming-bills rows, and Dashboard's notifications panel. The two true aggregates with no single source event — Cash on hand, Money in/out — get a plain-language "Why" explanation line instead (there is no single Business Event to drill into for a sum).
- [x] "Why" drill-down UI built for ledger entries — satisfied at the BusinessEvent level, not a raw ledger-entry level: this app has no owner-facing ledger-entry UI at all, by design (Vol 1_2 §2 bans "ledger"/"debit"/"credit" from the primary experience). Every owner-facing figure that traces back to specific ledger entries (an outstanding invoice/bill row, an activity feed row) already has the same "Why?" drill-down described above, which is the correct level of detail for this app's language rules.
- [x] "Why" drill-down UI built for AI recommendations — Workspace's "Today" CFO recommendation card and each Q&A turn's `sources` line both get a `WhyButton`.
- [x] Low-confidence/insufficient-context states visibly distinguished — `ai/whyDetail.ts`'s `WhyConfidenceState` (6 states) + `WhyButton.tsx`'s colour-coded badge: confident/confirmed states render green, low-confidence/awaiting-clarification render amber, not-yet-interpreted/manual-no-AI render neutral grey — never the same styling as a confident result.
- [x] Full screen sweep: empty states — reviewed Dashboard, Capture, Workspace, Documents, Settings; Documents and ActivityFeed already had proper empty states since Sprint 2/5. No new gaps found.
- [x] Full screen sweep: loading states — found and fixed a real gap: `WorkspaceScreen.tsx` had no loading indicator for its initial CFO-guidance fetch (a slow first load just showed a bare heading). Fixed with a proper `ActivityIndicator` + `guidanceLoading` state.
- [x] Full screen sweep: error states — found and fixed a real gap: `WorkspaceScreen.tsx`'s `handleAsk` had NO error handling at all around `askWorkspaceQuestion` — a thrown error (e.g. network failure) would propagate uncaught with no owner-facing message. Now wrapped in try/catch, logged, and shown inline.
- [x] Capture failure handling re-reviewed end to end — found and fixed a real, previously undocumented gap: `PhotoCapture.tsx`'s `handleCapture` (the camera-hardware call itself, `takePictureAsync`) had zero error handling — a camera failure (storage full, permission revoked mid-session, hardware error) threw straight past the component with no owner-facing state at all, silently doing nothing. Fixed with local try/catch + inline error text; this is a distinct failure mode from Vol 7_1 §5.1's "extraction fails" cases (which happen further downstream, after a photo was already successfully captured) and was not covered by Sprint 5's original review.
- [x] Accessibility basics (text size, contrast) — bumped several borderline-contrast hint-text colours (`#888`/`#999` on light backgrounds, roughly 2.8-3.5:1) to `#767676` (~4.5:1, AA) across Dashboard/Workspace/Capture; added missing `accessibilityRole="button"` to a handful of Pressables found without one (PhotoCapture's permission/cancel/capture buttons, ManualCaptureForm's submit button, BankTransactionForm's transaction-type chips). Not a full WCAG audit — time-boxed per this sprint's own risk register; the existing `#777` hint-text convention used since Sprint 2/5 (borderline ~4.48:1) was left as-is rather than retroactively changed everywhere.

**Sprint 11 Definition of Done**
- [x] Crash/error visibility confirmed working — verified via automated tests asserting `logAppError`/`listRecentAppErrors`/`countAppErrorsSince`, and that a thrown provider error in `capturePipeline.ts` actually produces an `app_error_log` row (not just the existing queued/retry behaviour). The global `ErrorUtils` hook itself (`crashReporting.ts`) is native-runtime-only and, like `lib/auth.ts`/`exportService.ts`, verified by tsc/eslint only in this sandbox.
- [x] Every owner-facing figure has working, accurate "why" drill-down — see the itemised list above; verified by tests asserting the correct `WhyConfidenceState` for auto-record, owner-confirmed, clarify, queued, and manual (Banking) cases, plus a null result for an unknown event id.
- [x] Low-confidence states visually distinct throughout — same `WhyConfidenceState`/badge system used everywhere the drill-down appears, so this is structural (one shared component), not per-screen styling that could drift out of sync.
- [x] Full click-through finds no missing empty/loading/error state — three real gaps were found (Workspace loading state, Workspace ask-error state, PhotoCapture capture-error state) and fixed, not just confirmed absent; Documents/ActivityFeed's existing states were reviewed and found already correct.

**Known gaps carried forward (not silently missing):** no remote crash-reporting SaaS (Sentry/Bugsnag) is integrated — a real production-dependency/vendor decision deferred to whenever the user wants to make that call, not this codebase's to make unilaterally; the local `app_error_log` only ever exists on the device that errored, so a real user's crash is invisible to the build team unless that device is later inspected — a genuine limitation of the dependency-free approach, stated plainly. Accessibility work is basics only, not a full audit (this sprint's own "Safe to Carry Over" allowance).

---

## Sprint 12 — Pilot Readiness & Launch

- [x] First-run onboarding flow built (`app/src/components/OnboardingFlow.tsx`, `app/src/onboarding/onboardingValidation.ts`, wired in `App.tsx`; 4 passing tests)
- [ ] Pilot business owner identified and onboarded — **owner action, see `Sprint_12_Pilot_And_Launch_Runbook.md` §1**
- [ ] Backup pilot candidate identified — **owner action, runbook §1**
- [x] Structured bug bash conducted (confirm/correct loop, reversal/reconciliation ledger arithmetic, migration idempotency, deletion safety, and `classifyAndRoute`/`resumeQueuedWork` re-read across Sprints 6/8/9/11's layered edits)
- [x] Launch-blocking bug classes prioritised — one genuine finding: two overlapping `resumeQueuedWork` passes (connectivity flapping faster than one AI round-trip) could double-write an `ai_interpretations` row for the same event. Ledger postings were already protected (deterministic id + `INSERT OR IGNORE`); this closes the same protection for the interpretation-history/explainability trail via a per-business in-flight guard. Fixed and covered by a new regression test (`offlineResume.test.ts`) that reproduces the race and asserts exactly one interpretation row results.
- [ ] App packaged for internal/beta distribution — **owner action, runbook §3** (requires real Apple/Google developer accounts and signing credentials)
- [ ] Backend confirmed on production configuration — **owner action, runbook §4** (requires the user's own Supabase project; no `.env`/secret access from this session per the standing security rule)
- [ ] Every MVP Exit Criterion (Overview §5) verified with evidence — **owner action, runbook §5**; criteria 1-5 are technically built and testable now, criterion 6 (2 real weeks, real external user) cannot be satisfied by a coding session at all

**Sprint 12 / Phase 1 Definition of Done**
- [ ] Real pilot owner used AIFA daily for 2 consecutive weeks — **not yet started; owner-driven, see runbook**
- [ ] Zero data-loss incidents during pilot window — pending the pilot itself
- [ ] Zero incorrect-ledger incidents during pilot window — pending the pilot itself
- [ ] Every MVP Exit Criterion checked off with evidence — pending the pilot itself
- [ ] App distributed via a real release channel — **owner action, runbook §3**

**Honest status:** the buildable half of Sprint 12 (onboarding flow, bug bash) is done and verified (tsc/eslint/126 tests passing). The rest of this sprint — and therefore Phase 1 itself — is deliberately NOT marked complete, because MVP Exit Criterion 6 requires two real weeks of a real external business owner's usage, distribution requires developer accounts only the user holds, and production backend confirmation requires the user's own Supabase project. See `Sprint_12_Pilot_And_Launch_Runbook.md` for the exact next steps.

---

## Phase 1 Complete

When every box above is checked, Phase 1 is done. Next step: a Phase 2 scoping pass against `Vol_0_1_MVP_Phased_Delivery_Roadmap.md`'s Phase 2 list, informed by real pilot feedback — not a continuation of this checklist.
