# AIFA — Phase 2 (Web Platform & Multi-Device Sync) Sprint Plan
## Overview

**Prepared:** 31 August 2026
**Scope authority:** `docs/architecture/v2.0/Series_12_Web_Platform_Architecture/Vol_12_0_Web_Platform_Architecture.md` and `Vol_12_1_Cross_Platform_Data_Synchronisation_Architecture.md` (both currently Version 1.2 / 1.2, status **Proposed**) plus ADR-002, ADR-003, ADR-004 in `Vol_4_0_0_Architecture_Refinement_ADR_Register.md`. This plan builds *only* what those documents specify. Nothing beyond their current scope appears here except where explicitly flagged as a deferred stub.
**Companion document:** `Checklist_Master.md` in this folder — the same work, as trackable checkboxes.
**Predecessor:** `docs/sprint-plan/Phase_1_MVP/` — Sprints 1–12, closed at pilot readiness. This plan continues the sprint sequence rather than restarting it, so sprints here are numbered 13 onward.
**Status at time of writing:** Design only. No code has been written against this plan. Per standing instruction, implementation does not begin until the owner gives explicit go-ahead — this document exists to make that decision informed, not to authorise starting.

---

## 1. Purpose

This is the execution plan that turns the Series 12 architecture (web platform + multi-device sync with a single active-device write lock and owner-designated primary-device override) into sequential two-week sprints, ending in a pilot-ready Phase 2: a business owner can use AIFA from a web browser as well as the mobile app, always knows which of their devices is registered, logged in, active, and synced, and can hand off or reclaim write access safely between devices.

## 2. Assumptions

| Assumption | Detail |
|---|---|
| Team | Same solo-or-near-solo assumption as Phase 1. Sprints are sequenced serially. |
| Cadence | 2-week sprints, 8 sprints, ≈16 weeks (~4 months) to a Phase-2-pilot-ready build. A planning estimate assuming focused, largely unblocked time — treat sprint numbers as sequence, not a calendar guarantee, exactly as Phase 1's plan does. |
| Starting point | Phase 1 MVP is functionally complete per its own exit criteria (`Phase_1_MVP/00_Sprint_Plan_Overview.md` §5) before Sprint 13 begins. This plan assumes a working single-device mobile app with local-first storage, cloud backup (not sync), and the Phase 1 data schema (Vol 11_1) as its starting point — not an empty repository. |
| Tech stack | As decided in Vol 11_0, extended per Vol 12_0 §6: web app in React/Next.js, IndexedDB via Dexie.js for local web storage, WebCrypto AES-GCM for client-side encryption, PWA/service worker for offline capability. Mobile stack unchanged. |
| Data model | `public.sync_envelopes`, `public.devices`, `public.active_device_lock` as defined in Vol 12_1 §4 and §5a — every sprint that touches sync or device state builds against those field definitions directly. |
| Architecture status | Series 12 is currently "Proposed," not "Complete." Sprint 13 should include a deliberate checkpoint (see Sprint 13 below) where the owner reviews and explicitly approves the design before cloud schema changes ship, since ADR-002/003/004 have not yet been implementation-tested. |

## 3. What Is Explicitly Out of Scope for This Plan

Per Vol 0_1's phase map and Vol 12_0/12_1's own stated boundaries, none of the following appear in Sprints 13–20. Listed here so scope creep is visible if it happens:

- DEK rotation / revocation for a lost or compromised device (Vol 12_1 §12, open item — no mechanism designed yet, let alone scheduled)
- Automatic or unattended failover of active-device status — every takeover (primary or not) requires an explicit owner tap (ADR-004; Vol 12_1 §6a.5)
- Team access / multi-user roles (Vol 8_1) — still Phase 2/3 territory beyond this plan's scope
- Third-party integrations, inventory/asset/payroll/project/tax operations, local on-device AI — unchanged from Phase 1's out-of-scope list, still not reached
- Full web feature parity with mobile (Phase 2b in Vol 12_0 §4) — this plan targets the Phase 2a minimal slice only; full parity is a later planning pass
- Realtime-push sync transport — Sprint 17 below builds pull/push over ordinary HTTP calls first; moving to Supabase Realtime (or an equivalent push channel) is an explicitly deferred optimisation, not a Sprint 13–20 deliverable, since Vol 12_1 §12 flags Realtime-vs-polling reliability as untested

## 4. Sprint Index

| Sprint | Theme | Primary Architecture References |
|---|---|---|
| 13 | Design Sign-Off & Shared Core Extraction | Vol 12_0 §5, §6; Vol 12_1 (full, review pass) |
| 14 | Cloud Data Model & Key Management | Vol 12_1 §4, §5; ADR-002 |
| 15 | Device Registry & Active-Device Lock (Backend) | Vol 12_1 §5a; ADR-003, ADR-004 |
| 16 | Mobile Sync Client & Read-Only Enforcement | Vol 12_1 §3, §6, §6.3 |
| 17 | Active-Device Handoff & Primary Override UX (Mobile) | Vol 12_1 §6a |
| 18 | Web App Shell (Phase 2a Minimal Slice) | Vol 12_0 §3–4, §6 |
| 19 | Web Sync Client & Device Visibility Panel | Vol 12_1 §6, §8 |
| 20 | Offline Reconciliation Backstop, Hardening & Pilot | Vol 12_1 §7; Phase 2 exit criteria |

## 5. Phase 2 (Web + Sync) Exit Criteria — "Definition of This Plan Done"

This plan is complete when all of the following are simultaneously true, not when the sprint count runs out:

1. A business owner can open AIFA in a supported web browser, sign in, and capture/view data through the Phase 2a minimal feature slice (Vol 12_0 §4), backed by the same `@aifa/core` business logic as mobile — not a second, divergent implementation.
2. At any moment, the owner can see — for every registered device — whether it is registered, logged in, active, and synced, as four separately visible states, per Vol 12_1 §8. No indicator collapses these into one.
3. Exactly one device can write at a time. Switching the active device requires the newly-active device to sync to the cloud's current state first; every other device is demoted to a verifiably read-only mode immediately after, with write permission re-checked live rather than only at launch.
4. The owner has designated a primary device, and that device can always reclaim active status from whichever device currently holds it, with a lightweight single-tap confirmation rather than the fuller non-primary caution prompt — but the sync-before-write data-safety step is never skipped, primary or not. (Amended 2026-08-31 sign-off: the original "confirmation skipped entirely" design was revised to keep a minimal deliberate-acknowledgement step, to guard against an accidental takeover from a stray tap.)
5. The one legitimate offline-write edge case (a demoted device that captured data before learning it was demoted) reconciles correctly per the Vol 12_1 §7 entity-by-entity table, with no silent data loss and no silently duplicated Business Events.
6. The cloud data model change (`sync_envelopes` alongside the existing opaque `backups`) is live, and payload content is verified encrypted end-to-end — the server sees only the metadata columns Vol 12_1 §4 explicitly says it will see, nothing more.
7. At least one real multi-device pilot (one owner, two or more of their own devices — for example phone + laptop browser) has run for at least one full week with no write conflicts reaching the ledger and no owner confusion about which device was active, evidenced by a usage log, not assumed.

## 6. Program-Level Risks

| Risk | Why It Matters | Mitigation |
|---|---|---|
| Building against a "Proposed" architecture that hasn't been implementation-tested | ADR-002/003/004 are sound on paper but the `request_activation` RPC's atomicity (flagged in Vol 12_1 §12) is exactly the kind of thing that looks fine in a document and breaks under real concurrent requests | Sprint 15 includes a dedicated concurrency test (two near-simultaneous activation requests) before any UI is built on top of the lock, not after |
| Metadata exposure trade-off not yet owner-approved | Vol 12_1 §4 has the server seeing structured per-row metadata it did not see under the old opaque-backup model; this is a real governance decision, not just an implementation detail | Sprint 13's design sign-off explicitly surfaces this trade-off for owner approval before Sprint 14 creates the schema |
| DEK distribution reuses the Sprint 10 recovery-code mechanism, which was designed for a different purpose | Reuse is the right call architecturally, but "designed for X, reused for Y" is a classic source of subtle bugs (wrong assumptions about when the code is shown, rotated, or revoked) | Sprint 14 includes explicit tests of the DEK distribution path using a fresh device, not just unit tests of the crypto primitives |
| Solo-developer bus factor (carried from Phase 1) | Same as before — single point of failure for all delivery | Same mitigation — keep this plan and the architecture docs as the resumable source of truth |
| Web storage fragility (IndexedDB eviction, private browsing, browser storage limits) | Vol 12_0 accepts this as a real trade-off, not a solved problem | Sprint 18 explicitly tests behaviour when IndexedDB is cleared or unavailable, and surfaces a clear "your local web data was cleared" state rather than failing silently |
| Scope creep toward full web feature parity (Phase 2b) before the sync foundation is proven | Phase 2b is compelling but premature — every extra web screen built before Sprint 20's pilot is more surface area for the lock/handoff model to have gotten wrong | Sprint 18 is explicitly scoped to the Phase 2a minimal slice; any sprint that starts pulling in Phase 2b screens should be flagged, not silently absorbed |

## 7. How to Use This Plan

Each sprint document states a theme, objectives, a task breakdown by area, a Definition of Done, dependencies on prior sprints, and sprint-specific risks — the same template Phase 1 used. Work through them in order: Sprints 13–15 (core extraction, cloud schema, lock backend) must land before Sprint 16 (mobile sync client) can safely target them, and Sprint 18 (web shell) depends on Sprint 13's shared-core extraction existing, not just planned. If a sprint runs long, prefer trimming a lower-priority task within it (each sprint doc flags what's safe to carry over) over skipping ahead.

---

*End of Overview.*
