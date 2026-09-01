# Sprint 20 Runbook — Offline Reconciliation Backstop, Hardening & Pilot

Authorized 2026-09-01 via "Proceed Sprint 20. Bismillah...". This is the last sprint in the Phase 2 (Web Platform & Multi-Device Sync) plan.

## 1. What was built

### 1.1 The reconciliation engine (`packages/core/src/sync/reconciliation.ts`, new)

Implements Vol 12_1 §7 end to end, split exactly as §7 itself is split:

- **§7.1 (append-only entities — never conflict).** No special handling needed or added: once a demotion is discovered, `runSyncCycle` already stopped pushing (Sprint 17's `skippedDueToDemotion`); this sprint's `reconcileAndReviewDemotedOutbox` simply lists whatever remains in the outbox after §7.2's resolution (below) as `safeToSendItems` — safe to send exactly as any other queued write, per §7.1's own words.
- **§7.2 (the one real conflict — a status transition).** This is the substantive new work. See §2 below for the bug it closes and exactly how.
- **§7.3 (low-stakes upserts).** No data is ever discarded; `buildProvenanceNotes` cross-references a still-queued `business_knowledge_entry`/`app_settings` item against what this pull cycle already applied for the same id, and attaches an informational note ("also updated on another device on `<date>`") without blocking the send — whichever push reaches the server last simply wins by `server_seq`, which is already true by construction once the item is sent.

`runSyncCycle` (`syncClient.ts`) now calls `reconcileAndReviewDemotedOutbox` automatically, inside its existing demotion-detection branch, immediately after the pull that discovered the demotion — not gated behind any UI action. This is deliberate: §7.2's correction is a data-safety fix to THIS device's own local view, and per this module's own header comment, that should never wait on the owner noticing a review screen. Only *sending* the safe remainder waits for the owner (`DemotedOutboxReview` component, §1.3 below).

`PullResult` (`syncClient.ts`) gained two new fields — `failedEnvelopes` and `appliedEnvelopes` — so reconciliation can see what a pull actually did without re-deriving it. Previously a failed envelope apply was silently swallowed (correct on its own, per Sprint 16/17's own comments) but invisible to any caller; now it is recorded, not just discarded.

### 1.2 The §7.2 fix itself, and the bug it closes

Before this sprint, a demoted device's own local database would end up **permanently wrong** after this exact backstop scenario, not just temporarily confused:

1. Device Y (active, offline) locally corrects Business Event E. Its local trigger (migration 4, `businessEventRepository.ts`) accepts the change — correctly, at the time, since Y's own local row was still `NULL`.
2. Device B (now the real active device) independently corrects the SAME event E and pushes first.
3. Y reconnects. Pulling B's status-transition envelope for E fails — Y's local row is already non-`NULL` (set by Y's own not-yet-pushed write), so migration 4's trigger correctly rejects the incoming pulled envelope (see `applyEnvelope.ts`'s own comment, already anticipating this). Before this sprint, that rejection was just silently swallowed and nothing else happened.
4. Result: Y's local database permanently disagreed with the server-canonical truth (it kept showing Y's own losing correction as the winner), and — worse — if Y's queued correction bundle were ever sent later, its business_event/business_data/ledger_entry INSERT envelopes (§7.1 entities, "never conflict by construction") would have been accepted everywhere as ordinary new history, silently double-posting the correction's ledger effect on every device in the business.

The fix (`resolveStatusTransitionConflicts`): when a pull's failed envelope is a status transition that matches one of THIS device's own still-queued (never pushed) status transitions for the same original event, this device's own local view is corrected to the winner — not left wrong. Concretely: the discarded correction's own new ledger entries + BusinessData + BusinessEvent rows are deleted locally (purely local deletes — the correction bundle was never pushed, so nothing anywhere else has ever seen it); the original event's `superseded_by` is reset to `NULL` via a privileged, narrowly-scoped override (`forceResetSupersededByForReconciliation`, `businessEventRepository.ts` — the migration-4 trigger is dropped, the raw `UPDATE` runs, the trigger is recreated in a `finally` block, so no other write anywhere in the app can ever run while it is down); the winning transition is then re-applied through the exact same trigger-enforced path every other device uses; and every outbox envelope belonging to the discarded bundle (the status transition itself, plus the correction's own inserts — but deliberately NOT its reversal ledger entries, which self-dedupe against the winner's own reversal via their shared deterministic `{id}-REV` id, so leaving them queued and eventually sending them is harmless) is removed so none of it can ever leak to another device.

The migration-4 trigger's exact DDL is now a named export (`BUSINESS_EVENTS_IMMUTABLE_TRIGGER_SQL`, `migrations.ts`) shared by the migration itself and this override, so the override can never silently drift from the real trigger — migration 4's own shipped statement is unchanged (still never edited, per this file's own discipline), just sourced from the shared constant.

### 1.3 Owner-facing review UI (both platforms)

New `DemotedOutboxReview` component (`app/src/components/DemotedOutboxReview.tsx`, `web/src/components/DemotedOutboxReview.tsx`) implementing Vol 12_1 §6a.4's "N items captured on this device before it was deactivated — review before sending":

- Tells the owner when a conflict was found AND ALREADY resolved on their behalf (never asks them to adjudicate it — §7.2 already did).
- Lists the count of remaining, genuinely safe items and offers "Send now" (`sendReviewedDemotedOutbox`, both `syncService.ts` files — a direct `pushOutbox` call, deliberately bypassing `runSyncCycle`'s own demotion guard, since by review time everything left is already conflict-free).
- Shows §7.3's provenance notes.

Wired into both `App.tsx`s next to the existing `ReadOnlyBanner`, fed by `useSyncResume.ts` (mobile) / `useWebSync.ts` (web) now also returning the latest `DemotedOutboxReview` alongside their existing return values.

## 2. Bug Bash

A structured pass across the sync/lock/handoff system built in Sprints 14-19, focused specifically on data loss, silently duplicated Business Events, and incorrect ledger figures (this sprint's own stated bar).

**Found and fixed:** the §7.2 double-counting / permanently-wrong-local-view bug described in §1.2 above — found by writing the real offline-then-reconnect test this sprint's own Definition of Done requires, not by inspection.

**Found, NOT fixed this sprint — disclosed, not hidden:** `generateBusinessEventId` (`businessEventRepository.ts`, Sprint 2) derives an event's id purely from a `COUNT(*)` of that device's OWN local rows for the current date (`BE-{date}-{4-digit count+1}`). Two devices that diverge from the same synced baseline — exactly this sprint's own backstop scenario — and each independently capture their Nth event of the day can generate the IDENTICAL id for two completely unrelated Business Events. Because `applyPulledBusinessEvent`'s pull-side apply is `INSERT OR IGNORE INTO business_events (id, ...)`, whichever device's envelope has the LOWER `server_seq` wins everywhere else; the other device's genuinely different, unrelated capture is silently dropped on every device except its own originator. This is exactly the class of bug this bug-bash exists to catch (a silently duplicated-id collision causing a silently lost Business Event), and it was found empirically — the first version of this sprint's own §7.2 test tripped over it directly (both devices generated `BE-20260901-0002` for their independent corrections of the same day).

This was NOT patched ad hoc under this sprint's own time pressure — per this sprint's own risk table ("Real usage reveals a genuine gap ... log it explicitly as a follow-up ADR candidate rather than patching it ad hoc"), and because a real fix (making the id generation scheme collision-safe across devices, most likely by incorporating a device-scoped component) touches an id FORMAT that many other modules derive sub-ids from by string manipulation (`documentRepository.ts`'s `DOC-`, `bankingRepository.ts`'s `RECON-`, `ledgerRepository.ts`'s `BD-`/`LE-` stripping) and that several pre-Sprint-20 tests assert an exact 4-digit shape for. That is a bigger, riskier, more-than-one-file change than this sprint's own remaining scope should absorb under deadline pressure — it needs its own reviewed change, not a rushed patch inside this sprint's closing hours.

**Recommendation, logged as the top-priority follow-up:** before wide pilot rollout beyond the single-owner pilot this sprint's own plan calls for, either (a) make `generateBusinessEventId` incorporate a device-scoped component so two devices can never generate the same id, with every downstream `-prefix-stripping` derivation and every existing exact-format test updated together as one reviewed change, or (b) accept the narrow-probability risk for the pilot's own limited duration and revisit before wider release. This finding means the Definition of Done's "zero unresolved data-loss findings" bar is **not fully met** — one is found and open. Everything else the bug bash specifically targeted (the §7.2 conflict itself, the ledger double-counting it would have caused, reversal-entry idempotency) is resolved and tested.

No other data-loss, duplicate-event, or incorrect-ledger-figure findings surfaced in this pass.

## 3. Multi-Device Pilot — NOT run this sprint

Same disclosed limitation as Phase 1 Sprint 12's pilot/distribution items, and Sprint 18/19's live-Supabase/live-browser caveats: this sandbox has no real business owner, no real second device, and no real week of elapsed time to run Vol 12_1 §5's own required "at least one full week, real owner, 2+ of their own devices, usage log" exit criterion against. This cannot be fabricated or simulated in good faith — Exit Criterion 7 (Overview §5) requires genuine evidence from a real pilot, not a synthetic stand-in. **This is an owner-driven step, same class as Phase 1's pilot recruitment**, and remains open.

## 4. Exit Criteria Verification (`00_Sprint_Plan_Overview.md` §5)

1. Web capture/view through the Phase 2a slice, same `@aifa/core` logic as mobile — **met**, established Sprint 18, unchanged this sprint.
2. Registered/logged-in/active/synced as four separately visible states — **met**, established Sprint 19's Devices panel, unchanged this sprint.
3. Exactly one writer at a time, sync-before-write enforced, live re-check — **met**, established Sprints 15-17, unchanged this sprint.
4. Primary device forced takeover with lightweight confirmation, sync-before-write never skipped — **met**, established Sprint 17, unchanged this sprint.
5. The offline-write edge case reconciles correctly per §7's table, no silent data loss, no silently duplicated Business Events — **substantially met, with one disclosed open finding**: every row of §7.4 has a passing automated test (§5 below), the real offline-then-reconnect conflict scenario is proven end to end, and the double-counting bug this criterion exists to prevent is fixed. The `generateBusinessEventId` collision finding (§2 above) is a genuine, disclosed exception to "no silently duplicated Business Event" under a narrow, specific condition — not swept under this checkmark.
6. `sync_envelopes` live, metadata-only server visibility — **met**, established Sprint 14, unchanged this sprint.
7. Real multi-device pilot, one full week, usage log — **not met, not run this sprint** (§3 above). Owner action required.

## 5. Definition of Done — every row of §7.4 tested

All in `app/src/db/__tests__/sprint20_reconciliation.test.ts`, run against a real SQLite adapter (`node:sqlite`), 6/6 passing:

| §7.4 row | Test |
|---|---|
| BusinessEvent (create), BusinessData, LedgerEntry, Document, AiInterpretation — never conflict | "BusinessEvent (create) + BusinessData + LedgerEntry + Document + AiInterpretation captured on a demoted device all survive reconciliation untouched and reach the other device intact" |
| BusinessEvent status transition — the one real conflict | "a real offline-then-reconnect scenario: both devices independently correct the same event..." (the full end-to-end scenario, §1.2 above) — plus "a genuinely unrelated queued item... is never touched" (no over-broad discarding) and an idempotency test (a second demoted cycle before the owner reviews resolves zero NEW conflicts) |
| BusinessKnowledgeEntry — last-confirmed-write-wins | "a queued upsert from the demoted device is left safe to send (never discarded), with a provenance note..." |
| AppSettings — last-confirmed-write-wins | "a queued profile update from the demoted device is left safe to send, not silently dropped" |

Full regression after this sprint: 20/20 suites, **171/171 tests** (165 carried forward + 6 new), tsc clean on `app/`, eslint clean (zero errors, formatting warnings only, auto-fixed) on both `app/` and `web/`. `web/`'s own `npx vite build` and `npm run verify:sqljs-parity` both ran clean directly against this sprint's scratch copy (unlike Sprint 19, `web/node_modules` was present there this time); the mounted project (`~/mnt/00AiFA`) still has no `web/node_modules` installed, so `web/`'s checks were run against scratch's byte-identical, checksum-verified copy, same disclosed limitation as Sprint 19 — not fixed here either, since installing dependencies on the owner's actual working copy without being asked remains out of scope.

## 6. Not covered this sprint

- The real multi-device pilot (§3) — owner action required.
- The `generateBusinessEventId` cross-device collision fix (§2) — logged as the top-priority follow-up, deliberately not patched ad hoc under this sprint's own deadline.
- DEK rotation / full revocation (Vol 12_1 §12's own long-standing open item, unchanged).
- Realtime lock broadcast (still polling-based, per Sprint 16's own "safe to carry over" note, unchanged).

## After this sprint

Per the sprint plan's own closing note: Phase 2 (Web Platform & Multi-Device Sync) is complete against this plan's scope, with the two disclosed open items above (the pilot, and the id-collision finding) carried forward rather than hidden. The next planning artefact is either a Phase 2b full-parity scoping pass or a DEK rotation/revocation design pass — **not authorized to begin without the owner's fresh, explicit go-ahead**, same standing rule as every prior sprint boundary in this project.
