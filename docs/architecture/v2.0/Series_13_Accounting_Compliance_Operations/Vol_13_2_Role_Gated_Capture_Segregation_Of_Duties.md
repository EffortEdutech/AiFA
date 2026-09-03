# AIFA — Role-Gated Capture & Segregation of Duties
## Volume 13_2 — Series 13: SME Accounting & Compliance Modules — Version 1.1 (Sprint 21 Sign-Off Applied)

**Status:** Proposed, V1.1 — Open Item 1 (Purchase domain gap) resolved via Vol 13_0 §4a; §4.3 default thresholds resolved with owner figures. Design authority for Phase 3's sprint plan; code follows the sprint plan's own gating, not this document directly.
**Prepared:** 2 September 2026
**Amended:** 2 September 2026 — Sprint 21 Design Sign-Off
**Requested by:** "With the introduction of multi role per tenant, the input which was initially only allowed to be done by the owner is now open depends on the role. This is a very important design consideration."
**Reads against:** Vol 13_1 (Multi-Role Tenant & Delegated Approval — Section 3's Permission catalog, Section 6's `ApprovalTask`), Vol 4_0 (Business Data Architecture), Vol 11_1 §2-3 (`BusinessEvent`/`BusinessData` schema), Vol 0_1 §5 (confidence thresholds), Vol 7_1 (Business Event Capture Architecture), Vol 4_2 (Business Knowledge Store).

**Design study, not a sprint** — same standing rule as Vol 13_0/13_1.

---

## 1. What Actually Changes

Vol 13_1 solved *who signs off*. It quietly left the other half of the sentence alone: `BusinessEvent` (Vol 11_1 §2) and every capture flow built on it (Vol 7_1) were designed for exactly one person able to create input at all — the owner. Vol 13_1 §3 already put `capture` in the Permission catalog next to `view`/`approve`/`configure`, but nothing in either volume actually enforces it at the point an event is captured, attributes a capture to the person who made it, or asks the harder question this raises: **should the person who captures a transaction ever be the same person who approves it?**

That last question is not cosmetic. It is the core control real accounting systems are built around — "maker-checker" / segregation of duties (SoD) — and multi-role-per-tenant is precisely the thing that makes it possible to enforce, where a single-owner system structurally cannot (there's only one person, so maker and checker are always the same). Introducing roles without addressing this would build a system that *looks* like it has controls (an approval step exists) while quietly allowing the one thing that approval step exists to prevent (someone recording and approving their own transaction). This volume treats that as the central design problem, not an afterthought.

## 2. `BusinessEvent` — Attributing Capture (revises Vol 11_1 §2)

```text
BusinessEvent
├── id                        (unchanged)
├── business_id                  (unchanged)
├── captured_at                     (unchanged)
├── capture_mode                       (unchanged)
├── raw_input_ref                         (unchanged)
├── status                                   (unchanged)
├── superseded_by                                (unchanged)
├── domain_hint                                     enum: sale | purchase | expense | banking |
│                                                          unclassified  (unchanged values, but
│                                                          now the join key into Vol 13_1 §3's
│                                                          Domain enum — see Section 3 below)
├── captured_by_membership_id                          string, foreign key → BusinessMembership
│                                                                              — NEW. Null only for
│                                                                              events captured before
│                                                                              this volume's migration
│                                                                              (Section 7); every event
│                                                                              from a multi-role
│                                                                              business has one.
└── capture_channel                                        enum: mobile_app | web_app | api  — NEW,
                                                                    minor but relevant to Section 6's
                                                                    surface-gating and useful on its
                                                                    own for the audit trail
```

`captured_by_membership_id` is the single field this whole volume turns on: it is what makes "who typed this in" a queryable fact rather than an implicit assumption, and it is the join key Section 4's segregation-of-duties logic needs.

## 3. Capture Permission — Enforced Before the AI Pipeline Runs

Today, any input reaching `capturePipeline.ts` (Vol 6_1 §6) is processed unconditionally — there was never a gate to place, because there was only ever one person who could open the app's capture screens. That assumption is now false. The gate:

```text
domain_hint → Domain mapping (both enums already exist; this is the missing translation table):
  sale        → sales
  purchase    → purchase        (Vol 13_0 does not yet give Purchase its own module number —
                                  flagged as Open Item 5)
  expense     → expense
  banking     → accounting_reports   (a manual bank entry is a configure/capture action on the
                                       ledger side, not its own domain — reuses accounting_reports)
  unclassified → (blocked — see below)
```

**Before `BusinessEvent.status` leaves `queued`**, the pipeline checks that `captured_by_membership_id`'s `BusinessMembership` (via its `Role`'s `RolePermission`, Vol 13_1 §4) grants `capture` on the mapped `Domain`. No grant → the event is rejected at intake, not silently processed and then hidden — the owner-equivalent of Vol 0_1 §7's existing discipline ("never a fabricated guess") applied to permission instead of OCR failure: the capturing person sees a clear "you don't have capture access to Expenses — ask an Owner or Bookkeeper to grant it" message, not a swallowed request. `unclassified` can never pass this gate by construction, since it maps to no domain — this is an existing, unrelated behaviour (an unclassified event already can't auto-record, Vol 0_1 §5) that this rule now also covers from the permission side.

## 4. Segregation of Duties — The Real Design Decision

### 4.1 The control, stated as a rule

**By default, the `BusinessMembership` that captured a `BusinessEvent` is excluded from that event's downstream `ApprovalTask` eligible-approver set (Vol 13_1 §6.1 Step 1)** — a Sales Agent who drafts a quotation cannot be the one who approves sending it, even if their role would otherwise carry `approve` on `sales`. This is the accounting-control meaning of "maker-checker," and it is what actually justifies calling the approval step a *control* rather than a formality.

### 4.2 Where this rule cannot and should not apply unmodified

- **The Owner is never excluded from approving their own capture.** A sole owner, or an owner who happens to also be the one who captured something, is the ultimate accountable party for the business — SoD exists to prevent a subordinate from self-approving, not to lock the Owner out of their own system. `resolved_via = escalation` (Vol 13_1 §6.1 Step 3) already routes to Owner when no one else is eligible; this is the same principle stated for the ordinary case too.
- **A single-person or two-person business.** If excluding the maker leaves zero eligible approvers and escalation to Owner *is* the maker (a one-person business, or a two-person business where the Owner captured it), the rule cannot demand a second reviewer that does not exist. Section 4.3 makes this configurable rather than a hard block, precisely so a genuinely small team is not locked out of using the system at all.
- **Low-risk, high-volume capture.** Requiring a second person to review every single clock-in or every routine stock receipt would make the system unusable at the volume these events actually occur. SoD is proposed as a **per-domain**, not universal, control.

### 4.3 Schema — configurable, not hardcoded

```text
SegregationOfDutiesPolicy
├── business_id                string
├── domain                        enum (Vol 13_1 §3)
├── enforce_maker_checker            boolean — default true for: sales (above a threshold — see
│                                               amount_threshold_myr below), expense/payment
│                                               vouchers, payroll, legal_contract; default false for:
│                                               hr_attendance_leave (a clock-in has no financial
│                                               control value to gate this way), inventory capture
│                                               below a threshold
├── amount_threshold_myr                decimal, nullable — below this amount, self-approval is
│                                                             permitted even with the policy on
│                                                             (e.g. "maker-checker applies to
│                                                             expenses over RM 500" — small
│                                                             transactions don't need it, matching
│                                                             the same "don't gate what doesn't need
│                                                             gating" reasoning Vol 0_1 §5 already
│                                                             applies to AI auto-record bands)
└── allow_self_approval_if_sole_eligible    boolean — the Section 4.2 escape valve: if excluding
                                                        the maker leaves nobody eligible, this decides
                                                        whether the system falls back to letting the
                                                        maker approve their own capture (with the
                                                        fact that this happened recorded plainly,
                                                        Section 5) or blocks the transaction entirely
                                                        until a second person is added to the business
```

This makes SoD a business-configurable policy per domain, seeded with sensible defaults (Section 4.3's `enforce_maker_checker` defaults above), not a blanket rule every business is stuck with regardless of size — a two-person business and a twelve-person business have genuinely different needs here, and forcing one config on both would make the smaller one unusable or the larger one uncontrolled.

**`amount_threshold_myr` default values — RESOLVED at Sprint 21 sign-off (2 September 2026):** `expense` (Payment Voucher/expense domain) = **RM 500**; `sales` (quotation/invoice domain) = **RM 2,000**, matching the Approver/Supervisor role template's default `approval_limit_myr` (Vol 13_1 §4.1). These are the values `Sprint_24`'s growth-trigger hook (Vol 13_3 §4) seeds on a business's first crossing into team mode — owner-adjustable afterward via the `settings` domain `configure` capability (Vol 13_1 §3), same as any other business policy. `payroll` and `legal_contract` retain `enforce_maker_checker = true` with no threshold (every transaction gated, matching payroll's existing non-negotiable approval rule, Vol 13_0 §10) pending a future revision if the owner wants a threshold there too.

## 5. Audit Trail — Closing the Loop

`ApprovalTask` (Vol 13_1 §6) already records `decided_by_membership_id`. This volume adds one more fact worth stating explicitly rather than leaving implicit: any report or export drawing on `ApprovalTask` should always be able to show `BusinessEvent.captured_by_membership_id` alongside `ApprovalTask.decided_by_membership_id` side by side — "captured by X, approved by Y" — and, per Section 4.3's escape valve, plainly flag the specific case where they are the same person and a `SegregationOfDutiesPolicy` was in force (`self_approved_via_escape_valve: true` on the `ApprovalTask` row) rather than letting that fact blend invisibly into ordinary approvals. This is the same "explained, never silent" posture Vol 13_0 §12.1 already applies to the credit-limit gate, applied here to the one control an auditor or accountant will specifically look for.

## 6. Capture Surface Gating (brief — a UX consequence, not new schema)

Once capture is permission-gated (Section 3), the mobile/web capture surfaces themselves (Vol 7_1, 7_2) should not offer a domain a `BusinessMembership` cannot capture into — a Warehouse Staff role should not see a "Record Expense" button at all, not see it and then get rejected by Section 3's gate after the fact. This is a straightforward consequence of Section 3 already existing as a permission check the client can query before rendering, not a new design decision — noted here so it isn't missed when this volume reaches implementation, not designed further in this data-architecture volume.

## 7. Business Knowledge Store — Shared Learning, Not Per-Capturer

Vol 11_1 §7 / Vol 4_2's vendor-category-mapping heuristic (`confirmation_count >= 3` promotes a pattern to trusted, Vol 0_1 §3.4) is keyed by `business_id` only, with no notion of *who* confirmed it. This volume leaves that unchanged in shape but flags one refinement worth deciding rather than assuming: **should three confirmations from three different people count the same as three confirmations from one person confirming the same vendor three times?** The latter is weaker evidence (one person's habit, not the business's actual convention) but the schema as it stands cannot tell them apart. Proposed refinement — not a schema change, an algorithm one: track `confirming_membership_ids` (a small set, not just a count) on `BusinessKnowledgeEntry`, and let "trusted" require confirmations from at least two distinct members where the business has more than one active member capturing in that domain, falling back to the existing count-only rule for genuinely single-capturer businesses. Flagged as an Open Item (Section 8) rather than designed to completion here, since it is a judgement call about learning-signal quality, not a structural requirement the way Sections 2-5 are.

## 8. Open Items

1. **Purchase domain's own module number — RESOLVED at Sprint 21 sign-off.** Vol 13_0 §4a now gives Purchase Operations a stub module section; Section 3's domain-mapping table above is accurate as written.
2. **`SegregationOfDutiesPolicy` default seeding — RESOLVED at Sprint 21 sign-off.** Figures recorded directly in Section 4.3: expense RM 500, sales RM 2,000.
3. **Business Knowledge Store multi-confirmer weighting** (Section 7) is a proposed refinement, not a decided design — needs the owner's or a future sprint's judgement on whether the added complexity is worth it at real usage volumes.
4. **Historical `BusinessEvent` rows with `captured_by_membership_id = null`** (Section 2) — a migration note, not a design gap: existing single-owner-era events can be backfilled to that business's Owner membership once one exists, since in that era the owner genuinely was the only possible capturer.

## 9. Relationships to Other Volumes

- Vol 13_1 (Multi-Role Tenant & Delegated Approval) — Section 4's SoD exclusion is a direct modification to Vol 13_1 §6.1 Step 1's eligible-approver computation; this volume does not restate that algorithm, only the one new exclusion rule feeding into it.
- Vol 13_0 (Accounting & Compliance Operations) — every module's `ApprovalTask` usage inherits Section 4's SoD behaviour by the same reference relationship Vol 13_1 already established.
- Vol 11_1 §2 (`BusinessEvent` schema) and Vol 4_0 (Business Data Architecture) — Section 2 is a direct field-level revision of the existing schema, additive except for the historical-row backfill noted in Section 8.4.
- Vol 7_1 (Business Event Capture Architecture) — Section 6 names a direct UX consequence for this volume, deferred to a UX design pass rather than designed here.
- Vol 4_2 (Business Knowledge Store) / Vol 0_1 §3.4 — Section 7 proposes a refinement to the existing confirmation-count heuristic without changing its governing rule (nothing becomes trusted without repeated confirmation).

---

*End of Volume 13_2.*
