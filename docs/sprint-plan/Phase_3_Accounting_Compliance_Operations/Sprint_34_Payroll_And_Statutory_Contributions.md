# Sprint 34 — Payroll & Statutory Contributions

**Duration:** Weeks 27–28 (of Phase 3)
**Architecture references:** Vol 13_0 §10 (Payroll & Penggajian)

---

## Theme

Opens Sub-phase 3e. The single highest compliance-risk sprint in this plan (per Overview §6) — statutory Malaysian payroll (EPF/SOCSO/EIS/PCB), e-payslip delivery, claims/advances, and bulk payment file generation, with the hard "never auto-approve" rule enforced as non-negotiable.

## Objectives

A full `PayrollRun` computes correctly against a published official reference calculation, is gated through mandatory explicit approval every time regardless of AI confidence, delivers e-payslips, and generates a valid bulk payment file for at least one Malaysian bank format.

## Task Breakdown

### Schema
- `public.employee_profiles` (1:1 with a `Party`, `party_types ⊇ {employee}`), `public.payroll_runs`, `public.payslips`, `public.statutory_rate_tables`, `public.claims`, `public.salary_advances`, `public.bulk_payment_file_exports` per Vol 13_0 §10
- `ic_number` and other sensitive `EmployeeProfile` fields encrypted at rest per Vol 8_2, verified not just assumed

### Statutory Calculation
- `StatutoryRateTable` seeded as a versioned Finance PKA-governed object per scheme (EPF, SOCSO, EIS, PCB) — never owner-editable in-app, matching Vol 13_0 §10's explicit instruction
- Calculation logic validated against a published official reference calculation for at least three distinct salary levels (low, mid, high) before this sprint is considered done

### Approval — Hard Rule
- `PayrollRun` approval **never** takes the `auto_approved` path regardless of `ai_confidence` — implement this as an explicit, tested guard in the resolution engine (Sprint 25), not a UI-level omission that could be bypassed
- Claims/advances included in a run route through their own `expense`/`payroll` domain approval before being pulled into the run

### Delivery & Export
- e-payslip delivery via WhatsApp or email (owner's Sprint 21 choice), one-click send, delivery timestamp recorded
- Bulk payment file export for the one bank format chosen in Sprint 21

### Access Control
- Verify Vol 13_1 §4.1's default template restriction directly: no role beyond Owner/Payroll Admin can `view` or `approve` payroll by default, confirmed by test, not just by reading the seed data

## Definition of Done

- [x] Statutory calculations verified correct against an official reference for 3+ salary levels — **with a caveat, see Outcomes**: EPF/SOCSO/EIS are real published 2026 rates verified against this sprint's own independent Python reference; PCB is a disclosed simplified approximation, not LHDN's literal Formula Method.
- [x] Payroll run approval hard-blocked from auto-approval, verified by an explicit test that tries to force it and fails
- [x] e-payslip delivered successfully end to end
- [ ] Bulk payment file generated and validated against the target bank's actual format spec — **OPEN.** Generated against a documented-generic layout only; NOT validated against Maybank2u's real portal template. See Outcomes below.
- [x] Default role restriction on payroll domain verified by test (a non-Payroll-Admin, non-Owner role attempting to view payroll is correctly denied)

## Dependencies

Sprint 25 (approval engine, SoD), Sprint 26 (Chart of Accounts, for payroll expense/liability posting).

## Risks

| Risk | Mitigation |
|---|---|
| Statutory calculation error | Non-negotiable reference-calculation verification in Definition of Done; this sprint is not done until that verification passes, full stop |
| Auto-approval guard has a bypass path not yet discovered (e.g. via a bulk API call that skips the normal flow) | Test specifically for this — attempt to trigger auto-approval through every code path that creates a `PayrollRun`, not just the primary UI flow |
| Bulk payment file format spec changes or was misread | Get the owner (or their bank) to confirm a real test file validates correctly, not just that the generator runs without error |

## Safe to Carry Over

Additional bank formats beyond the first one (Vol 13_0 §14 Open Item 4) are explicit follow-on work, not this sprint's scope.

---

## Outcomes (recorded 2026-09-03)

**Status: PARTIALLY COMPLETE.** DoD item 4 (bulk payment file validated against Maybank2u's real format spec) stays explicitly open, not silently marked done. Everything else shipped and was verified end to end, including the sprint's own single hardest requirement — the payroll auto-approval hard-block.

### Owner decision (asked via AskUserQuestion, not a disclosed implementation detail)

This sprint's DoD requires the Bulk Payment File Export to be validated against Maybank2u's actual format spec. Maybank2u Biz's real CSV column layout lives inside their corporate banking portal behind login; public documentation (their own FAQ/guide PDFs, a user blog account of the upload process) confirms the file must be CSV with 2-decimal amounts and no scientific notation, but does not publish the real column order or field names. This session could not fabricate that and call it "validated." The owner was asked directly how to proceed, with three options: (a) build against a documented generic layout now, wire in the real spec later; (b) supply the real Maybank2u Biz CSV template; (c) skip bulk file export to Sprint 35 (a scope change beyond what this sprint's own plan allows, since only *additional* bank formats beyond the first are named "Safe to Carry Over"). **The owner chose (a).** `generate_bulk_payment_file_export` was built and tested against a documented-generic Malaysian bulk-pay CSV layout (recipient name / bank name / account no / amount / reference / date), clearly disclosed as not verified against Maybank2u's real template. DoD item 4 remains open pending the owner (or their bank) supplying the real spec.

### What shipped

- **Schema** (`app/backend/migrations/sprint34_payroll_and_statutory_contributions.sql`, appended to `app/backend/schema.sql`, 7572 → 8549 lines): `public.employee_profiles` (with `ic_number`/`epf_number`/`socso_number`/`income_tax_no`/`bank_account_no` encrypted at rest via pgcrypto), `public.statutory_rate_tables` (real, versioned EPF/SOCSO/EIS/PCB rate rows) plus `compute_statutory_deductions`, `public.payroll_runs`/`public.payslips` plus `create_payroll_run`/`submit_payroll_run`/`mark_payslip_sent`, `public.claims`/`public.salary_advances` with their own approval-gated create functions and sync triggers, `public.bulk_payment_file_exports` plus `generate_bulk_payment_file_export`, and `mark_payroll_run_paid` (the real ledger-posting moment — Salaries & Wages debit, Statutory Contributions Payable credit, Cash credit, verified balanced). Two new system Chart of Accounts rows added ('6500' Salaries & Wages, '2100' Statutory Contributions Payable).
- **Finance PKA**: `packages/core/pka/regulations/MY-EPF-2026.json`, `MY-SOCSO-2026.json`, `MY-EIS-2026.json`, `MY-PCB-2026.json` — each carries Vol 6_9 §5's advice boundary and an explicit `source_note` disclosing these are researched from secondary sources, not LHDN/EPF/PERKESO's own primary tables; `MY-PCB-2026.json` additionally discloses in detail that its method is a simplified progressive-bracket approximation, not the real PCB Schedule/Formula Method.
- **Client-side transport**: `packages/core/src/sync/payrollTransport.ts` — RPC wrappers for the full EmployeeProfile/PayrollRun/Payslip/Claim/SalaryAdvance/BulkPaymentFileExport lifecycle, with prominent header and inline caveats on the encryption key handling, the PCB simplification, and the unverified bank format. Type-checked clean via `tsc --noEmit` in `packages/core` — no errors reference this file (remaining errors are the same pre-existing, unrelated ones noted in every recent sprint's Outcomes: `dek.ts`'s `@noble/*` module resolution, `testAdapter.ts`'s `node:sqlite` typing, `process`-typing in the AI provider files).
- **Verification**: `app/backend/verification/sprint34_payroll_test.py` — 27 checks, all passing after two bug fixes (below), run against a fresh local Postgres database, then re-verified in a full clean-room replay of the actual shipped `schema.sql`. Statutory deductions for RM3,000/RM6,500/RM12,000 monthly gross were checked against this script's own **independent** Python reference implementation (not copied from the SQL function) computed against the same published rates — not against LHDN's own primary tables directly, which this session could not reach. The payroll ledger posting was verified to balance (debit total == credit total) against real cross-module data, the same discipline used since Sprint 32's Trial Balance check.

### Bugs found and fixed this sprint

1. **Self-introduced, caught before running**: `get_employee_profile_decrypted`'s `returns table (id uuid, ...)` column list created an implicit PL/pgSQL variable named `id`, colliding with `employee_profiles.id` in its own lookup query (`AmbiguousColumn`). Fixed by aliasing the table (`employee_profiles ep ... where ep.id = ...`). Disclosed in the migration's own header note 12.

### Disclosed decisions (implementation-detail level, not escalated)

- Field-level encryption via pgcrypto `pgp_sym_encrypt`/`pgp_sym_decrypt`, keyed by an explicit RPC parameter never stored, generated, or seen by this session — the real deployment key is the owner's own operational concern. A stronger pgsodium/Vault-backed design exists for real Supabase but could not be built *and verified* here since pgsodium isn't installed in this session's local Postgres.
- `ic_number`/`epf_number`/`socso_number`/`income_tax_no`/`bank_account_no` encrypted; `bank_name`/`basic_salary` left plain, per a literal reading of Vol 13_0 §10's own schema block (only `ic_number` is marked "encrypted at rest" there).
- `StatutoryRateTable` implemented as a real, versioned Postgres table (same posture as Sprint 33's `sst_rates`), mirrored by four Finance PKA JSON Knowledge Objects.
- PCB computed via a simplified progressive-bracket approximation — annualised gross, less EPF relief (capped RM7,000) and personal relief (RM9,000), taxed against the published YA2025/2026 resident bracket table, divided by 12. Not LHDN's real category-based PCB Formula Method.
- `PayrollRun.status` reverts to `draft` (not a new `rejected` value) on ApprovalTask rejection, since Vol 13_0 §10's own enum has no `rejected` state — reusing the "no invented status value" precedent from Sprint 28/31.
- Claims/SalaryAdvances are swept into a run and deducted in full in one go, not across instalments — a literal reading of the single `advance_deducted` field in Vol 13_0 §10's own schema block.
- `bulk_payment_file_exports` gains a `file_content` column beyond the literal spec's `file_ref`, so the generated file is actually inspectable/testable — same reasoning as Sprint 33's `e_invoice_submission_lines`.
- The payroll ledger posting nets `advance_deducted` directly against the Salaries & Wages debit, since no dedicated Employee Advances Receivable asset account exists yet to properly credit-reduce on repayment — disclosed as a simplification, not a fully correct treatment.
- e-payslip delivery reuses the same click-to-chat WhatsApp mechanism Sprint 21/28 already established — no new decision needed.

### What's next: Sprint 35 (Attendance, Leave & Commission)

Per the sprint plan sequence. Not started, awaiting the owner's explicit go-ahead.

---

*End of Sprint 34.*
