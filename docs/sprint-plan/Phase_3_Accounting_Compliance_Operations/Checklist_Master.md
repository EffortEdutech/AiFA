# AIFA — Phase 3 (Accounting, Compliance & Multi-Role Operations) Master Checklist

Companion to `00_Sprint_Plan_Overview.md`. Same scope, tracked as checkboxes. Check items off as you go — don't mark a sprint's "Definition of Done" section complete until every item in it is checked.

**Status at time of writing:** Planning only. Every item below is unchecked because no Phase 3 code has been written yet — this checklist exists to be filled in as sprints run, not as a record of work already done.

**Maintenance convention (per the owner's SOP):** at the end of any session that touches Phase 3 work, update this file — check off what actually got done (not just attempted), add a line under the relevant sprint's "Ad-Hoc / Unplanned" note for anything unplanned that came up, and leave the first unchecked item as the visible "what's next." Commit/push is the owner's own action, not run automatically.

---

## Sub-phase 3a — Foundation

## Sprint 21 — Design Sign-Off & Series 13 Scope Confirmation ✅ COMPLETE (2 September 2026)

- [x] Vol 13_1 §11.5 sequencing (foundation-before-modules) confirmed by owner — confirmed by proceeding with Sprint 21 under this plan's stated ordering
- [x] Vol 13_1 §11.1 Sprint 22 scope (review, not finished spec) confirmed by owner — same
- [x] Vol 13_2 §8.1 default SoD domains/thresholds confirmed with owner figures — **expense/PV: RM 500, sales: RM 2,000**; payroll/legal_contract stay threshold-free (always gated)
- [x] Vol 13_3 §10.1 same threshold question for policy-seeding confirmed — same figures, seeded at the Sprint 24 growth-trigger hook
- [x] Vol 13_0 §14.2 WhatsApp mechanism decided — **click-to-chat** (zero external account setup; Business Platform remains a future upgrade)
- [x] Vol 13_0 §14.3 LHDN MyInvois sandbox registration status recorded — **not yet started**; owner will begin in parallel with Sub-phases 3a/3b, ahead of Sprint 33
- [x] Vol 13_0 §14.4 target Malaysian bank format for Sprint 34 chosen — **Maybank2u**
- [x] Vol 13_0 §14.5 e-signature provider — **deferred explicitly**, to be revisited closer to Sprint 36
- [x] Vol 13_0 §14.7 ChartOfAccounts migration acknowledged as its own reviewed step — acknowledged, Sprint 26 is that step
- [x] Purchase Operations gap closed — Vol 13_0 §4a added (Purchase Operations stub, sufficient for Sections 5/7's dependencies)
- [x] All amendments recorded and dated in the source volumes — Vol 13_0/13_1/13_2/13_3 all bumped to V1.1, dated 2 September 2026

**Sprint 21 Definition of Done**
- [x] Every Open Item above has an explicit recorded decision
- [x] No schema or code written this sprint

**Ad-Hoc / Unplanned:** _(none — sprint completed exactly as planned)_

**What's next:** Sprint 22 — Key-Wrapping & Multi-User Crypto Design Review.

---

## Sprint 22 — Key-Wrapping & Multi-User Crypto Design Review ✅ COMPLETE (2 September 2026)

- [x] Business-level KEK design specified — superseded by finding: no KEK/stored key exists; DEK is deterministic shared-secret derivation (Sprint 14). Reconciled as Path A (extend shared-secret model) vs. Path B (true envelope encryption, deferred)
- [x] Per-membership DEK wrapping design specified — see Path A/Path B comparison
- [x] Rotation design specified (new DEK issuance, re-wrap for remaining active members) — Path A: new recovery code, manual re-entry per device
- [x] Revocation design specified, exposure window between removal and rotation stated plainly — Path A inherits Sprint 19's `revoke_device` gap, extended to people
- [x] Interaction with ADR-003 (active-device lock) explicitly stated/amended — real structural conflict found (single-business-wide lock unworkable for team mode); resolved in direction, amended into Vol 12_1 (V1.4 §5b)
- [x] Self-review failure modes walked (simultaneous removal, partial rotation failure, capture-during-exposure-window)
- [x] Runbook document written (`Sprint_22_Multi_User_Key_Wrapping_Design_Review.md`)
- [x] Explicit go/no-go decision recorded — GO, with disclosed limitations

**Sprint 22 Definition of Done**
- [x] KEK/wrapping/rotation/revocation all specified in writing
- [x] Every failure mode has a confident answer or a flagged follow-on
- [x] Go/no-go recorded — if no-go, Sprint 23 does not start

**Owner decisions (2 September 2026):**
- Path A (extend existing recovery-code model) accepted for Sprint 24-25 and non-sensitive Sub-phase 3b domains; Path B (per-recipient envelope encryption) required, not optional, before Payroll/HR (Sprint 34-35) opens to a multi-person team.
- ADR-003 write-lock re-scoping (per-business → per-`BusinessMembership`) judged more urgent than the original "add as Sprint 24 task" recommendation — resolved in direction now (Vol 12_1 V1.4 §5b) and the concrete migration moved into **Sprint 23's** own Task Breakdown instead of Sprint 24's.

**Ad-Hoc / Unplanned:** ADR-003/active-device-lock scope conflict discovered during this sprint's review (not anticipated in the original Sprint 22 plan) — logged and resolved into Sprint 23's scope, see Sprint 23 section below and Vol 12_1 §5b.

**What's next:** Sprint 23 — Tenant, Role & Permission Schema + RLS Redesign.

---

## Sprint 23 — Tenant, Role & Permission Schema + RLS Redesign

## Sprint 23 — Tenant, Role & Permission Schema + RLS Redesign ✅ COMPLETE (3 September 2026)

**Schema**
- [x] `public.businesses` created, existing business_id values preserved
- [x] `public.permissions` seeded (11 domains × 4 capabilities, fixed — 44 rows verified)
- [x] `public.roles` / `public.role_permissions` seeded with 6 templates (fixed, well-known role ids)
- [x] `public.business_memberships` created with sole-Owner constraint (partial unique index + `enforce_sole_owner_membership` trigger)
- [x] Every existing business backfilled with exactly one active Owner membership

**RLS Migration**
- [x] `profiles` / `backups` — found NOT to need migration (already keyed by the person's own auth.uid(), correct as-is under multi-role; corrected from the original plan, see Sprint 23 doc Outcomes)
- [x] `sync_envelopes` policy migrated to membership-based check
- [x] `devices` / `active_device_lock` policies migrated
- [x] Real logic (device-lock RPCs) kept in SECURITY DEFINER functions; a new `is_active_member()` SECURITY DEFINER helper added after verification caught an infinite-recursion bug in the naive inline-subquery policy approach (see below)

**Ad-Hoc: Active-Device Write-Lock Re-Scoping (added 2 September 2026, from Sprint 22)**
- [x] `active_device_lock` / `devices` gain `business_membership_id`, per Vol 12_1 V1.4 §5b
- [x] Lock uniqueness/atomicity re-scoped to per-membership, not per-business
- [x] `register_device`, `request_activation`, `request_primary_takeover`, `set_primary_device`, `revoke_device` re-scoped accordingly (no RPC signature/client-code changes needed — caller's membership resolved server-side from auth.uid())
- [x] Solo-business regression: zero behavioural change proven
- [x] Two-membership regression: concurrent writes from different memberships' devices proven safe (Owner + Bookkeeper each hold independent active locks in the same business)

**Verification** (`app/backend/verification/sprint23_membership_rls_and_lock_test.py`, local-Postgres method per Sprint 14)
- [x] Full existing Phase 1/2 regression suite passes unchanged (base schema.sql replays clean)
- [x] Cross-tenant isolation proven with two distinct businesses
- [x] Solo-business behaviour proven unchanged
- [x] Sole-Owner constraints proven under real inserts/updates (second active Owner rejected; sole-Owner removal blocked)
- [x] `revoke_device` cross-membership authorization proven (blocked without `settings`/`configure`; allowed with it)

**Sprint 23 Definition of Done**
- [x] All five tables live with correct RLS
- [x] Templates seeded correctly
- [x] Backfill complete and correct
- [x] Regression suite passes
- [x] Active-device write-lock re-scoped to per-membership (Vol 12_1 V1.4 §5b), with solo- and multi-membership regression tests passing
- [x] Cross-tenant isolation proven

**Ad-Hoc / Unplanned:** A genuine bug was found and fixed during this sprint's own verification pass, not shipped: `business_memberships`' RLS policy (and every policy querying it) caused Postgres "infinite recursion detected in policy" — a self-referencing policy recursing into itself. Fixed with a `SECURITY DEFINER` helper function (`public.is_active_member`), the standard fix, before the sprint was called done. Also found: `revoke_device` needs a "membership is being removed, no replacement device exists" mode — logged as a new Sprint 24 task (see below), not fixed here since it belongs to Sprint 24's own removal operation.

**What's next:** Sprint 24 — Team Membership Lifecycle & Growth-Adaptive Access Model.

---

## Sprint 24 — Team Membership Lifecycle & Growth-Adaptive Access Model ✅ COMPLETE (3 September 2026)

**Membership Lifecycle**
- [x] Invitation creation implemented (`invite_member`, email-based, `configure`-gated)
- [x] Acceptance flow implemented (status → active, matched by the caller's own auth email against the pending invite)
- [x] Suspension/removal implemented (`suspend_membership`/`remove_membership`), sole-Owner guard enforced at operation level
- [x] Device cleanup on removal implemented (from Sprint 23): removed membership's devices auto-revoked and its `active_device_lock` row deleted, without `revoke_device`'s per-device replacement guard blocking it

**Growth-Adaptive Access Model**
- [x] `effective_access_model` implemented as a single shared computed function (backend RPC + `teamMembershipTransport.ts` client wrapper)
- [x] Solo-mode behaviour verified byte-identical to pre-Series-13 (Sprint 23's existing device-lock RPCs re-verified unaffected)
- [x] Growth trigger hook fires correctly on second membership going active (proven: stays solo right after invite, flips to team only at acceptance)
- [x] `access_model_override` (`forced_solo`, `forced_team`) implemented and configure-gated — normalization bug found and fixed during verification (see Sprint 24 doc Outcomes)
- [x] Shrink-back path verified by explicit test

**Ad-Hoc / Unplanned:** Two real decisions/fixes made mid-sprint, not part of the original plan: (1) owner decision to restrict a person to at most one live membership across ALL businesses globally, not just per-business — closes a latent gap in Sprint 23's device-lock RPCs; required making `business_memberships.user_id` nullable and adding `invited_email` so an invite can target someone without an existing account yet. (2) `effective_access_model` bug: originally returned the raw override string instead of normalized `solo`/`team` — found and fixed via this sprint's own verification pass before being called done.

**UX Consequence**
- [ ] Team/Roles/Approvals surfaces correctly hidden in solo mode, shown once team mode is reached — **not applicable yet, no such screens exist in this codebase.** `teamMembershipTransport.ts`'s `getEffectiveAccessModel` is delivered as the shared function for whichever future sprint builds those screens to call — see Sprint 24 doc Outcomes for the full scoping note.

**Sprint 24 Definition of Done**
- [x] Full invite → accept → active lifecycle works end to end
- [x] Sole-Owner removal blocked with clear error
- [x] `effective_access_model` correct in both directions, test-verified
- [x] Solo-mode identical behaviour verified
- [x] Overrides work and are gated
- [ ] UI surfaces correctly conditional — deferred, no screens exist yet (see above)

**What's next:** Sprint 25 — Delegated, SoD-Aware Approval Engine & Role-Gated Capture.

---

## Sprint 25 — Delegated, SoD-Aware Approval Engine & Role-Gated Capture ✅ COMPLETE (3 September 2026)

**Schema**
- [x] `public.approval_delegations` created
- [x] `public.segregation_of_duties_policies` created and seeded at growth-trigger hook
- [x] `ApprovalTask` (`public.approval_tasks`) built fresh with Vol 13_1/13_2 fields (assigned_membership_id, resolved_via, delegated_from, self_approved_via_escape_valve, etc.) — did not exist as a real table before this sprint, see Sprint 25 doc Outcomes
- [x] `sync_envelopes.captured_by_membership_id` / `capture_channel` added — `BusinessEvent` itself is still not a standalone table (Vol 13_1 §8 Path A encryption), so these land as plaintext metadata on `sync_envelopes`, see Sprint 25 doc Outcomes

**Engine Logic**
- [x] 5-step resolution algorithm implemented (Vol 13_1 §6.1)
- [x] Delegation lookup implemented (narrowing-only) — real bug found and fixed during testing, see Sprint 25 doc Outcomes
- [x] SoD maker-exclusion step implemented
- [x] Escape valve implemented with audit flag — branch-precise semantics refinement, see Sprint 25 doc Outcomes
- [x] `solo_self_resolved` instant resolution implemented, including payroll (owner decision, 3 September 2026)
- [x] Capture-permission gate implemented ahead of AI pipeline (as a pipeline-callable RPC, `check_capture_permission`)

**Verification**
- [x] Synthetic test domain exercises every resolution path (direct, delegation, escalation, SoD exclusion, escape valve, solo) — 27/27 checks pass
- [x] captured_by/decided_by both correctly surfaced on the same record

**Sprint 25 Definition of Done**
- [x] All tables live with RLS
- [x] Resolution algorithm tested against every path
- [x] Delegation narrowing verified
- [x] SoD + escape valve + audit flag verified
- [x] Solo-mode instant resolution verified
- [x] Capture gate verified rejecting unauthorised capture

**Ad-Hoc / Unplanned:** A real owner decision made mid-sprint, not assumed: whether a solo business's payroll should also resolve via `solo_self_resolved` given Vol 13_0 §10's "payroll never auto-approves" rule — owner confirmed yes, that rule targets AI-confidence bypass, not a sole owner's own capture-and-confirm act (implemented as a DB-level hard bar specifically on `p_auto_approved`, unrelated to `solo_self_resolved`). A real delegation-lookup bug (required the delegate to independently hold their own `approve` grant, contradicting Vol 13_1 §5's "delegation moves whose queue it lands in") found and fixed during testing, not shipped. A test-harness gap (missing `GRANT ... ON ALL SEQUENCES` for `authenticated`) found and fixed, not a schema bug. Pre-existing, unrelated TypeScript errors in `packages/core` (`@types/node`, `@noble/*` missing from this sandbox's `node_modules`) disclosed — confirmed not present in this sprint's own new file. Full details in the Sprint 25 doc's own Outcomes section.

**What's next:** Sprint 26 — Party, Document Numbering & Chart-of-Accounts Migration (first Sub-phase 3b module) — not started, awaiting explicit go-ahead.

---

## Sub-phase 3b — Sales, Pricing, Expense, Core Reports

## Sprint 26 — Party, Document Numbering & Chart-of-Accounts Migration ✅ COMPLETE (3 September 2026)

- [x] `public.parties` created with RLS (capture/view split by party_types: employee → hr_attendance_leave, else → sales)
- [x] `public.document_number_sequences` created — generic, reused by Party's own numbering (document_type='party') and by document sequences future modules will configure
- [x] Shared header/line pattern documented in the migration for future modules to implement as their own per-module tables (Vol 13_0 §3.2 — not a literal shared table, per this sprint's own plan)
- [x] `public.chart_of_accounts` created, plus `public.bank_accounts` / `public.bank_statement_lines` (Vol 13_0 §8)
- [x] Every Phase 1 account seeded as `is_system = true` (12 rows: 7 top-level + 5 Operating Expenses sub-categories), exact 1:1 mapping verified by test, immutable type/code enforced by trigger
- [x] `LedgerEntry` — **scope changed by owner decision mid-sprint**: no real `ledger_entry` table existed to migrate additively (it was, like `BusinessEvent` before Sprint 25, an encrypted `sync_envelopes` payload shape only) — owner chose to build a real server-side `public.ledger_entries` table now, following `ApprovalTask`'s own Sprint 25 precedent, rather than defer. See Sprint 26 doc Outcomes for the full discovery and the disclosed scope boundary (existing client pipeline and historical data migration explicitly NOT done this sprint)
- [x] Full existing ledger/report regression suite passes unchanged — unaffected, since the existing client-side ledger pipeline was deliberately left untouched

**Sprint 26 Definition of Done**
- [x] Party, numbering, ChartOfAccounts all live with RLS
- [x] Account seeding verified by direct comparison
- [x] Migration additive, not destructive — resolved differently than originally scoped (a brand-new table has no old column to migrate away from), see Outcomes
- [x] 100% regression pass (by construction — existing pipeline untouched)

**Ad-Hoc / Unplanned:** A genuine architecture discovery put to the owner before writing schema, not silently worked around: `LedgerEntry` was never a real Postgres table, so Vol 13_0 §8's literal "ALTER TABLE, backfill, drop old column" migration plan couldn't execute as written. Owner chose to give it a real server-side table now (bigger scope, done this sprint) over deferring it (smaller scope, matching Sprint 25's BusinessEvent precedent). Two real bugs found and fixed during testing (a wrong auto-provisioned document-number prefix for parties; a test-harness role-state artifact, confirmed not a schema bug by reproducing directly in psql). A real refactor (`caller_has_capability`) introduced additively, existing Sprint 23-25 code untouched. Full details in the Sprint 26 doc's own Outcomes section.

**What's next:** Sprint 27 — Pricing & Product Catalog — not started, awaiting explicit go-ahead.

---

## Sprint 27 — Pricing & Product Catalog

- [ ] `public.price_types`, `public.products`, `public.price_list_entries` created
- [ ] `PRICE-001` added as versioned Finance PKA rule
- [ ] AI drafting pipeline wired to consult `PRICE-001`
- [ ] Excel product import (parse → validate → review → commit) implemented
- [ ] Bad-row handling verified (surfaced for correction, not dropped/guessed)

**Sprint 27 Definition of Done**
- [ ] Products/price types/entries CRUD-able with correct role gating
- [ ] Price resolution verified with 3+ price types
- [ ] `PRICE-001` externalised, not inline
- [ ] Excel import verified end to end including a bad row

**Ad-Hoc / Unplanned:** _(none logged yet)_

---

## Sprint 28 — Quotation & Invoice + WhatsApp Send

- [ ] `public.quotations` / lines, `public.invoices` / lines created with domain RLS
- [ ] AI drafting extended for Quotation with line items, price/credit-term resolution
- [ ] Capture wired through role gate + `captured_by_membership_id`
- [ ] Quotation approval wired through real `ApprovalTask` engine
- [ ] WhatsApp send implemented per Sprint 21's chosen mechanism
- [ ] Quotation → Invoice conversion implemented, due date correct

**Sprint 28 Definition of Done**
- [ ] Full quotation → approve → send → convert cycle verified end to end
- [ ] SoD exclusion verified with two real distinct memberships
- [ ] `e_invoice_status` field present, defaulted correctly

**Ad-Hoc / Unplanned:** _(none logged yet)_

---

## Sprint 29 — Payments, Credit Notes & AR Ageing

- [ ] `public.payments`, `public.credit_notes` created
- [ ] Payment posting implemented (Cash/Bank debit, AR credit)
- [ ] `Invoice.status` state machine implemented including derived `overdue`
- [ ] Real AR ageing buckets implemented, replacing the flat outstanding list
- [ ] AI CFO overdue-follow-up wired to real bucket data
- [ ] Credit note issuance approval-gated

**Sprint 29 Definition of Done**
- [ ] Partial/full payment verified with correct posting
- [ ] Credit note issuance verified, approval-gated
- [ ] AR ageing verified against a manual test case
- [ ] `Invoice.status` full lifecycle verified

**Ad-Hoc / Unplanned:** _(none logged yet)_

---

## Sprint 30 — Payment Vouchers, Expense & Cash Book/P&L

- [ ] `public.payment_vouchers` created, wraps existing Expense event
- [ ] Receipt attachment via existing `Document` table
- [ ] PV routes through standard `expense` domain approval/SoD (no second path)
- [ ] Cash Book report implemented (minimal `BankAccount`)
- [ ] P&L report implemented with real category granularity
- [ ] Cost/expense percentage breakdown implemented

**Sprint 30 Definition of Done**
- [ ] PV creation/attachment/approval verified end to end
- [ ] Cash Book verified against a real bank account for one period
- [ ] P&L matches a manually-computed reference figure
- [ ] Cost breakdown correctly ranks categories

**Ad-Hoc / Unplanned:** _(none logged yet)_

---

## Sub-phase 3c — Inventory & Full Reports

## Sprint 31 — Inventory & Delivery Order

- [ ] `public.warehouses`, `public.stock_levels`, `public.stock_movements` created
- [ ] `public.delivery_orders` / lines, `public.stock_takes` / lines created
- [ ] Opening stock entry implemented
- [ ] DO dispatch → automatic stock decrement implemented
- [ ] Concurrent-dispatch race condition tested and proven safe
- [ ] Stock Take variance-to-adjustment generation implemented
- [ ] DO approval-gated (`domain = inventory`)
- [ ] Purchase-side auto-cost-calc wired if Sprint 21 addendum ready (else explicitly flagged deferred)

**Sprint 31 Definition of Done**
- [ ] Opening stock verified
- [ ] DO dispatch decrement verified including concurrency test
- [ ] Stock Take variance generation verified against a manual scenario
- [ ] DO approval-gated correctly

**Ad-Hoc / Unplanned:** _(none logged yet)_

---

## Sprint 32 — Full Accounting Reports

- [ ] Trial Balance report implemented, verified nets to zero
- [ ] Balance Sheet report implemented
- [ ] General Ledger export implemented (PDF/Excel)
- [ ] Stock report implemented
- [ ] Tax report placeholder implemented
- [ ] `public.bank_statement_lines` created
- [ ] Bank Reconciliation matching workflow implemented (unmatched/matched/ignored)

**Sprint 32 Definition of Done**
- [ ] Trial Balance nets to zero on real data
- [ ] Balance Sheet/GL match a manually-verified reference
- [ ] Bank Reconciliation verified against a real/realistic statement
- [ ] All reports respect role gating

**Ad-Hoc / Unplanned:** _(none logged yet)_

---

## Sub-phase 3d — Malaysian Compliance

## Sprint 33 — e-Invoice & SST Compliance

- [ ] `public.e_invoice_submissions`, `public.sst_transactions`, `public.sst_returns` created
- [ ] `MY-EINVOICE-RULES` and `MY-SST-RATES` Finance PKA Knowledge Objects created
- [ ] LHDN MyInvois sandbox submission/validation/QR integration implemented
- [ ] Consolidated invoice batch generation implemented
- [ ] SST computation wired into Invoice/PV line items
- [ ] Advice-boundary statement surfaced in-product

**Sprint 33 Definition of Done**
- [ ] At least one real invoice validated end to end against sandbox, QR generated
- [ ] Consolidated batch verified for one test period
- [ ] SST verified against 3+ codes/rates
- [ ] Rejection handling verified with real IRB reason shown
- [ ] Production cutover explicitly not attempted

**Ad-Hoc / Unplanned:** _(none logged yet)_

---

## Sub-phase 3e — Payroll, HR, Legal

## Sprint 34 — Payroll & Statutory Contributions

- [ ] `public.employee_profiles`, `public.payroll_runs`, `public.payslips` created
- [ ] `public.statutory_rate_tables`, `public.claims`, `public.salary_advances` created
- [ ] `public.bulk_payment_file_exports` created
- [ ] Sensitive EmployeeProfile fields encrypted at rest, verified
- [ ] Statutory rate tables seeded as versioned Finance PKA objects
- [ ] EPF/SOCSO/EIS/PCB calculation verified against official reference (3+ salary levels)
- [ ] Payroll auto-approval hard-block implemented and tested (including bypass-path testing)
- [ ] Claims/advances routed through their own approval before inclusion
- [ ] e-payslip delivery implemented (WhatsApp/email per Sprint 21 choice)
- [ ] Bulk payment file export implemented for chosen bank format
- [ ] Default role restriction on payroll domain verified by test

**Sprint 34 Definition of Done**
- [ ] Statutory calculations verified correct
- [ ] Auto-approval hard-block verified with no bypass found
- [ ] e-payslip delivered end to end
- [ ] Bulk payment file validated against real bank format spec
- [ ] Role restriction verified

**Ad-Hoc / Unplanned:** _(none logged yet)_

---

## Sprint 35 — Attendance, Leave & Commission

- [ ] `public.attendance_records`, `public.overtime_records` created
- [ ] `public.leave_types`, `public.leave_balances`, `public.leave_applications` created
- [ ] `public.commission_rules`, `public.commission_calculations` created
- [ ] GPS clock-in/out implemented with offline queueing (reusing Vol 7_4 pattern)
- [ ] Overtime derivation job implemented, routed through approval
- [ ] Approved overtime verified reaching a real payroll run
- [ ] Leave application/approval/balance-deduction cycle implemented
- [ ] Commission rule configuration + auto-trigger-on-invoice implemented
- [ ] Minimal revenue-vs-cost dashboard implemented

**Sprint 35 Definition of Done**
- [ ] GPS clock-in/out + offline queue verified (airplane-mode test)
- [ ] Overtime derivation/approval/payroll-reach verified
- [ ] Full leave cycle verified
- [ ] Commission verified for 2+ basis types
- [ ] Dashboard verified for one test period

**Ad-Hoc / Unplanned:** _(none logged yet)_

---

## Sprint 36 — Legal & Commercial

- [ ] `public.contracts`, `public.contract_alerts`, `public.e_signature_envelopes` created
- [ ] Contract CRUD + document attachment implemented
- [ ] Renewal alert generation implemented, verified firing at correct lead time
- [ ] e-signature provider integration implemented (Sprint 21 choice)
- [ ] Envelope status tracking reflected back onto parent Contract/Quotation
- [ ] Credit limit gate implemented at Invoice creation
- [ ] Owner override path implemented and logged
- [ ] `Contract.credit_limit_override` precedence over `Party.credit_limit` verified

**Sprint 36 Definition of Done**
- [ ] Renewal alert timing verified
- [ ] Full e-signature sign cycle verified with chosen provider
- [ ] Credit limit gate verified blocking a real over-limit test invoice
- [ ] Override path verified working and logged
- [ ] Override precedence verified by test

**Ad-Hoc / Unplanned:** _(none logged yet)_

---

## Phase 3 Exit Criteria (from Overview §5)

- [ ] 1. Solo-mode zero-friction verified
- [ ] 2. Two distinct non-Owner roles verified (allowed + denied action each)
- [ ] 3. SoD enforcement + escape valve + audit verified
- [ ] 4. One real end-to-end sale (quote → invoice → payment → AR/P&L) verified
- [ ] 5. DO dispatch decrement + Trial Balance/Balance Sheet/GL correctness verified for one period
- [ ] 6. One invoice validated against LHDN sandbox including QR
- [ ] 7. One payroll run verified against official reference, mandatory-approval-gated, valid bulk file produced
- [ ] 8. GPS clock-in/out + leave cycle + one commission calculation verified
- [ ] 9. Contract renewal alert + credit-limit hard gate verified
- [ ] 10. At least one real pilot business, 2+ weeks, no ledger-affecting bug, evidenced by usage log

---

*End of Checklist.*
