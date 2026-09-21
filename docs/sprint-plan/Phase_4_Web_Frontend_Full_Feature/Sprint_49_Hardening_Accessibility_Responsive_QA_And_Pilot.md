# Sprint 49 — Hardening, Accessibility, Responsive QA & Pilot

**Duration:** Weeks 25–26 (of Phase 4)
**Architecture references:** Vol 12_2 (whole volume — this sprint verifies it was actually built as designed); Vol 12_1 (concurrency/sync UX, final verification pass)

---

## Theme

The final sprint of this plan, mirroring Sprint 20's role at the close of Phase 2 and Sprint 36's at the close of Phase 3: no new sidebar items, only verification, hardening, and an honest close-out of what remains open across the whole phase.

## Objectives

Every sidebar item (Vol 12_2 §4.2) works correctly for both a solo-owner and a restricted-role test membership; the shell is usable at common desktop/laptop widths; keyboard/screen-reader basics work on the sidebar/tab/form patterns every module reuses; a real pilot session (the owner, or a delegated tester) has used the full frontend against real business data.

## Task Breakdown

### Cross-module role-visibility audit
- Verify Vol 12_2 §4.4's sidebar-collapse behaviour for at least three distinct role profiles (Owner, Bookkeeper-shaped, Sales-Agent-shaped), not just the two-membership spot checks each prior sprint did individually

### Responsive/accessibility pass
- Verify the shell (sidebar collapse, tab strip, tables) at common desktop/laptop breakpoints — this phase does not target mobile-web parity (Vol 12_2 §3), but must not break on a smaller laptop screen
- Keyboard navigation and basic screen-reader labelling on the sidebar, tab strip, and the most-used form patterns (built once in Sprint 37, so this is a shell-level check, not nineteen separate module checks)

### Concurrency/sync final verification
- Re-verify Vol 12_1's active-device read-only gating and Vol 12_2 §6's rules across a sample of write actions from different modules, not just Sprint 37/38's own original build-time checks

### Pilot & close-out
- A real pilot session against real (or realistic test) business data, covering at least one full workflow per sidebar section
- Phase 4 close-out note in `Checklist_Master.md`, naming every real remaining gap honestly (LHDN sandbox, e-signature vendor, Maybank2u format, GPS/offline device test — all four carried unresolved from Phase 3 — plus any Phase-4-specific gaps surfaced by this sprint), mirroring Phase 3's own close-out discipline

## Definition of Done

- [x] Role-visibility audit passed for three distinct role profiles (static trace: Owner, Bookkeeper/Accountant, Sales Agent — see Outcomes)
- [x] Shell responsive at common desktop/laptop breakpoints, no broken layout found (Ledger table overflow-wrap fix applied; the other four table pages already correct)
- [x] Keyboard navigation works for sidebar, tabs, and the most common form pattern (Sidebar collapsed-state aria-label added; AI Workspace Escape-to-close added; TabStrip already had basic keyboard support; a disclosed placeholder-only-label gap remains on some form inputs, logged not fixed)
- [x] Concurrency/sync gating re-verified across a representative sample of modules — **found materially incomplete, disclosed rather than silently passed**: the active-device read-only gating Vol 12_2 §6 requires is wired on `BusinessSettingsPage.tsx` only; none of the 18 Series-13-backed module pages built in Sprints 39-48 implement it, despite each sprint's own Outcomes claiming the standard five DoD items held. Server-side authorization (`caller_has_capability` + RLS) remains sound and unaffected — this is a UX/documentation-conformance gap, not a correctness or data-integrity risk. See Outcomes for full detail; logged as the central Phase 4 close-out finding, not fixed inline per this sprint's own Risk table.
- [x] Pilot session completed and any findings logged (fixed here if small, or explicitly carried over if not) — static code-trace pilot only; this session's Linux device-bridge shell cannot run Vite/Rollup (`@rollup/rollup-linux-x64-gnu` missing, disclosed since Sprint 37/40), so no live browser pilot could be run here. A real owner-run live pilot remains open and is named in the close-out note.
- [x] Phase 4 close-out note written, naming every real open gap honestly (see `Checklist_Master.md`)
- [x] Standard five DoD items from `00_Sprint_Plan_Overview.md`, verified phase-wide, not just for this sprint's own (nonexistent) new screens — four of five hold phase-wide; item 3 (active-device gating) does not and is the central finding above, corrected in documentation now rather than silently re-claimed

## Dependencies

Sprint 48 (and, transitively, every earlier Phase 4 sprint).

## Risks

| Risk | Mitigation |
|---|---|
| A hardening sprint can silently become "fix everything found," ballooning past two weeks | Triage findings: anything module-specific and non-blocking is logged as a disclosed open item for a future maintenance pass, not fixed inline against this sprint's own budget — mirrors how Phase 3 sprints consistently drew this same line |

## Safe to Carry Over

Explicitly: nothing from this sprint carries forward silently — this is the phase's own close-out sprint, so every open item found here must be named in the close-out note, not left implicit.

---

## Outcomes (recorded 3 September 2026)

**Status: COMPLETE**, with one significant, previously-undisclosed finding surfaced and honestly reported (not fixed inline, per this sprint's own Risk-table triage rule) — see "Central finding" below — and one genuine environment limitation (this session cannot run a live browser against this codebase) that shaped how every verification task in this sprint was actually carried out.

### Environment constraint, stated up front

`npm run build` and `npx vite` both fail in this session's Linux device-bridge shell with `Cannot find module '@rollup/rollup-linux-x64-gnu'` — Vite/Rollup ship Windows-native optional-dependency binaries that this Linux VM never installed, the same class of gap disclosed in Sprint 37 ("Vite build/dev remain unverifiable from this Linux device-bridge shell") and reconfirmed unchanged here. This session therefore could not run a live `npm run dev` session or click through the app in a real browser. Every verification task below was carried out as a **static code/data trace** — reading the actual component code, the actual RPC implementations, and the actual seeded `role_permissions`/`schema.sql` data, and reasoning through what the running app would do — not a live UI test. This is stated plainly rather than presented as a live pilot, and a real live click-through (ideally by the owner, from their own Windows `npm run dev`) remains a genuine open item, not something this sprint can close from this environment.

### Cross-module role-visibility audit (static)

Traced `role_permissions` seed data (`schema.sql` lines ~864-920) against `sidebarConfig.ts`'s domain gates and `AccessContext.tsx`'s actual `isDomainVisible`/`getGrantedDomainsForRole` logic (any granted capability on a domain makes it visible — not capability-specific) for three role profiles:
- **Owner** — every domain granted (cross-join over all domains/capabilities) — sees all ten sidebar sections, all 25 items.
- **Bookkeeper / Accountant** — granted `accounting_reports, sales, expense, inventory, pricing, tax_compliance, payroll` only. Traced item-by-item: sees Overview, Sales, Purchases & Cash, Inventory, Accounting (minus Chart of Accounts — `settings` not granted), Compliance, People (Payroll only — no `hr_attendance_leave`/`commission`), Team, Settings (Devices only). **Legal section correctly collapses entirely** (zero granted items) — matches the role's own seeded description exactly.
- **Sales Agent** — granted `sales, pricing, commission` only. Traced: sees Overview, Sales (minus AR Ageing — `accounting_reports` not granted), People (Commission only), Team, Settings (Devices only). **Purchases & Cash, Inventory, Accounting, Compliance, Legal all correctly collapse entirely.** Matches the role's own seeded description ("Capture on sales/pricing; view own commission records; nothing else") exactly.

All three traces are internally consistent with each role's own stated description in the seed data — no visibility mismatch found.

### Responsive/accessibility pass

- **Found and fixed:** `LedgerPage.tsx` rendered its `<table>` directly inside `.aifa-page` with no horizontal-scroll container — the one page of the five that render real `<table>` elements that was missing the `overflow-x: auto` wrapper the other four (`CashBookPlPage`, `EInvoiceSstPage`, `FullReportsPage`, `ProductsStockPage`) already had. Fixed by wrapping it the same way, so a wide ledger table scrolls within its own card at a narrower laptop width instead of stretching the page.
- **Found and fixed:** `Sidebar.tsx`'s collapsed state rendered each item's visible button text as `item.label.slice(0, 1)` (a single letter) with only a `title` tooltip (not reliably announced by screen readers) carrying the full label — so a screen-reader user with the sidebar collapsed would hear "P" instead of "Payroll." Fixed by adding `aria-label={item.label}` so the accessible name stays the full label regardless of the collapsed visual state.
- **Found and fixed:** the AI Workspace slide-over (`AppShell.tsx`) had no Escape-to-close handling — only its own "✕" button (itself keyboard-reachable) closed it. Added an `onKeyDown` handler so Escape closes it too, matching the common dialog/slide-over keyboard pattern.
- **Checked, no other layout breakage found:** `.row`'s `flex-wrap: wrap` already lets every filter bar/create-form's inline inputs reflow at narrower widths; `.aifa-page`'s `max-width: 960px` is a cap, not a forced width, so it shrinks correctly under the sidebar+padding budget at common laptop widths (verified arithmetically: 1024px viewport − 240px sidebar − 48px padding = 736px, well within a shrinkable block).
- **Genuine, disclosed open gap — NOT fixed, out of this sprint's budget:** every form input across all ~19 module pages uses a bare `<input placeholder="...">` with no associated `<label>` element — a real, systemic screen-reader gap (a placeholder is not a reliable accessible name once text is entered, and some screen readers don't announce it at all). This is module-specific work across every page's every field, not a single shell-level component fix like Sidebar/TabStrip/the slide-over were — retrofitting real `<label>` elements onto every field in ~19 pages is squarely the kind of "fix everything found" scope-creep this sprint's own Risk table says to avoid. Logged here as a real, disclosed open item for a dedicated future accessibility pass, not silently left undocumented.
- `TabStrip.tsx` already uses `role="tablist"`/`role="tab"`/`aria-selected` on real, natively-focusable `<button>` elements — basic keyboard operability (Tab to reach, Enter/Space to activate) already works; full ARIA APG roving-tabindex/arrow-key navigation was not added, judged out of "basics" scope per this sprint's own DoD wording.

### Concurrency/sync final verification — CENTRAL FINDING

Re-verifying Vol 12_1 §6a.3 / Vol 12_2 §6's rule ("every write-capable screen... must check and respect this [active-device-lock] state... disabled with Vol 12_1 §6a.3's exact read-only banner treatment") against a representative sample of Sprint 39-48 write actions found that **none of the 18 Series-13-backed module pages (every page except `BusinessSettingsPage.tsx`) actually check or respect the active-device lock at all.** Concretely:
- `activeDeviceInfo` (`ActiveDeviceInfo | null`) is threaded from `AppShell.tsx` only into `TopBar.tsx` (for its own status pill) — it is never passed to `renderContent()` or any module page.
- Grepping every `web/src/shell/pages/*.tsx` file for `activeDeviceInfo`/`isActiveDevice`/`assertWriteAllowed`/`assertSyncGateOk` found exactly one match: `BusinessSettingsPage.tsx` — because it alone still writes through the old local-first `appSettingsRepository.ts` (`updateBusinessProfile`/`updateNotificationPreferences`), which internally calls `assertSyncGateOk`.
- Every other module's write action (create Quotation, record Payment, run Payroll, create Contract, etc. — the exact examples Vol 12_2 §6 itself names) calls a Supabase RPC directly via `client.rpc(...)`, with Postgres + RLS as the sole authority. This code path has no relationship whatsoever to the local device-lock/outbox mechanism — `enqueueSyncableWrite`/`assertSyncGateOk` are used only by six `packages/core/src/db/*Repository.ts` files (all Phase 1/2 local-first entities: AI interpretation, app settings, business events, business knowledge, local document metadata, the now-superseded local ledger), never by any of the fourteen `packages/core/src/sync/*Transport.ts` files Series 13/Phase 4 actually builds against.

**Risk assessment, stated plainly:** this is a real, previously-undisclosed gap between Vol 12_2 §6's stated design and what Sprints 39-48 actually built — not a data-corruption risk. Vol 12_1's device-lock model exists to prevent two devices' local SQLite mirrors from silently diverging before an eventual sync reconciles them; Series 13's Supabase-RPC-direct architecture has no local mirror for these entities at all; two devices/memberships submitting RPCs concurrently are both just ordinary concurrent Postgres transactions, correctly serialized and authorized by `caller_has_capability`/RLS exactly as any normal multi-user web app is — there is no silent data loss or divergence risk here. What is missing is the specific **UX signal** Vol 12_1/12_2 called for (a visible "this device is read-only, another device is active" banner disabling write buttons on these 18 pages) — a real, disclosed non-conformance with the written design, not a correctness bug.

**Not fixed inline**, per this sprint's own Risk table ("anything module-specific and non-blocking is logged as a disclosed open item... not fixed inline against this sprint's own budget") — retrofitting a real device-lock read-only banner into 18 pages' worth of write actions is a multi-page undertaking, not a hardening-sprint-sized fix. Logged as the single most significant open item from this sprint — see the Phase 4 close-out note in `Checklist_Master.md`.

Separately, server-side authorization correctness (the actual thing that prevents an unauthorized write, independent of any device-lock UX) was spot-checked across the sample and confirmed present on every RPC read this session across all of Phase 4 (`caller_has_capability` checks on `create_contract`, `create_esignature_envelope`, `_create_invoice_from_quotation`'s credit-limit gate, `create_payment_voucher`, etc.) — this part of Vol 12_1/13_2's design is solid and was never in question.

### Pilot & close-out

Given the environment constraint above, "pilot" here means a full end-to-end **code trace** of one representative workflow per sidebar section, confirming each is genuinely wired (component → lib/transport call → real RPC → real schema), not a live click-through:

- **Overview:** `BusinessOverviewPage` Snapshot tab → `trialBalance` RPC (rows '1000'/'1100'/'2000') + `listApprovalTasks` (direct table read) — built and typechecked this phase's own Sprint 48.
- **Sales:** `QuotationsPage` → `createQuotation` → ApprovalTask → `markQuotationSent` → `convertQuotationToInvoice` (credit-limit gate) — Sprint 40/47.
- **Purchases & Cash:** `PaymentVouchersPage` → `createPaymentVoucher` → approve → `markPaymentVoucherPaid` (posts EXP-001) — Sprint 41.
- **Inventory:** `DeliveryOrdersPage` → dispatch decrements stock-tracked lines — Sprint 42.
- **Accounting:** `FullReportsPage` → `trialBalance`/`balanceSheetSummary` — Sprint 43 (same RPCs Sprint 48's Snapshot reuses, cross-sprint consistency confirmed).
- **Compliance:** `EInvoiceSstPage` → `submitEinvoice` → `StubMyInvoisClient.submitForValidation` — Sprint 44.
- **People:** `PayrollPage` → `createPayrollRun` → `computeStatutoryDeductions` → payslips — Sprint 45.
- **Legal:** `ContractsAlertsPage` → `createContract` → ApprovalTask → `ESignaturePage` → `markEsignatureEnvelopeSigned` → Contract 'active' — Sprint 47.
- **Team:** `ApprovalsPage` → `decideApprovalTask` / `createApprovalDelegation` — Sprint 38/48.
- **Settings:** `BusinessSettingsPage` → `updateBusinessProfile`/`updateNotificationPreferences` (local-first, sync-gated) — Sprint 48.

Every sidebar item (all 25) confirmed wired to a real component in `AppShell.tsx`'s switch statement — zero orphaned `PlaceholderPage` fallbacks remain (verified by diffing every `sidebarConfig.ts` id against every `AppShell.tsx` case id, no gaps found).

A genuine, owner-run live pilot session (real browser, real `npm run dev` on a machine where Vite's native binaries resolve, ideally against a seeded test business with a second non-Owner test membership) remains a real open item this session's environment cannot close — recorded as such in the Phase 4 close-out note, not silently assumed equivalent to the code trace above.

### Verification

- `npm run typecheck` (`web`): clean except the same pre-existing, unrelated `dek.ts` gap disclosed since Sprint 40.
- `npm run lint` (`web`): clean, zero warnings.
- `npm run build`/`npx vite`: **cannot run in this session** (Rollup native-binary gap, disclosed above) — not silently skipped, stated as its own limitation.

Onboarding gap remains open by owner's explicit instruction, tracked for a dedicated follow-up. Phase 4 close-out note is in `Checklist_Master.md`.

---

*End of Sprint 49. End of Phase 4 Sprint Plan.*
