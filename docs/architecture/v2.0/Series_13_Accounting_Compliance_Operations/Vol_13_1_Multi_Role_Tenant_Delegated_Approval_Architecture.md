# AIFA — Multi-Role Tenant & Delegated Approval Architecture
## Volume 13_1 — Series 13: SME Accounting & Compliance Modules — Version 1.2 (Sprint 22 Key-Wrapping Review Applied)

**Status:** Proposed, V1.1 — Open Item 5 (foundation-before-modules sequencing) confirmed by owner at Sprint 21 sign-off; Open Item 1 (crypto review) is Sprint 22's own scope, confirmed as a review not a finished spec. Design authority for Phase 3's sprint plan.
**Prepared:** 2 September 2026
**Amended:** 2 September 2026 — Sprint 21 Design Sign-Off
**Requested by:** "Please make the system ready for multi role per tenant. This is very important in delegating during human verification and approval process" — directly resolving Open Item 1 of Vol 13_0, and promoting Vol 8_1 Section 2/3 (Bookkeeper/Staff, domain × capability scoping) from a stated-but-explicitly-unbuilt "target shape" (Vol 8_1 §6: "remain entirely unbuilt (Phase 2)") to a concrete, buildable design.
**Reads against:** Vol 8_1 (Identity & Access Management), Vol 8_2 (Security & Data Protection), Vol 4_4 (Local-First Storage & Synchronisation), Vol 12_1 (Cross-Platform Data Synchronisation — ADR-003/004), Vol 13_0 (this series' Section 3.3 `ApprovalTask`, and every module's Party table).

**Still a design study, not a sprint.** Per the same standing rule as Vol 13_0: nothing here is built without a separate, explicit go-ahead.

---

**Version 1.2 change note (2 September 2026):** Sprint 22's dedicated key-wrapping design review (`docs/sprint-plan/Phase_3_Accounting_Compliance_Operations/Sprint_22_Multi_User_Key_Wrapping_Design_Review.md`) found that Section 8's original KEK/wrapped-DEK language did not match how the existing Business DEK actually works (Sprint 14: deterministic shared-secret derivation, not a stored/generated key) — Section 8 is rewritten below to reconcile this and record the owner's reviewed decision. The review also found a real structural conflict between ADR-003's single-active-device write lock and multi-person team use; that is now resolved in direction in Vol 12_1 (Version 1.4, new §5b), referenced from Section 8 below. Section 11 Open Item 1 is marked resolved.

## 1. Why This Volume Exists, and Why It Changes the Plan

Vol 13_0 named this as Open Item 1 and moved on. That was the wrong call to leave open, and the owner has now said so directly: delegated approval is not a nice-to-have layered on top of the module build-out — it is a precondition for the `ApprovalTask` pattern (Vol 13_0 §3.3) to mean anything in a real business. "AI drafts, a human approves" only delegates real work if *which* human is a first-class, configurable answer — otherwise every draft still queues up in front of one person, which is the exact bottleneck the owner is trying to remove.

This volume does three things: (1) gives Vol 8_1's identity model the concrete schema it always said it would eventually need, (2) extends `ApprovalTask` so an approval routes to the right role, respects approval limits, and can be delegated when someone is away, and (3) is honest about the one place this is genuinely hard — Section 8 — because multi-role access collides with a real architectural decision (local-first, single-owner end-to-end encryption) that a permissions table alone cannot paper over.

## 2. Tenant Model — Decoupling `business_id` from a Single Person

**The current assumption, stated plainly.** `app/backend/schema.sql`'s Sprint 14 comment is explicit: *"business_id here IS the signed-in Supabase user's auth.uid() ... Phase 1/2 is single-user-per-business ... this reuses the identity Supabase already manages rather than inventing a separate 'business' concept."* Every RLS policy in the current backend (`profiles`, `backups`, `sync_envelopes`, `devices`, `active_device_lock`) checks `auth.uid() = business_id`. That equality is the thing multi-role breaks — a business with three logged-in people cannot have its identity be literally equal to any one of their login IDs.

**The change:** `business_id` stops being *derived* from a login and becomes what it always conceptually was — a standalone tenant identifier. No data migration is required for the equality itself (the existing UUID value continues to be the business's id unchanged); what changes is that other users can now hold a `BusinessMembership` row pointing at that same `business_id` without owning it.

```text
Business
├── id                     uuid, primary key — unchanged value from today's owner's auth.uid(),
│                                                for every business that already exists
├── legal_name             string, nullable
├── industry                string, nullable
├── pka_version               string
├── owner_user_id                uuid, foreign key → auth.users — the original account; always
│                                                                   retains an un-removable Owner
│                                                                   membership (Section 4)
└── created_at                     timestamptz
```

`public.profiles` (today's table) is not deleted — it continues to represent *a person's* account-level profile; `Business` is the new tenant-level row. A single person can, in principle, own more than one `Business` in the future (Section 11 flags this as explicitly out of scope for now, matching Vol 8_1 §5's own deferral to Vol 10_1 for true multi-tenant/multi-entity).

## 3. Permission Catalog — a Fixed Enum, Not a Free-Text Table

Vol 8_1 §3 already names the two axes ("domain" and "capability — view, capture, approve, configure"). This volume fixes both as closed enums, one row per module from Vol 13_0, so every future module addition is required to declare its own domain here rather than inventing ad hoc access rules per feature:

```text
Domain enum:
  sales              (Vol 13_0 §4 — quotations, invoices, payments, credit notes)
  pricing            (§5 — price lists, promotions, product costs)
  expense            (§6 — payment vouchers)
  inventory          (§7 — delivery orders, stock takes, product import)
  accounting_reports (§8 — chart of accounts, bank reconciliation, statements)
  tax_compliance     (§9 — e-Invoice, SST)
  payroll            (§10 — payroll runs, payslips, claims, advances)
  hr_attendance_leave (§11 — clock-in/out, overtime, leave)
  commission          (§11 — commission rules/calculations)
  legal_contract      (§12 — contracts, e-signature, credit limits)
  settings            (business configuration, team management itself)

Capability enum:
  view       — read-only visibility into the domain's records
  capture    — create new records (an AI-drafted or manual quotation, expense, clock-in, etc.)
  approve    — act on an ApprovalTask in this domain (Section 6)
  configure  — change domain-level settings (price types, chart of accounts, statutory rate
               table versions, credit limit policy, role definitions themselves)
```

```text
Permission     (the fixed catalog — 11 domains × 4 capabilities = 44 rows, seeded once, never
                owner-editable; roles grant a subset, they do not invent new permissions)
├── domain                enum, from above
└── capability             enum, from above
```

## 4. Roles and Team Membership

```text
Role
├── id                    string
├── business_id             string, nullable — null = system-defined template (Section 4.1);
│                                               non-null = a business's own cloned/customised role
├── name                     string
├── is_system_template         boolean
└── description                 string, nullable

RolePermission            (join table — a role's actual granted access)
├── role_id                  string, foreign key → Role
├── domain                     enum (Section 3)
└── capability                   enum (Section 3)

BusinessMembership
├── id                      string
├── business_id                string, foreign key → Business
├── user_id                       uuid, foreign key → auth.users — the invited person's login
├── role_id                          string, foreign key → Role
├── party_id                            string, nullable, foreign key → Party (Vol 13_0 §3.1) —
│                                                                        links this login to the
│                                                                        employee/agent record if
│                                                                        one exists, so payroll,
│                                                                        commission, and access
│                                                                        share one identity instead
│                                                                        of drifting apart
├── approval_limit_myr                     decimal, nullable — per-member override; null means
│                                                                "use the role's default limit"
│                                                                (Section 6.1)
├── status                                    enum: invited | active | suspended | removed
├── invited_by_membership_id                    string, nullable
├── invited_at                                     timestamptz
├── accepted_at                                       timestamptz, nullable
└── removed_at                                           timestamptz, nullable
```

**Every business always has exactly one Owner membership, and it cannot be the one being removed or suspended** — the same "never leave zero primary" discipline `revoke_device` already enforces for devices (`app/backend/schema.sql`, Sprint 19) applies here for the same reason: a business with no Owner membership is a business nobody can administer.

### 4.1 Built-in Role Templates

Shipped seeded, so a business is usable on day one without first designing its own role model — each business may clone and adjust a template into its own custom `Role`, but never edit the template row itself:

| Template | Typical grant (domain: capabilities) |
|---|---|
| **Owner** | all domains: view, capture, approve, configure — always, non-revocable, unlimited approval_limit |
| **Bookkeeper / Accountant** | accounting_reports: view+configure; sales, expense, inventory, pricing: view+approve; tax_compliance: view+capture+approve; payroll: view only (Vol 6_7 §5 sensitivity — Section 9 below) |
| **Sales Agent** | sales, pricing: view+capture; commission: view (own records only, Section 10); everything else: none |
| **Warehouse Staff** | inventory: view+capture; sales: view (to see linked Delivery Orders); everything else: none |
| **Payroll Admin** | payroll, hr_attendance_leave: view+capture+approve+configure; everything else: none |
| **Approver (Supervisor)** | expense, sales: approve only, with a role-default `approval_limit_myr` (e.g. RM 2,000) — capture/configure withheld; a pure verification role, matching the owner's own framing ("delegating during ... verification and approval") |

These are starting defaults, not fixed law — Open Item in Section 11 covers who tunes them and how.

## 5. Delegation — Covering the Owner's Actual Stated Need

Roles answer "what can this person normally do." Delegation answers "who stands in when they can't" — leave, travel, a deliberately shared queue — which is the specific mechanism the owner asked for.

```text
ApprovalDelegation
├── id                        string
├── business_id                  string
├── delegator_membership_id         string, foreign key → BusinessMembership
├── delegate_membership_id            string, foreign key → BusinessMembership
├── domain_scope                        enum, nullable — a single domain, or null = every
│                                                          domain the delegator can approve
├── starts_at / ends_at                    timestamptz / timestamptz, nullable end = open-ended
├── reason                                    string, nullable — "annual leave", "travelling"
├── created_by_membership_id                    string
└── status                                        enum: active | expired | revoked
```

A delegate never gains more authority than the delegator actually had — `domain_scope` can only narrow, not widen, the delegator's own `RolePermission` grants, and the delegate's own `approval_limit_myr` still applies where it is lower than the delegator's (delegation moves *whose queue* a task lands in, not a blank cheque). Multiple active delegations can point at the same person (e.g., two supervisors both delegate to the Owner while both are on leave); a delegation never removes the delegator's own ability to act if they come back early — `status` only ever becomes `revoked` by an explicit action or `expired` by passing `ends_at`, an approval is never silently orphaned by a delegation's end.

## 6. `ApprovalTask` — Revised (supersedes Vol 13_0 §3.3)

```text
ApprovalTask
├── id                        string
├── business_id                  string
├── domain                          enum (Section 3) — NEW: resolves who is even eligible
├── subject_type                      enum (unchanged from Vol 13_0 §3.3)
├── subject_id                           string
├── amount                                  decimal, nullable — the monetary figure Section 6.1's
│                                                                 limit check applies to (invoice/PV
│                                                                 total, payroll run total, etc.);
│                                                                 null for non-monetary tasks
│                                                                 (a leave application, a contract
│                                                                 signature request)
├── ai_draft_summary                            string
├── ai_confidence                                  decimal, nullable
├── assigned_membership_id                            string, nullable, foreign key →
│                                                                       BusinessMembership — set
│                                                                       once resolution (Section
│                                                                       6.1) picks a specific person;
│                                                                       null means "open to anyone
│                                                                       currently eligible," shown
│                                                                       to every eligible approver
│                                                                       until one of them acts
├── resolved_via                                        enum: direct_permission | delegation |
│                                                              escalation | auto_approved
├── delegated_from_membership_id                            string, nullable — populated only when
│                                                                                resolved_via =
│                                                                                delegation, for the
│                                                                                audit line in
│                                                                                Section 7
├── status                                                    enum: pending_approval | approved |
│                                                                    rejected | auto_approved
├── decided_by_membership_id                                    string, nullable
├── decided_at                                                    timestamptz, nullable
├── next_action                                                    string, nullable (unchanged)
└── created_at                                                        timestamptz
```

### 6.1 Resolution Algorithm

Run once when an `ApprovalTask` is created, and re-run if it is still `pending_approval` when a relevant `ApprovalDelegation` starts or ends:

1. Compute the **eligible set**: every `active` `BusinessMembership` whose `Role` grants `approve` on `ApprovalTask.domain`, and whose effective limit (`BusinessMembership.approval_limit_myr`, falling back to the role's default) is either null (unlimited) or `>= ApprovalTask.amount` (skip this check when `amount` is null).
2. If the eligible set is empty, walk each ineligible-by-limit member's active `ApprovalDelegation` rows for this `domain` (or scope-null) and add their delegate if the delegate is themself eligible by limit — `resolved_via = delegation`.
3. If still empty, **escalate to the Owner membership automatically** — `resolved_via = escalation`. This is the same "never leave a task with nowhere to go" discipline Section 4 already applies to Owner-membership removal; an approval bottleneck is a worse failure than an over-broad escalation to the one membership that is guaranteed to exist and never expire.
4. If the eligible set has exactly one member, set `assigned_membership_id` directly. If it has more than one (e.g., two Bookkeepers), leave `assigned_membership_id` null — first eligible person to act wins, same "whoever's free handles it" behaviour a shared queue implies; the UI surfaces the same task to all of them and the losing race gets a "already actioned by X" state rather than a stale approve button.
5. `resolved_via = auto_approved` bypasses this whole algorithm — it is Vol 13_0 §3.3's existing confidence-band shortcut, unchanged, and **Section 9 below still hard-bars payroll from ever taking this path**, unchanged from Vol 13_0 §10.

## 7. Audit Trail

Every `ApprovalTask` row already carries `decided_by_membership_id`, `resolved_via`, and (where applicable) `delegated_from_membership_id` — a report over this table answers "who approved this, in what capacity, and was it delegated" without any extra schema, which is the concrete form of Vol 4_1 §4's "traceable links from every posting back to its Business Event" applied to the *approval*, not just the ledger posting. A rejected `ApprovalTask` is never deleted or overwritten — same immutability discipline Vol 4_1 §4 already applies to `LedgerEntry` corrections (reverse-and-repost, never edit-in-place) carries over here by the same reasoning: an audit trail that can be edited after the fact is not an audit trail.

## 8. The Hard Part — Local-First Encryption vs. Multi-User Access (reviewed and reconciled — Sprint 22, 2 September 2026)

This is the section that cannot be waved away, and it is why this volume treats "ready for multi-role" as a real architectural decision, not a table addition.

**The conflict, stated precisely.** Vol 4_4 (Local-First Storage) makes the device the primary operational environment; the business's actual data (`BusinessEvent`, `BusinessData`, `LedgerEntry`, and every Vol 13_0 module table above it) lives client-side, and per Sprint 14's DEK model, is encrypted with a key the owner's device holds — the existing multi-*device* sync (Sprint 14-20, ADR-003/004) is explicitly multi-device-**for-one-owner**, with a single active-device write lock. None of that machinery currently has a concept of a second *person* — a Bookkeeper on their own laptop, logged in as themselves — reading or writing the same encrypted store at all. A permissions table cannot grant a Sales Agent's phone access to data it has no key to decrypt.

**Correction from the original Version 1.1 text (Sprint 22 finding):** the paragraphs below originally proposed "a business-level KEK wrapping the DEK" and "per-membership wrapped-DEK distribution" — conventional envelope-encryption language. Sprint 22's dedicated review found this does not match how the Business DEK actually works: per Sprint 14's runbook, the DEK is never generated-and-stored at all — it is **deterministically derived, independently, on every device**, via `deriveBusinessDek(recoveryCode, businessId)` (HKDF-SHA256). There is no key to "wrap"; there is a shared secret (the recovery code) that anyone holding it can turn into the same DEK, offline. The reviewed design below (Path A) replaces the original KEK/wrapping proposal with what the codebase actually supports; true per-recipient envelope encryption (Path B, the original proposal's intent) is retained as a real, deferred direction, not abandoned.

**Reviewed design — Path A, the near-term model (Sprint 24-25 and Sub-phase 3b's non-sensitive-domain modules):**

1. **No new primitive.** Every `BusinessMembership` that needs decrypt access receives the current recovery code, entered manually into their device the same way a new device does today (Sprint 14 §2 Step 2) — extending the existing shared-secret mechanism to people, not just one owner's devices.
2. **Rotation** = generate a new recovery code; every remaining active membership's device(s) must re-enter it, exactly like onboarding a new device today. This is more rotation friction than a true wrapped-DEK design would have, disclosed plainly rather than understated.
3. **Revocation is honest, not clean.** A removed `BusinessMembership` is not cryptographically cut off at the moment of removal — only completed rotation closes the window, the same category of gap Sprint 19's `revoke_device` comment already admits for a single owner's own devices, now extended to people. Vol 13_0's Sprint 19 `revoke_device` comment is explicit that it *cannot* force-invalidate a still-valid session; Path A does not close that gap, it inherits it.
4. **No cryptographic role enforcement under Path A.** Because every holder of the recovery code can derive the *same* DEK for the whole business, a Warehouse Staff member's device is, cryptographically, just as capable of decrypting Payroll data as the Owner's — Section 4's role/permission model is enforced entirely at the application/RLS layer under Path A, never at the encryption layer. This is the single most important limitation this volume states plainly, per the review's own instruction not to soften it (see Section 9).

**Reviewed design — Path B, required before Payroll/HR opens to a team (deferred, Sprint 34-35's gate):** true per-recipient envelope encryption — each membership's device generates its own asymmetric keypair, a real randomly-generated DEK is wrapped separately per registered public key (sealed-box style). Rotation re-wraps only for remaining members, with no manual re-entry; revocation is a clean server-side re-wrap. This is what the original Version 1.1 text described in shape, but it is a new primitive with zero precedent in the codebase, and its lost-device-recovery story is not designed — see the full comparison in `Sprint_22_Multi_User_Key_Wrapping_Design_Review.md` Section 2.

**Owner decision recorded (2 September 2026):** Path A is accepted for Sprint 24-25 and non-sensitive Sub-phase 3b domains; Path B is required, not optional, before payroll/HR domain data (Section 9 below, Vol 13_0 §10-11, Sprint 34-35) is opened to a multi-person team.

**A second, independent finding from the same review — the active-device write lock.** ADR-003's single-active-device-write-lock (Vol 12_1 §5a-8), designed for one owner's own devices, would — applied unmodified — allow only one device across an entire *business* to write at a time once `BusinessMembership` means more than one person, making genuinely concurrent team use impossible. The owner judged this more urgent than a later-sprint task: it is now resolved in direction and amended into Vol 12_1 (Version 1.4, new §5b) — the lock's scope moves from per-business to per-`BusinessMembership` — with the concrete schema/RPC rework folded into **Sprint 23's** own RLS migration task rather than deferred further.

4. **Practical consequence for Vol 13_0's modules, unchanged from Version 1.1:** team-shared entities (Invoice, Quotation, Delivery Order, PaymentVoucher, ApprovalTask itself, and everything in this volume) most likely need to live with the **cloud (Postgres) as the actual multi-user source of truth**, not as a backup blob of an on-device SQLite file — because only a server the business's members all reach can mediate "many people, one shared dataset, role-gated" access without every device needing every other device's live connection. Local SQLite becomes each device's *cache/offline-write-queue* against that shared store, closer to how the existing sync envelope model (Sprint 14-16) already moves data device-to-cloud-to-device, just now cloud-to-*multiple-owners* too. This is a materially bigger shift than Vol 13_0 anticipated, and is the real reason this volume exists as its own document rather than three extra tables bolted onto Vol 13_0.

**What this section now claims, and what it still does not:** Path A is a reviewed, buildable design — Sprint 23 onward may build against it for non-sensitive domains. Path B remains a credible direction, not a ready spec; its algorithm choice and lost-device recovery story are still open (see `Sprint_22_Multi_User_Key_Wrapping_Design_Review.md` Section 7) and should get specialist applied-crypto input before Sprint 34-35 builds against it.

## 9. Payroll/HR Sensitivity — Extending, Not Replacing, the Existing Rule

Vol 6_7 §5 already classifies payroll as high-sensitivity; Vol 13_0 §10 already hard-bars payroll from auto-approval. This volume adds the access-control half: `payroll` and `hr_attendance_leave` domain permissions are the two domains where `view` and `approve` are **never** granted to a system-template role beyond Owner and Payroll Admin (Section 4.1's table already reflects this — Bookkeeper gets `view only` on payroll, nothing else does by default) — a business can still explicitly grant more via a custom cloned role, but the templates deliberately default closed here, the same "explained, never silent" posture Section 12.1 of Vol 13_0 already applies to the credit-limit gate.

## 10. Row-Level Security — Conceptual Redesign

Every existing RLS policy in `app/backend/schema.sql` (`profiles`, `backups`, `sync_envelopes`, `devices`, `active_device_lock`) currently reads `using (auth.uid() = business_id)`. Under this model that check is replaced everywhere by membership lookup, conceptually:

```sql
using (
  exists (
    select 1 from public.business_memberships bm
    where bm.business_id = <table>.business_id
      and bm.user_id = auth.uid()
      and bm.status = 'active'
  )
)
```

— with domain/capability-specific policies (e.g. an `invoices` table's insert policy) additionally joining `role_permissions` to check the specific `(domain, capability)` grant, mirroring how `request_activation`/`request_primary_takeover` (Sprint 15) already use `SECURITY DEFINER` functions rather than bare table policies for anything with real business logic — approval resolution (Section 6.1) is exactly that kind of operation and belongs in a function, not a passive RLS check, for the same reasons device activation already does.

## 11. Open Items

1. **Cryptographic design review (Section 8) — RESOLVED at Sprint 22 (2 September 2026).** The review happened as this item recommended; Section 8 above is rewritten with its findings. Path A is reviewed and buildable for non-sensitive domains; Path B (still needing specialist applied-crypto input on algorithm choice and lost-device recovery) remains open specifically as Sprint 34-35's gate, not a general blocker.
2. **Invitation flow UX** (how a business owner actually invites a Bookkeeper — email link, in-app code, phone number) is not designed here; only the resulting `BusinessMembership(status=invited)` row is.
3. **Who tunes role templates and approval limits** — presumably the Owner via `configure` on the `settings` domain (Section 4.1's table already grants this), but the UI for it is out of scope here.
4. **Multi-business-per-owner** (Section 2's brief mention) stays explicitly out of scope, consistent with Vol 8_1 §5 deferring true multi-tenant/multi-entity to Vol 10_1.
5. **Sequencing against Vol 13_0's Section 13 phase plan**: because `ApprovalTask` (Vol 13_0 §3.3) is used by essentially every module, and this volume changes its shape (Section 6), this volume's `Business`/`Role`/`BusinessMembership`/delegation schema should land **before** Vol 13_0's Sub-phase 2a, not after — building Module A's approval flow against the old single-approver shape and retrofitting roles later would mean redoing it. Recommend treating this volume as **Sub-phase 2a's own prerequisite**, not a later phase.

## 12. Relationships to Other Volumes

- Vol 8_1 (Identity & Access Management) — this volume is the concrete schema for §2/§3, which Vol 8_1 §6 already named as the target shape and explicitly left unbuilt.
- Vol 8_2 (Security & Data Protection) — Section 8's key-wrapping direction extends Vol 8_2's encryption model rather than replacing it.
- Vol 4_4 / Vol 12_1 (Local-First Storage, Cross-Platform Sync, ADR-002/003/004) — Section 8 states why the existing single-owner multi-device sync model needs to grow into a multi-person model, and that DEK rotation (already Vol 12_1 §12's top-priority open item) now has a second driver.
- Vol 13_0 (Accounting & Compliance Operations) — Section 6 of this volume supersedes Vol 13_0 §3.3's `ApprovalTask`; every module in Vol 13_0 (§4-§12) inherits domain-scoped, delegatable approval by reference to this volume rather than redefining it per module.
- Vol 6_7 (Payroll Operations) §5 — Section 9 of this volume is the access-control counterpart to the sensitivity classification Vol 6_7 already states.

---

*End of Volume 13_1.*
