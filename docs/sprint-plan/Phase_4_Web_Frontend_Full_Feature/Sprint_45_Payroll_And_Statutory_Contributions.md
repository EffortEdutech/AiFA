# Sprint 45 — Payroll & Statutory Contributions

**Duration:** Weeks 17–18 (of Phase 4)
**Architecture references:** Vol 13_0 §10 (Module G: Payroll & Penggajian); Vol 12_2 §4.2

---

## Theme

The most access-sensitive module in the sidebar (`payroll` is threshold-free/always-gated, same tier as Sprint 36's `legal_contract`) — this sprint's own central discipline is making sure the UI's role gating is airtight, not just the backend's.

## Objectives

Employee profiles, payroll runs, statutory deduction computation, and the bulk payment file export are usable end to end by a correctly-gated membership, with the PCB approximation and unverified bank-file format both visibly caveated.

## Task Breakdown

### Payroll (`payrollTransport.ts`)
- Employee Profile list/detail/create/edit — sensitive-field decrypt-read gated identically to the backend's own `encryptionKey`-requiring calls; the key itself is a deployment-time secret this sprint's frontend must be configured to hold securely (never logged, never rendered in a debug view) per the transport's own note
- Payroll Run creation, `computeStatutoryDeductions` display with the PCB-approximation caveat shown wherever `pcbDeduction` is rendered
- Bulk Payment File export action, with a visible "unverified against Maybank2u — confirm with your bank before uploading" caveat per the transport's own note

## Definition of Done

- [x] Employee Profile sensitive fields are never rendered to a membership without `payroll` configure access, verified by a restricted-role test case
- [x] PCB approximation caveat is visible wherever `pcbDeduction` appears
- [x] Bulk payment file caveat is visible on the export action, not just in a tooltip
- [x] Payroll Run end-to-end flow verified against real test data
- [x] Standard five DoD items from `00_Sprint_Plan_Overview.md`

## Dependencies

Sprint 37 (shell), Sprint 38 (Team/Roles this module's access gate reads from).

## Risks

| Risk | Mitigation |
|---|---|
| The `encryptionKey` deployment secret this transport requires has no established frontend-configuration convention yet | Confirm with the owner how this secret reaches the web build (env var, runtime config) before this sprint starts building the decrypt-read screens — flag as a blocking design question for Sprint 45's own kickoff, not solved unilaterally |
| A UI showing payroll figures without the PCB/bank-file caveats could be mistaken for filing-ready output | Both caveats are explicit DoD items above |

## Safe to Carry Over

None expected, pending the encryption-key-configuration risk above being resolved before or at sprint start.

---

## Outcomes (recorded 2026-09-03)

**Status: DONE.** The blocking encryption-key-configuration risk was resolved with the owner at sprint kickoff (via AskUserQuestion) before any decrypt-read screen was built, per the risk table's own instruction.

- **Encryption key decision:** the owner chose "prompt each session" over a build-time env var — a payroll-authorized user types the key into a password-style field whenever they need it (Add Employee Profile, View sensitive details, Generate bulk payment file). It lives only in `PayrollPage.tsx`'s own React component state, is never written to `localStorage`/`sessionStorage`/an env var/any debug output, and clears when the panel that needed it is closed. A build-time env var was explicitly rejected because it would ship the secret inside the JS bundle, visible to anyone with dev tools — defeating the point of a per-call decrypt gate.
- `web/src/lib/membership.ts`: added `getGrantedCapabilitiesForDomain(roleId, domain)` — the same `role_permissions` table `getGrantedDomainsForRole` already reads, narrowed to one domain and returning the capability set instead of a boolean. Needed because this sprint's own DoD requires a finer gate than the existing domain-visibility-only `AccessContext`.
- `web/src/lib/payroll.ts` (new): the eighth "no list RPC" lib helper — `listEmployeeProfiles` reads only the non-sensitive `employee_profiles` columns (`EmployeeProfileRow`'s own documented set; `ic_number`/`epf_number`/`socso_number`/`income_tax_no`/`bank_account_no` are never read outside `getEmployeeProfileDecrypted`, called directly from the transport), plus `listPayrollRuns`, `listPayslips`, and `listBulkPaymentFileExports`.
- `web/src/shell/pages/PayrollPage.tsx` (new), two tabs (Employees / Payroll Runs) under one `payroll` sidebar item:
  - **UI-level capability gate, stricter than the backend:** the backend's own RPCs only require `view` on `payroll` for `getEmployeeProfileDecrypted` (and `capture` for the bulk export) — this page additionally hides both the "View sensitive details" control and the "Generate bulk payment file" control unless the signed-in membership's role holds `configure` on `payroll` (computed via the new `getGrantedCapabilitiesForDomain` helper; solo mode / dev-bypass, with no real membership row, is treated as unrestricted, matching `AccessContext`'s own existing posture). This directly answers this sprint's own theme sentence ("airtight on the UI, not just the backend").
  - **Restricted-role test case (verified by direct inspection of the seed data, not an automated test — this repo has no frontend test framework in any prior sprint either):** `schema.sql`'s seed `role_permissions` grants "Bookkeeper / Accountant" `payroll: view` only — no `configure` — while "Payroll Admin" holds `view`+`capture`+`approve`+`configure`. Under this page's gate, a Bookkeeper-role membership sees the plain Employee Profile list (basic salary, bank name, employment type — none of it encrypted) but never sees the "View sensitive details" button, the sensitive-field reveal panel, or the bulk-export control at all; a Payroll Admin sees both. This is exactly the DoD's required restricted-vs-privileged contrast, traced against real seeded role grants rather than assumed.
  - **PCB caveat:** a small `<PcbCaveat>` component renders "(PCB is a simplified approximation... not a filing-ready figure)" next to every `pcbDeduction` figure shown anywhere on the page — the standalone statutory-deduction calculator and each expanded payroll run's payslip list — not once at the top of the screen.
  - **Bulk payment file caveat:** the "⚠ Unverified against Maybank2u — confirm with your bank before uploading this file" warning renders as its own paragraph directly above both the key-entry form (before generation) and the generated CSV textarea (after) — not a tooltip, and shown twice so it survives the state change from "about to generate" to "generated."
  - **Payroll Run flow:** create run → submit (routes through Approvals, "never auto-approves" enforced entirely server-side per the transport's own hard rule — this UI has no override control, matching that instruction not to add one) → once approved, generate the bulk payment file (configure-gated) → Mark Paid (posts ledger entries, throws if no export exists yet — this UI only shows the Mark Paid button once an export is confirmed present, avoiding a guaranteed-to-fail click). Payslips and the generated export are lazy-loaded on row expand.
  - **Disclosed scope boundary:** Claims and Salary Advances (`createClaim`/`createSalaryAdvance`) are real RPCs on this same transport but were not built into this page — this sprint's own task breakdown lists only "Employee Profile," "Payroll Run creation + statutory deduction display," and "Bulk Payment File export," and `sidebarConfig.ts` reserves only the single `payroll` item, with no sub-item for claims/advances. Left available-but-unwired for a future sprint, not silently dropped, matching Sprint 42/43's own precedent for out-of-breakdown capabilities on an already-built transport.
- `web/src/shell/AppShell.tsx` / `sidebarConfig.ts`: wired `payroll` to `status: "existing"`.
- Onboarding gap remains open by the owner's own explicit instruction, still tracked for a dedicated follow-up.

*End of Sprint 45.*
