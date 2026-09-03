# Sprint 35 — Attendance, Leave & Commission

**Duration:** Weeks 29–30 (of Phase 3)
**Architecture references:** Vol 13_0 §11 (Pengurusan Syarikat Lengkap)

---

## Theme

The new domain Vol 13_0 introduced from scratch (no prior Series 6 volume covered it): GPS clock-in/out, overtime derivation, leave management, and commission calculation — feeding directly into Sprint 34's payroll.

## Objectives

An employee can clock in/out with GPS captured, overtime is correctly derived and approved, a leave application/approval cycle completes correctly and reaches the next payroll run, and a commission calculation correctly triggers off a paid/issued invoice.

## Task Breakdown

### Schema
- `public.attendance_records`, `public.overtime_records`, `public.leave_types`, `public.leave_balances`, `public.leave_applications`, `public.commission_rules`, `public.commission_calculations` per Vol 13_0 §11

### Attendance & Overtime
- Mobile GPS clock-in/out capture, reusing Vol 7_4's existing offline-capture/queue pattern — no new offline model
- Overtime derivation job (scheduled or on-demand) comparing attendance pairs against scheduled hours, drafted then routed through `ApprovalTask` (`domain = hr_attendance_leave`)
- Verified sync path: an approved `OvertimeRecord` correctly reaches the next `PayrollRun`'s gross-pay calculation (Sprint 34)

### Leave
- Leave type/balance setup, application submission, approval routing through the real engine
- Verify balance deduction only happens on approval, never on submission alone

### Commission
- Commission rule configuration (percent-of-invoice, percent-of-margin, flat-per-unit)
- Auto-trigger on `Invoice.status` reaching the business-configured trigger point (`issued` or `paid`), computing against the correct agent `Party`

### Dashboard (minimal)
- A read-model view joining revenue (Sprint 30 reports) against payroll+commission cost — functional minimum per Vol 13_0 §11's own framing as "no new storage"

## Definition of Done

- [ ] GPS clock-in/out works with offline queueing verified (airplane-mode test, same discipline as Vol 7_4's existing offline tests)
- [ ] Overtime correctly derived, approved, and verified reaching a real payroll run
- [ ] Full leave application → approval → balance deduction cycle verified
- [ ] Commission correctly computed and attributed to the right agent for at least two different `basis` types
- [ ] Dashboard shows correct revenue-vs-cost figures for at least one test period

## Dependencies

Sprint 34 (payroll run to feed overtime into), Sprint 28/29 (invoices to trigger commission from), Sprint 25 (approval engine).

## Risks

| Risk | Mitigation |
|---|---|
| GPS accuracy/reliability issues on real devices in the field | Surface `gps_accuracy_m` to the owner rather than hiding it; don't silently trust a low-accuracy reading as authoritative |
| Overtime derivation logic miscalculates against irregular schedules | Verify against at least one irregular real-world schedule case (not just a clean 9-to-5), given SME staff schedules are rarely uniform |

## Safe to Carry Over

Richer dashboard analytics beyond the basic revenue-vs-cost view are explicit follow-on work; the functional minimum is this sprint's bar.

---

*End of Sprint 35.*
