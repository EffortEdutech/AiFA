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

- [ ] Statutory calculations verified correct against an official reference for 3+ salary levels
- [ ] Payroll run approval hard-blocked from auto-approval, verified by an explicit test that tries to force it and fails
- [ ] e-payslip delivered successfully end to end
- [ ] Bulk payment file generated and validated against the target bank's actual format spec
- [ ] Default role restriction on payroll domain verified by test (a non-Payroll-Admin, non-Owner role attempting to view payroll is correctly denied)

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

*End of Sprint 34.*
