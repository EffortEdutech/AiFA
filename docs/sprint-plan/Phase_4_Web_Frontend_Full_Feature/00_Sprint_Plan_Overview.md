# Phase 4 — Web Frontend Full-Feature — Sprint Plan Overview

**Architecture reference:** `docs/architecture/v2.0/Series_12_Web_Platform_Architecture/Vol_12_2_Web_Frontend_Full_Feature_UI_UX_Architecture.md`
**Depends on:** Phase 3 (Sprints 21-36, complete) for every backend RPC/transport this phase's screens call; Phase 2 (Sprints 13-20, complete) for the existing web app shell, auth, sync client, and Devices panel this phase extends rather than replaces.
**Status:** Proposed — sprint plan only, no sprint has started. Per the owner's explicit process instruction ("we will design first, prepare sprint plan and checklist before writing any code"), Sprint 37 does not begin until the owner gives explicit go-ahead, exactly as every Phase 3 sprint did.

---

## Why this phase exists

Phase 3 shipped sixteen sprints of verified backend capability with no screen to show for any of it — the owner's own framing: "we have completed Phase 3 but we cant see the result." Phase 4 is exclusively frontend work against `web/`. It introduces no new schema, no new RPC, and no new transport file unless a sprint discloses a genuine gap in the existing transport surface (Vol 12_2 §8) — the default assumption for every sprint below is that the backend is already complete and correct.

## Sequencing principle

Sprint 37 (foundation) must ship first — every later sprint's screens are built inside the sidebar/tab/routing shell it establishes, so nothing else can start in parallel with it. Sprints 38-47 are grouped by business function (mirroring Vol 12_2 §4.2's sidebar sections) and are largely independent of each other once Sprint 37 is done — each consumes exactly one or two existing transport files and does not depend on another module sprint's screens existing yet. The suggested order below follows the transaction lifecycle an SME actually uses (set up parties/pricing, then sell, then account for cash, then the back-office modules), but a later sprint could be pulled forward without breaking anything if the owner has a different priority (e.g. Payroll before Inventory) — this is noted explicitly so the order is understood as a recommendation, not a hard dependency chain, except where a Dependencies line says otherwise. Sprints 48-49 close the phase and must come last.

## Sprint list

| Sprint | Title | Sidebar sections delivered | Depends on |
|---|---|---|---|
| 37 | Design Sign-Off & Web Shell Foundation | (chrome only — hamburger/sidebar, tab framework, routing, design tokens, role-based visibility engine) | Vol 12_2 owner sign-off |
| 38 | Team, Roles, Approvals & Devices | Team, part of Settings | Sprint 37 |
| 39 | Parties, Chart of Accounts & Pricing/Catalog | part of Sales, part of Accounting | Sprint 37 |
| 40 | Sales Cycle — Quotations, Invoices, Payments, Credit Notes, AR Ageing | rest of Sales | Sprint 37, 39 |
| 41 | Purchases & Cash — Payment Vouchers, Expense, Cash Book/P&L | Purchases & Cash | Sprint 37, 39 |
| 42 | Inventory & Delivery Orders | Inventory | Sprint 37, 39, 40 |
| 43 | Full Accounting Reports & Bank Reconciliation | rest of Accounting | Sprint 37, 39, 40, 41 |
| 44 | e-Invoice & SST Compliance | Compliance | Sprint 37, 40 |
| 45 | Payroll & Statutory Contributions | part of People | Sprint 37, 38 |
| 46 | Attendance, Leave & Commission | rest of People | Sprint 37, 38, 40, 45 |
| 47 | Legal & Commercial | Legal | Sprint 37, 40 |
| 48 | Business Overview, Settings & Cross-Module Polish | Overview, rest of Settings | All module sprints (39-47) |
| 49 | Hardening, Accessibility, Responsive QA & Pilot | (no new sidebar items) | Sprint 48 |

Thirteen sprints, an estimated 26 weeks at Phase 3's own two-week cadence (Weeks 1-26 of Phase 4), subject to the same "proceed sprint by sprint with explicit go-ahead" discipline used throughout Phase 3 — this table is a plan, not a commitment to a fixed calendar date.

## What "Definition of Done" means for a Phase 4 sprint (read once, applies to every sprint below)

Unlike Phase 3, where DoD centred on schema/RPC correctness verified by a Python test script, every Phase 4 sprint's DoD centres on: (1) the screen renders and performs every action Vol 12_2 §4.2/§5 describes for its sidebar item(s) against the real, already-verified transport RPCs (no new backend logic, no mock data standing in for a real call); (2) role-based visibility is verified for at least a solo-owner membership and one restricted-role membership (Vol 12_2 §4.4); (3) the active-device read-only gating (Vol 12_1 §6a.3, Vol 12_2 §6) is verified on the sprint's write actions; (4) `tsc --noEmit`/`npm run typecheck` and `npm run lint` both pass clean in `web/`; (5) any stub/simulated backend state the sprint's module surfaces (e-Invoice, e-Signature) is visibly labelled as such in the UI, not presented as live. A sprint's own DoD list states these five plus anything module-specific.

## Checklist

See `Checklist_Master.md` in this directory for the sprint-by-sprint and phase-exit checklist, maintained in the same style as Phase 3's.

---

*End of Phase 4 Sprint Plan Overview.*
