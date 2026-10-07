# UI Polish — Browser Walkthrough (for Codex)

Branch: `ui-polish`. Goal: visually and functionally verify every page restyled by the UI polish work. This is a **review run, not a coding task**: do not edit source files. Report findings only.

## Ground rules

1. Read `AGENTS.md` first. Never open, print or paste `.env*` files or any key/secret. If env vars are needed, ask the owner.
2. Do NOT click destructive or irreversible actions: Remove/Suspend member, Revoke device, Mark Paid, Submit for approval, Submit (simulated), Create/Send anything, Publish Changes, Sign out, Decrypt (payroll key). Opening forms and typing in them is fine; **cancel before submitting**. Exception: if the owner supplied a disposable test business, you may create records there.
3. Use only the repo's own commands. No new dependencies.
4. Use seed mode (see Setup) so data-backed pages render. If a page still cannot load, record "blocked: <reason>" and move on; do not fake data.

## Setup

```powershell
cd web
npm run typecheck ; npm run lint      # both must pass
npm run dev                            # note the printed local URL (Vite, usually http://localhost:5173)
```
**Seeded-data mode (no backend, no account, no `.env` needed).** Prefer this when no test account exists:

```powershell
cd web
$env:VITE_SEED_MODE = "1"
npm run dev
```
Then click **Skip sign-in (dev only, no backend)** and **Skip (dev only, no backend)** on the device screen. Every page is served fictional sample data for "Kedai Contoh Sdn Bhd" (parties, invoices in every status, quotations, vouchers, POs, DOs, payroll runs and payslips, contracts, members, devices, approvals, reports). Notes:

- It is **read-only**: any create/update/delete/RPC write returns the error "Seed mode is read-only". That error text is expected; check it is displayed as a styled alert, not a raw stack. Do not treat it as a bug.
- The top bar shows **Read-only** / "Another device is currently active" in this mode; that is normal.
- Business name/industry in Settings come from local storage, so they show "—".
- Sample data lives in `web/src/dev/seedData.ts`; the mode is compiled out of production builds.
- Close the dev server (or `Remove-Item Env:VITE_SEED_MODE`) before a normal run.

Otherwise sign in with the owner-provided test account (ask if none). For the Public Site: `cd web-public ; npm run dev` (Next.js, usually http://localhost:3000; open `/site/<slug>` using the slug shown in Settings → Public Site).

Test at three widths: **1440 px, 1024 px, 390 px (phone)**. Test once in OS dark mode (the app is pinned to light; confirm controls are NOT dark/black).

## Checks to apply on EVERY page

- **Layout**: page title (PageHeader) present; no horizontal page scroll at 390 px (tables may scroll inside their own wrapper); cards aligned, consistent spacing.
- **Forms**: every input/select has a visible label (or accessible name); inputs are white with a visible border; only primary buttons are gold; disabled controls look disabled.
- **Tables**: header row, right-aligned money columns (RM1,234.00 format), status pills coloured sensibly, empty-state text when no rows, skeleton while loading.
- **Errors**: trigger one safe error if possible (e.g. disconnect network, reload) → red alert box with `role="alert"`, no raw stack traces.
- **Keyboard**: Tab reaches every control in a logical order; focus ring visible; Enter/Space on a button inside a clickable table row performs the button action only (does not also select the row).
- **Console**: no React warnings, no errors (record any).
- **Contrast**: text readable on every background, including alert banners.

## Pages (sidebar order) and page-specific checks

| # | Sidebar item | Specific checks |
|---|---|---|
| 1 | Overview → Business Overview | Stat tiles; Today / Money Moves tab; move cards; tab switching works |
| 2 | Capture → Quick Capture (AI) | Drop-zone highlight on drag-over; capture list; resolve form selects labelled (Payment method, Clock type, Contract type); WhatsApp copy still says nothing is sent until you tap Send |
| 3 | Capture → Forward to AiFA | Drop-zone and "browse" link keyboard-reachable; file input works |
| 4 | Sales → Parties | List + form; checkbox group; validation messages |
| 5 | Sales → Pricing & Catalog | Chips render; forms labelled |
| 6 | Sales → Quotations | **Behaviour change:** actions appear in a detail card after selecting a row; lines table; selected row highlighted |
| 7 | Sales → Invoices | List, status pills, create form |
| 8 | Sales → Payments & Credit Notes | Tabs, forms, tables |
| 9 | Sales → AR Ageing | Buckets, money alignment |
| 10 | Purchases & Cash → Payment Vouchers | List/form; AP RM0.00 disclosure label still visible |
| 11 | Purchases & Cash → Expense | Form labels, validation |
| 12 | Purchases & Cash → Purchase Orders | Table, actions |
| 13 | Purchases & Cash → Cash Book / P&L | Tabs, totals |
| 14 | Inventory → Products & Stock | Tables, forms, chips |
| 15 | Inventory → Delivery Orders | Row select opens detail card |
| 16 | Accounting → Chart of Accounts | Type tabs; "New custom account" form; System pill |
| 17 | Accounting → Ledger | Filter bar (account/from/to); table; cutover-gap note in empty state |
| 18 | Accounting → Full Reports & Bank Reconciliation | 4 tabs; **Balance Sheet red "totals may not balance" banner always visible**; Tax Report amber placeholder banner; Trial Balance balanced/unbalanced alert; Match panel opens only after clicking "Match to ledger entry" (do not confirm a match) |
| 19 | Compliance → e-Invoice & SST | **Red "SIMULATED — NOT CONNECTED TO LHDN MyInvois" banner visible on both tabs**; tax-advice statement under title; reject-simulation card opens/closes (do not confirm) |
| 20 | People → Payroll | Employees + Payroll Runs tabs; calculator (safe, no data written); run row select shows payslips card; **PCB caveat visible**; "Maybank2u unverified" warning visible when export panel opens; never enter an encryption key |
| 21 | People → Attendance & Leave | Two tabs; manual-entry disclosure; solo/team routing note |
| 22 | People → Commission | Forms, tables |
| 23 | Legal → Contracts & Alerts | Due Alerts + Contracts tables; New Contract form labels, Auto-renew checkbox |
| 24 | Legal → e-Signature | **Red "SIMULATED — NOT CONNECTED TO A REAL E-SIGNATURE PROVIDER" banner**; legal-validity caution under title |
| 25 | Team → Members & Roles | Display-name card; (Owner) invite card; table with actions; "Set label" card opens/closes |
| 26 | Team → Approvals | 5 tabs with counts; tasks table; My Delegations form + tables; do not decide any task |
| 27 | Settings → Devices | Devices card with table; read-only device notice present; Rename input accessible name; do not revoke |
| 28 | Settings → Business Settings | Profile/Notifications edit forms (open then Cancel); Website card (accent colour picker); Public Site card (Copy link works); AI provider keys card (if gateway configured); "This browser" card |
| 29 | AI Workspace (top bar) | Drawer opens; "Ask AiFA" field labelled; Enter submits; error state styled |
| 30 | Entry screens | Sign-in, workspace switcher, create business, device setup: labelled fields, gold primary only |
| 31 | Shell | Skip link on Tab, sidebar collapse/rail, top bar menu, bell, tab strips keyboard-operable |
| 32 | Public Site (`web-public`) | Landing page at 390/1024/1440; owner accent colour applied; contact links; 404 page; no layout shift |

## Report format (point form, no long prose)

Return a markdown report:

- **Run info**: commit hash, widths tested, dark-mode tested (Y/N), data source (test account / blocked).
- **Pass/fail table**: one row per page above → `PASS` / `FAIL` / `BLOCKED` + one-line note.
- **Findings**: for each FAIL: page, width, steps to reproduce, expected vs actual, severity (blocker / major / minor / cosmetic), screenshot filename.
- **Console errors/warnings** list.
- **Disclosure check**: confirm each of these is visible where expected — AP RM0.00 label; e-Invoice SIMULATED banner (both tabs); e-Signature SIMULATED banner; Balance Sheet banner; tax-report placeholder; Maybank2u warning; PCB caveat; read-only device notice; WhatsApp "nothing is sent until you tap Send"; solo/team approval notes.
- **Not verified** and why.

Save screenshots under `docs/ui-polish-walkthrough/` (create it) and the report as `docs/ui-polish-walkthrough/REPORT.md`. Do not commit; leave that to the owner.
