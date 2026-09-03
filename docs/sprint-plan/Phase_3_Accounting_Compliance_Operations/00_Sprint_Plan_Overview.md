# AIFA — Phase 3 (Accounting, Compliance & Multi-Role Operations) Sprint Plan
## Overview

**Prepared:** 2 September 2026
**Scope authority:** `docs/architecture/v2.0/Series_13_Accounting_Compliance_Operations/` — `Vol_13_0_Accounting_Compliance_Operations_Architecture.md` (module design), `Vol_13_1_Multi_Role_Tenant_Delegated_Approval_Architecture.md` (roles/delegation), `Vol_13_2_Role_Gated_Capture_Segregation_Of_Duties.md` (maker-checker), `Vol_13_3_Growth_Adaptive_Access_Model.md` (solo-to-team flexibility) — all currently Version 1.0, status **Proposed**. This plan builds *only* what those four volumes specify. Nothing beyond their current scope appears here except where explicitly flagged as a deferred stub.
**Companion document:** `Checklist_Master.md` in this folder — the same work, as trackable checkboxes.
**Predecessor:** `docs/sprint-plan/Phase_2_Web_And_Sync/` — Sprints 13–20. This plan continues the sprint sequence rather than restarting it, so sprints here are numbered 21 onward.
**Status at time of writing:** Design only. No code has been written against this plan. Per standing instruction, implementation does not begin until the owner gives explicit go-ahead, sprint by sprint — this document exists to make that decision informed, not to authorise starting.

---

## 1. Purpose

This is the execution plan that turns Series 13's four architecture volumes into sequential two-week sprints, ending in a Phase-3-pilot-ready build: a business owner can run real invoicing, pricing, expense/PV, inventory, full accounting reports, Malaysian e-Invoice/SST compliance, payroll, HR (attendance/leave/commission), and legal/contract management through AiFA — with all of it delegatable across a team whose access adapts automatically as the business grows, exactly as Vol 13_1–13_3 designed.

## 2. Assumptions

| Assumption | Detail |
|---|---|
| Team | Same solo-or-near-solo delivery assumption as Phases 1–2. Sprints are sequenced serially. |
| Cadence | 2-week sprints, 16 sprints, ≈32 weeks (~8 months) to a Phase-3-pilot-ready build. A planning estimate, not a calendar guarantee — same caveat Phase 1 and 2's plans both carry. |
| Starting point | Phase 2 (Web & Sync) is functionally complete per its own exit criteria (`Phase_2_Web_And_Sync/00_Sprint_Plan_Overview.md` §5) before Sprint 21 begins — a working web + mobile app, multi-device sync with active-device lock, but still genuinely single-user-per-business. This plan does not assume any Series 13 code exists yet. |
| Foundation-first ordering | Sprints 21–25 (Sub-phase 3a) are a hard prerequisite for every module sprint after them, per Vol 13_1 §11 Open Item 5: `ApprovalTask` changes shape once roles exist, and building Module sprints against the old single-approver shape first would mean redoing them. No module sprint (26 onward) starts before Sprint 25's Definition of Done is met. |
| Cryptographic design is reviewed, not assumed | Vol 13_1 §8 explicitly declines to hand over a finished multi-user key-wrapping spec and asks for a dedicated review first. Sprint 22 is that review, sequenced before Sprint 23 writes any schema depending on it — mirroring how Phase 2's Sprint 13 held a design sign-off before Sprint 14 touched cloud schema. |
| Tech stack | Unchanged from Vol 11_0/12_0 — `@aifa/core` shared package, mobile (Expo/React Native) and web (React) both build against it, Supabase/Postgres backend. No new framework choice is introduced by Series 13. |
| Compliance dependencies are owner-held | Sprint 33 (e-Invoice & SST) and Sprint 28 (WhatsApp send) depend on external accounts/registrations (LHDN MyInvois, SST registration, WhatsApp Business Platform or equivalent) that only the business owner can obtain — flagged again in those sprints' own Dependencies section, not assumed available by default. |

## 3. What Is Explicitly Out of Scope for This Plan

Per Vol 13_0/13_1's own stated boundaries and open items, none of the following appear in Sprints 21–36. Listed here so scope creep is visible if it happens:

- Multi-business-per-owner / true multi-tenant (Vol 13_1 §11 Open Item 4 — deferred to Vol 10_1 territory, unchanged)
- Local on-device AI, third-party developer extensions, enterprise/industry-PKA composition — unchanged from Phase 1/2's out-of-scope lists, still not reached
- A finished, audited cryptographic implementation of Vol 13_1 §8's key-wrapping direction — Sprint 22 produces a reviewed *design*; if that review concludes the direction needs external/specialist audit before production use, that audit is its own follow-on, not assumed complete inside this plan
- Full LHDN MyInvois **production** submission — Sprint 33 targets the sandbox/validated-integration milestone; production cutover is gated on the owner's own completed LHDN registration, which this plan cannot schedule
- Invitation-flow UX polish, role-template tuning UI, and the "historical self-approval" report (Vol 13_1 §11 Open Item 2/3, Vol 13_3 §10 Open Item 3) — functional minimums ship where a sprint's Definition of Done needs them; polish passes are not scheduled here
- Bank-specific bulk-payment file formats beyond one reference format (Vol 13_0 §14 Open Item 4) — Sprint 34 ships one format; additional bank formats are follow-on work

## 4. Sprint Index

| Sprint | Theme | Primary Architecture References |
|---|---|---|
| **Sub-phase 3a — Foundation (prerequisite for everything below)** | | |
| 21 | Design Sign-Off & Series 13 Scope Confirmation | Vol 13_0/13_1/13_2/13_3 (full, review pass) |
| 22 | Key-Wrapping & Multi-User Crypto Design Review | Vol 13_1 §8 |
| 23 | Tenant, Role & Permission Schema + RLS Redesign | Vol 13_1 §2–4, §10 |
| 24 | Team Membership Lifecycle & Growth-Adaptive Access Model | Vol 13_1 §4; Vol 13_3 (full) |
| 25 | Delegated, SoD-Aware Approval Engine & Role-Gated Capture | Vol 13_1 §5–7; Vol 13_2 (full) |
| **Sub-phase 3b — Sales, Pricing, Expense, Core Reports** | | |
| 26 | Party, Document Numbering & Chart-of-Accounts Migration | Vol 13_0 §3.1, §3.4, §8 |
| 27 | Pricing & Product Catalog | Vol 13_0 §5 |
| 28 | Quotation & Invoice + WhatsApp Send | Vol 13_0 §4, §4.1 |
| 29 | Payments, Credit Notes & AR Ageing | Vol 13_0 §4 |
| 30 | Payment Vouchers, Expense & Cash Book/P&L | Vol 13_0 §6, §8 |
| **Sub-phase 3c — Inventory & Full Reports** | | |
| 31 | Inventory & Delivery Order | Vol 13_0 §7 |
| 32 | Full Accounting Reports (Balance Sheet, Trial Balance, GL, Bank Reconciliation) | Vol 13_0 §8 |
| **Sub-phase 3d — Malaysian Compliance** | | |
| 33 | e-Invoice & SST Compliance | Vol 13_0 §9 |
| **Sub-phase 3e — Payroll, HR, Legal** | | |
| 34 | Payroll & Statutory Contributions | Vol 13_0 §10 |
| 35 | Attendance, Leave & Commission | Vol 13_0 §11 |
| 36 | Legal & Commercial | Vol 13_0 §12, §12.1 |

## 5. Phase 3 Exit Criteria — "Definition of This Plan Done"

This plan is complete when all of the following are simultaneously true, not when the sprint count runs out:

1. A solopreneur business owner experiences zero added friction from any of Sprints 21–25's work — solo mode behaves exactly as Phase 1/2 already do (Vol 13_3 §3), verified explicitly, not assumed.
2. An owner can invite a second person, assign them a role from Vol 13_1 §4.1's templates, and that person's capture/approval access is correctly scoped — verified with at least two distinct non-Owner roles exercising both an allowed and a denied action.
3. Segregation of duties is enforced per Vol 13_2 §4 where configured, with the escape valve and audit flag both verified for the case where excluding the maker leaves nobody eligible.
4. An owner can create a quotation, send it (Sprint 28), convert it to an invoice, record a payment, and see it reflected correctly in AR ageing and the P&L (Sprints 26–30) — one real end-to-end sale, not unit tests alone.
5. A Delivery Order dispatch correctly decrements inventory (Sprint 31), and Trial Balance/Balance Sheet/GL exports (Sprint 32) balance to zero and match manually-verified figures for at least one full test period.
6. At least one invoice successfully validates against the LHDN MyInvois **sandbox** environment end-to-end, including QR code generation (Sprint 33).
7. At least one full payroll run (Sprint 34) computes EPF/SOCSO/EIS/PCB correctly against a published official reference calculation, is gated through mandatory explicit approval (never auto-approved, per Vol 13_0 §10), and produces a valid bulk payment file.
8. GPS clock-in/out, a leave application/approval cycle, and one commission calculation (Sprint 35) all complete correctly, with overtime correctly reaching a payroll run.
9. A contract with a renewal alert fires correctly at its configured lead time, and the credit-limit hard gate (Sprint 36) correctly blocks a new invoice for an over-limit customer, with a visible reason and an explicit override path (Vol 13_0 §12.1).
10. At least one real pilot business (ideally with a second real team member, not a test account) has used the system for at least two full weeks with no ledger-affecting bug, evidenced by a usage log.

## 6. Program-Level Risks

| Risk | Why It Matters | Mitigation |
|---|---|---|
| Foundation sprints (21–25) run long, delaying every module sprint behind them | Everything after Sprint 25 depends on the new `ApprovalTask`/role shape; starting a module sprint early against the old shape means redoing it | Sprint 21's design sign-off should surface any scope disagreement before 22–25 start, not mid-build; if 22–25 run long, trim module scope later rather than skip foundation work |
| The Section 8/Sprint 22 crypto direction turns out to need real specialist review, not just an internal design pass | A permissions table without correct key-wrapping is security theatre — Vol 13_1 §8 already flags this as the biggest open item in the whole series | Sprint 22's Definition of Done includes an explicit go/no-go: if the internal review cannot reach confidence, the plan pauses at Sprint 22 rather than Sprint 23 building schema against an unreviewed design |
| `ChartOfAccounts` migration (Sprint 26) touches the one existing table Series 13 changes rather than only adding new ones | Vol 13_0 §14 Open Item 7 flags this explicitly — a bad migration here corrupts every existing Phase 1/2 ledger entry | Sprint 26 seeds every existing Phase 1 account as an `is_system = true` row with an exact 1:1 mapping before any new account is added, and runs the full existing ledger/report test suite against it before proceeding |
| e-Invoice/SST (Sprint 33) and WhatsApp send (Sprint 28) both depend on external accounts the owner must obtain, on a timeline this plan doesn't control | Building ahead of those approvals means integration work sits blocked | Both sprints are sequenced late enough in their sub-phase that the owner has lead time to start the external registration process while earlier sprints in the same sub-phase proceed |
| Payroll (Sprint 34) is the single highest compliance-risk sprint in this entire plan | Wrong statutory calculations have real regulatory and financial consequences for the pilot business | Sprint 34's Definition of Done requires validation against a published official reference calculation before any real payroll run is permitted, and Vol 13_0 §10's "never auto-approve" rule is treated as non-negotiable, not tunable |
| Solo-developer bus factor (carried from Phases 1–2) | Same as before — single point of failure for all delivery | Same mitigation — keep this plan and the architecture docs as the resumable source of truth |
| Scope creep — a module sprint quietly pulls in a later sub-phase's feature | Sixteen sprints is a long plan; drift compounds | Each sprint doc's Task Breakdown states its own boundary explicitly; anything reaching into a later sprint's territory should be flagged in that sprint's status update, not silently absorbed |

## 7. How to Use This Plan

Each sprint document states a theme, objectives, a task breakdown by area, a Definition of Done, dependencies on prior sprints, sprint-specific risks, and what's safe to carry over if the sprint runs long — the same template Phases 1 and 2 used. Work through them in order within each sub-phase; sub-phases themselves are ordered by dependency (3a before everything, 3b before 3c since inventory needs `Product`/`Invoice`, 3e last since it's the highest-sensitivity, lowest-interdependency work per Vol 13_0 §13's own reasoning).

**Status tracking going forward:** as work actually starts, this Overview and `Checklist_Master.md` are the durable record of progress — at the end of each work session touching this plan, the checklist is updated to reflect what's actually done (not just attempted), any ad-hoc/unplanned task that came up gets logged against the sprint it affected, and what's next is read directly off the first unchecked item in sprint order. This mirrors exactly how Phase 2's checklist was maintained.

---

*End of Overview.*
