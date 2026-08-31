# Sprint 18 — Web App Shell (Phase 2a Minimal Slice)

**Duration:** Weeks 11–12 (of Phase 2)
**Architecture references:** Vol 12_0 §3–4 (Scope, Feature Parity Phasing), §6 (Technology Choices)

---

## Theme

The first line of web code in this plan. Deliberately minimal — the Phase 2a slice from Vol 12_0 §4, not full parity — because the point of this sprint is proving `@aifa/core` actually works as a real second consumer, not building out the whole web product at once.

## Objectives

A business owner can sign in to AIFA from a web browser and use the Phase 2a minimal feature slice, built entirely on `@aifa/core` with a new `IndexedDBDataAdapter`, with no sync yet (that's Sprint 19) — this sprint is local-only web functionality plus auth.

## Task Breakdown

### Project Setup
- Next.js (or the specific framework Vol 12_0 §6 settled on) project scaffolded, added to the monorepo alongside `app/` and `@aifa/core`
- PWA/service worker groundwork laid (offline shell caching) — full offline sync behaviour is a later sprint's concern, but the app should at least load without network once first visited

### Local Storage
- `IndexedDBDataAdapter` implemented against `@aifa/core`'s `DataAdapter` interface, using Dexie.js
- WebCrypto AES-GCM wired for client-side encryption of locally-stored data, mirroring the mobile app's SQLCipher-at-rest guarantee in web terms
- Explicit handling for IndexedDB unavailability/clearing (private browsing, browser storage eviction) — surfaced as a clear "your local web data was cleared" state per this plan's Overview risk register, not a silent failure

### Auth
- Web sign-in against the existing Supabase auth (same backend as mobile, no parallel auth system)
- New web session registers itself as a device per Sprint 15's `register_device` RPC — even though sync isn't wired yet this sprint, registration should happen now so Sprint 19 has a real device to sync as

### Phase 2a Minimal Feature Slice
- Implement exactly the feature-parity table's Phase 2a row set from Vol 12_0 §4 (capture + dashboard view, at minimum — confirm exact scope against that table rather than re-deciding it here)
- Every feature in this slice runs through `@aifa/core`, proving the shared-logic extraction from Sprint 13 actually holds up under a second real UI

## Definition of Done

- [ ] Web app builds, deploys to a staging environment, and loads in a supported browser
- [ ] Sign-in works against the shared Supabase auth backend
- [ ] The signing-in browser session registers as a device (visible in `public.devices`, even without a dedicated UI yet)
- [ ] `IndexedDBDataAdapter` correctly stores and retrieves data through `@aifa/core`, encrypted at rest via WebCrypto
- [ ] The Phase 2a minimal feature slice (exact scope per Vol 12_0 §4) works end-to-end, locally, without needing sync
- [ ] IndexedDB-cleared scenario tested and surfaces a clear owner-facing message rather than a silent blank state

## Dependencies

Sprint 13 (`@aifa/core` and the `DataAdapter` interface must exist), Sprint 15 (device registration RPC).

## Risks

| Risk | Mitigation |
|---|---|
| `@aifa/core`'s interface turns out to have mobile-specific assumptions baked in that only surface once a second adapter is written | Expect and budget time for this — it's exactly why this sprint exists before Sprint 19 adds sync complexity on top |
| Scope creep toward Phase 2b features once the web app "exists" and feels good to keep building | Hold the line at the Vol 12_0 §4 Phase 2a row set; anything beyond it goes on a Phase 2b backlog, not into this sprint |
| WebCrypto browser support/quirks across target browsers | Test on the actual supported-browser list (Vol 12_0 should state or imply one); don't assume desktop Chrome behaviour generalises |

## Safe to Carry Over

PWA installability polish (icons, manifest niceties) can slip past this sprint if the underlying service-worker offline-shell behaviour works — cosmetic PWA polish isn't load-bearing for Sprint 19.

---

*End of Sprint 18.*
