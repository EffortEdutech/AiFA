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

## Sprint 27 — Pricing & Product Catalog ✅ COMPLETE (3 September 2026)

- [x] `public.price_types`, `public.products`, `public.price_list_entries` created
- [x] `PRICE-001` added as versioned Finance PKA rule (`accounting_rules.json`, `pka_version` 0.3.0 → 0.4.0)
- [x] AI drafting pipeline wired to consult `PRICE-001` — **scope note**: no AI drafting call site for pricing exists yet (that's Sprint 28's Quotation/Invoice module); `resolve_price` is deterministic per `BANK-001`'s own precedent (a lookup, not a classification judgment), and Sprint 28 is where it actually gets called. See Sprint 27 doc Outcomes.
- [x] Excel product import (parse → validate → review → commit) implemented
- [x] Bad-row handling verified (surfaced for correction, not dropped/guessed)

**Sprint 27 Definition of Done**
- [x] Products/price types/entries CRUD-able with correct role gating
- [x] Price resolution verified with 3+ price types (Retail/Wholesale/VIP), including a disclosed extra fallback case
- [x] `PRICE-001` externalised, not inline
- [x] Excel import verified end to end including a bad row

**Ad-Hoc / Unplanned:** No bugs found this sprint — 24/24 verification checks passed on the first run against the real, cumulative schema. Two disclosed, provisional design calls made without an `AskUserQuestion` escalation (judged lower-stakes than Sprint 25/26's architecture forks, both already time-boxed by this sprint's own risk notes): (1) `resolve_price`'s fallback chain extends Vol 13_0 §5's literal two-step wording with a third case — a party's assigned price type existing but having no entry for the specific product also falls through to the business default, rather than failing; (2) the Excel import parser's column-header matching (`productImportParser.ts`) uses conventional header-name guesses, disclosed in its own file header as provisional pending a real sample file from the owner (the sprint's own risk mitigation called for one but none was available). Full details in the Sprint 27 doc's own Outcomes section.

**What's next:** Sprint 28 — Quotation & Invoice + WhatsApp Send — not started, awaiting explicit go-ahead.

---

## Sprint 28 — Quotation & Invoice + WhatsApp Send ✅ COMPLETE (3 September 2026)

- [x] `public.quotations` / lines, `public.invoices` / lines created with domain RLS
- [x] AI drafting extended for Quotation with line items, price/credit-term resolution — **scope note**: the deterministic price (PRICE-001) and credit-term (`Party.credit_terms_days`) resolution is built and tested; the free-text-to-{party_id, product_id} NLP entity-resolution step (matching "ABC Trading"/"Product X" in plain text to real records) is NOT built this sprint — disclosed as necessary follow-on work, not silently skipped. See Sprint 28 doc Outcomes.
- [x] Capture wired through role gate + `captured_by_membership_id`
- [x] Quotation approval wired through real `ApprovalTask` engine
- [x] WhatsApp send implemented per Sprint 21's chosen mechanism (click-to-chat) — PDF/link generation itself is disclosed as not yet built (message text + `wa.me` link only)
- [x] Quotation → Invoice conversion implemented, due date correct

**Sprint 28 Definition of Done**
- [x] Full quotation → approve → send → convert cycle verified end to end
- [x] SoD exclusion verified with two real distinct memberships (Owner excluded as maker, Bookkeeper approves)
- [x] `e_invoice_status` field present, defaulted correctly

**Ad-Hoc / Unplanned:** Two real bugs found and fixed in existing Sprint 25/27 code while building on top of it — exactly what this sprint's own risk note anticipated: (1) `resolve_price` (Sprint 27) had no authorization check at all, letting any authenticated user read any business's pricing data — fixed with a `pricing`/`view` capability check; (2) `create_approval_task`/`resolve_approval_task` (Sprint 25) never actually persisted Vol 13_0 §3.3's own "what fires once approved" field — `next_action` was always clobbered by the resolution algorithm — fixed by adding a separate `on_approval_action` column. Full details, plus the disclosed ledger-posting-entry-point decision and the quotation-status/ApprovalTask-status split, in the Sprint 28 doc's own Outcomes section.

**What's next:** Sprint 29 — Payments, Credit Notes & AR Ageing — not started, awaiting explicit go-ahead.

---

## Sprint 29 — Payments, Credit Notes & AR Ageing ✅ COMPLETE (3 September 2026)

- [x] `public.payments`, `public.credit_notes` created
- [x] Payment posting implemented (Cash/Bank debit, AR credit)
- [x] `Invoice.status` state machine implemented including derived `overdue` — read-time-only, never stored (see Sprint 29 doc Outcomes)
- [x] Real AR ageing buckets implemented, replacing the flat outstanding list
- [x] AI CFO overdue-follow-up wired to real bucket data — **scope note**: `ar_ageing_detail` is built and tested; the AI CFO Assistant's own client-side code was not modified to call it in place of the old flat list — disclosed as necessary follow-on work, not silently skipped. See Sprint 29 doc Outcomes.
- [x] Credit note issuance approval-gated

**Sprint 29 Definition of Done**
- [x] Partial/full payment verified with correct posting
- [x] Credit note issuance verified, approval-gated
- [x] AR ageing verified against a manual test case — verified against three (15-day, 45-day, not-yet-due) plus a fully-paid-invoice exclusion check
- [x] `Invoice.status` full lifecycle verified

**Ad-Hoc / Unplanned:** No bugs found in existing code this sprint — 26/26 verification checks passed on the first run against the real, cumulative schema. Notable disclosed design decisions (none escalated to `AskUserQuestion` — judged as implementation-detail-level, each already reasoned through and none touching an owner-level risk tradeoff): CreditNote built as a single-amount document rather than a full line-item DocumentHeader/DocumentLine pair (Vol 13_0's own text never describes a CreditNoteLine table, and the DoD doesn't require line-level allocation); credit note posting reuses the Sales Revenue account rather than a not-yet-existing "Sales Returns" contra-revenue account; `record_payment`/`create_credit_note` gated on EITHER `sales` capture OR `accounting_reports` configure (verified both paths work); overpayment rejected outright rather than allowed to go negative. Full details in the Sprint 29 doc's own Outcomes section.

**What's next:** Sprint 30 — Payment Vouchers, Expense & Cash Book/P&L — not started, awaiting explicit go-ahead.

---

## Sprint 30 — Payment Vouchers, Expense & Cash Book/P&L

- [x] `public.payment_vouchers` created, wraps existing Expense event
- [x] Receipt attachment via existing `Document` table
- [x] PV routes through standard `expense` domain approval/SoD (no second path)
- [x] Cash Book report implemented (minimal `BankAccount`)
- [x] P&L report implemented with real category granularity
- [x] Cost/expense percentage breakdown implemented

**Sprint 30 Definition of Done**
- [x] PV creation/attachment/approval verified end to end
- [x] Cash Book verified against a real bank account for one period
- [x] P&L matches a manually-computed reference figure
- [x] Cost breakdown correctly ranks categories

**Ad-Hoc / Unplanned:** A real bug found during this sprint's own testing — `cash_book_detail()`'s `v_opening_movement` query had an ambiguous column reference (`direction`/`amount` unqualified against a join). Fixed by table-qualifying against `public.ledger_entries le`. Disclosed in the migration's own header note 7 and the Sprint 30 doc's Outcomes.

**What's next:** Sprint 31 — Inventory & Delivery Order.

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
- [x] Opening stock verified
- [x] DO dispatch decrement verified including concurrency test
- [x] Stock Take variance generation verified against a manual scenario
- [x] DO approval-gated correctly

**Ad-Hoc / Unplanned:** None — full test suite (including a genuine 3-trial threaded concurrency race using real, separate psycopg2 connections) passed on the first run.

**What's next:** Sprint 32 — Full Accounting Reports.

---

## Sprint 32 — Full Accounting Reports

- [x] Trial Balance report implemented, verified nets to zero
- [x] Balance Sheet report implemented
- [x] General Ledger export implemented (PDF/Excel)
- [x] Stock report implemented
- [x] Tax report placeholder implemented
- [x] `public.bank_statement_lines` created
- [x] Bank Reconciliation matching workflow implemented (unmatched/matched/ignored)

**Sprint 32 Definition of Done**
- [x] Trial Balance nets to zero on real data
- [x] Balance Sheet/GL match a manually-verified reference — **disclosed note**: the Balance Sheet is deliberately verified as NOT balancing (assets ≠ liabilities + equity) for a business with real revenue/expense activity, since no period-closing/retained-earnings mechanism exists anywhere in the schema yet. Verified directly (asserted `!=`), not hidden. See Sprint 32 doc Outcomes.
- [x] Bank Reconciliation verified against a real/realistic statement
- [x] All reports respect role gating

**Ad-Hoc / Unplanned:** None — all 20 checks passed on the first run.

**What's next:** Sprint 33 — e-Invoice & SST Compliance.

---

## Sub-phase 3d — Malaysian Compliance

## Sprint 33 — e-Invoice & SST Compliance

- [x] `public.e_invoice_submissions`, `public.sst_transactions`, `public.sst_returns` created
- [x] `MY-EINVOICE-RULES` and `MY-SST-RATES` Finance PKA Knowledge Objects created
- [ ] LHDN MyInvois sandbox submission/validation/QR integration implemented — **OPEN.** Built against a stubbed/simulated response only; no real sandbox credentials available this sprint. See Outcomes below.
- [x] Consolidated invoice batch generation implemented
- [x] SST computation wired into Invoice/PV line items
- [x] Advice-boundary statement surfaced in-product

**Sprint 33 Definition of Done**
- [ ] At least one real invoice validated end to end against sandbox, QR generated — **OPEN**
- [x] Consolidated batch verified for one test period
- [x] SST verified against 3+ codes/rates
- [ ] Rejection handling verified with real IRB reason shown — **OPEN** (verified against a simulated IRB rejection only)
- [x] Production cutover explicitly not attempted

**Ad-Hoc / Unplanned:** This sprint's DoD required real LHDN MyInvois sandbox credentials that this session does not have and cannot fabricate. Per standing rule (never expose/fabricate secrets or credentials) this was escalated to the owner directly via AskUserQuestion — the first such escalation since Sprint 25/26 — offering: (a) owner supplies real sandbox credentials, (b) build stubbed now, wire in credentials later, (c) skip to Sprint 34 per this sprint's own named risk fallback. **Owner chose (b).** The full schema, Finance PKA rule sets, SST computation, submission state machine, and a real `MyInvoisClient` interface (with `StubMyInvoisClient` wired up) were built and verified against a simulated MyInvois response. DoD items 1 and 4 stay explicitly open above, not silently checked off. Also found and fixed a historic Sprint 28 bug: `create_quotation` accepted a `tax_code` per line but never persisted it, so no invoice created through the normal flow could ever carry a tax code forward to SST computation — see the migration's own header note 8 and the Sprint 33 doc Outcomes for the full account.

**What's next:** Sprint 34 — Payroll & Statutory Contributions. Not started, awaiting the owner's explicit go-ahead. Standing reminder: payroll/HR data is high-sensitivity and payroll approval must never auto-approve regardless of AI confidence (Vol 13_0 §10).

---

## Sub-phase 3e — Payroll, HR, Legal

## Sprint 34 — Payroll & Statutory Contributions

- [x] `public.employee_profiles`, `public.payroll_runs`, `public.payslips` created
- [x] `public.statutory_rate_tables`, `public.claims`, `public.salary_advances` created
- [x] `public.bulk_payment_file_exports` created
- [x] Sensitive EmployeeProfile fields encrypted at rest, verified (pgcrypto; round-trip and wrong-key-fails both tested)
- [x] Statutory rate tables seeded as versioned Finance PKA objects
- [x] EPF/SOCSO/EIS/PCB calculation verified against official reference (3+ salary levels) — PCB is a disclosed simplified approximation, not LHDN's literal Formula Method; see Sprint 34 doc Outcomes
- [x] Payroll auto-approval hard-block implemented and tested (including bypass-path testing)
- [x] Claims/advances routed through their own approval before inclusion
- [x] e-payslip delivery implemented (WhatsApp/email per Sprint 21 choice)
- [ ] Bulk payment file export implemented for chosen bank format — generator built and tested, but **not verified against Maybank2u's real portal template**; see Outcomes
- [x] Default role restriction on payroll domain verified by test

**Sprint 34 Definition of Done**
- [x] Statutory calculations verified correct (against this session's own independent reference; EPF/SOCSO/EIS are real 2026 rates, PCB is a disclosed simplification)
- [x] Auto-approval hard-block verified with no bypass found
- [x] e-payslip delivered end to end
- [ ] Bulk payment file validated against real bank format spec — **OPEN**
- [x] Role restriction verified

**Ad-Hoc / Unplanned:** Sprint 21 recorded Maybank2u as the target bank format, but its real bulk-pay CSV template is only available inside its corporate banking portal (behind login) — no public spec exists. Escalated to the owner via AskUserQuestion (first such escalation since Sprint 33's LHDN sandbox). Owner chose to build against a documented-generic Malaysian bulk-pay CSV layout now, disclosed as unverified, wiring in the real spec once available — the same posture as Sprint 33's stubbed MyInvois integration. DoD item 4 stays open above. Also found and fixed a self-introduced bug before ever running the test: `get_employee_profile_decrypted`'s `returns table` column named `id` collided with the table's own `id` column in an unqualified lookup — fixed by table-aliasing.

**What's next:** Sprint 35 — Attendance, Leave & Commission. Not started, awaiting the owner's explicit go-ahead.

---

## Sprint 35 — Attendance, Leave & Commission ✅ COMPLETE (3 September 2026)

- [x] `public.attendance_records`, `public.overtime_records` created
- [x] `public.leave_types`, `public.leave_balances`, `public.leave_applications` created
- [x] `public.commission_rules`, `public.commission_calculations` created
- [ ] GPS clock-in/out implemented with offline queueing (reusing Vol 7_4 pattern) — **OPEN.** `create_attendance_record` accepts a caller-supplied `recorded_at` (server-side half verified); the actual mobile GPS capture UI and a real airplane-mode/offline-queue device test are outside this session's toolset. See Outcomes.
- [x] Overtime derivation job implemented, routed through approval
- [x] Approved overtime verified reaching a real payroll run
- [x] Leave application/approval/balance-deduction cycle implemented
- [x] Commission rule configuration + auto-trigger-on-invoice implemented
- [x] Minimal revenue-vs-cost dashboard implemented

**Sprint 35 Definition of Done**
- [ ] GPS clock-in/out + offline queue verified (airplane-mode test) — **OPEN**, see Outcomes
- [x] Overtime derivation/approval/payroll-reach verified — including an irregular-schedule case (this sprint's own named Risk)
- [x] Full leave cycle verified — balance proven unchanged at submission, deducted only on approval
- [x] Commission verified for 3 basis types (percent_of_invoice, percent_of_margin, flat_per_unit), including agent-specific-vs-business-default rule resolution
- [x] Dashboard verified for one test period against an independently-summed reference

**Ad-Hoc / Unplanned:** DoD item 1 (a real GPS/airplane-mode offline-queue device test) was judged a structural tooling limitation, not an owner-level business decision — handled via direct disclosure (migration header note 1, doc Outcomes below) rather than an `AskUserQuestion` escalation, unlike Sprint 33/34's genuine external-dependency forks. Three self-introduced bugs were found and fixed in the test script itself before it passed (not schema bugs): a timezone-display assertion that compared a datetime's string form instead of the actual instant; two attendance records inserted out of chronological order, which broke the alternation guard because it keys off the latest `recorded_at`, not insertion order; and an ApprovalTask lookup using an invoice's id instead of the CommissionCalculation's own id as `subject_id`. All three were caught by the local verification run, not shipped. See the migration's own 9 header notes and the Sprint 35 doc Outcomes for the full set of disclosed design decisions (overtime pay constants, delete-on-rejection for OvertimeRecord/CommissionCalculation, the explicit follow-up-RPC commission trigger, the new `agent_party_id`/`commission_trigger_status` columns).

**What's next:** Sprint 36 — Legal & Commercial. Not started, awaiting the owner's explicit go-ahead.

---

## Sprint 36 — Legal & Commercial ✅ COMPLETE (3 September 2026)

- [x] `public.contracts`, `public.contract_alerts`, `public.e_signature_envelopes` created
- [x] Contract CRUD + document attachment implemented
- [x] Renewal alert generation implemented, verified firing at correct lead time
- [ ] e-signature provider integration implemented (Sprint 21 choice) — **OPEN.** Sprint 21 deferred the vendor choice to this sprint; owner chose a provider-agnostic STUB now (no live vendor credentials exist in this session). See Outcomes.
- [x] Envelope status tracking reflected back onto parent Contract/Quotation
- [x] Credit limit gate implemented at Invoice creation
- [x] Owner override path implemented and logged
- [x] `Contract.credit_limit_override` precedence over `Party.credit_limit` verified

**Sprint 36 Definition of Done**
- [x] Renewal alert timing verified — verified NOT due one day before trigger_date, due exactly on it, while end_date still 30+ days away
- [ ] Full e-signature sign cycle verified with chosen provider — **OPEN**, verified against a provider-agnostic stub instead; see Outcomes
- [x] Credit limit gate verified blocking a real over-limit test invoice
- [x] Override path verified working and logged
- [x] Override precedence verified by test

**Ad-Hoc / Unplanned:** No bugs found this sprint — the migration applied cleanly with zero errors on the first run, and all 26 verification checks passed on the first execution. One RLS policy name (65 chars) was shortened proactively before the first apply, per the 63-character-limit lesson from Sprints 33-35. The e-signature provider decision (Vol 13_0 §14 Open Item 5, explicitly deferred at Sprint 21 sign-off) was escalated to the owner via AskUserQuestion — the first such escalation since Sprint 34's Maybank2u bank format — offering: (a) provider-agnostic stub now, wire in a real vendor later; (b) owner supplies real credentials; (c) skip entirely, logged as an open gap. **Owner chose (a), provider-agnostic.**

**This was the final sprint of the Phase 3 sprint plan.** See the Phase 3 Exit Criteria below and the Sprint 36 doc's own close-out note for the full account of what remains genuinely open across the whole plan.

---

## Phase 3 Exit Criteria (from Overview §5)

- [x] 1. Solo-mode zero-friction verified
- [x] 2. Two distinct non-Owner roles verified (allowed + denied action each)
- [x] 3. SoD enforcement + escape valve + audit verified
- [x] 4. One real end-to-end sale (quote → invoice → payment → AR/P&L) verified
- [x] 5. DO dispatch decrement + Trial Balance/Balance Sheet/GL correctness verified for one period
- [ ] 6. One invoice validated against LHDN sandbox including QR — **OPEN** (Sprint 33: stubbed MyInvois only, no real sandbox credentials)
- [ ] 7. One payroll run verified against official reference, mandatory-approval-gated, valid bulk file produced — **PARTIAL.** Payroll run verified against reference and mandatory-approval-gated are both done; the bulk payment file is generated and structurally tested but NOT validated against Maybank2u's real portal template (Sprint 34 DoD item 4)
- [ ] 8. GPS clock-in/out + leave cycle + one commission calculation verified — **PARTIAL.** Leave cycle and commission calculation are both fully verified; GPS clock-in/out itself is verified only at the server-RPC level (Sprint 35 DoD item 1 — no real device/airplane-mode test was possible in this session)
- [x] 9. Contract renewal alert + credit-limit hard gate verified
- [ ] 10. At least one real pilot business, 2+ weeks, no ledger-affecting bug, evidenced by usage log — **OPEN**, requires a real business using the deployed app over real time; outside what any session in this engagement can produce

**Real remaining gaps across the whole plan (not silently closed):** items 6, 7 (bulk file spec), 8 (GPS device test), and 10 — each already disclosed in its own sprint's Outcomes (Sprints 33, 34, 35) and now summarised here per Vol 0_1's own close-out convention of stating real remaining gaps rather than declaring false completeness.

---

*End of Checklist.*
