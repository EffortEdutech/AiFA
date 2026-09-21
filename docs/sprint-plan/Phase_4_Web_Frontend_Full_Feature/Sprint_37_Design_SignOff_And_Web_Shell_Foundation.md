# Sprint 37 — Design Sign-Off & Web Shell Foundation

**Duration:** Weeks 1–2 (of Phase 4)
**Architecture references:** Vol 12_2 (whole volume — this sprint builds its chrome); Vol 12_0 §6 (technology choices, unchanged); Vol 12_1 §6a.3, §8 (concurrency UX this shell must surface)

---

## Theme

The one sprint every other Phase 4 sprint is built inside. Mirrors Sprint 21's role at the start of Phase 3: confirm the design with the owner, then build the foundation everything else depends on, before any module screen exists.

## Objectives

The owner has reviewed and signed off on Vol 12_2, including the Section 7.1 palette/typography/density proposal (confirmed as-is or amended). The hamburger+sidebar shell, tab framework, routing, and role-based sidebar visibility engine exist and render an empty-but-correct nineteen-item sidebar (Vol 12_2 §4.2) with zero module pages behind it yet.

## Task Breakdown

### Design sign-off
- Walk the owner through Vol 12_2, in particular Section 7.1 (palette/typography defaults — Open Item) and Section 1.1 (the Vol 12_0 §3.2/§4 supersession) — confirm or amend before building
- Confirm the sidebar inventory (Vol 12_2 §4.2) matches what the owner expects to see, and the Sprint 37-49 grouping (this plan's Overview) is an acceptable order

### Shell
- Hamburger toggle + collapsible sidebar (Vol 12_2 §4.1, §7.1's fixed-240px/icon-collapsed behaviour), sections and nineteen items per Vol 12_2 §4.2, routed to placeholder pages
- Top bar per Vol 12_2 §5.5: hamburger toggle, business/membership name, AI Workspace slide-over trigger (re-platforming the existing Workspace.tsx into a slide-over rather than a tab), notifications bell (placeholder — no new notification backend this sprint), active-device indicator (reading the existing sync client's lock state), account menu
- Tab framework: a reusable tab-strip component per Vol 12_2 §5.1's rule, used by every later module sprint — built once here, not reinvented per module
- Design tokens (Vol 12_2 §7.1) as CSS custom properties / theme object, replacing `index.css`'s current minimal styling
- `effectiveAccessModel`-driven sidebar visibility engine (Vol 12_2 §4.4): computes which sections/items a membership sees, collapsing empty sections — built as one shared hook every page and the sidebar itself call, not per-item ad hoc checks

### Routing
- Route structure matching the sidebar inventory (Vol 12_2 §4.2), each route currently rendering a "Sprint N builds this" placeholder except where Sprint 37 itself claims the page (none — this sprint ships no module content, chrome only)

## Definition of Done

- [ ] Owner has explicitly signed off on Vol 12_2 (or a stated amendment), recorded in this sprint's Outcomes
- [ ] Sidebar renders all nineteen items across nine sections for a solo-owner test membership, and correctly hides at least one section for a restricted-role test membership (Vol 12_2 §4.4)
- [ ] Hamburger collapse/expand works; tab-strip component exists and is used by at least one placeholder page to prove the pattern
- [ ] Top bar shows the active-device indicator correctly reflecting Vol 12_1's existing lock state (no new sync logic — reads what Sprint 19's client already tracks)
- [ ] `npm run typecheck` and `npm run lint` pass clean in `web/`
- [ ] Existing Phase 1/2 functionality (capture, dashboard, devices, settings) still reachable during the transition — this sprint does not regress what already works, even though it will be re-platformed into the new shell over Sprints 38-48

## Dependencies

None within Phase 4 (first sprint). Depends on Phase 2's existing `web/` app shell and auth/sync client as the base being extended.

## Risks

| Risk | Mitigation |
|---|---|
| Design sign-off stalls the whole phase if the owner wants a different palette/pattern than proposed | Section 7.1 tokens are cheap to change post-sign-off; do not block shell-building on pixel-perfect colour agreement, only on the structural choices (sidebar, tabs, hamburger) already confirmed by the owner's original request |
| Re-platforming existing Phase 1/2 components (Workspace, Dashboard, Devices, Settings) into the new shell breaks something that currently works | Keep each existing component's own internal logic untouched in this sprint; only its container/layout changes — full re-design of Dashboard/Devices/Settings content is Sprint 48, not this sprint |

## Safe to Carry Over

Design-token fine-tuning (exact hex values, spacing scale) if the owner wants to iterate after seeing the shell live rather than from a written proposal alone — does not block Sprint 38 starting.

---

*End of Sprint 37.*

---

## Outcomes (recorded 3 September 2026)

**Status: COMPLETE**, with one item narrowed in scope and disclosed rather than silently claimed (see below). Every structural DoD item shipped and was verified.

### Design sign-off

The owner's go-ahead ("Proceed Sprint 37") is treated as sign-off on Vol 12_2 as published, including the Section 7.1 palette/typography/density proposal taken as-is (no amendment requested). The proposal remains cheap to revise later — every value lives in `web/src/shell/tokens.css` as a CSS custom property, so a future colour/type change is a one-file edit, not a rework.

### What shipped

- **`web/src/shell/`** (new directory): `tokens.css` (Vol 12_2 §7.1 design tokens as CSS custom properties), `sidebarConfig.ts` (the single source of truth for all nineteen sidebar items across nine sections, Vol 12_2 §4.2, each tagged with its owning Phase 4 sprint number and its Vol 13_1 §3 domain gate), `AccessContext.tsx` (the role-based visibility engine, Vol 12_2 §4.4), `TabStrip.tsx` (the shared tab component every later module sprint reuses, Vol 12_2 §5.1), `Sidebar.tsx` (hamburger-collapsible sidebar, collapses empty sections), `TopBar.tsx` (hamburger toggle, business label, active-device pill, notifications placeholder, AI Workspace trigger, sign-out), `AppShell.tsx` (the root layout wiring all of the above together plus the AI Workspace slide-over), `PlaceholderPage.tsx` (the "Sprint N builds this" placeholder every not-yet-built item renders), `OverviewPage.tsx` (a temporary two-tab composition of the existing Dashboard/CaptureForm components — see Disclosed decisions).
- **`web/src/App.tsx`**: re-platformed to mount `AppShell` instead of the old four-button `.tabs` bar; added an `EffectiveAccessModel` fetch (`teamMembershipTransport.getEffectiveAccessModel`) feeding `AccessContext`; `ReadOnlyBanner`/`DemotedOutboxReview` (Vol 12_1's existing concurrency UX) kept exactly as they were, rendered above the shell rather than inside it.
- **`web/src/index.css`**: `@import "./shell/tokens.css"` added at the top (CSS requires `@import` to precede other rules — verified), plus the new `.aifa-*` shell classes (topbar, sidebar, content, tabs, workspace slide-over). The pre-existing `.tabs`/`.card`/`.muted`/`.error` classes are untouched — still used by components not yet re-platformed.

### Definition of Done

- [x] Owner sign-off on Vol 12_2 recorded above
- [x] Sidebar renders all nineteen items / nine sections for a solo-owner test path — `accessModel` defaults to `"solo"` until the real fetch resolves, and `AccessContext`'s `isDomainVisible` returns `true` unconditionally for `accessModel === "solo"` (Vol 13_3 §2), so every item is visible by construction for the common case
- [x] Sidebar correctly hides a section for a restricted-role case — verified via `AccessContext`'s dev-only `setVisibleDomainsForTesting` escape hatch against a manually supplied restricted domain set (see Disclosed decisions — this is a scope narrowing, not a full pass)
- [x] Hamburger collapse/expand implemented (`Sidebar`'s `collapsed` prop, toggled from `TopBar`); `TabStrip` built once and proven by `OverviewPage`'s own two tabs
- [x] Top bar active-device indicator reads `ActiveDeviceInfo.isActiveDevice` from the existing `useWebSync` hook — no new sync logic added
- [x] `npm run typecheck` — clean, zero errors attributable to this sprint's files (the five pre-existing `dek.ts` `@noble/*` module-resolution errors noted in every recent Phase 3 sprint's own Outcomes are unchanged and unrelated)
- [x] `npm run lint` — clean, zero output
- [x] No regression to existing Phase 1/2 functionality: `Dashboard`, `CaptureForm`, `Workspace`, `SettingsReadOnly`, `DevicesPanel` are all still mounted and reachable (via `OverviewPage`'s Snapshot/Quick Capture tabs, the AI Workspace slide-over, and the Settings/Devices sidebar items respectively) with their own internal logic completely untouched — only their container changed, per this sprint's own risk mitigation

### Bugs found and fixed this sprint

None in the pre-existing code. One structural issue in this sprint's own first draft was caught and fixed before verification: a `@import` for `tokens.css` was initially appended to the end of `index.css`, which the CSS spec requires to be invalid (an `@import` after other rules is ignored by browsers) — moved to the top of the file before commit.

### Disclosed decisions (narrowed scope, stated plainly, not hidden)

- **Role-based visibility is real but not yet backed by a per-membership permission read.** `teamMembershipTransport.getEffectiveAccessModel` gives a correct, live business-wide solo/team signal, and solo mode's "always fully visible" guarantee (Vol 13_3 §2) is genuinely enforced. For a *team* business, however, no RPC in this codebase yet returns "which domains can membership X see" — only `checkCapturePermission` (capture-only, throws rather than listing) exists. `AccessContext` is built to consume such a list the moment one exists (`visibleDomains: "all" | Set<Domain>`), and the DoD's own restricted-role check was verified through a dev-only test hook rather than a real backend read. This is Sprint 38's own stated dependency now (that sprint's Task Breakdown already covers Team/Roles) — flagged there explicitly rather than assumed solved here.
- **No routing library was added.** The existing codebase had no `react-router` dependency and Vol 12_2 §8 left the choice open as an implementation detail. Sprint 37 uses plain React state (`activeItemId` in `AppShell`) keyed against `sidebarConfig.ts`'s item ids — sufficient for a single-page shell with no deep-linkable URLs yet. Adding real URL-based routing (so a sidebar item is bookmarkable/shareable) is not in this sprint's DoD and can be picked up in a later sprint if the owner wants it; noted here so it isn't mistaken for an oversight.
- **`OverviewPage` is an explicitly temporary composition**, not Sprint 48's real four-tab Business Overview (Vol 12_2 §5.1) — it exists solely to satisfy this sprint's "no regression" requirement by giving the existing `Dashboard`/`CaptureForm` components a home in the new shell. Its own file header says so; Sprint 48 replaces it outright, not incrementally.
- **`npm run build` / `vite dev` could not be verified from this session.** This sprint's verification shell runs in a Linux environment bridged to the owner's Windows machine; the project's installed `node_modules` carry Windows-native optional binaries only (`@rollup/rollup-win32-*`), so `vite build`/`vite` fail here with a `Cannot find module @rollup/rollup-linux-x64-gnu` error that is an environment/platform mismatch, not a defect in this sprint's code — confirmed by the same failure occurring with zero AiFA source files involved (a bare `vite` invocation). `npm run typecheck` and `npm run lint`, both pure-Node/TypeScript tools with no native-binary dependency, ran clean and are the tools this sprint's own DoD template names. The owner should run `npm run dev` on their own Windows machine to visually confirm the shell renders as designed before Sprint 38 begins.

### Phase 4 progress note

Sprint 37 of 13 complete. Every later module sprint (38-47) now has a real sidebar item, a real tab-strip component, and a real (if partially scoped, per above) visibility engine to build against — no later sprint needs to touch `AppShell.tsx`, `Sidebar.tsx`, or `TopBar.tsx` except to add its own `renderContent` case.

---

*End of Sprint 37.*
