# AIFA — Observability & Diagnostics Architecture
## Volume 8_6 — Series 8: Platform Services Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

This volume defines how AIFA's own health, performance, and error conditions are made visible — to the platform operator for reliability, and to the owner where relevant to trust.

## 2. Observability Domains

| Domain | What Is Tracked |
|---|---|
| Engine health | Latency and error rates for BIE, FIE, CAE, KRCE (Series 2, 3) |
| AI Runtime health | Model availability, local vs. cloud fallback frequency (Vol 5_1) |
| Sync health | Backup success, sync latency, conflict frequency (Vol 8_4) |
| PKA integrity | Validation failures, rollback events (Vol 8_5) |
| Owner-facing confidence | Rate of low-confidence flags requiring clarification (Vol 5_3, Vol 1_4 Section 7) |

## 3. Privacy-Respecting Diagnostics

Diagnostic telemetry is designed to capture operational health signals (latencies, error codes, confidence-score distributions) without transmitting raw business content — consistent with the minimisation and security principles in Vol 8_2 and Vol 3_1.

## 4. Owner-Facing Diagnostics

A limited diagnostics view is available to the owner (via Vol 7_7 Settings) showing sync status, last backup time, and installed PKA version/health — giving the owner visibility into the system's operational trustworthiness without technical noise.

## 5. Sprint 11 Concrete Implementation

Section 1's "basic crash/error logging only; full dashboard is Phase 2" (Vol 0_1 Section 8_6 note) is implemented dependency-free: `app/src/lib/crashReporting.ts` installs a global JS error handler via React Native's own built-in `ErrorUtils` — not a third-party crash-reporting SaaS (Sentry, Bugsnag, etc.). That deliberate omission mirrors the no-new-production-dependency posture Sprints 8-10 already took for notifications, connectivity, encryption, and file sharing (AGENTS.md) — adding a remote crash-reporting vendor is both a new dependency and a third-party data-sharing decision, neither of which this codebase decides unilaterally. The previously-registered global handler (RN's own fatal-error behaviour) is always still invoked after logging, so this can only add visibility, never suppress a crash.

Section 2's "AI Runtime health" and "Owner-facing confidence" rows are covered by extending `capturePipeline.ts`'s existing (Sprint 9) try/catch blocks around `provider.classify`/`provider.extractExpenseFromImage`: a thrown provider error now writes a row to a new `app_error_log` table (migration 9) in addition to leaving the event queued — the queued/retry behaviour itself is unchanged. `WorkspaceScreen.tsx`'s Q&A call, which had no error handling at all before this sprint, is now wrapped the same way.

Section 3's "privacy-respecting diagnostics" is upheld structurally: `errorLogRepository.ts`'s `LogAppErrorInput.context` is documented and used only for identifiers (a `business_event_id`, a domain, an operation name) — never amounts, counterparty names, or captured descriptions. The one Workspace Q&A error log call logs the question's character length, never the question text itself.

Section 4's "limited diagnostics view... showing sync status, last backup time" is a new "Diagnostics" card in `SettingsScreen.tsx` (Vol 7_7), backed by `db/diagnosticsRepository.ts`'s `getDiagnosticsSummary`: count of Business Events still `queued`/`processing` plus the oldest one's age, last backup time (a new local `app_settings.last_backup_at` column, migration 10, set by `backupService.ts`'s `uploadBackup` on success — this local record answers "when did MY device last back up" without a network round-trip), and a rolling 24-hour error count. Finance PKA version display was already built in Sprint 10 and is not duplicated here.

**Honest limitation, stated not hidden:** because the error log is local-only, a real user's crash is only visible if that specific device is later inspected — there is no central collection point for the build team the way a real crash-reporting SaaS would provide. This is the direct tradeoff of the no-new-dependency decision above, not an oversight.

## 6. Relationships to Other Volumes

- Series 2 and 3 (Core Architecture, Finance PKA) are the primary components monitored here.
- Vol 8_2 (Security & Data Protection) constrains what diagnostic data may contain.
- Vol 7_7 (Settings & Business Configuration) surfaces owner-facing diagnostics.
- Vol 5_3 (AI Context Management) Section 4 is the explainability requirement whose data this volume's error/interpretation logging supports.

---

*End of Volume 8_6.*
