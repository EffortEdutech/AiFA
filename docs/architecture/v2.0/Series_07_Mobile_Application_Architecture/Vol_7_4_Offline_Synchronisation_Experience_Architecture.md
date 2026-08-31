# AIFA — Offline & Synchronisation Experience Architecture
## Volume 7_4 — Series 7: Mobile Application Architecture — Version 2.0

**Status:** Complete
**Realism correction applied:** Yes — see Vol 0_1, Section 3.1

---

## 1. Purpose

This volume defines how offline operation and synchronisation feel to the owner, implementing the technical model in Vol 4_4 as a mobile experience.

## 2. Offline Guarantees

| Capability | Available Offline? (Phase 1) |
|---|---|
| Business Event capture (all modes except passive cloud-forwarded messages) | Yes — always stored locally with a "queued" state (Vol 0_1, Section 7) |
| Dashboard viewing | Yes — reads local Financial Data |
| Document/receipt viewing | Yes — reads local encrypted storage |
| Bookkeeping interpretation (turning a captured event into a recorded entry) | No — requires cloud AI; queues and processes automatically once online |
| AI Workspace conversation | No — requires cloud AI; the app states this plainly rather than offering a degraded local chat |
| Sync to other devices / cloud backup | No — queues until connectivity returns |

Phase 2 may reduce the "No" rows above once local classification is validated (Vol 5_1, Section 2); Phase 1 does not promise capability it cannot deliver at a trustworthy quality bar.

## 3. Connectivity State Indication

The app clearly, but unobtrusively, indicates when it is operating offline and when items are queued for sync or interpretation — consistent with the trust principle in Vol 1_2, the owner should never be confused about whether their data is safely captured (it always is, locally, the instant they log it) versus interpreted/backed up (which requires connectivity in Phase 1). A captured-but-not-yet-interpreted event is shown as "saved, will process when back online" — never silently presented as if it were already understood.

## 4. Sync Resumption Flow

```text
Connectivity restored
        ↓
Queued Business Events / Financial Data / Business Knowledge deltas sync (Vol 4_4)
        ↓
Any deferred cloud-AI-dependent advisory tasks resume
        ↓
Owner notified only if sync surfaces something needing attention (e.g., a conflict)
```

## 5. Sprint 9 Concrete Implementation

Section 2's guarantees are enforced, not just stated: prior to this sprint, Expense/Sale/Purchase text capture had NO offline handling at all (`runCaptureInterpretation` called the AI provider unconditionally, so a network failure would throw past the whole pipeline); photo capture had an `isOnline` parameter but the capture screen hard-coded `true`. Both are fixed in `app/src/ai/capturePipeline.ts`: `classifyAndRoute` accepts an `isOnline` flag and wraps the actual provider call in try/catch, so either an explicit offline signal or a genuine network failure mid-call leaves the Business Event `queued` — never stuck at `processing` with no defined path forward. Banking (Vol 6_4) needed no change: it is manual/deterministic with no AI call to ever get stuck on.

Section 4's Sync Resumption Flow is implemented as three functions: `resumeQueuedCaptures` (text captures, and photo captures whose extraction already succeeded — anything that already has a BusinessData row), `resumeQueuedPhotoCaptures` (photo captures that never reached extraction — re-fetches the stored image bytes from `document_blobs` rather than asking the owner to re-photograph anything), and the unified `resumeQueuedWork`. `app/src/hooks/useAutoResume.ts` calls `resumeQueuedWork` once on app mount (covering the Sprint 9 risk register's "app killed mid-queue" scenario — a relaunch is a fresh mount) and again on every offline-to-online transition.

Section 3's connectivity indication is `app/src/components/ConnectivityBanner.tsx`, rendered once at the app root rather than per-screen, backed by `app/src/lib/connectivity.ts` — a dependency-free polling `fetch` probe against the configured Supabase URL, re-checked on `AppState` foreground transitions. This is a deliberate trade-off, stated in that file's own comment: it is NOT a real-time OS-level connectivity event stream (which `expo-network` or `@react-native-community/netinfo` would provide) — neither was an existing project dependency, and adding one requires the approval AGENTS.md's "no new production dependencies" rule calls for. If real-time transition detection becomes a real requirement, that is the point to raise the dependency question, not to quietly add one.

## 6. Relationships to Other Volumes

- Vol 0_1 (MVP & Phased Delivery Roadmap) Section 3.1 is the authority for the Phase 1 offline scope in Section 2.
- Vol 4_4 (Local-First Storage & Synchronisation) defines the technical sync model this volume presents.
- Vol 8_4 (Synchronisation & Cloud Services Architecture) details the backend service side.
- Vol 5_1 (AI Runtime Architecture) confirms there is no local-model fallback in Phase 1.

---

*End of Volume 7_4.*
