# AIFA — Growth-Adaptive Access Model: Solopreneur to Team
## Volume 13_3 — Series 13: SME Accounting & Compliance Modules — Version 1.1 (Sprint 21 Sign-Off Applied)

**Status:** Proposed, V1.1 — Open Item 1 (default threshold figures) resolved, recorded in Vol 13_2 §4.3 which this volume's Section 4 seeding trigger fires against
**Prepared:** 2 September 2026
**Amended:** 2 September 2026 — Sprint 21 Design Sign-Off
**Requested by:** "Our system will of course serve soloprenuer where the same person will be the maker and checker. As the company grows, and add new staff, then the work delegation and approval will be distributed accordingly. Our system must have that level of flexibility."
**Reads against:** Vol 13_1 (Multi-Role Tenant & Delegated Approval), Vol 13_2 (Role-Gated Capture & Segregation of Duties), Vol 0_1 §5 (confidence thresholds — the existing single-person behaviour this volume must not break).

**Design study, not a sprint** — same standing rule as the rest of Series 13.

---

## 1. The Requirement, Stated Precisely

Vol 13_1 and 13_2 designed the team apparatus — roles, delegation, maker-checker. Neither one designed what happens on day one, when there is no team, and neither designed the transition. Left as written, both volumes have a real failure mode: a solopreneur signing up would be handed role assignment, permission catalogs, and approval-queue concepts that describe a business they don't have yet — friction that actively works against the product's own core promise ("One Input. AI Does the Rest.") for the majority of businesses that start this way.

The owner's framing is the correct one and this volume adopts it directly: **access model is a stage the business is in, not a mode someone configures.** A one-person business and a twelve-person business are not two different products with a setting between them; they are the same system observed at two points on one continuous line, and every business that grows crosses that line without anyone having flipped a switch labelled "enable team mode."

## 2. Access Model as Derived State, Not Stored Configuration

```text
Business   (extends Vol 13_1 §2)
├── ...                            (unchanged fields)
└── access_model_override             enum, nullable: null | forced_solo | forced_team  — NEW
                                                        default null = auto-detect (Section 3);
                                                        an explicit escape hatch (Section 6), not
                                                        the normal path
```

**`effective_access_model` is computed, never stored as the primary source of truth**: `count(active BusinessMembership for this business) > 1` → `team`, else → `solo` — unless `access_model_override` overrides the computation. This is a deliberate choice over a stored "mode" flag the owner sets once at onboarding: a stored flag can drift out of sync with reality (an owner who hires someone and forgets to "turn on team mode," or forgets to turn it back off after a team member leaves), where a computed value cannot drift by construction — it is always exactly what the current membership table says it is. Every place in Vol 13_1/13_2 that branches on "is this a solo or team business" reads this computed value, recalculated at the moment it's needed, not cached.

## 3. Solo Mode — Exactly Today's Behaviour, Not a Reduced Team Mode

This is the important framing correction to Vol 13_1/13_2: solo mode is not "team mode with every check turned off." It is the existing, already-built Phase 1 system, completely unchanged in what the owner experiences:

- **Capture and approval collapse to one step**, exactly as they do today — an event at ≥90% confidence auto-records, 60-89% shows the owner a one-tap confirm/correct, <60% asks a clarifying question (Vol 0_1 §5, untouched by any of Series 13).
- **`ApprovalTask` rows are still created** (Vol 13_1 §6) — schema consistency matters more here than it looks: if solo-mode events never produced an `ApprovalTask` row, then a business growing into team mode would have two shapes of history (a "before" with no approval records and an "after" with them), and every report or audit view would need to special-case which era a given record came from, forever. Instead, a solo-mode `ApprovalTask` is created and **resolved instantly, automatically, in the same transaction as capture** — `resolved_via = solo_self_resolved` (a new value alongside Vol 13_1 §6's `direct_permission | delegation | escalation | auto_approved`), `decided_by_membership_id` set equal to `captured_by_membership_id` (Vol 13_2 §2), `decided_at` equal to `created_at`. The owner never sees a queue, never taps "approve" a second time — the row exists purely so history is uniform, not because solo mode has an approval *step*.
- **Vol 13_2 §4's segregation-of-duties exclusion never fires**, because it only ever applies when a `SegregationOfDutiesPolicy` exists for the domain, and Section 4 below states plainly that no such policy exists yet in solo mode — there is no maker/checker distinction to enforce when there is one person.
- **No permission catalog friction.** A solopreneur's single `BusinessMembership` is the seeded Owner template (Vol 13_1 §4.1: all domains, all capabilities, unlimited approval limit) — Section 3's capture-permission check (Vol 13_2 §3) always passes trivially, so it is never a visible gate a solo owner has to think about.

## 4. The Growth Trigger — What Activates, and When

Nothing in Sections 5-6 below happens until the moment a second `BusinessMembership` transitions to `status = active` (Vol 13_1 §4) — not at invitation, at *acceptance*, since an outstanding invite to a not-yet-active person should not change how the existing owner's own capture behaves in the meantime.

**What activates automatically, requiring no owner configuration:**
- `effective_access_model` recomputes to `team` the moment the second membership goes active — nothing to toggle.
- `SegregationOfDutiesPolicy` rows (Vol 13_2 §4.3) are seeded for the business **at this exact moment**, using the sensible per-domain defaults Vol 13_2 §4.3 already names (maker-checker on for sales/expense/payroll/legal above their thresholds, off for attendance/routine inventory) — not before, because seeding them earlier would mean policies sitting inert against a business that has nobody to check anyone, and seeding them reactively means the owner is never asked to design a controls policy before they have a reason to need one.
- The `ApprovalTask` resolution algorithm (Vol 13_1 §6.1) starts actually branching on eligibility/limits/delegation instead of trivially resolving to the sole Owner — this needs no code path change, since the algorithm was always written generally; it simply had only one eligible person to find before now.

**What requires an explicit owner action, deliberately not automated:**
- Assigning the new member's `Role` (Vol 13_1 §4.1's templates make this a one-pick decision, not a from-scratch design exercise, but it is still the owner's call, not a guess the system makes).
- Any deviation from Vol 13_2 §4.3's default `SegregationOfDutiesPolicy` thresholds — the defaults seed automatically; changing them is a `configure` action same as any other settings change (Vol 13_1 §3).

**What never happens:** historical `BusinessEvent`/`ApprovalTask` rows from the solo era are never retroactively re-evaluated against the newly-seeded SoD policy. This follows directly from the immutability principle Vol 4_1 §4 already states for `LedgerEntry` corrections — a record confirmed under the rules that existed at the time is not rewritten because the rules later changed; if the owner wants historical review, that is a reporting question ("show me everything I self-approved before we had a second person"), not a data-mutation one.

## 5. Team Mode — Exactly Vol 13_1/13_2, Unmodified

Nothing in this volume changes Vol 13_1 or Vol 13_2's design once `effective_access_model = team` — Sections 3-4 above exist specifically so that the transition *into* team mode is invisible in its mechanics (same tables, same algorithm, just now with more than one eligible party) and deliberate in its one owner-facing moment (role assignment). Team mode's own behaviour is exactly what those two volumes already specify.

## 6. Shrinking Back Down — Flexibility in Both Directions

The owner's framing ("as the company grows...") describes growth, but a computed state (Section 2) handles the reverse for free, which is worth stating explicitly since it is easy to under-design: if every non-Owner `BusinessMembership` is removed (staff turnover, a team that scales back down), `effective_access_model` recomputes to `solo` on its own the next time it's evaluated — no migration step, no "are you sure you want to exit team mode" flow, because there was never a stored mode to exit. `SegregationOfDutiesPolicy` rows are not deleted when this happens (Vol 13_2 §4.3 policies are cheap to leave in place, dormant, since they only ever apply when `effective_access_model = team` evaluates true), which matters for exactly one case: a business that shrinks to solo and later re-grows does not need its SoD thresholds re-decided from scratch — they're still there, waiting, from the first time the business crossed the line.

## 7. The Manual Override — For the Cases the Default Gets Wrong

Section 2's `access_model_override` exists because "more than one active member" is a good default proxy for "needs team controls," not a perfect one. Two named cases where an owner should be able to override the computed default:

- **`forced_solo`** — two co-owners/partners who fully trust each other and explicitly do not want maker-checker friction between themselves (a real, legitimate choice for e.g. a two-person partnership where both are effectively Owners) — without this, the moment a second Owner-equivalent joins, the system would impose controls neither partner asked for.
- **`forced_team`** — a still-solo owner who wants Section 4's SoD policies and approval-routing apparatus configured and visible in advance of hiring, rather than discovering it for the first time under the pressure of onboarding their first employee. A deliberate, opt-in exception to Section 3's "no friction until there's a reason" default, for an owner who wants to plan ahead.

Both are `configure`-capability actions (Vol 13_1 §3), Owner-only in practice since Vol 13_1 §4.1 is the only template with unrestricted `configure`.

## 8. UX Consequence (brief, matching Vol 13_2 §6's treatment)

A solo-mode business should not see an "Approvals," "Team," or "Roles" surface in the product at all — there is nothing there for them yet, and showing an empty queue or a one-person "team" screen answers a question the owner isn't asking. These surfaces should appear the moment `effective_access_model` first evaluates to `team` (or `forced_team` is set), not be present-but-empty beforehand. Deferred to a UX design pass, noted here so the data-architecture decision (Section 2's computed-not-stored model) is understood to have this direct product consequence.

## 9. Schema Summary (what this volume actually adds)

Two additive changes, both small: `Business.access_model_override` (Section 2), and one new `ApprovalTask.resolved_via` enum value, `solo_self_resolved` (Section 3) — everything else in this volume is behaviour (when SoD policies get seeded, when the resolution algorithm starts mattering) layered on schema Vol 13_1/13_2 already defined, not new tables.

## 10. Open Items

1. **Default `SegregationOfDutiesPolicy` thresholds at first seeding — RESOLVED at Sprint 21 sign-off.** Final RM amounts (expense RM 500, sales RM 2,000) are recorded in Vol 13_2 §4.3; this volume's Section 4 is the trigger that fires the seeding, unchanged.
2. **Whether `forced_team` (Section 7) should be available before a second membership ever exists** — technically yes (an Owner can set it on a still-solo business), but whether the product should surface that as an option pre-emptively or only reveal it once relevant is a UX decision, not an architectural one.
3. **Historical review reporting** (Section 4's "never retroactively re-evaluated" note) — "show me what I self-approved before we had a team" is a reasonable report to want; not designed here, flagged as a natural follow-on for whichever volume ends up covering Vol 13_0 Module E's reporting surface in more depth.

## 11. Relationships to Other Volumes

- Vol 13_1 (Multi-Role Tenant & Delegated Approval) — Section 4's approval-resolution algorithm (§6.1) is unmodified; this volume only changes when it starts mattering and adds one new `resolved_via` value.
- Vol 13_2 (Role-Gated Capture & Segregation of Duties) — Section 4's `SegregationOfDutiesPolicy` (§4.3) is unmodified in shape; this volume states its seeding trigger, which Vol 13_2 left unspecified.
- Vol 0_1 §5 (confidence thresholds) — Section 3 confirms explicitly that solo-mode behaviour is this existing, already-shipped model, not a new one Series 13 introduces.
- Vol 4_1 §4 (immutability/correction principle) — Section 4's "never retroactive" rule is a direct application of the same principle already governing `LedgerEntry` corrections.

---

*End of Volume 13_3.*
