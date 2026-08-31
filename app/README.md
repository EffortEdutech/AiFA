# AIFA — Mobile App (Phase 1 / MVP)

Sprints 1–11 complete. See `docs/sprint-plan/Phase_1_MVP/` in the project root
for each sprint's full plan, and
`docs/architecture/v2.0/Vol_0_1_MVP_Phased_Delivery_Roadmap.md` for the scope
this build stays within.

## Stack

React Native (Expo, TypeScript) · op-sqlite + SQLCipher (local encrypted DB)
· Supabase (auth + backup storage) · single cloud AI model — per
`docs/architecture/v2.0/Series_11_Implementation_Foundations/Vol_11_0_Technology_Stack_Decisions.md`.

## What's in this scaffold

- `App.tsx`, `src/navigation/` — the 5-tab shell (Vol 7_0): Dashboard, Capture,
  AI Workspace, Documents, Settings. All five tabs are now functional as of
  Sprint 10 (Settings was the last placeholder).
- `src/db/` — local encrypted database client (op-sqlite + SQLCipher,
  production — Sprint 9 adds `getDeviceEncryptionKey`, exposing this
  device's key so `backupService.ts` can reuse it; this same value also
  doubles as the owner's backup "recovery code", see that file's own
  comment) plus an engine-agnostic `SqlDb` interface, SQL migrations
  (`business_events`, `business_data`, `ledger_entries`, `ai_interpretations`,
  `documents`, `document_blobs` — Vol 11_1 §2, §3, §4, §5, §8), a DB-level
  trigger enforcing Business Event immutability once confirmed (Vol 4_0 §7,
  relaxed once in migration 4 to allow the documented `superseded_by`
  linkage — see "Notes" below), `businessEventRepository.ts` (create/list/
  status-transition, no direct update/delete of a confirmed event beyond
  that one linkage; Sprint 5 adds event-only + attach-data-later primitives
  for photo capture; Sprint 6 renames the Expense-only `recordExpenseCaptureQueued`
  to domain-parameterised `recordCaptureQueued`), `ledgerRepository.ts`
  (double-entry postings + reversal postings, Vol 4_1 §4; Sprint 7 adds an
  optional `idVariant` to `LedgerEntryInput` so a settlement posting can
  share a BusinessData row with its original sale/purchase entries without
  id collision — see `bankingRepository.ts` below),
  `financialSummaryRepository.ts` (cash position / money in-out trend,
  Sprint 4; Sprint 6 adds `getOutstandingReceivables`/`getOutstandingPayables`,
  reused unchanged by Sprint 7's reconciliation),
  `accounts.ts` (shared chart-of-accounts constants — Sprint 6 adds
  `ACCOUNTS_RECEIVABLE_ACCOUNT`), `aiInterpretationRepository.ts`
  (explainability + cost-per-event log), `documentRepository.ts`
  (Sprint 5: Document metadata + the `document_blobs` image store, Vol
  11_1 §5, Vol 7_6), (Sprint 8) `businessKnowledgeRepository.ts` — the
  Business Knowledge Store's Phase 1 minimal form (Vol 4_2, Vol 11_1 §7):
  one table, one heuristic (vendor -> category mapping), no general-purpose
  pattern engine. `recordVendorCategoryConfirmation` tracks a CONSECUTIVE
  streak of the same confirmed category per vendor (a differing
  confirmation resets it to 1 rather than accumulating toward the old
  value); `getTrustedVendorCategory` returns the mapping once it crosses
  `TRUSTED_CONFIRMATION_THRESHOLD` (3), and null otherwise — callers never
  need to re-check the threshold themselves. And (Sprint 7)
  `bankingRepository.ts` — Banking's
  own manual-entry pipeline (Vol 6_4, deliberately NOT run through the AI
  classification pipeline: Deposit/Withdrawal/Transfer/Bank Fee have no
  ambiguous category to guess). `recordBankTransaction` posts deterministic
  ledger entries per PKA rule `BANK-001`, and — its main piece of logic —
  optionally matches a Deposit/Withdrawal against an outstanding Sale/
  Purchase (`matchBusinessDataId`) and settles it via new ledger entries
  against the ORIGINAL BusinessData id (not a new row), full-amount-only
  (partial settlement is explicitly unsupported, tolerance-checked to
  0.005). Every match is also logged to a new `bank_reconciliations` table
  (migration 6) purely for audit traceability — `getOutstandingReceivables`/
  `Payables` already net correctly from `ledger_entries` alone, so this
  table plays no role in balance computation. Migration 6 also adds
  `Operating Expenses:Bank Fees` to the chart of accounts. A same-business
  "Transfer" posts zero ledger entries (Phase 1 has one undifferentiated
  Cash/Bank line, so both legs would hit the same account) but still
  records a BusinessEvent for the audit trail. Sprint 9 adds
  `getBusinessEventById` (a raw, non-joined event lookup — returns a row
  even when it has no linked BusinessData yet, unlike
  `getActivityItemByEventId`'s INNER JOIN — needed to resume a queued
  photo capture that never reached extraction).
- `src/db/backupRepository.ts` (Sprint 9) — the engine-agnostic core of
  backup/restore (Vol 8_4, Vol 4_4 §4): `createLocalSnapshot` reads every
  Phase 1 table (`SNAPSHOT_TABLES`) into one portable JSON object;
  `restoreFromSnapshot` inserts it into any migrated `SqlDb` via generic,
  column-name-driven `INSERT OR IGNORE`. No native/network dependency at
  all — fully exercised by Jest against the Node test adapter
  (`backupRepository.test.ts`), unlike everything else backup-related.
- `src/db/backupService.ts` (Sprint 9) — the native/network-dependent
  counterpart: `uploadBackup` snapshots the local DB, writes it into a
  small temporary SQLCipher-encrypted SQLite file (reusing the SAME device
  key as the main database — no new crypto dependency added), and uploads
  the raw encrypted bytes to Supabase Storage; `restoreLatestBackup`
  reverses this given a `recoveryCode` (see `db/client.ts`'s
  `getDeviceEncryptionKey` below). Both require a signed-in Supabase user
  and throw a clear `BackupNotAvailableError` otherwise — sign-in doesn't
  exist yet (Sprint 10), so this path is code-complete but genuinely
  unusable end-to-end until then; see "Why isn't this already fully
  built" below.
- `src/db/appSettingsRepository.ts` (Sprint 10, Vol 7_7) — a single
  `app_settings` row per business (migration v8) covering Business Profile
  (`business_name`, `industry`) and Notifications (full owner-configurable
  quiet hours plus per-kind `notify_action_needed`/`notify_confirmation_request`
  toggles — closing the gap Sprint 8's own doc explicitly deferred).
  `getAppSettings` returns Sprint 8's hardcoded defaults when no row exists
  yet, so a business that's never opened Settings behaves identically to
  before this table existed. `DashboardScreen.tsx` reads these settings
  once per load and passes them straight into `getNotifications`'s options.
- `src/db/exportRepository.ts` / `exportService.ts` (Sprint 10, Vol 7_7 Data
  & Privacy) — split the same way backup is (Sprint 9): `exportRepository.ts`
  is pure and fully tested (`buildActivityCsv`, `buildExportBundle`, which
  reuses `backupRepository.ts`'s `createLocalSnapshot` directly rather than
  duplicating that read logic — an export IS a snapshot, just written
  locally instead of uploaded); `exportService.ts` is the native
  `expo-file-system` write layer (no `expo-sharing` dependency added — a
  deferred new-dependency decision; the Settings screen just shows the
  resulting file paths).
- `src/db/deletionRepository.ts` / `deletionService.ts` (Sprint 10, Vol 7_7
  Data & Privacy) — `deleteAllLocalData` (pure, tested) clears every Phase
  1 business/config table (`LOCAL_DELETION_TABLES`, a superset of Sprint
  9's `SNAPSHOT_TABLES` plus `app_settings`, compile-time-asserted to cover
  every snapshot table) while leaving `schema_migrations` alone, so the app
  stays usable afterwards. `deleteRemoteAccountData` is best-effort: it
  removes the owner's `backups` Storage objects and `public.backups` rows
  and signs out, but does NOT delete the Supabase Auth user record itself —
  that needs an admin/service-role action, which must live server-side (a
  service-role key can never ship in this client, per this project's own
  strict secrets rule) and has not been built. Never blocks or is blocked
  by the local wipe, per Vol 4_4 §2's local-first principle.
- `src/lib/auth.ts` (Sprint 10, Vol 8_1, Vol 11_0 §5) — minimal email/OTP
  auth (`requestOtp`/`verifyOtp`/`signOut`/`useAuthSession`), the piece
  Sprint 9's `backupService.ts` has needed since it was written. Deliberately
  NOT a gate on the rest of the app — surfaced only as an optional
  "Account" section inside Settings, per Vol 4_4's local-first principle.
- `src/ai/types.ts` — Sprint 10 security audit fix: `ProfessionalContextBundle`
  gained the `sensitivity_classification: "standard" | "high"` field Vol 3_1
  §4 / Vol 11_1 §6 call "required" even in the Phase 1 minimal PCB — this
  was a genuine gap (the field didn't exist at all), not a documented
  simplification. Both `buildCapturePcb` and `buildWorkspacePcb` (`ai/pcb.ts`)
  now populate it as `"standard"` — Phase 1 has no high-sensitivity domain
  (payroll, Vol 6_7) wired into capture yet.
- `src/db/testAdapter.ts` — a Node-only `SqlDb` adapter (built on Node's
  native `node:sqlite`) used solely by the Jest suite in `src/db/__tests__/`,
  so the migration and repository logic is unit-tested without needing a
  device/simulator. See the file's own comment for why this exists instead
  of a package like better-sqlite3.
- `src/ai/` — the capture interpretation pipeline (Sprint 3, Expense-only;
  generalised in Sprint 6 to also cover Sale and Purchase, Vol 6_0 §4
  "shared engine, domain-scoped rules"): `pcb.ts`'s `buildCapturePcb`
  assembles the Phase 1 minimal Professional Context Bundle (Vol 11_1 §6)
  from the Finance PKA bundle in `pka/`, domain-parameterised;
  `capturePipeline.ts` (Sprint 6 rename of `expensePipeline.ts`) runs
  classify → route → (post ledger | wait for owner) per the confidence
  thresholds in `pka/accounting_rules.json` for any of the three
  AI-interpreted domains, and (Sprint 5, still Expense-only) the equivalent
  photo → vision-extract → route flow sharing the same routing core;
  `providers/anthropicProvider.ts` is the real cloud-model call, both text
  classification (`classify`, renamed from `classifyExpense` in Sprint 6)
  and (Sprint 5) vision extraction (needs `EXPO_PUBLIC_AI_API_KEY`, see
  below); `providers/localHeuristicProvider.ts` is a keyword-matching
  text-only placeholder used automatically when no key is set, capped
  below the auto-record threshold so nothing posts without either a real
  model or an explicit owner confirm — as of Sprint 6 it reads its
  candidate categories/keywords off the PCB itself rather than importing
  `accounting_rules.json` directly, so it works for any domain unmodified;
  it has no vision method, so a photo capture with no key is treated as an
  honest "extraction failed entirely" (Vol 7_1 §5.1), not a special case;
  `providers/scriptedProvider.ts` (`ScriptedCaptureProvider`, Sprint 6
  rename of `ScriptedExpenseProvider`) / `scriptedVisionProvider.ts` are
  the test doubles. `src/ai/expensePipeline.ts` still exists on disk as a
  thin `export *` shim to `capturePipeline.ts` — it could not be deleted
  from the sandbox this was built in (see "Notes" below); do not add new
  code there. Sprint 7 adds a second, parallel pipeline for the AI
  Workspace's free-form Q&A (Vol 7_2): `cfoGuidance.ts`'s `getCfoGuidance`
  computes the Vol 0_1 §6 reduced set (cash position, overdue receivables
  — a 30-day `captured_at`-age proxy, `OVERDUE_THRESHOLD_DAYS`, since
  Phase 1 has no real due-date field — upcoming payables, and at most one
  "today" recommendation, never manufactured if nothing is overdue);
  `pcb.ts`'s `buildWorkspacePcb` wraps that guidance into a PCB scoped to
  exactly those four fields and nothing else, so a provider literally
  cannot answer outside that scope; `workspacePipeline.ts`'s
  `askWorkspaceQuestion` ties guidance + PCB + provider together and
  returns one of three honest states — a real answer, `outOfScope` (a
  capable provider evaluated and declined), or `noProviderConfigured` (the
  configured provider has no `answerFinancialQuestion` method at all).
  `AiProvider.answerFinancialQuestion` (optional, `types.ts`) is
  implemented by `anthropicProvider.ts` (real call, untested live — no
  network/key in this sandbox) and `localHeuristicProvider.ts` (a small
  keyword-routed set: cash/overdue/payables/today, else declines);
  `providers/scriptedWorkspaceProvider.ts` is this pipeline's test double
  (deliberately does not implement `classify()` — it's Workspace-only).
  Sprint 8 adds a third: `notificationEngine.ts`'s `getNotifications`
  (Vol 7_5) — action-needed items from every one of `CfoGuidance`'s
  overdue receivables (not just the single "today" recommendation) and
  confirmation-request items from any unresolved draft/needs_clarification
  event across all three AI-interpreted domains, capped at
  `NOTIFICATION_DAILY_CAP` (3) and suppressible via a basic on/off quiet
  hours window (hardcoded default 9pm-8am). Also Sprint 8:
  `capturePipeline.ts`'s `classifyAndRoute` now checks
  `businessKnowledgeRepository.ts`'s trusted vendor-category mappings —
  when a vendor's mapping is trusted (3+ consecutive owner confirmations
  of the same category, Vol 4_2 §3.1) AND the AI provider's own
  independent guess agrees with it, confidence is boosted to
  `TRUSTED_MAPPING_CONFIDENCE_FLOOR` (0.95). Deliberately agreement-required
  — the mapping never overrides a disagreeing or unrecognised AI guess, a
  design choice made explicitly to avoid the "over-eager
  auto-categorisation erodes trust" risk in that sprint's own risk
  register. `confirmCategory` and `correctConfirmedCapture` are the only
  two call sites that feed the mapping (both represent explicit owner
  certainty, confidence 1.0) — `classifyAndRoute`'s own `auto_record`
  decisions never do, since an AI guess the owner never touched is not an
  "explicit owner confirmation" (Vol 4_2 §3). Sprint 9 (Vol 7_4 §2-4) adds
  a fourth `InterpretationDecision`, `queued_retry`: `classifyAndRoute`
  now accepts an `isOnline` flag (skips the network call entirely when
  `false`) and wraps the actual `provider.classify()`/
  `provider.extractExpenseFromImage()` calls in try/catch — a genuine
  network failure mid-call leaves the event `queued` (never stuck at
  `processing` with no way forward) rather than throwing past the
  pipeline. `resumeQueuedCaptures` (text + photo-with-data),
  `resumeQueuedPhotoCaptures` (photo captures that never reached
  extraction — re-fetches the stored image bytes from `document_blobs`
  rather than requiring a re-photograph), and the unified
  `resumeQueuedWork` retry all of it once connectivity returns.
- `src/components/ManualCaptureForm.tsx`, `ActivityFeed.tsx`,
  `PhotoCapture.tsx` (Sprint 5) — the capture form (now also the Vol 7_1
  §5.1 fallback UI, pre-filled and with missing fields highlighted when a
  photo's extraction was partial), the activity feed, and the camera
  capture UI, wired into `CaptureScreen.tsx` and (feed only)
  `DashboardScreen.tsx`. Expense, Sale, and Purchase captures all go
  through the AI pipeline as of Sprint 6 (draft/clarify states render
  inline confirm/correct/answer chips, domain-scoped to whichever
  category list applies; a confirmed event in any of these three domains
  also gets a "Correct category" affordance as of Sprint 4/6, which posts
  a reversal rather than editing anything in place). Banking now has its
  own dedicated form, `BankTransactionForm.tsx` (Sprint 7) — a chip
  selector for Deposit/Withdrawal/Transfer/Bank Fee, with a conditional
  "match to an outstanding invoice/bill" list for Deposit/Withdrawal that
  locks the amount/currency fields once a match is picked, and an inline
  notice on Transfer explaining the single-Cash/Bank-account limitation.
  `ManualCaptureForm.tsx`'s own domain options dropped "banking" the same
  sprint — Banking capture goes exclusively through the new form now,
  wired into `CaptureScreen.tsx` via a "Log a bank transaction" button.
- `src/hooks/useRecentActivity.ts` — shared fetch/refresh/resolve/correct
  logic for the activity feed, used by both Capture and Dashboard (Sprint 4;
  previously duplicated between the two).
- `src/screens/DashboardScreen.tsx` — Vol 7_3 Dashboard v1 (Sprint 4): cash
  position, 30-day money in/out trend, recent Business Events; Sprint 6
  adds "Outstanding invoices" and "Upcoming bills" sections (Vol 6_1 §5,
  Vol 6_2 §5 — see that file's own comment for the "upcoming" naming
  caveat: Phase 1 has no due-date data, so these are flat outstanding
  lists, not ageing-sorted). Business language only, no ledger/
  account-code terms — see that file's own comment for the reduced Phase 1
  panel set (Vol 0_1 §6). Sprint 8 adds a "Needs your attention" panel at
  the top of this screen, backed by `ai/notificationEngine.ts` (Vol 7_5) —
  Phase 1's honest substitute for OS push notifications (no
  `expo-notifications` dependency added): the owner sees it on next app
  open rather than being proactively pinged.
- `src/screens/WorkspaceScreen.tsx` — Vol 7_2 AI Workspace (Sprint 7,
  replacing the Sprint 1 placeholder): loads today's CFO guidance on
  mount (recommendation card, or an honest "Nothing needs your attention
  today" when nothing is overdue), an outstanding-invoices/upcoming-bills
  summary, and a free-form Q&A box — each past turn shows the question,
  the answer (styled distinctly when `outOfScope`), and a "Source: ..."
  line when the answer cites specific Business Events.
- `src/screens/SettingsScreen.tsx` — Vol 7_7 (Sprint 10, replacing the
  Sprint 1 placeholder): Business Profile, Notifications (quiet hours +
  per-kind toggles), read-only Finance PKA version, an optional Account
  section (email/OTP sign-in/out via `lib/auth.ts`), backup recovery-code
  reveal (`db/client.ts`'s `getDeviceEncryptionKey`, closing the Vol 4_4 §8
  gap that flagged no reveal UI existed), data export, and account/business
  deletion (with a confirmation dialog and remote-then-local ordering).
  AI Autonomy and Access & Team sections deliberately do not appear — both
  are Phase 2 (Vol 0_1 §4, Vol 8_1 §4), and a visible-but-fake control would
  misrepresent Phase 1 scope. Note: this screen does NOT yet add UI to
  trigger a backup upload or enter a recovery code to restore onto a new
  device — only the recovery-code *reveal* was in this sprint's scope; the
  full backup-trigger UI remains a gap (see "Why isn't this already fully
  built" below). Sprint 11 adds a "Diagnostics" card (queue/sync status,
  last backup time, rolling 24h error count — `db/diagnosticsRepository.ts`,
  Vol 8_6 §4).
- `src/lib/crashReporting.ts` (Sprint 11, Vol 8_6) — installs a global JS
  error handler via React Native's own built-in `ErrorUtils` (no new
  dependency), logging to `app_error_log` (migration 9,
  `db/errorLogRepository.ts`). Deliberately NOT wired to a remote
  crash-reporting SaaS (Sentry, Bugsnag, etc.) — that's both a new
  production dependency and a third-party data-sharing decision, neither
  of which this codebase adds without approval (AGENTS.md), same posture
  as Sprints 8-10 took for notifications/connectivity/encryption/sharing.
  Always calls through to RN's own previous handler afterwards — this adds
  visibility, it never suppresses the app's normal fatal-error behaviour.
  `capturePipeline.ts`'s existing (Sprint 9) try/catch blocks around
  `provider.classify`/`provider.extractExpenseFromImage` now also call
  `logAppError`, and `WorkspaceScreen.tsx`'s Q&A call — which had NO error
  handling at all before this sprint — is now wrapped too.
- `src/ai/whyDetail.ts` + `src/components/WhyButton.tsx` (Sprint 11, Vol
  5_3 §3-4, Vol 1_2 §5) — the "why" drill-down. `getWhyDetailForEvent`
  reads a Business Event's full `ai_interpretations` history (unchanged
  since Sprint 3) and classifies it into one of six `WhyConfidenceState`
  values (confident/owner-confirmed/needs-review/awaiting-clarification/
  not-yet-interpreted/manual-no-AI); `WhyButton` is a self-contained "Why?"
  link + modal, colour-coded by that state so a low-confidence or
  not-yet-interpreted item is never visually indistinguishable from a
  confident one (Vol 5_3 §3's explicit requirement). Wired onto
  `ActivityFeed.tsx` rows (used by both Dashboard and Capture),
  `DashboardScreen.tsx`'s outstanding-invoices/bills rows and notifications
  panel, and `WorkspaceScreen.tsx`'s "Today" recommendation card and each
  Q&A turn's source. The two genuine aggregate figures with no single
  source event (Cash on hand, Money in/out) get a plain-language "Why"
  sentence instead of a drill-down button — there's no one event to open.
- `src/screens/DocumentsScreen.tsx` — Vol 7_6 Document library (Sprint 5):
  basic browsable list of every captured receipt/invoice with a thumbnail
  and its linked Business Event context. Functional, not yet the polished
  search/filter UX (explicitly safe to carry over per the Sprint 5 plan).
- `src/lib/supabaseClient.ts` — backend client wiring.
- `src/lib/connectivity.ts`, `src/hooks/useAutoResume.ts`,
  `src/components/ConnectivityBanner.tsx` (Sprint 9, Vol 7_4 §3-4) — the
  cross-cutting offline experience, wired once at the app root
  (`App.tsx`) rather than duplicated per-screen. `connectivity.ts` is a
  dependency-free `fetch`-based reachability probe (polling +
  `AppState`-triggered re-check on foreground) — deliberately NOT built on
  `expo-network`/`NetInfo` since neither was an existing dependency;
  `useAutoResume` calls `resumeQueuedWork` on mount and on every
  offline-to-online transition; `ConnectivityBanner` shows a small
  "Offline — ..." strip only while offline.
- `backend/schema.sql` — the Postgres schema to run in your Supabase project.
- `pka/` — the Phase 1 Finance PKA bundle (Vol 3_0 Section 4.1): governed
  rules and role definition, versioned as plain files. Expense-only through
  Sprint 5; Sprint 6 adds Sales and Purchase domain rules/categories; Sprint 7
  adds `BANK-001` (Banking's deterministic posting rules, not run through
  the AI classification pipeline) and `Operating Expenses:Bank Fees` to the
  chart of accounts, bumping `pka_version` to `0.3.0`.
- `.github/workflows/ci.yml` — lint + typecheck on push (consider adding
  `npm test` to this workflow now that a test suite exists).

## Testing

```
npm test
```

Runs Jest against `src/db/__tests__/`. Requires **Node 22+** (uses the
built-in `node:sqlite` module for the test-only DB adapter — see
`src/db/testAdapter.ts`). Covers the portable SQL schema/repository logic,
the full capture interpretation pipeline (confidence routing, ledger
posting, immutability ordering) against the `ScriptedCaptureProvider` test
double for the Expense domain (`capturePipeline.test.ts`, Sprint 3, renamed
from `expensePipeline.test.ts`), (Sprint 4) the ledger balance-check across
captures and corrections, reversal-based correction, and the cash
position/trend calculation against a hand-worked scenario
(`ledgerAndDashboard.test.ts`), (Sprint 5) all three Vol 7_1 §5.1
photo-capture failure modes (extraction fails entirely, partial, no
connectivity) plus the success path, against `ScriptedVisionExpenseProvider`
(`documentsAndPhotoCapture.test.ts`), and (Sprint 6) the same pipeline
parameterised for Sale and Purchase — domain-correct ledger posting shape,
cross-domain category rejection, reversal-based correction, and the
outstanding receivables/payables queries (`salesPurchasePipeline.test.ts`),
and (Sprint 7) Banking's deterministic posting shapes for all four
transaction types, reconciliation matching/settlement (including
wrong-type-match, amount-mismatch, and double-settlement rejections) and
its effect on outstanding balances, and `getCfoGuidance`'s overdue-trigger
logic simulated via its `now` option rather than backdating real rows
(`bankingAndCfoGuidance.test.ts`), plus `askWorkspaceQuestion`'s three
honest response states and the Workspace PCB's exact scoped field set
against a `ScriptedWorkspaceProvider` test double (`workspacePipeline.test.ts`),
and (Sprint 8) the vendor-mapping trust streak (fresh vendor, crossing
`TRUSTED_CONFIRMATION_THRESHOLD`, and a differing confirmation resetting
the streak), the confidence-boost agreement-required design (boosted when
the AI's guess agrees with a trusted mapping, unchanged when it disagrees
or when the vendor isn't yet trusted), and `getNotifications`'s
action-needed/confirmation-request firing, non-issue suppression, daily
cap under a multi-trigger scenario, and quiet-hours on/off
(`businessKnowledgeAndNotifications.test.ts`), and (Sprint 9) offline/
retry handling — a thrown network error mid-classify or mid-extraction
leaving an event queued rather than stuck, `resumeQueuedCaptures`/
`resumeQueuedPhotoCaptures`/`resumeQueuedWork` correctly retrying without
duplication, and an empty-queue no-op case
(`offlineResume.test.ts`) — plus the backup snapshot/restore round-trip:
seed a source test DB across every `SNAPSHOT_TABLES` table, snapshot it,
restore into a fresh test DB, and assert cash position/receivables/
payables/row-counts are identical, including a double-restore
idempotency check (`backupRepository.test.ts`), and (Sprint 10)
`appSettingsRepository`'s default/persist/partial-update/hour-clamping
behaviour, `notificationEngine`'s new per-kind
`notifyActionNeeded`/`notifyConfirmationRequest` suppression, `exportRepository`'s
CSV header/escaping and JSON-snapshot reuse, `deletionRepository`'s
`deleteAllLocalData` clearing every table while leaving `schema_migrations`
(and app usability) intact, and both `buildCapturePcb`/`buildWorkspacePcb`
setting `sensitivity_classification: "standard"`
(`settingsAndDataRights.test.ts`), and (Sprint 11) `errorLogRepository`'s
write/truncate/ordering/time-window behaviour, `diagnosticsRepository`'s
queue-count/oldest-item/last-backup/recent-error aggregation,
`capturePipeline.ts`'s thrown-provider-error path now ALSO writing an
`app_error_log` row (not just leaving the event queued, Sprint 9's
existing behaviour), and `getWhyDetailForEvent`'s six-way confidence-state
classification (auto-record, owner-confirmed-after-draft,
awaiting-clarification, queued/not-yet-interpreted, Banking's
manual-no-AI, and an unknown-event-id returning null)
(`observabilityAndExplainability.test.ts`) — and (Sprint 12)
`onboardingValidation`'s business-name-required check (4 tests,
`onboarding/__tests__/onboardingValidation.test.ts`) plus a
concurrency-guard regression test proving two overlapping
`resumeQueuedWork` passes for the same business no longer produce a
duplicate `ai_interpretations` row (`offlineResume.test.ts`) — 126 tests
total, up from 121.
It does not exercise `AnthropicExpenseProvider`
or its Sprint 7 `answerFinancialQuestion` method (both need a real network
call and API key), the `PhotoCapture` camera UI (needs real camera
hardware), op-sqlite's native SQLCipher encryption layer, (Sprint 9)
`backupService.ts`'s actual native file/Supabase Storage calls, (Sprint
10) `lib/auth.ts`'s real Supabase Auth calls and `exportService.ts`/
`deletionService.ts`'s native file/Storage calls, or (Sprint 11)
`crashReporting.ts`'s actual `ErrorUtils` hook (a real RN-runtime global
not present under Jest/Node — the module handles its own absence
gracefully, see its own comment) — all can only be verified on a real
device/simulator build with a real Supabase project and a signed-in user
(see "Running this project" below).

**Note (Sprint 5):** "vision extraction accuracy measured against real
receipts" (that sprint's own Definition of Done) could NOT be done in this
sandbox — no camera, no real receipt images, no live API key. This is not
a checked-off item; it's flagged in `Checklist_Master.md` as requiring your
own device. Treat it as unfinished, not assumed-fine.

## Manual setup required (cannot be done from this scaffold alone)

1. **Create a Supabase project** at supabase.com (free tier is enough for
   Phase 1). Run `backend/schema.sql` in its SQL editor.
2. **Copy `.env.example` to `.env`** and fill in your Supabase URL and anon
   key from the project's API settings.
3. **Install dependencies:** `npm install`, then `npx expo install --fix` to
   align every package to your installed Expo SDK version (the versions in
   `package.json` are a reasonable starting point, not guaranteed exact —
   this is the standard Expo way to self-correct that).
4. **Native module setup (op-sqlite + SQLCipher):** this cannot run inside
   Expo Go. Run `npx expo prebuild` to generate native iOS/Android projects,
   then build a dev client (`npx expo run:ios` / `npx expo run:android`, or
   an EAS development build if you don't have local Xcode/Android Studio).
   This is a one-time step per machine.
5. **AI model key:** set `EXPO_PUBLIC_AI_API_KEY` (and optionally
   `EXPO_PUBLIC_AI_MODEL`) in your `.env` to use the real
   `AnthropicExpenseProvider` — see `.env.example`. Without it, Expense
   capture still works end-to-end using the local placeholder heuristic
   provider, just without real AI reasoning. Do not commit a real key, and
   do not ship it inside a client-side production bundle (route through a
   small backend function before general release; fine to call directly
   from the app for early local development only).
6. **Backup/restore (Sprint 9) additionally needs a signed-in Supabase
   user**, on top of steps 1-2 above — `backupService.ts`'s
   `uploadBackup`/`restoreLatestBackup` both call `supabase.auth.getUser()`
   and throw a clear error if nothing is signed in. Sprint 10 added the
   Account section in Settings (email/OTP sign-in) to actually reach that
   signed-in state — see step 7. Note the Settings screen itself does not
   yet call `uploadBackup`/`restoreLatestBackup` from a button (that UI
   wiring remains a gap, see "Known gaps carried forward from Sprint 10"
   above) — those functions still need to be called directly for now.
7. **Email/OTP sign-in (Sprint 10) needs Supabase Auth's email provider
   configured** in your project (Authentication → Providers → Email, and
   Authentication → Email Templates for the OTP/magic-link template) — the
   default Supabase project settings usually work out of the box, but rate
   limits and the "confirm email" requirement are worth checking in your
   own project's Auth settings before relying on `lib/auth.ts`'s
   `requestOtp` in a real test.

## Running this project

```
npm install
npx expo install --fix
npx expo prebuild
npx expo run:ios      # or: npx expo run:android
```

## Why isn't this already fully built and verified?

This scaffold was generated in a sandboxed environment with no Xcode,
Android SDK, physical device, camera hardware, or outbound access to AI
provider APIs — so it cannot be built to a real app, tested on a
simulator, have the real `AnthropicExpenseProvider` exercised, or have the
camera capture UI touched from here. What *has* been verified in-sandbox
as of Sprint 12: `npm install` completes clean, `npm run typecheck`, `npm
run lint`, and `npm test` (126 tests, up from 121) all pass with zero
errors, including the full Expense/Sale/Purchase pipeline, ledger reversal/
correction, cash-position and outstanding receivables/payables
calculations, every photo-capture failure mode logic path, Banking's
deterministic posting and reconciliation/settlement logic, CFO Guidance's
overdue-trigger logic, the Sprint 8 vendor-trust confidence boost and
notification firing/cap/quiet-hours logic, (Sprint 9) offline queueing/
resume behaviour and the backup snapshot/restore round-trip, (Sprint 10)
settings persistence, per-kind notification suppression, export
CSV/JSON generation, deletion clearing every table safely, and the PCB
sensitivity-classification fix, and (Sprint 11) error logging (write,
truncate, time-window queries), the diagnostics-summary aggregation, a
thrown provider error now producing a real `app_error_log` row (not just
Sprint 9's existing queued/retry behaviour), and every one of
`getWhyDetailForEvent`'s six confidence-state classifications. What still
requires your own machine: an actual device/simulator build (`expo
prebuild` + dev client), a real classification/vision/Workspace-Q&A call
with a configured `EXPO_PUBLIC_AI_API_KEY` (currently deferred per your own
request — see the task list), a real Supabase project + signed-in user to
exercise `backupService.ts`'s upload/download calls and (Sprint 10)
`lib/auth.ts`'s real email/OTP sign-in, (Sprint 11) confirming
`crashReporting.ts`'s global `ErrorUtils` hook actually fires on a real RN
crash and that the "Why?" modal renders correctly on-device, and —
specifically for Sprint 5, still unresolved — testing the camera UI and
vision accuracy against real, messy, real-world receipts, which is that
sprint's own stated risk and cannot be faked with synthetic data. Treat
all of this as part of finishing each relevant sprint, not as separate
work.

**Sprint 12:** built the first-run onboarding flow (`OnboardingFlow.tsx` +
`onboardingValidation.ts`, wired ahead of `AppNavigator` in `App.tsx` behind
a one-time SecureStore flag) and ran a structured bug-bash code review
targeting the three launch-blocking classes named in the sprint doc: data
loss, incorrect financial figures, and a broken confirm/correct loop.
Reviewed: `confirmCategory`/`correctConfirmedCapture` (correct — the
agreement-required Business Knowledge trust boost from Sprint 8 is
unchanged, corrections still reverse-then-recreate rather than editing in
place), reversal-based correction and bank reconciliation settlement
arithmetic in `ledgerRepository.ts`/`bankingRepository.ts` (both correct
and already idempotent — deterministic per-row ids plus `INSERT OR IGNORE`
mean re-running either is a safe no-op, not a double-posting), migration
idempotency (`runMigrations` gates every migration on
`schema_migrations`, confirmed sound), and deletion safety
(`deleteAllLocalData` has exactly one call site, behind an explicit owner
confirmation dialog). One genuine finding, fixed: `resumeQueuedWork` had
no guard against two overlapping resume passes for the same business
(e.g. connectivity flapping offline→online→offline→online faster than one
AI round-trip completes) — the ledger was already protected from this by
the idempotent-posting design above, but `recordAiInterpretation`'s
timestamp-based id and plain `INSERT` were not, so a duplicate
`ai_interpretations` row (and a last-write-wins race on the event's final
status) was genuinely possible. Fixed with a per-business in-flight guard
in `capturePipeline.ts`'s `resumeQueuedWork`; a new regression test in
`offlineResume.test.ts` reproduces the race with a deliberately slow
provider and asserts exactly one interpretation row results. Phase 1 is
**not** complete after this sprint — see
`docs/sprint-plan/Phase_1_MVP/Sprint_12_Pilot_And_Launch_Runbook.md` for
everything still outstanding (real pilot recruitment, TestFlight/Play
Console distribution, production Supabase confirmation, and MVP Exit
Criterion 6's two-real-weeks requirement), none of which a coding session
can execute on your behalf.

**A build note for whichever machine you run this on:** this project
needs a custom **dev client**, not Expo Go — op-sqlite/SQLCipher is a
native module Expo Go cannot load. If you're testing on an Android phone
with Expo Go installed, that's the wrong target for this app specifically;
Expo Go will open but the database layer (and everything built on it,
which by Sprint 2 is nearly everything) will fail. With Android Studio
already installed, the path is `npx expo prebuild` then `npx expo run:android`
(builds and installs a real dev client APK onto the connected phone via
USB debugging, replacing the Expo Go app for this project) rather than
scanning a QR code into Expo Go. A USB webcam (e.g. a Logi C615) does not
substitute for `PhotoCapture.tsx`'s camera flow either — that screen uses
`expo-camera` against the phone's own camera hardware, not a
computer-attached webcam; there's no code path in this app that reads from
a desktop-connected USB camera.

**First real device-build attempt (2026-08-02, post-Sprint 12) found and fixed two genuine Sprint-1-era scaffold bugs** — neither was ever caught before because no one had run `npx expo prebuild` against a real device until now:

1. `app.json`'s `expo.plugins` array listed `@op-engineering/op-sqlite` as an Expo config plugin with `{ "sqlcipher": true }`. The installed version (9.x) has no config-plugin export at all (no `app.plugin.js`) — it reads SQLCipher config from a top-level `"op-sqlite": { "sqlcipher": true }` key in `package.json` instead (read directly by both `android/build.gradle` and the iOS podspec via `JsonSlurper`/Ruby, not through Expo's plugin system). The stale plugin entry made `expo prebuild` crash with `CommandError: Package "@op-engineering/op-sqlite" does not contain a valid config plugin. ... Unexpected token 'typeof'` — Expo trying and failing to `require()` the package's runtime entrypoint as if it were a plugin function. Fixed: removed the op-sqlite entry from `app.json`'s `plugins`, added the `"op-sqlite": { "sqlcipher": true }` key to `package.json` directly.
2. `app.json` referenced `"./assets/icon.png"` but no file had ever been placed there — `assets/` was empty since Sprint 1. `expo prebuild`'s icon-generation step fails hard (`ENOENT`) without it. Fixed with a placeholder 1024×1024 icon (`assets/icon.png`) — replace with real branding whenever you have it; nothing else depends on its actual appearance.

Both fixes verified by running `npx expo prebuild --platform android` to completion in a Linux sandbox (can't run the Android SDK/Gradle step itself there, but the plugin-loading and icon-generation stages that were failing both now succeed). If you still hit an error after pulling these fixes, it's a new one — paste the output.

**Also found while investigating (unrelated to the device build itself):** `settingsAndDataRights.test.ts`'s two per-kind notification-toggle tests called `getNotifications` without pinning `now`, so they silently relied on quiet hours (default 9pm-8am) NOT being active at whatever real time the suite happened to run — they failed when actually run at 10pm. Not a Sprint 12 regression and not an app bug (the app's own quiet-hours suppression during 9pm-8am is working as designed); it was a test-only gap. Fixed by pinning `now` to a fixed daytime timestamp in both tests.

**Known gaps carried forward from Sprint 11:** no remote crash-reporting SaaS
(Sentry, Bugsnag, etc.) is integrated — `app_error_log` only exists on the
device that actually errored, so a real user's crash is invisible to the
build team unless that specific device is later inspected; wiring a real
service is a genuine future dependency/vendor decision, not something this
codebase should decide unilaterally (AGENTS.md). Accessibility work this
sprint was "basics" only (a handful of contrast fixes and missing
`accessibilityRole` props) — not a full WCAG audit, per the sprint's own
"Safe to Carry Over" allowance. The "why" drill-down has no button on the
two genuine aggregate figures (Cash on hand, Money in/out) — by design,
since there's no single Business Event to open for a sum — they get a
plain-language explanation sentence instead.

**Known gaps carried forward from Sprint 10:** deleting an account/business
does not delete the underlying Supabase Auth user record — only its backup
data (Storage objects + `public.backups` rows). Removing the auth record
itself needs a server-side admin action (an Edge Function holding a
service-role key, which must never ship in this client) that has not been
built. There is still no Settings-screen UI to trigger a backup upload or
enter a recovery code to restore onto a new device — only recovery-code
*reveal* was added this sprint; Sprint 9's backup mechanism remains
code-complete but without a full owner-facing trigger. AI Autonomy and
Access & Team (Vol 7_7) remain entirely unbuilt, correctly (Phase 2, Vol
0_1 §4 / Vol 8_1 §4) — no placeholder toggle for either.

**Known gaps carried forward from Sprint 9:** no backup scheduling
(on-background/periodic) wired up yet; connectivity detection is a
polling approximation (`fetch` + `AppState`), not real-time OS-level
network events, a deliberate trade-off to avoid a new dependency.

**Known gaps carried forward from Sprint 8:** only the vendor-category
mapping heuristic is implemented — `customer_payment_behaviour`/`other`
pattern types exist in the schema (Vol 11_1 §7) but have no producing code
yet, matching Vol 4_2 §3.1's explicit "just this one heuristic" Phase 1
scope. Notifications are computed fresh per call, not persisted to a
delivery log or pushed via the OS notification tray (no
`expo-notifications` dependency added). Quiet hours and per-kind toggles
are now fully owner-configurable (Sprint 10, `appSettingsRepository.ts` +
`SettingsScreen.tsx`) — the hardcoded-default/no-configurability gap this
paragraph used to describe is closed. There is still no urgent-item bypass
of quiet hours, and Awareness/Positive-insight notification categories
(Vol 7_5 §2) are still not built.

**Known gaps carried forward from Sprint 7:** partial settlement of a
receivable/payable is not supported — only an exact full-amount match
reconciles (0.005 tolerance); AI Workspace Q&A turns are not persisted to
`ai_interpretations` (explainability is satisfied instead via the inline
`sources` array returned with each answer); Purchase Order and Refund/
Sale-Cancelled/Purchase-Returned flows are still not built (carried from
Sprint 6); and "overdue"/"upcoming" remain a `captured_at`-age proxy, not
real due-date ageing (Phase 2/3, per Vol 0_1 §5/§6 precedent).

## Notes for whoever picks this up next

- The `@/*` import alias (e.g. `@/db/client`) is wired in `tsconfig.json`
  (type-checking), `babel.config.js` via `babel-plugin-module-resolver`
  (Metro bundler resolution at runtime), and `package.json`'s
  `jest.moduleNameMapper` (test resolution) — three places, all three need
  to stay in sync. A Sprint 1 gap where only the `tsconfig` side existed
  was caught and fixed in Sprint 2; don't reintroduce it if the alias
  config ever moves.
- `SqlDb` (`src/db/types.ts`) is async throughout because op-sqlite's real
  API is Promise-based end to end — there is no local synchronous execute
  in the installed version. Keep new repository functions async to match.
- `runMigrations` (`src/db/migrations.ts`) now skips any migration version
  already recorded in `schema_migrations`, rather than replaying every
  migration's SQL on every app launch. This matters starting with migration
  3, which does a SQLite table-rebuild (to widen a CHECK constraint) that
  must only ever run once — see that migration's comment before adding
  another one that changes an existing constraint.
- BusinessData has no immutability trigger of its own; it is made
  effectively immutable by *ordering* — the AI pipeline always finalises
  BusinessData and posts its LedgerEntry rows before setting the parent
  BusinessEvent to `confirmed`. See `finalizeCategory` (renamed from
  `finalizeExpenseCategory` in Sprint 6) in `src/ai/capturePipeline.ts`
  before adding any code path that could touch `business_data` after its
  event is confirmed.
- The local heuristic AI provider is a genuine placeholder, not a shortcut
  meant to stay — it exists so the pipeline is demoable without a key. It
  is deliberately capped at 0.85 confidence (below the 0.90 auto-record
  threshold) so it can never fully bypass human review.
- Migration 4 (Sprint 4) relaxes the confirmed-event trigger to allow
  exactly one additional write: setting `superseded_by` from NULL to a
  value, with every other column required to stay byte-identical. This
  closed a real gap — Vol 4_0 §7 documents that a correction sets
  `superseded_by` on the original confirmed event, but the original
  migration 2 trigger blocked that write along with everything else. If a
  future sprint needs another exception to immutability, extend this same
  pattern (a new migration, an explicit allowed-transition clause) rather
  than loosening the trigger's `WHEN` condition broadly.
- Correcting an already-confirmed capture (`correctConfirmedCapture`,
  renamed from `correctConfirmedExpense` in Sprint 6, now works for any of
  Expense/Sale/Purchase) never edits `business_data` or the original
  ledger postings in place — it posts reversal entries (opposite
  direction, `reversal_of` set) and a brand-new confirmed
  BusinessEvent/BusinessData/ledger postings under the corrected category,
  then links the original forward. `confirmCategory` (Sprint 3 as
  `confirmExpenseCategory`, generalised in Sprint 6) is the separate,
  simpler path for a still-*unconfirmed* draft/needs_clarification event —
  don't merge the two; they have different data-integrity guarantees.
- Sync workflow reminder (bit twice now — README in Sprint 3, `.env.example`
  in Sprint 4): after any direct edit to a file on the mounted project path
  outside of the `$HOME` scratch copy used for iteration, copy that file
  back into scratch immediately, or the next `rsync scratch→mnt` will
  silently revert it. Diff scratch vs. mnt before every sync from now on.
- Documents are stored as base64 BLOBs inside the SQLCipher-encrypted
  SQLite database (`document_blobs`), not as loose files — see migration 5
  in `src/db/migrations.ts` and Vol 7_6 §6 for why. `documentRepository.ts`
  is the only place that should read/write that table directly.
- Photo capture creates the `BusinessEvent` row WITHOUT a `BusinessData`
  row (`createQueuedPhotoEvent`) — amount/category aren't known yet.
  `attachExpenseBusinessData` adds the data row once extraction succeeds or
  the owner completes the fallback form. This is the one legitimate
  event-without-data state in the schema; every other capture path creates
  both together. Don't assume every `business_events` row has a matching
  `business_data` row when writing new queries against these tables.
- `classifyAndRoute` (private to `capturePipeline.ts`) is the single
  implementation of confidence-threshold routing, shared by the text flow
  (`runCaptureInterpretation`, domain-parameterised as of Sprint 6), the
  photo-complete-extraction flow, and the photo-fallback-form flow
  (`completePhotoCapture`, both still Expense-only). Domain is read off
  `event.domain_hint` rather than threaded as a separate argument — if
  Sprint 7 adds a Banking pipeline, prefer this same shape (derive domain
  from the event, add Banking to `BusinessDomain`, add a
  `banking_categories`/rules block to `accounting_rules.json`, extend
  `ledgerAccountsForDomain`) rather than a fourth bespoke pipeline file.
- Sprint 6 generalisation, if you're diffing against Sprint 5: `ai/expensePipeline.ts` → `ai/capturePipeline.ts`;
  `ExpensePcbInput`/`buildExpensePcb` → `CapturePcbInput`/`buildCapturePcb`
  (now domain-parameterised); `ExpenseClassificationResult` →
  `CategoryClassificationResult`; `AiProvider.classifyExpense` →
  `AiProvider.classify`; `ExpenseInterpretationDecision`/`Outcome` →
  `InterpretationDecision`/`Outcome`; `runExpenseInterpretation` →
  `runCaptureInterpretation` (+ required `domain` field);
  `confirmExpenseCategory` → `confirmCategory`; `correctConfirmedExpense`
  → `correctConfirmedCapture`; `recordExpenseCaptureQueued` →
  `recordCaptureQueued` (in `businessEventRepository.ts`);
  `ScriptedExpenseProvider` → `ScriptedCaptureProvider`. Class names
  `AnthropicExpenseProvider`/`LocalHeuristicExpenseProvider` and factory
  `getDefaultExpenseProvider` were deliberately **not** renamed (cosmetic
  only, would've touched every import for no functional gain) — treat the
  leftover "Expense" in those names as a known, low-priority mismatch, not
  a bug. `ExpenseCaptureInput` is gone; use `CaptureQueuedInput` (adds a
  required `domain` field) instead.
- `ai/expensePipeline.ts` and `db/__tests__/expensePipeline.test.ts` still
  exist on disk as trivial shims/stubs pointing at the renamed files —
  this sandbox's mounted project folder cannot delete or rename files (see
  the sync-workflow note below), so a true rename wasn't possible here.
  Delete both by hand on your own machine once you've confirmed nothing
  external still imports the old path; nothing in this codebase does.
- A recurring test-fragility bug was found and fixed this sprint: a test
  hardcoded "2026-08-01" while the code under test stamps rows with the
  real system clock (`new Date()`) — it silently depended on the sandbox's
  real date matching that string, and broke the moment real time crossed
  into the next day. Fixed by deriving the expected date from `new Date()`
  in the test itself. Any future test asserting on a generated id/timestamp
  should do the same — never hardcode a date and assume "today" will match
  it.
- **Sprint 7 sync-drift incident (dated 2026-08-02), the sharpest version
  of the sync-workflow note above yet:** mid-sprint, an `Edit` call against
  `pcb.ts` on the mounted project path landed against a STALE copy of that
  file (scratch had already moved ahead with the new `buildWorkspacePcb`
  function, not yet rsynced to mnt). A follow-up `cp mnt→scratch`, intended
  as a recovery, instead overwrote the newer scratch file with the stale
  one — silently deleting `buildWorkspacePcb` from disk. Caught by grepping
  scratch for the function name and finding it gone; fixed by re-appending
  the function body via a bash heredoc directly against scratch. **The
  rule this produced, followed for the remainder of Sprint 7 and worth
  keeping permanently: during active development, do ALL source-code edits
  via bash (heredoc/python) directly against the `$HOME` scratch copy only.
  Reserve the `Edit`/`Write` tools for documentation files, and only apply
  them at a sprint's finalisation stage** — after every source file is
  already verified (`tsc`/`eslint`/`npm test`) and freshly rsynced, so mnt
  and scratch are known-identical before any tool touches the mnt path
  directly. The previous, weaker version of this note ("diff before every
  sync") wasn't enough on its own to prevent this — the stronger
  edit-location discipline is the actual fix.
- Sprint 7 additions, if you're diffing against Sprint 6: new files
  `src/db/bankingRepository.ts`, `src/ai/cfoGuidance.ts`,
  `src/ai/workspacePipeline.ts`, `src/ai/providers/scriptedWorkspaceProvider.ts`,
  `src/components/BankTransactionForm.tsx`; migration 6
  (`bank_reconciliations` table); `LedgerEntryInput.idVariant` (optional,
  backward-compatible); `AiProvider.answerFinancialQuestion` (optional
  method) and `WorkspaceAnswerResult` in `types.ts`; `buildWorkspacePcb` in
  `pcb.ts`; `ManualOnlyDomainHint` stayed as `Exclude<DomainHint,
  "expense"|"sale"|"purchase">` (still includes `"banking"`) even though
  the UI no longer offers it as a manual-form option, because the
  `isAiInterpretedDomain` type guard narrows to that same type — narrowing
  `ManualOnlyDomainHint` further broke the guard's else-branch; instead
  `domainHintToDataType` gained a defensive `case "banking": throw ...`
  documented as UI-unreachable. `AnthropicExpenseProvider`/
  `LocalHeuristicExpenseProvider` still carry the Sprint 6 "Expense" naming
  mismatch (now also implementing Workspace Q&A) — same known,
  low-priority cosmetic gap, not a bug.
- Sprint 8 additions: new files `src/db/businessKnowledgeRepository.ts`,
  `src/ai/notificationEngine.ts`; migration 7 (`business_knowledge_entries`
  table). `confirmCategory`'s and `correctConfirmedCapture`'s signatures
  widened slightly -- `confirmCategory`'s `event`/`data` Pick types now
  also require `business_id`/`counterparty_name` (both already present on
  every real caller's object; no caller changes were needed) so the
  function can feed the Business Knowledge heuristic without a second DB
  round-trip. Design decision worth preserving if you touch
  `classifyAndRoute`: the trust boost requires the AI provider's OWN guess
  to already agree with the trusted mapping before boosting -- it never
  substitutes the mapping's category when the provider disagrees or
  recognised nothing at all. This was a deliberate choice over the simpler
  "just trust the mapping outright once trusted," made specifically to
  blunt the Sprint 8 risk register's "over-eager auto-categorisation
  erodes trust" risk; don't remove the agreement check to "simplify" this
  later without re-reading that risk note. `businessKnowledgeRepository.ts`'s
  `knowledgeEntryId` follows the same deterministic-id-via-slug pattern as
  `ledgerRepository.ts`'s `ledgerEntryId` (Sprint 7) -- a repeat vendor
  always resolves to the same row rather than needing a
  lookup-then-conditional-insert dance at every call site.
- Sprint 9 additions: new files `src/db/backupRepository.ts`,
  `src/db/backupService.ts`, `src/lib/connectivity.ts`,
  `src/hooks/useAutoResume.ts`, `src/components/ConnectivityBanner.tsx`;
  `InterpretationDecision` gained `"queued_retry"`; `classifyAndRoute`
  gained an `options.isOnline` parameter and now wraps the provider call in
  try/catch; `runExpensePhotoInterpretation`'s extraction logic was
  extracted into a private `extractAndRoutePhoto` so
  `resumeQueuedPhotoCaptures` can re-enter it without recreating the event/
  document; `businessEventRepository.ts` gained `getBusinessEventById` (a
  non-joined lookup, needed because `getActivityItemByEventId`'s INNER
  JOIN on `business_data` returns null for a photo capture that never
  reached extraction); `db/client.ts` gained `getDeviceEncryptionKey`.
  **Two deliberate no-new-dependency design decisions worth preserving:**
  (1) connectivity detection is a polling `fetch`-based probe
  (`lib/connectivity.ts`), not `expo-network`/`NetInfo` -- neither was an
  existing dependency, and AGENTS.md gates new production dependencies
  behind approval; if real-time OS-level connectivity events are ever
  needed, that is the point to bring one of those to the user for
  approval, not to quietly add it. (2) the backup blob is encrypted by
  reusing SQLCipher (opening a small temp op-sqlite DB with the SAME
  device key already used for the main database) rather than adding a
  crypto library to hand-roll a second cipher -- SQLCipher is already this
  project's one vetted encryption mechanism. Both were reasoned through in
  full rather than picked casually; re-read `connectivity.ts`'s and
  `backupService.ts`'s own module comments before changing either
  approach. Also worth knowing: `resumeQueuedCaptures` and
  `resumeQueuedPhotoCaptures` are two SEPARATE functions (unified only by
  the thin `resumeQueuedWork` wrapper) because they resume different
  states -- an event that already has BusinessData (text captures, or a
  photo whose extraction already succeeded) vs. one that doesn't (a photo
  that never got as far as extraction) -- `getActivityItemByEventId`'s
  INNER JOIN is what makes that distinction meaningful; don't collapse the
  two into one query without re-deriving that distinction first.
- Sprint 10 additions: new files `src/db/appSettingsRepository.ts`,
  `src/db/exportRepository.ts`, `src/db/exportService.ts`,
  `src/db/deletionRepository.ts`, `src/db/deletionService.ts`,
  `src/lib/auth.ts`; migration 8 (`app_settings` table);
  `ProfessionalContextBundle` gained a required
  `sensitivity_classification` field (`ai/types.ts`), populated as
  `"standard"` in both `pcb.ts` builder functions. `getNotifications`
  (`ai/notificationEngine.ts`) gained `notifyActionNeeded`/
  `notifyConfirmationRequest` options, defaulting to `true` each so
  omitting them exactly reproduces Sprint 8's behaviour — `DashboardScreen.tsx`
  now reads `appSettingsRepository.ts`'s saved settings once per load and
  passes all five notification-related fields through as options, closing
  the loop between "settings are persisted" and "settings actually change
  what the owner sees."
  `deletionRepository.ts`'s `LOCAL_DELETION_TABLES` has a compile-time
  check (`_AssertAllSnapshotTablesCovered`) that fails to type-check if a
  future table gets added to `backupRepository.ts`'s `SNAPSHOT_TABLES` but
  not to this deletion list — if you add a new Phase 1 data table, add it
  to BOTH lists, and let the type error catch you if you forget the second
  one. `exportRepository.ts` deliberately does NOT reuse
  `listRecentActivity`'s default limit (Phase 1's dashboard/recent-activity
  scale assumption) — a full export needs every event, not just the
  newest ones, hence its own much larger `EXPORT_ACTIVITY_LIMIT`. Auth
  (`lib/auth.ts`) is intentionally thin — email/OTP only, no password
  field anywhere, avoiding a password-reset flow entirely (Vol 11_0 §5's
  own stated Phase 1 choice) — and is surfaced only inside Settings, never
  as an app-wide gate (Vol 4_4 §2). `deleteRemoteAccountData`
  (`deletionService.ts`) cannot delete the Supabase Auth user record itself
  — that requires a service-role-keyed admin action, which must live in a
  server-side Edge Function this project does not yet have (a service-role
  key must never be embedded client-side, per this project's own strict
  secrets rule) — don't be tempted to "just add the service role key to
  `.env`" to close this gap; build the Edge Function instead.
- Sprint 11 additions: new files `src/db/errorLogRepository.ts`,
  `src/db/diagnosticsRepository.ts`, `src/lib/crashReporting.ts`,
  `src/ai/whyDetail.ts`, `src/components/WhyButton.tsx`; migration 9
  (`app_error_log` table), migration 10 (`app_settings.last_backup_at`
  column, a plain `ALTER TABLE ADD COLUMN` — no rebuild needed since it's
  an unconstrained nullable column, unlike migration 3's CHECK-constraint
  change). `capturePipeline.ts`'s two existing (Sprint 9) `catch` blocks
  around `provider.classify`/`provider.extractExpenseFromImage` now also
  call a new private `logAiCallError` helper before leaving the event
  queued — this ADDS observability, it does not change Sprint 9's
  queued/retry behaviour at all. `backupService.ts`'s `uploadBackup`
  gained a required `businessId` parameter (needed to call
  `recordBackupCompleted`) — there were no other call sites to update
  (confirms the still-open "no UI trigger for backup upload" gap).
  `WorkspaceScreen.tsx`'s `handleAsk` previously had NO error handling at
  all around `askWorkspaceQuestion` — a real, previously silent gap, now
  fixed with try/catch + logging + an inline error message.
  `ai/whyDetail.ts`'s `WhyConfidenceState` is derived PRIMARILY from
  `event.status`, using the latest `ai_interpretations` row only as
  supporting detail/tie-break (e.g. `confirmed` + `latest.decision ===
  "auto_record"` → confident; `confirmed` with anything else → owner
  reviewed it) — deriving from `latest.decision` alone would be wrong,
  since that field is frozen at whatever the LAST interpretation attempt
  decided and doesn't reflect a subsequent owner action like
  `confirmCategory`. If you touch this function, keep `event.status` as
  the primary switch. A genuinely undocumented Sprint 5 gap was found and
  fixed while re-reviewing capture failure handling with fresh eyes (this
  sprint's own task): `PhotoCapture.tsx`'s `handleCapture` — the camera
  hardware call itself, `takePictureAsync` — had zero error handling; a
  camera failure threw straight past the component with no owner-facing
  state at all. This is a different failure mode from Vol 7_1 §5.1's
  "extraction fails" cases (which happen further downstream, after a photo
  was already captured successfully) and was missed by Sprint 5's own
  review at the time. Also found while adding migration 10: the existing
  `migrations.test.ts` asserted `applied.map((r) => r.version).sort()`
  with NO comparator — `Array.prototype.sort()` defaults to lexicographic
  string comparison, which silently "worked" for versions 1-8 (all single
  digits) and broke the instant a two-digit version (10) existed
  (`[1, 10, 2, 3, ...]`). Fixed to `.sort((a, b) => a - b)` — a real latent
  test bug, not a Sprint 11 regression; watch for the same mistake in any
  future numeric `.sort()` in this codebase.
- Sprint 12 additions: new files `src/components/OnboardingFlow.tsx`,
  `src/onboarding/onboardingValidation.ts`; `src/db/client.ts` gained
  `getHasCompletedOnboarding`/`setOnboardingCompleted` (a device-level
  SecureStore flag, deliberately not a business-data table row — "has this
  device seen onboarding" has no `business_id` to key on before the very
  first launch). `App.tsx` now checks that flag once on mount and renders
  `OnboardingFlow` ahead of `AppNavigator` until it's set. The bug-bash
  pass's one real finding: `capturePipeline.ts`'s `resumeQueuedWork` gained
  a module-level per-business in-flight `Set` guard — two overlapping
  calls for the same business (a real risk under flapping connectivity,
  since `useAutoResume` re-fires on every offline→online transition) used
  to both proceed and both call `recordAiInterpretation`, which has no
  idempotency protection unlike `ledger_entries`/`bank_reconciliations`
  (both use deterministic ids + `INSERT OR IGNORE` specifically to survive
  this). If you ever refactor `resumeQueuedWork` away from this guard,
  either restore an equivalent claim mechanism or give
  `ai_interpretations` its own idempotent id — don't just remove the Set
  without replacing what it protects. Everything else reviewed in the bug
  bash (confirm/correct, reversal/reconciliation arithmetic, migration
  idempotency, deletion safety) had no issues — see the Sprint 12 section
  above for what was checked.

### Android SQLCipher key-generation fix (2026-08-03)

The first Android runtime verification found that `globalThis.crypto.getRandomValues` was unavailable in the React Native runtime. Its empty fallback caused the first Business Profile save to fail with `[OP SQLite] using SQLCipher encryption key is required`. The app now uses Expo's native `expo-crypto` `getRandomBytesAsync` API for the 32-byte database key and 16-byte local business identifier, and rejects an invalid generated value explicitly. This is a native-module change, so rebuild the development client with `npx expo run:android` rather than relying on a Metro reload alone.
