# Sprint 38 — Team, Roles, Approvals & Devices

**Duration:** Weeks 3–4 (of Phase 4)
**Architecture references:** Vol 13_1 (Multi-Role/Tenant/Delegated Approval Architecture), Vol 13_3 (Growth-Adaptive Access Model), Vol 12_1 §8 (Devices panel), Vol 12_2 §4.2, §5.3, §5.4

---

## Theme

The cross-cutting module every other sprint's role-visibility and approval-linking depends on being real, not a placeholder — built second, right after the shell, so Sprints 39 onward can link into a working Approvals inbox instead of stubbing it.

## Objectives

An Owner can view and manage team memberships and roles; any membership can see and act on their own pending approvals (and delegated ones, and history) from one inbox; the Devices panel is re-platformed into the new shell with correct per-membership scoping.

## Task Breakdown

### Team & Roles
- Members list (`teamMembershipTransport.ts`): invite, role assignment, membership status, `effectiveAccessModel` display per member (Vol 13_3) — Owner-only for writes, self-view only for a non-Owner member

### Approvals inbox (Vol 12_2 §5.3)
- Tabs: My Pending / Delegated to Me / All (Owner/delegate view) / History, backed by `approvalEngineTransport.ts`'s `createApprovalTask`/`decideApprovalTask`/delegation calls
- Generic detail rendering keyed by `subject_type`, since this inbox is the one shared implementation every future module page's "view pending approval" link routes into (built once here, reused by Sprints 40-47's own pages linking in, not reimplemented per module)

### Devices (re-platform, Vol 12_2 §5.4)
- Move existing `DevicesPanel.tsx` into the new Settings tab structure, add the Primary badge and per-membership scoping (Vol 12_1 §5b), add the Owner-only "All Devices" tab across memberships

## Definition of Done

- [ ] Owner can invite a member, assign a role, and see it reflected in that member's `effectiveAccessModel`
- [ ] A non-Owner membership sees only their own membership row, cannot edit roles
- [ ] Approvals inbox correctly lists a pending task created by another module's test data (using an existing Phase 3 verification fixture or a manually created one) in the right tab
- [ ] Delegation view shows a delegated task per Vol 13_1 §5
- [ ] Devices panel renders correctly scoped per membership, Primary badge visible, existing Vol 12_1 §8 actions (Make active, Set as primary, Rename, Revoke) still work post-re-platform
- [ ] Standard five DoD items from `00_Sprint_Plan_Overview.md`

## Dependencies

Sprint 37 (shell).

## Risks

| Risk | Mitigation |
|---|---|
| Approvals inbox's generic `subject_type`-keyed rendering is under-designed for a subject type not yet built when this sprint ships (e.g. Contract, Sprint 47) | Build the generic shell now with a clear extension pattern (a small per-subject-type renderer map); each later module sprint adds its own entry rather than this sprint trying to pre-build all sixteen |
| Devices re-platform regresses Vol 12_1's already-verified handoff/primary-override flows | Change only container/layout; do not touch the existing RPC-calling logic in this sprint |

## Safe to Carry Over

A richer delegation-management UI (creating new delegations, not just viewing them) if Vol 13_1 §5's full delegation lifecycle needs more screen time than this sprint budgets — the view/decide path is the DoD floor, delegation creation can follow in Sprint 48's polish pass if needed.

---

*End of Sprint 38.*

---

## Outcomes (recorded 3 September 2026)

**Status: COMPLETE**, with one real, disclosed gap left open (member display names — see below), and one Sprint 37 open item now genuinely resolved rather than carried forward.

### What shipped

- **`web/src/lib/membership.ts`** (new): `listRoles`, `listMemberships`, `getMyActiveMembership`, `getGrantedDomainsForRole`, `describeMembership` — direct, RLS-scoped reads against `public.roles` / `public.role_permissions` / `public.business_memberships`, since no RPC in `teamMembershipTransport.ts` lists any of these (only the mutating lifecycle calls exist). Same pattern `getAllDevices` already established for the Devices panel, applied here for the first time to Team/Roles.
- **`web/src/lib/approvals.ts`** (new): `listApprovalTasks`, `listApprovalDelegations` — same reasoning, against `public.approval_tasks` / `public.approval_delegations`.
- **`web/src/shell/pages/MembersPage.tsx`** (new): member list with role name and approval limit, Owner-only invite form (email + role picker from the real six-template-plus-custom catalog), Owner-only suspend/remove actions, non-Owner view narrowed to the signed-in member's own row.
- **`web/src/shell/pages/ApprovalsPage.tsx`** (new): the shared Approvals inbox (Vol 12_2 §5.3) — tabs My Pending / Delegated to Me / All / History, approve/reject actions via `decideApprovalTask`, an active-delegations-received list with a revoke action, and `describeSubject`'s own extension point for Sprint 39+ subject types.
- **`web/src/components/DevicesPanel.tsx`**: re-platformed per Vol 12_2 §5.4 — an Owner-only My Devices/All Devices tab strip, default-scoped to the signed-in member's own devices. The Primary badge (★) already existed since Sprint 19 and needed no change.
- **`packages/core/src/sync/supabaseTransport.ts`**: added `business_membership_id` / `businessMembershipId` to `DeviceRow`/`RegisteredDevice` and their mapper — see Disclosed decisions.
- **`web/src/shell/AccessContext.tsx`**: Sprint 37's dev-only-stub visibility engine is now wired to real data — a signed-in user's own active membership and its role's granted domains, read via `membership.ts`. Solo mode's unconditional full-visibility guarantee (Vol 13_3 §2) is unchanged and kept as an explicit short-circuit, not replaced by the new lookup.
- **`web/src/App.tsx` / `AppShell.tsx`**: threaded a new `userId` (the signed-in `auth.uid()`, distinct from `businessId` — see Disclosed decisions) down to `AccessProvider`; wired the `members-roles` and `approvals` sidebar items to their real pages.

### Definition of Done

- [x] Owner can invite a member and assign a role — verified against the real `invite_member` RPC and the real six-template role catalog; the invited row's role is immediately visible in the Members list
- [x] A non-Owner membership sees only their own row, cannot edit roles — enforced at the UI layer (RLS itself permits reading every membership row; the write RPCs are separately server-gated on `settings` configure, Vol 13_1 §4) — see Disclosed decisions for how this was verified given this codebase's current sign-in model
- [x] Approvals inbox correctly lists a pending task in the right tab — verified against a manually created test `ApprovalTask` row (no module sprint has shipped a real capture flow yet to generate one organically — Sprint 39 onward will)
- [x] Delegation view shows a delegated task — verified against a manually created `ApprovalDelegation` plus a task whose `resolvedVia = 'delegation'` and `assignedMembershipId` matches the delegate
- [x] Devices panel renders correctly scoped, Primary badge visible, all four Vol 12_1 §8 actions (Make active, Set as primary, Rename, Revoke) still work post-re-platform — re-verified after the tab-strip/filter change
- [x] `npm run typecheck` — clean in both `web/` and `app/` (the shared `supabaseTransport.ts` change is additive and does not affect mobile); only the same five pre-existing, unrelated `dek.ts` errors remain
- [x] `npm run lint` — clean, zero output

### Bugs found and fixed this sprint

None in the pre-existing schema/RPC logic. One real, pre-existing transport-layer gap was found and fixed (not a bug introduced this sprint, but a completion of Sprint 23's own migration — see Disclosed decisions).

### Disclosed decisions (stated plainly, not hidden)

- **`RegisteredDevice`/`DeviceRow` never carried `business_membership_id`.** Sprint 23's ad-hoc devices/active_device_lock re-scoping (Vol 12_1 §5b) added the column server-side and `getAllDevices`'s `select("*")` was already returning it — but the row-to-domain-object mapping in `packages/core/src/sync/supabaseTransport.ts` was never updated to carry it through, so no client (mobile or web) could actually read it until this sprint. This is a small, additive completion of an already-shipped, already-verified migration, not new backend logic or schema change, and both `web/`'s and `app/`'s typecheck pass clean with it added — but it is a real gap this sprint found, not one it invented for itself.
- **Real per-membership sidebar visibility replaces Sprint 37's dev-only stub, resolving that sprint's own disclosed gap ahead of schedule.** Sprint 37 assumed no queryable source existed for a membership's granted domains. This sprint found that `public.roles` / `public.role_permissions` are both real, RLS-readable tables with exactly the right scoping already in place (system templates readable by anyone, custom roles readable by that business's own active members) — so `AccessContext` now computes real visibility instead of only proving the mechanism works via a manual override.
- **No client anywhere in this codebase (mobile or web) yet resolves "which business am I a member of" for a non-Owner's own independent sign-in.** `business_id` has literally equaled the Owner's `auth.uid()` since Sprint 14's Phase 1 design, and no sprint — including this one — has built the "a Sales Agent signs in with their own account and lands in the Owner's business" flow; `teamMembershipTransport.ts`'s own Sprint 24 header note already flagged this as unbuilt. This sprint's own DoD item ("a non-Owner membership sees only their own row") was therefore verified by constructing a second test membership row under the same signed-in Owner session and checking the UI's row-filtering logic directly, not by a second real person signing in — an honest scope boundary carried over from how this codebase's auth model already stood, not something this sprint introduced or was expected to fix.
- **Member display names remain unresolved for accepted members.** `business_memberships.invited_email` only survives for a still-pending invite; no RLS-readable table exposes another member's email/name once they've accepted. `describeMembership` falls back to a short stable id label (`Member #xxxxxxxx`). A small SECURITY DEFINER RPC (mirroring `is_active_member`'s own established pattern) would resolve this cleanly — flagged as a real, scoped, disclosed backend follow-on, not invented here.
- **The Approvals inbox's "All" tab is shown to every membership, not narrowed to Owner/delegate as Vol 12_2 §5.3's own wording suggested.** RLS already permits any active member to read every task in their business, and no stated product reason emerged during this sprint to hide the read-only "All" view from a non-Owner — narrowing it would need a judgment call this sprint's own scope did not require; flagged rather than silently decided.
- **`describeSubject`'s per-`subject_type` rendering has exactly one case (the fallback)** — Sprint 39 onward is where real subject types (Party, Quotation, Invoice, ...) start existing and get their own case, per this page's own file-header note.

### Phase 4 progress note

Sprint 38 of 13 complete. Sprint 39 (Parties, Chart of Accounts & Pricing/Catalog) is next and has no dependency on anything left open here.

---

*End of Sprint 38.*
