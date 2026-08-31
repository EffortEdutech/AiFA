# AIFA — Web Platform Architecture
## Volume 12_0 — Series 12: Web Platform Architecture — Version 1.0 (Proposed)

**Status:** Proposed — architecture design, not yet implemented. Written to the same standard as the Version 2.0 set but not yet built or verified against real code, unlike Series 1-11 which record what Sprints 1-12 actually shipped.
**Applies:** Vol 0_1 (MVP & Phased Delivery Roadmap), Vol 1_3 (Technology Architecture, Section 2's "web dashboard as a secondary, later surface"), Vol 11_0 (Technology Stack Decisions)
**Companion volume:** Vol 12_1 (Cross-Platform Data Synchronisation Architecture) — read together; this volume scopes the web application itself, Vol 12_1 designs the mobile-web data sync in full detail.

---

## 1. Purpose

This volume defines the architecture for a web version of AIFA, extending the product from mobile-only (Series 7) to mobile-plus-web while preserving the non-negotiable boundaries in Vol 0_0 Section 4 and the local-first, cloud-assisted principle in Vol 1_3 Section 3. Web was always anticipated ("web dashboard as a later addition," Vol 1_0, Vol 1_3) but never designed; this volume does that design work.

## 2. Why Web Changes the Architecture, Not Just the Surface

Every existing volume assumes exactly one durable local-first store per business (the phone). Adding a second, independently-usable client (a browser) breaks that assumption in a specific way: a browser has no equivalent of a mobile OS keychain, no guaranteed persistent storage (a user can clear site data, use a private window, or switch computers), and no native SQLCipher module. A web client therefore cannot be "just another local-first device" on the same trust model as the phone — it needs the cloud to act as a genuine second source of truth for reconciliation, not merely a backup target.

This is the central architectural consequence of this request, and it is deliberately elevated to an Architecture Decision Record rather than treated as a web-only implementation detail: see **ADR-002** in Vol 4_0_0, and the full design in Vol 12_1. Everything else in this volume follows from that decision.

## 3. Scope

### 3.1 What the web platform is

A companion, browser-based client for the same AIFA business account — not a separate product, not an admin-only tool. Same Business Events, same Finance PKA rules, same AI CFO guidance, same governance boundaries (Vol 0_0 Section 4) as the mobile app, viewed and operated from a browser.

### 3.2 What the web platform is not (Phase boundary, mirrors Vol 0_1's discipline)

- Not a rebuild of AIFA's business logic in a second, independently-maintained codebase (Section 5 addresses this directly).
- Not a relaxation of "the AI model never receives the full PKA or the full business database" (Vol 0_0 Section 4, item 2) — the web client still assembles a minimal Professional Context Bundle (Vol 3_1) exactly as the mobile client does (Section 6).
- Not multi-user/team access. Web is a second *device* for the same single-user business account (Vol 8_1's Phase 1 single-user scope still holds); team roles remain a distinct, later item (Vol 7_7, Vol 10_1).
- Not a way to avoid the mobile app. Voice/photo capture and always-on offline capture remain mobile's strengths; web's strength is a larger screen for review, reporting, and the AI Workspace.

## 4. Feature Parity Phasing

| Feature | Phase 2a (web MVP) | Phase 2b (web full parity) |
|---|---|---|
| Dashboard (cash position, receivables/payables, notifications) | Yes | Yes |
| AI Workspace (Q&A, CFO guidance) | Yes | Yes |
| Manual/text capture (Sale, Purchase, Expense, Banking) | Yes | Yes |
| Photo/document capture (webcam or file upload, vision extraction) | No — upload-a-file fallback only, not the full camera capture UX | Yes |
| "Why?" explainability views (Vol 5_3, Vol 7_1 Sprint 11) | Yes | Yes |
| Settings & business configuration | Read-only | Full parity |
| Devices panel (registered/logged-in/active/synced status, activate/rename/revoke) | Yes — read-only devices can still view it and request activation (Vol 12_1 Section 8) | Yes |
| Notifications | In-app panel only | Browser push (Phase 2b or later, revisit against Vol 11_0 Section 6's "no dedicated observability/push platform yet" posture) |
| Live cross-device sync (Vol 12_1) | Required from day one (Section 2) | Required from day one |

Phase 2a is deliberately the smallest slice that is genuinely useful (view your business and log transactions from a laptop) without requiring browser camera/vision work to ship first. This mirrors the project's established pattern of shipping a working vertical slice before replicating it (Vol 0_1's own sprint sequencing: Sprint 3 proved the pipeline on Expense alone before Sprint 6 replicated it to Sale/Purchase).

## 5. Shared Business Logic, Not a Second Codebase

**Decision:** extract the storage-agnostic parts of `app/src` (capture pipeline routing, ledger/financial-summary derivation, PKA rule evaluation, PCB assembly, notification/CFO-guidance logic) into a shared TypeScript package (`@aifa/core`), consumed by both the React Native app and a new web app, each providing its own implementation of a small `DataAdapter` interface (SQLite/op-sqlite for mobile, IndexedDB for web) and its own `AiProvider` transport.

**Reasoning:** every one of the sprint-log entries in `[[project_aifa_architecture]]` that mattered most (immutability triggers, reversal-based corrections, idempotent settlement, confidence routing, the trust-boost agreement rule) is business logic, not UI. Re-deriving it in a second codebase would silently reintroduce bugs Sprints 3-12 already found and fixed. A second implementation is the single biggest risk this volume identifies — worse than any UI or styling risk.

**Consequence:** `app/src/db/*Repository.ts` files need their SQL/op-sqlite specifics separated from their business rules before this can happen cleanly — this is refactoring work, not new logic, and should be scoped as its own sprint before web feature work begins, not done piecemeal alongside it.

## 6. Technology Choices (extends Vol 11_0, does not replace it)

| Decision | Choice | Reasoning | Revisit If |
|---|---|---|---|
| Web framework | React (same component/hooks model as React Native; Next.js or Vite+React Router for routing/build) | Maximises shared logic and shared engineering mental model with the existing RN app | A server-rendering requirement (SEO, marketing pages) emerges — AIFA is an authenticated app, not a marketing site, so this is unlikely |
| Local browser storage | IndexedDB via a typed wrapper (e.g. Dexie.js), schema mirroring Vol 11_1's tables | Needed for offline capture and as the local half of the sync design in Vol 12_1 | N/A for Phase 2 |
| Local encryption | WebCrypto (AES-GCM) keyed by the per-business Data Encryption Key described in Vol 12_1 Section 5, held as a non-extractable CryptoKey for the browser session | Browsers have no OS keychain; this is the closest achievable equivalent, explicitly weaker than mobile's SQLCipher+keychain model (stated plainly, not hidden — see Vol 12_1 Section 9) | A stronger browser-native secure-storage primitive becomes broadly available |
| Offline support | Progressive Web App (service worker for app-shell caching + IndexedDB for data) | Keeps capture usable without connectivity, matching Vol 1_3 Section 2's offline-first principle for capture/viewing | N/A |
| Backend | Same Supabase project already in use (Vol 11_0 Section 5) — extended per Vol 12_1, not replaced | One backend for both platforms; avoids a second integration surface | N/A |

## 6a. Single Active-Device Concurrency Model (new — see Vol 12_1 Section 5a-8 for full detail)

The owner has set a firm product requirement: only one device may write at a time, every registered device's state (registered / logged in / active / synced) is always visible, and switching which device is active requires the newly-active device to sync first while every other device stalls into read-only mode. On top of that, one device is owner-designated "primary" and can always reclaim active status, unconditionally dropping whichever device currently holds it, with a lightweight single-tap confirmation rather than the fuller caution prompt a non-primary takeover shows when the currently-active device looks like it's genuinely in use (ADR-004, amended 2026-08-31 — primary takeover is not a bare zero-confirmation action). Neither rule waives the underlying sync-before-write requirement. This is a real constraint on the web client's UX, not just a backend detail — every write-capable screen in Phase 2a/2b (Section 4) must check and respect this state, and Settings must surface the Devices panel described in Vol 12_1 Section 8 on both platforms, including the Primary badge and "Set as primary" action. See Vol 12_1 for the full design (device registry, the server-held active-device lock, the handoff protocol, the primary-device override, and the narrow offline-conflict backstop this reduces the sync design to).

## 7. Governance & Boundaries (unchanged, restated for web)

All five boundaries in Vol 0_0 Section 4 apply to the web client exactly as they apply to mobile:

1. The web client never manufactures or modifies the Finance PKA — it loads the same versioned bundle (Vol 3_0), fetched from the same source mobile uses.
2. The web client assembles its own minimal PCB locally (in-browser, via `@aifa/core`) before any AI call — the AI model still never receives the full PKA or the full business database, regardless of which client made the request.
3. Business Events remain canonical; the web client derives Business Data/Financial Data/Business Knowledge the same way mobile does, through the shared logic in Section 5.
4. Business-specific knowledge is never written back into the shared Finance PKA, from either client.
5. Runtime Memory stays temporary and client-local; nothing becomes permanent knowledge except through Knowledge Factory or BKEE, unchanged by having two client platforms.

## 8. Relationships to Other Volumes

- Vol 12_1 (Cross-Platform Data Synchronisation Architecture) — the sync design this volume depends on; read together.
- Vol 1_3 (Technology Architecture) Section 2 first anticipated a web surface; this volume and Vol 12_1 realise it.
- Vol 4_4 / Vol 8_4 — the Phase 1 local-first/backup model this volume's Section 2 explains why web cannot fully inherit unmodified.
- Vol 7_0-7_7 (Mobile Application Architecture) — the UX/feature reference web achieves parity with per Section 4's phasing.
- Vol 8_1 (Identity & Access Management) — web reuses the same auth; Section 3.2 states the single-user scope carries over.
- Vol 11_0 / Vol 11_1 — the Phase 1 stack and schema this volume extends rather than replaces.
- Vol 4_0_0 — ADR-002, the decision record this volume's Section 2 is grounded in.

## 9. Open Items

- The `@aifa/core` extraction (Section 5) is a prerequisite, not a nice-to-have — it should be scoped and estimated as its own sprint before any web UI sprint is planned.
- Browser push notifications (Section 4, Phase 2b) depend on a decision not yet made about a push provider; not designed here.
- No decision yet on hosting/deployment target for the web app (left for a future Series 11-style implementation-foundations pass once this design is approved).
- File upload as the Phase 2a substitute for camera capture needs its own small UX spec (drag-drop vs. picker, accepted formats) — not detailed in this volume.

---

*End of Volume 12_0.*
