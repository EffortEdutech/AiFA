# Sprint 19 — Web Sync Client & Device Visibility Panel

**Duration:** Weeks 13–14 (of Phase 2)
**Architecture references:** Vol 12_1 §6 (Sync Flow), §8 (Device Visibility)

---

## Theme

The web app gets the same push/pull/read-only-enforcement treatment the mobile app got in Sprint 16, and both platforms get the Devices panel — the concrete, always-visible answer to "which device is registered, logged in, active, and synced," built once and shared in spirit even though the two UIs are platform-native.

## Objectives

The web app participates fully in the sync envelope and active-device lock system as a first-class citizen, and both mobile and web surface a Devices panel showing all four device states plus the primary badge and handoff/override actions, per Vol 12_1 §8.

## Task Breakdown

### Web Sync Client
- Port Sprint 16's push/pull/idempotency logic to the web app, against `IndexedDBDataAdapter` instead of `SQLiteDataAdapter` — this should mostly be reuse through `@aifa/core`, not a parallel implementation
- Web read-only enforcement at the data-layer boundary, matching Sprint 16's mobile guarantee (blocked at the adapter, not just hidden in the UI)
- Web-side handoff/primary-override actions, reusing Sprint 17's protocol logic (the RPC calls and sequencing are identical; only the UI chrome differs by platform)

### Devices Panel (Both Platforms)
- Table/list of every registered device for the business: label, platform, the four states (registered / logged in / active / synced) shown distinctly per Vol 12_1 §8 — never collapsed into one status pill
- Primary badge on the primary device
- Actions: request activation, set as primary, rename device, revoke a device (revoke was stubbed in Sprint 15 as backend-only; this sprint gives it a real UI)
- Last-seen / last-synced timestamps sourced from `public.devices` fields already populated since Sprint 15

### Cross-Platform Consistency Check
- Deliberate test pass: register a device on mobile, confirm it's visible correctly from the web Devices panel, and vice versa — the whole point of a server-held lock (Vol 12_1 §5a.2) is that both platforms see one consistent truth, so this needs to be proven, not assumed from each platform's own tests passing individually

## Definition of Done

- [ ] Web app pushes/pulls sync envelopes correctly, verified with the same idempotency/replay tests Sprint 16 used for mobile, run again against the web client
- [ ] Web read-only enforcement confirmed blocked at the data-layer boundary, same test standard as Sprint 16
- [ ] Devices panel shows all four states distinctly, with the primary badge, on both mobile and web
- [ ] Set-as-primary, request-activation, rename, and revoke actions all work from the web Devices panel
- [ ] A device registered on one platform is correctly and promptly visible from the other platform's Devices panel
- [ ] Revoking a device from either platform correctly prevents that device from writing on its next attempt (live re-check, per Sprint 15's requirement)

## Dependencies

Sprint 18 (web app must exist and run through `@aifa/core`), Sprint 16/17 (mobile push/pull/handoff logic being ported, not reinvented), Sprint 15 (device registry backend already supports everything this panel surfaces).

## Risks

| Risk | Mitigation |
|---|---|
| Web and mobile Devices panels drift into showing subtly different information because they were each built against the same backend but implemented independently | Write the cross-platform consistency test above as an explicit, repeatable check, not a one-time manual look |
| Revoke-device UI ships without the backend actually enforcing it live | This was flagged as a risk in Sprint 15 too — treat "revoke doesn't take effect until next app launch" as a bug, not an acceptable gap |
| Device labels/platform strings are inconsistent between what mobile and web write into `public.devices` | Agree a small shared enum/format in `@aifa/core` rather than each platform inventing its own strings |

## Safe to Carry Over

Visual polish of the Devices panel (icons, animation on state change) can wait — the states being correct and truthful matters far more than how they're styled, for this plan's purposes.

---

*End of Sprint 19.*
