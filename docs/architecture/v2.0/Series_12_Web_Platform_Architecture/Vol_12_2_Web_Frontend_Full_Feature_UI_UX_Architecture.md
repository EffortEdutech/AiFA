# AIFA — Web Frontend Full-Feature UI/UX Architecture
## Volume 12_2 — Series 12: Web Platform Architecture — Version 1.0 (Proposed)

**Status:** Proposed — architecture design, not yet implemented. This volume is the design-first deliverable requested by the owner ("we will design first, prepare sprint plan and checklist before writing any code") ahead of Phase 4. No code accompanies this volume.
**Applies:** Vol 12_0 (Web Platform Architecture), Vol 12_1 (Cross-Platform Data Synchronisation Architecture), Vol 13_0 (Accounting Compliance Operations Architecture), Vol 13_1 (Multi-Role/Tenant/Delegated Approval Architecture), Vol 13_2 (Role-Gated Capture & Segregation of Duties), Vol 13_3 (Growth-Adaptive Access Model), Vol 7_0-7_7 (Mobile Application Architecture)
**Companion volumes:** Vol 12_0 (scopes the web client itself — **this volume formally supersedes Vol 12_0 §3.2 and §4**, see Section 1.1 below), Vol 12_1 (the sync/device-lock model this frontend must surface and respect unchanged)

---

## 1. Purpose

Phase 3 (Sprints 21-36) shipped sixteen sprints of real, verified backend capability — multi-role/tenant membership, delegated SoD-aware approvals, party/ledger/chart-of-accounts, pricing, quotation/invoice, payments/credit notes/AR ageing, payment vouchers/expense/cash book/P&L, inventory/delivery orders, full accounting reports/bank reconciliation, e-Invoice/SST compliance, payroll/statutory contributions, attendance/leave/commission, and legal/commercial contracts with credit-limit enforcement. Every one of these modules has a working, verified RPC surface in `packages/core/src/sync/*Transport.ts`. None of it has a screen. The owner's own words open this engagement: **"We have completed Phase 3 but we cant see the result."**

This volume is the UI/UX architecture for AiFA Web as the **full frontend** — the one surface that shows the complete feature set of AiFA, as distinct from the mobile app, which stays intentionally narrow (Section 3). It defines the information architecture, navigation pattern, page-management pattern, visual design system, and role-based visibility model for every module above, and maps every screen to the specific existing RPC(s) it calls. It does not change any backend schema, RPC, or transport file — Phase 4 (Section 9) is a pure frontend build against what Phase 3 already shipped.

### 1.1 Formal supersession of Vol 12_0 §3.2 and §4

Vol 12_0 was written before Series 13 existed and is now factually stale in two places, not merely incomplete:

- **Vol 12_0 §3.2** states web is "Not multi-user/team access... team roles remain a distinct, later item." This was true when written; it has been false since Sprint 23-25 shipped real `BusinessMembership`, RLS-scoped tenancy, and a delegated SoD-aware approval engine. **This volume supersedes that statement.** AiFA web is multi-role and multi-tenant-membership-aware from its first sprint (Section 4.4, Section 6).
- **Vol 12_0 §4 (Feature Parity Phasing table)** lists only Phase-1/2-era features (Dashboard, AI Workspace, capture, Settings, Devices panel) and has no row for any Series 13 module. **This volume supersedes that table.** Section 4 below is the current, authoritative feature/navigation inventory for web.

Nothing else in Vol 12_0 is superseded: Section 5 (`@aifa/core` shared-logic decision — already executed via the transport-file pattern), Section 6 (technology choices — React/Vite/IndexedDB/WebCrypto/PWA, all still current and reused, Section 8), Section 6a (single active-device concurrency model, now per-membership per Vol 12_1 §5b), and Section 7 (governance boundaries) all remain in force unchanged and this volume builds directly on top of them. Vol 12_1 is unchanged and unsuperseded in full — this volume adds no new sync design; it consumes Vol 12_1's device/sync/lock model as given (Section 6).

## 2. Owner Requirements (binding, restated so this document is self-checkable against them)

Stated directly by the owner when commissioning this volume:

1. AiFA Web is the full frontend — every Phase 1-3 feature must be reachable from it.
2. Corporate visual style.
3. Hamburger menu + sidebar for navigation (not top nav, not a different pattern).
4. Tabs for page management; explicitly avoid "noticeboard style" pages (an unstructured dump of dashboard widget-cards).
5. Mobile stays scoped to input, respond, approval, and simple report for the user — it is not being redesigned toward parity (Section 3).
6. Design → sprint plan → checklist, in that order, before any code (this volume is deliverable 1 of 3; Section 9 and the accompanying checklist are 2 and 3).

Each numbered requirement above is cross-referenced from the section that satisfies it.

## 3. Scope: Web vs. Mobile, Restated for Phase 4

Mobile (Vol 7_0-7_7) is not being expanded to feature parity — this is an explicit, deliberate narrowing of Vol 12_0's original "web achieves parity with mobile" framing (Vol 12_0 §8), made necessary now that Series 13 has made "full parity" mean sixteen additional modules mobile was never meant to carry on a small screen. Per the owner's Section 2, item 5, mobile's permanent scope is:

- **Input** — capture flows only (Sale, Purchase, Expense, Banking, and the Series 13 capture-shaped actions that make sense one-handed: attendance clock-in/out, quick quotation capture).
- **Respond** — the AI Workspace's Q&A/CFO-guidance surface, and reacting to notifications.
- **Approval** — deciding pending `ApprovalTask` items (Vol 13_1 §6) from wherever the owner happens to be, without needing a laptop.
- **Simple report** — read-only, no-frills views: today's cash position, an invoice's status, a payslip, nothing that requires the tabbed, multi-panel treatment Section 5 below defines for web.

Web is where every module gets its full, structured treatment: multi-step forms, tables with filtering/sorting, tabbed detail views, bulk actions, report generation, settings/configuration screens, and anything the Series 13 architecture volumes describe as "the Bookkeeper does X" or "the Owner reviews Y" — those are desk workflows and belong on the full frontend, not squeezed into a phone.

This scope split is itself an architecture decision worth recording as such: it means Phase 4 sprints (Section 9) are exclusively `web/`. No `app/` (React Native) sprint is implied by this volume. A future, separate pass may selectively backport specific Series 13 capture/approval/report actions to mobile once web has proven the UX — noted as an Open Item (Section 10), not designed here.

## 4. Information Architecture — the Sidebar

### 4.1 Design

Hamburger icon (top-left, standard corporate-app convention) toggles a collapsible left sidebar (owner requirement 3). Sidebar sections group by business function, not by sprint number — the sprint numbers below are provenance, not the navigation label. Each top-level sidebar item opens one page; a page with more than one logical sub-view uses tabs inside that page (Section 5), never a second-level flyout menu — this keeps the sidebar shallow (two levels: section header, then item) and keeps "where do I click for X" answerable without hovering.

### 4.2 Full sidebar inventory

| Sidebar Section | Item | Backend module (transport file) | Primary domain/capability gate (Vol 13_2) |
|---|---|---|---|
| **Overview** | Business Overview | Cross-module read (Section 5.1 defines this as a structured summary, not a noticeboard) | any active membership |
| **Sales** | Parties (Customers/Suppliers) | `partyAndLedgerTransport.ts` | `sales` capture / `accounting_reports` configure |
| | Pricing & Catalog | `pricingTransport.ts` | `sales` capture, `settings` configure for price list edits |
| | Quotations | `quotationInvoiceTransport.ts` | `sales` capture |
| | Invoices | `quotationInvoiceTransport.ts` | `sales` capture |
| | Payments & Credit Notes | `paymentsCreditNotesTransport.ts` | `sales` capture or `accounting_reports` configure |
| | AR Ageing | `paymentsCreditNotesTransport.ts` | `accounting_reports` view |
| **Purchases & Cash** | Payment Vouchers | `paymentVouchersReportsTransport.ts` | `expense` capture |
| | Expense | `paymentVouchersReportsTransport.ts` | `expense` capture |
| | Cash Book / P&L | `paymentVouchersReportsTransport.ts` | `accounting_reports` view |
| **Inventory** | Products & Stock | `pricingTransport.ts` / `inventoryDeliveryTransport.ts` | `sales` capture, `settings` configure |
| | Delivery Orders | `inventoryDeliveryTransport.ts` | `sales` capture |
| **Accounting** | Chart of Accounts | `partyAndLedgerTransport.ts` | `settings` configure |
| | Ledger | `partyAndLedgerTransport.ts` | `accounting_reports` view |
| | Full Reports & Bank Reconciliation | `fullAccountingReportsTransport.ts` | `accounting_reports` view/configure |
| **Compliance** | e-Invoice & SST | `eInvoiceSstTransport.ts` | `accounting_reports` configure (stub provider — Section 7.3) |
| **People** | Payroll | `payrollTransport.ts` | `payroll` configure (threshold-free, always gated — Vol 13_2 §4) |
| | Attendance & Leave | `attendanceLeaveCommissionTransport.ts` | `payroll`/self-service (Vol 13_3 §3 `solo_self_resolved`) |
| | Commission | `attendanceLeaveCommissionTransport.ts` | `payroll` configure |
| **Legal** | Contracts & Alerts | `legalCommercialTransport.ts` | `legal_contract` (threshold-free, always gated) |
| | e-Signature | `legalCommercialTransport.ts` | `legal_contract` (stub provider — Section 7.3) |
| **Team** | Members & Roles | `teamMembershipTransport.ts` | Owner-only for role changes; self-view for others |
| | Approvals | `approvalEngineTransport.ts` | any membership with a pending task; delegation view is Owner/delegate-only |
| **Settings** | Devices | Vol 12_1 §8 (existing `DevicesPanel.tsx`, redesigned per Section 5.4) | any active membership (read); write actions self-scoped |
| | Business Settings | existing `SettingsReadOnly.tsx`, promoted to full read/write per Vol 12_0 §4's original Phase 2b intent | `settings` configure |

Nineteen sidebar items across nine sections is the complete Phase 1-3 inventory (owner requirement 1). A module with no UI yet (there are none outstanding after Phase 4 — Section 9 covers all nineteen) would appear here with a stated gap; there is none to disclose.

### 4.3 What is deliberately NOT a sidebar item

- Individual reports (Trial Balance, Balance Sheet, Tax Report Placeholder) are tabs inside **Full Reports**, not separate sidebar entries — this is the tab-over-noticeboard principle (Section 5) applied one level up: a report is a view of the Accounting module, not a new module.
- "Notifications" is not a sidebar item — it is a bell icon in the top bar (Section 5.5), consistent with corporate-app convention and Vol 12_0 §4's own original placement.
- The AI Workspace (Vol 12_0 §4's "AI Workspace (Q&A, CFO guidance)" row) is available from the top bar as a persistent slide-over panel, not a sidebar page — it is meant to be consulted alongside whatever module page is open, not navigated away to.

### 4.4 Role-based sidebar visibility

Every sidebar item's visibility is computed from the signed-in membership's effective permissions (Vol 13_1 §7, `teamMembershipTransport.ts`'s `effectiveAccessModel`) at render time — never hardcoded per role name, and never cached beyond one render pass (per that file's own header note, restated here as a binding frontend rule, not a suggestion). A **solo** business (Vol 13_3, one membership, the Owner) sees every item with full capture+configure rights everywhere, degenerating to "no visibility restriction" by construction — the same solo-mode-is-free guarantee Vol 13_3 §2 requires of the backend, now stated as a frontend requirement too. A **team** business shows only the sections a membership has at least view access to; a section with zero visible items collapses out of the sidebar entirely rather than showing as a greyed-out dead end — a Sales Agent with no `payroll`/`legal_contract` access never sees "People" or "Legal" in their sidebar at all.

## 5. Page-Management Pattern — Tabs, Not Noticeboards (owner requirement 4)

### 5.1 The rule

Every sidebar item opens exactly one page. A page with more than one logical view uses a horizontal tab strip directly under the page title — never a grid of independent summary cards competing for attention, never a scroll-and-hope dashboard. This is a firm rule, not a per-page judgment call, because "noticeboard style" was named explicitly as something to avoid: a page either (a) is simple enough to need no tabs (e.g. Devices), or (b) has multiple views, in which case those views are tabs, full stop.

Applied to the **Business Overview** landing page specifically (the one page most tempted toward a noticeboard layout): it is built as a single page with tabs — **Snapshot** (a small, fixed set of headline figures: cash position, AR/AP totals, pending approvals count — each a single number with a one-line label, laid out as a compact strip, not a wall of cards), **Sales Pipeline**, **Compliance Status**, **Team Activity** — each tab a focused, structured view drawing from one or two RPCs, not an open-ended widget grid a future sprint keeps adding cards to. This satisfies "show me the business at a glance" without becoming the noticeboard the owner explicitly ruled out.

### 5.2 Worked example — Sales module (Quotations/Invoices/Payments)

Rather than three separate sidebar entries fanning out sales further, or one page with a widget dump, the Sales section pages each get their own focused tab strip where the underlying data has multiple lifecycle states:

- **Invoices** page: tabs **All / Draft / Issued / Overdue / Paid** — reading `invoiceEffectiveStatus` (never raw `Invoice.status`, per `paymentsCreditNotesTransport.ts`'s own explicit note) to populate Overdue correctly, plus a detail drawer (not a full page navigation) for a single invoice's line items, payment history, and credit notes.
- **Quotations** page: tabs **All / Pending Approval / Sent / Accepted / Rejected/Expired**, each backed by `approval_tasks` state (pending) or `Quotation.status` (post-approval) as appropriate — never conflating the two state machines in one tab's query, mirroring the same care the backend already takes (`quotationInvoiceTransport.ts`'s own approval note).

### 5.3 Worked example — Approvals inbox (cross-cutting, Team section)

One page, tabs **My Pending / Delegated to Me / All (Owner/delegate view) / History** — this is the single place every module's `ApprovalTask` items surface, rather than each module inventing its own mini-approval-list; every module page's own pending items link into this same inbox filtered to that `subject_type`, so there is one implementation of "how do I show a pending approval," reused everywhere, mirroring how `approvalEngineTransport.ts` is already the one generic engine every module's backend calls.

### 5.4 Devices panel (Vol 12_1 §8) placement

The existing `DevicesPanel.tsx` becomes a full Settings sub-page (not a modal), gains the Primary badge and per-membership scoping Vol 12_1 §5b requires (a device belongs to exactly one membership — Section 4.4's role-based visibility applies here too: a member sees only their own devices, the Owner sees all memberships' devices in an additional **All Devices** tab), and keeps its existing column set (Section 8 of Vol 12_1) unchanged. No new design work is needed here beyond re-platforming it into the tabbed Settings page and the membership-scoping Sprint 23 already resolved at the schema level (Vol 12_1 §5b) — this is explicitly a low-risk, mostly-relocation sprint task (Section 9, Sprint 38).

### 5.5 Top bar (persistent across all pages)

Hamburger toggle (left) · current business/membership name · AI Workspace slide-over trigger · notifications bell · active-device indicator (Vol 12_1 §8's "which device is active," always visible per that volume's own requirement, not just inside the Devices page) · account menu (sign out, switch business if the auth model ever supports more than one — out of scope, Vol 8_1 unchanged). This satisfies Vol 12_1 §6a.3's requirement that write-permission state be visibly, persistently surfaced, not buried in Settings.

## 6. Concurrency & Sync — Consumed Unchanged From Vol 12_1

This volume introduces no new sync, device-lock, or conflict-resolution design. Every module page is a consumer of Vol 12_1's existing model:

- A page's write actions (create quotation, record payment, run payroll, etc.) are disabled with Vol 12_1 §6a.3's exact read-only banner treatment whenever this device/membership does not hold the active-device lock for its own membership scope (Vol 12_1 §5b — team members hold independent locks; only a member's own other devices contest their lock).
- Every list/table view subscribes to the same pull mechanism (Vol 12_1 §6.2) — no page introduces its own polling or a bespoke "refresh" button as the primary update mechanism; a manual refresh action may exist as a convenience but live update is the default per Vol 12_1's own design goal ("make sync boring").
- The Devices page (Section 5.4) is where Vol 12_1's device visibility/handoff/primary-override UX lives; no other page duplicates any part of that UI.

## 7. Corporate Visual Design System (owner requirement 2)

### 7.1 Proposed defaults (disclosed as a proposal, not a confirmed decision — see Open Items)

No existing AiFA volume specifies a brand palette; Vol 12_0 §4's original Phase 2a scope never reached a design-system decision. This volume proposes sensible, conservative defaults in the same spirit as prior disclosed defaults in this project (e.g. the bulk-payment CSV layout, Sprint 34) — usable to start Phase 4 sprints without blocking on a branding exercise, explicitly open to owner revision at zero migration cost since these are CSS tokens, not structural decisions:

| Token | Proposed value | Rationale |
|---|---|---|
| Primary | Deep slate-navy (`#1E293B` family) | Corporate/financial-software convention (matches the register of accounting/compliance tooling, not a consumer-app palette) |
| Accent | A single restrained accent (`#2563EB` blue) used only for primary actions and active-state indicators | One accent, used sparingly, keeps tabbed pages calm — a second or third accent colour would undercut the "not noticeboard" discipline visually as well as structurally |
| Semantic colours | Standard success/warning/danger (green/amber/red), used only for status pills (Overdue, Pending Approval, Credit Limit Exceeded) | Needed for the many lifecycle-state tabs in Section 5; kept out of general chrome so they stay meaningful |
| Typography | System UI font stack (`-apple-system, "Segoe UI", Roboto, sans-serif`) at a corporate-dashboard type scale (14px body, 13px table density) | No custom font licensing decision has been made; a system stack ships instantly and reads as "business software," not a marketing site |
| Density | Table-dense by default (matches the volume of line-item data in Quotation/Invoice/Payroll/Attendance tables), with a comfortable-density toggle in Settings | A financial back-office tool is read most often as tables, not cards — density is a first-class settings choice, not an afterthought |
| Sidebar | Fixed-width (240px) expanded, icon-only collapsed via the hamburger toggle, section headers in a muted label style, active item shown with the accent colour and a left border, not a filled background (keeps the corporate/restrained register) | Matches owner requirement 3 exactly (hamburger + sidebar) with a specific, implementable collapse behaviour |

### 7.2 What corporate style means operationally in this volume

Concretely, "corporate style" is enforced through the rules already stated rather than left as a vibe: one accent colour (7.1), tabs over noticeboards (Section 5), tables over cards for anything list-shaped, a persistent and predictable chrome (Section 5.5) rather than a page-by-page reinvented layout, and status communicated through small text/pill treatments rather than illustrations or large iconography. A future design-system pass (e.g. adopting a component library — Section 10) can implement these rules with any specific toolkit; this volume specifies the rules, not the library.

## 8. Technology (extends Vol 12_0 §6, no changes)

No new technology decisions are introduced. Phase 4 builds entirely within Vol 12_0 §6's existing choices: React 18 + Vite + TypeScript (confirmed current in `web/package.json`), IndexedDB via the existing `sqlJsAdapter.ts`, the existing `@supabase/supabase-js` client, and the existing `packages/core/src/sync/*Transport.ts` files as the sole data-access layer — Phase 4 sprints consume these transports as-is; a Phase 4 sprint that finds a transport's interface insufficient for a screen's needs raises that as a scoped, disclosed follow-on backend task (mirroring how every Series 13 sprint disclosed rather than silently patched around backend gaps) rather than duplicating query logic directly against Supabase from a component. A routing library (React Router, already implied by Vol 12_0 §6's "Vite+React Router" mention) and a lightweight tab/table component approach are Sprint 37's own implementation choice (Section 9) — not fixed here, since neither is an architectural decision at this volume's level of detail.

## 9. Relationship to the Sprint Plan (deliverable 2 of 3)

This volume defines *what* Phase 4 builds; the accompanying sprint plan (`docs/sprint-plan/Phase_4_Web_Frontend_Full_Feature/`) defines the *order and increments*. In outline, thirteen sprints: one foundation sprint (shell, sidebar engine, design tokens, tab framework, routing), ten module-delivery sprints grouped by business function (mirroring Section 4.2's sidebar sections, each sprint shipping one or more complete sidebar items with their full tab set), and two closing sprints (cross-cutting Team/Approvals/Devices/Settings, then hardening/responsive/accessibility/pilot). See the sprint plan's own `00_Sprint_Plan_Overview.md` for the numbered breakdown and dependencies.

## 10. Open Items (stated honestly, not hidden)

- **The Section 7.1 palette/typography/density defaults are a proposal, not a confirmed owner decision.** They are deliberately low-cost to change (CSS tokens only, no structural rework) and Phase 4's foundation sprint (Sprint 37) should confirm them with the owner before or during that sprint rather than block this design volume on a branding exercise.
- **A specific UI component library/toolkit is not chosen here** (Section 8) — left to Sprint 37 as an implementation detail, since the architectural requirement (tabs, sidebar, tables, restrained corporate palette) is satisfiable with several reasonable choices and picking one is not a design-volume-level decision.
- **Backporting select Series 13 actions to mobile** (Section 3's closing note) is explicitly out of scope for this volume and for Phase 4 — noted as a possible future, separate engagement once web has shipped and proven the UX, not designed here.
- **The `postLedgerEntries` local-vs-server-ledger cutover** (`partyAndLedgerTransport.ts`'s own disclosed Sprint 26 scope note) is a pre-existing open backend item this volume does not resolve — the Accounting/Ledger sidebar page (Section 4.2) should read from whichever ledger source is authoritative at the time its sprint is built, and that sprint should surface this dependency explicitly rather than assume it is already resolved.
- **e-Invoice/SST and e-Signature UI both surface stub/simulated provider states** (`eInvoiceSstTransport.ts`, `legalCommercialTransport.ts`'s own disclosed scope) — their sprints (Section 9) must design the UI to clearly label simulated/stub results as such (per those files' own "do not present as done" instructions), not silently render them as if a real government or vendor integration is live.
- **This entire volume is unimplemented design**, exactly like Vol 12_0/12_1 before their respective build sprints — nothing in it should be read as a report of shipped code.

## 11. Relationships to Other Volumes

- Vol 12_0 (Web Platform Architecture) — companion volume this one partially supersedes (Section 1.1); all other sections of Vol 12_0 remain in force and are built on directly.
- Vol 12_1 (Cross-Platform Data Synchronisation Architecture) — the device/sync/lock model every page in this volume consumes unchanged (Section 6).
- Vol 13_0 (Accounting Compliance Operations Architecture) — the sixteen-module backend inventory this volume's sidebar (Section 4.2) is a direct UI mapping of.
- Vol 13_1 (Multi-Role/Tenant/Delegated Approval Architecture) — the permission/membership model Section 4.4's visibility rules and Section 5.3's approvals inbox are built against.
- Vol 13_2 (Role-Gated Capture & Segregation of Duties) — the domain/capability gates named throughout Section 4.2's table.
- Vol 13_3 (Growth-Adaptive Access Model) — the solo/team distinction Section 4.4 states as a frontend requirement, not just a backend one.
- Vol 7_0-7_7 (Mobile Application Architecture) — the surface this volume's Section 3 explicitly keeps out of scope, restating and narrowing Vol 12_0 §8's original "web achieves parity with mobile" framing.

---

*End of Volume 12_2.*
