# Sprint 24 — Team Membership Lifecycle & Growth-Adaptive Access Model

**Status: ✅ COMPLETE — 3 September 2026**
**Duration:** Weeks 7–8 (of Phase 3)
**Architecture references:** Vol 13_1 §4 (Membership); Vol 13_3 (full — Growth-Adaptive Access Model)

## Outcomes (recorded 3 September 2026)

Full lifecycle (`invite_member`, `accept_membership_invitation`, `suspend_membership`, `remove_membership`), `effective_access_model`/`access_model_override` (Vol 13_3 §2/§7), and the `business_access_model_transitions` growth/shrink hook built and verified. Migration: `app/backend/migrations/sprint24_team_membership_lifecycle.sql` (appended to `app/backend/schema.sql`). Client-side shared function: `packages/core/src/sync/teamMembershipTransport.ts`, type-checked clean. Verification: `app/backend/verification/sprint24_membership_lifecycle_test.py` — 14/14 checks pass against a local Postgres instance (Sprint 14's method), including a full base+Sprint23+Sprint24 schema.sql replay.

**A real owner decision made mid-sprint, not assumed:** building invite/accept surfaced that nothing in Sprint 23's schema stopped one person from holding an active membership on more than one business at once — a real gap, since Sprint 23's own device-lock RPCs already assume "one active membership per person" (resolved via `limit 1`). The owner chose to restrict a person to at most one live (invited/active/suspended) membership across ALL businesses, globally, for now (a freelance bookkeeper serving several clients needs a separate login per client business, deliberately, not a bug) — enforced via a new global partial-unique index (`business_memberships_one_live_globally`), replacing Sprint 23's per-business one. This also required making `business_memberships.user_id` nullable and adding `invited_email`, since Vol 13_1 §4's schema assumed the invited person already had a Supabase account — not true for a genuine "invite someone by email" flow.

**A real bug found and fixed during verification, not shipped:** `effective_access_model` originally returned the raw `access_model_override` string (`'forced_team'`/`'forced_solo'`) instead of the normalized `'team'`/`'solo'` Vol 13_3 §2 actually specifies — caught when the transition-log table's own CHECK constraint rejected the unnormalized value the first time an override was set. Fixed before being called done, matching the same discipline Sprint 23's recursion bug was caught and fixed under.

**Sprint 23's flagged device-cleanup gap is closed**: `remove_membership` auto-revokes every device the removed membership held and deletes its `active_device_lock` row directly, rather than routing through `revoke_device`'s replacement-device requirement (which cannot be satisfied when the whole membership is leaving).

**Scope correction on the "UX Consequence" task, recorded rather than silently narrowed:** no Team/Roles/Approvals screens exist anywhere in `app/src` or `web/src` yet — Sprint 23 built no UI at all, deliberately, and this sprint's own work is the backend lifecycle those future screens will call. "Hidden entirely in solo mode, shown once team mode is reached" cannot be built or verified against screens that don't exist. What this sprint delivers instead: `teamMembershipTransport.ts`'s `getEffectiveAccessModel` is the single shared function Vol 13_3 §8's visibility rule should be built against, so whichever future sprint builds those screens has one correct place to call rather than re-deriving the solo/team check itself. The actual screen wiring is deferred to that sprint, not done here.

---

## Theme

Turns Sprint 23's static schema into a working lifecycle: inviting, accepting, suspending, and removing team members, and the `effective_access_model` computation (Vol 13_3 §2) that makes solo vs. team behaviour automatic rather than configured. This is the sprint that makes Vol 13_3's central promise — zero friction for a solopreneur, automatic activation on growth — actually real.

## Objectives

An owner can invite someone by email, that person can accept and become `active`, `effective_access_model` correctly computes `solo`/`team` from live membership count, `access_model_override` works for both named exception cases (Vol 13_3 §7), and removing a member correctly falls back to solo behaviour with no manual step.

## Task Breakdown

### Membership Lifecycle
- Invitation creation (`status = invited`) — minimal viable channel only (Vol 13_0 §14's WhatsApp-mechanism-style deferral applies here too: an email link or in-app code is enough, polish is out of scope per the Overview §3)
- Acceptance flow — `status → active`, `accepted_at` set, role already assigned at invite time (owner picks from Vol 13_1 §4.1 templates or a business-cloned role)
- Suspension/removal — `status → suspended`/`removed`, with the "cannot remove the sole Owner" guard from Sprint 23 enforced here at the operation level, not just the constraint level
- **Device cleanup on removal (added 3 September 2026, from Sprint 23's own finding):** `revoke_device` (Sprint 15/19/23) requires a replacement active/primary device whenever the device being revoked holds either role — correct for the self-service/lost-device case, but not directly usable when a whole membership is removed and no replacement device exists because that person is leaving entirely. This sprint's removal operation must handle a removed membership's devices itself — either auto-revoking all of them as part of removal (bypassing `revoke_device`'s per-device replacement guard, since there is no "remaining device" to hand off to), or giving `revoke_device` a membership-removal mode. Decide and implement as part of this sprint's Suspension/removal task, not as an afterthought.

### Growth-Adaptive Access Model
- Implement `effective_access_model` as a computed value (Vol 13_3 §2) — never cached/stored as primary truth
- Verify Section 3's claim directly: a solo business's capture/confirm flow is byte-for-byte the existing Phase 1/2 behaviour, with zero new UI surfaced
- Implement the growth trigger (Vol 13_3 §4): the moment a second membership goes `active`, confirm role assignment was already required at invite time (not deferred), and that `SegregationOfDutiesPolicy` seeding (owned by Sprint 25, stubbed here) has a hook to fire at this exact moment
- Implement `access_model_override` (`forced_solo`, `forced_team`) as a `configure`-gated setting
- Implement the shrink-back path (Vol 13_3 §6): removing the last non-Owner member recomputes to `solo` with no migration step, verified with an explicit test, not just by absence of code

### UX Consequence (minimal)
- Team/Roles/Approvals surfaces hidden entirely in solo mode, appearing only once `effective_access_model` first evaluates `team` (or `forced_team`) — per Vol 13_3 §8, functional minimum only

## Definition of Done

- [x] Full invite → accept → active lifecycle works end to end
- [x] Sole-Owner removal is blocked at the operation level with a clear error (`cannot_remove_sole_owner`/`cannot_suspend_sole_owner`)
- [x] `effective_access_model` correctly computed in both directions (growth and shrink), verified by test, not inspection
- [x] Solo-mode behaviour verified identical to pre-Series-13 behaviour (Sprint 23's device-lock RPCs re-verified unaffected)
- [x] Both override values work and are `configure`-gated, and normalize correctly to `solo`/`team` (bug found + fixed, see Outcomes)
- [ ] Team/Roles/Approvals UI surfaces correctly hidden/shown based on computed state — **not applicable yet**: no such screens exist in this codebase. `teamMembershipTransport.ts`'s `getEffectiveAccessModel` is delivered as the shared function they should call; actual screen wiring is deferred to the sprint that builds those screens (see Outcomes)

## Dependencies

Sprint 23's schema. `SegregationOfDutiesPolicy` seeding itself is Sprint 25's table — this sprint only needs to prove the growth-trigger hook exists and fires at the right moment, not implement the policy content. Delivered as `business_access_model_transitions`, a real append-only transition log (not a placeholder stub) that Sprint 25 can query for "the first time this business became team" rather than re-deriving that moment itself.

## Risks

| Risk | Mitigation |
|---|---|
| `effective_access_model` computed inconsistently in different code paths (one place checks membership count, another assumes a cached flag) | Implement as a single shared function in `@aifa/core`, called everywhere this matters — never re-derived ad hoc per call site |
| Shrink-back path never gets exercised in normal use, bugs go unnoticed | Explicit test required in Definition of Done, not just "should work" reasoning |

## Safe to Carry Over

Invitation-flow UX polish (Overview §3) can be minimal through this sprint and improved later without schema impact.

---

*End of Sprint 24.*
