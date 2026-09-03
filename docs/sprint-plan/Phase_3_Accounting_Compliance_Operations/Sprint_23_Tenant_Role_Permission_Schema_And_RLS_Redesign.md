# Sprint 23 — Tenant, Role & Permission Schema + RLS Redesign

**Status: ✅ COMPLETE — 3 September 2026**
**Duration:** Weeks 5–6 (of Phase 3)
**Architecture references:** Vol 13_1 §2 (Tenant Model), §3 (Permission Catalog), §4 (Roles & Membership), §10 (RLS Redesign)

## Outcomes (recorded 3 September 2026)

All five tables (`businesses`, `permissions`, `roles`, `role_permissions`, `business_memberships`) built, seeded, and backfilled; `sync_envelopes`/`devices`/`active_device_lock` RLS migrated to membership-based checks; the ad-hoc `active_device_lock`/`devices` per-membership re-scoping (Vol 12_1 §5b) implemented in the same migration. Migration file: `app/backend/migrations/sprint23_tenant_role_permission_schema.sql` (also appended to the cumulative `app/backend/schema.sql`). Verified against a local Postgres instance (Sprint 14's own verification method — no Docker/Supabase stack available in this sandbox): `app/backend/verification/sprint23_membership_rls_and_lock_test.py`.

**A correction found and recorded during this sprint, not silently fixed:** the original Objectives line below said `profiles` and `backups` would also be migrated to membership-based RLS. On inspection, both are keyed by a person's own `auth.uid()` (their own account profile, their own backup pointer rows) — not by `business_id` — so `auth.uid() = id` / `auth.uid() = user_id` is already exactly correct under multi-role and needed no change. Only `sync_envelopes`, `devices`, and `active_device_lock` (genuinely business-shared, keyed by `business_id`) were migrated.

**A real bug found and fixed during verification, not shipped:** `business_memberships`' own RLS policy, and every other policy that queried `business_memberships` inline, caused "infinite recursion detected in policy" under Postgres — a self-referencing RLS policy on the same table it queries recurses. Fixed with a `SECURITY DEFINER` helper function (`public.is_active_member`), the standard fix for this class of bug, matching this schema's existing "real logic goes in a SECURITY DEFINER function" convention. Caught by this sprint's own local-Postgres verification pass before being called done — exactly the discipline Sprint 14's runbook established.

**A known, disclosed limitation, not resolved here:** `revoke_device` still requires a replacement active/primary device when revoking a membership's last device — correct for today's self-service/lost-device case, but not yet adapted for "this person is leaving the business entirely" (Sprint 24's own membership-removal operation), where no replacement device exists because the whole membership is being removed. Flagged as a Sprint 24 dependency below, not papered over.

---

## Theme

The first schema sprint of Series 13. Decouples `business_id` from a single login, and builds the fixed permission catalog, role templates, and membership table Vol 13_1 designs — gated on Sprint 22's go decision, since `BusinessMembership` is exactly the table Sprint 22's key-wrapping model attaches to.

## Objectives

`Business`, `Permission`, `Role`, `RolePermission`, and `BusinessMembership` exist in the backend schema with correct RLS, seeded with Vol 13_1 §4.1's role templates, and every existing RLS policy (`profiles`, `backups`, `sync_envelopes`, `devices`, `active_device_lock`) is migrated from `auth.uid() = business_id` to membership-based checks with zero behaviour change for existing single-owner businesses.

## Task Breakdown

### Schema
- `public.businesses` per Vol 13_1 §2 — existing owners' `business_id` values preserved unchanged
- `public.permissions` — seeded, fixed, 11 domains × 4 capabilities per Vol 13_1 §3 (not owner-editable)
- `public.roles` / `public.role_permissions` — seed Vol 13_1 §4.1's six templates (`is_system_template = true`)
- `public.business_memberships` per Vol 13_1 §4, including the "exactly one Owner, never removable" constraint (mirroring the Sprint 15 `devices_one_primary_per_business` partial-unique-index pattern)
- Backfill: every existing business gets exactly one `active` Owner `BusinessMembership` pointing at its original owner

### RLS Migration
- Rewrite every existing policy per Vol 13_1 §10's conceptual redesign — membership-lookup based, not `auth.uid() = business_id`
- Domain/capability-specific policies wrapped in `SECURITY DEFINER` functions where real logic is involved (mirroring Sprint 15's `request_activation` pattern), not bare table policies
- Full regression: every existing Phase 1/2 backend test (profiles, backups, sync_envelopes, devices, active_device_lock RLS) still passes with identical behaviour for a single-owner business

### Ad-Hoc: Active-Device Write-Lock Re-Scoping (added 2 September 2026, from Sprint 22's review)
- Sprint 22's key-wrapping design review surfaced a real structural conflict: ADR-003's single-active-device write lock, unmodified, would allow only one device across an entire *business* to write at a time — unworkable once `BusinessMembership` means more than one person. Resolved in direction and amended into Vol 12_1 (Version 1.4, new §5b) ahead of this sprint, specifically so this sprint's `devices`/`active_device_lock` migration (above) implements the correct scope the first time rather than needing a second migration in a later sprint
- `public.active_device_lock` and `public.devices` gain a `business_membership_id` column; the lock's uniqueness/atomicity guarantee (Vol 12_1 §5a.2) is re-scoped to "exactly one active device per membership," not "exactly one active device per business"
- `register_device`, `request_activation`, `request_primary_takeover`, `set_primary_device`, `revoke_device` (Sprint 15) all have their `business_id`-scoped queries reworked to `business_membership_id`-scoped ones
- Regression proof: a solo business (exactly one membership) must show zero behavioural change — the re-scoped lock degenerates back to exactly today's per-business behaviour; a two-membership test business must show both memberships' devices able to hold and use their own active lock concurrently, with `sync_envelopes` ordering (not the lock) as the safety mechanism across memberships, per Vol 12_1 §5b

### Verification
- Cross-tenant isolation test: a second business's membership cannot see or act on the first business's rows, same rigor as Sprint 14's cross-tenant test
- Confirm a single-owner (solo) business sees zero behavioural change — this is the direct schema-level proof point for Sprint 24/Vol 13_3's solo-mode claim

## Definition of Done

- [x] All five new tables live with correct RLS
- [x] Six role templates seeded correctly (fixed, well-known role ids — see migration comments)
- [x] Every existing business backfilled with exactly one Owner membership
- [x] Every pre-existing RLS policy that needed migration is migrated with a passing regression test (`profiles`/`backups` found not to need migration — see Outcomes)
- [x] Cross-tenant isolation proven with two distinct businesses
- [x] No `BusinessMembership`-related UI exists yet — this sprint is schema + RLS only
- [x] `active_device_lock`/`devices` re-scoped to `business_membership_id` per Vol 12_1 §5b, with solo-mode-unchanged and concurrent-multi-membership-write regression tests passing (added 2 September 2026)

## Dependencies

Sprint 22 go decision recorded, including the ADR-003/write-lock direction (Vol 12_1 V1.4 §5b), which this sprint implements. Sprint 21 sign-off on the RLS redesign approach.

**New dependency for Sprint 24 (recorded 3 September 2026):** `revoke_device`'s replacement-device requirement (Outcomes above) needs to be handled as part of Sprint 24's membership-removal operation — either that operation auto-revokes all of a removed membership's devices without going through `revoke_device`'s per-device replacement guard, or `revoke_device` itself gets a "membership is being removed, no replacement needed" mode. Sprint 24's own plan should account for this rather than discovering it mid-sprint.

## Risks

| Risk | Mitigation |
|---|---|
| RLS migration silently changes behaviour for an existing single-owner business | The regression suite from Sprints 1–20 is the gate — nothing in this sprint is done until 100% of it passes unchanged |
| Backfill logic gets the "which existing user is Owner" mapping wrong for an edge-case account | Since Phase 1/2 business_id literally equals the owner's auth.uid(), backfill is a 1:1 mechanical mapping with no ambiguity — verify this assumption explicitly against the real data before running it, not just in theory |
| Folding the active-device-lock re-scoping into this sprint (rather than a dedicated later sprint) enlarges its scope | Judged acceptable by the owner (2 September 2026) specifically to avoid a second migration of the same tables later; if this makes the two-week window too tight, the re-scoping task itself — not the rest of the sprint — is what should carry over, per Vol 12_1 §5b already being fully specified in direction |

## Safe to Carry Over

The full domain/capability-specific policy set for every future Vol 13_0 module table does not need to exist yet — those tables don't exist until their own module sprint. This sprint only needs the foundation tables' own policies plus the migrated existing ones.

---

*End of Sprint 23.*
