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

- [ ] GPS clock-in/out works with offline queueing verified (airplane-mode test, same discipline as Vol 7_4's existing offline tests) — **OPEN, see Outcomes**: this session has no mobile app UI or physical device; what IS verified is that `create_attendance_record` accepts a caller-supplied `recorded_at` rather than forcing `now()`.
- [x] Overtime correctly derived, approved, and verified reaching a real payroll run — including an irregular-schedule case (this sprint's own named Risk)
- [x] Full leave application → approval → balance deduction cycle verified
- [x] Commission correctly computed and attributed to the right agent for THREE different `basis` types (percent_of_invoice, percent_of_margin, flat_per_unit), including agent-specific-vs-business-default rule resolution
- [x] Dashboard shows correct revenue-vs-cost figures for at least one test period, checked against an independently-summed reference

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

## Outcomes (recorded 3 September 2026)

**Status: PARTIALLY COMPLETE.** DoD item 1 (GPS clock-in/out with a real airplane-mode/offline-queue device test) stays explicitly open, not silently marked done. Every other DoD item shipped and was verified end to end, including this sprint's own two named Risks (an irregular-schedule overtime case, and commission attributed correctly across three distinct basis types).

### DoD item 1 — a disclosed scope judgment call, not an AskUserQuestion escalation

Unlike Sprint 33's LHDN sandbox credentials or Sprint 34's Maybank2u bank format — both genuine external-dependency decisions where a real owner choice existed between concrete options — DoD item 1 is a structural limitation of this session's own toolset: there is no mobile app UI or physical device anywhere in this engagement, and there never has been (every sprint since Sprint 21 has built and verified the Postgres/RPC layer plus a client-side TypeScript transport, never actual React Native screens or on-device behaviour). There was no real choice to put to the owner — building a fake "airplane-mode test" would have meant fabricating a result, which the standing rules already forbid. What this sprint COULD and DID verify server-side: `create_attendance_record` accepts a caller-supplied `recorded_at` timestamp rather than forcing `now()` at insert time, so a record captured while offline and synced minutes or hours later still carries its true clock-in/out time — the one thing the server side must get right to support an offline-queued mobile client correctly. Vol 13_0 §11's own domain-flow text says attendance capture "reuses" Vol 7_4's existing offline-capture/queue pattern — "no new offline model needed" — meaning the queueing mechanism itself is pre-existing, unmodified client infrastructure from an earlier phase, not new work this sprint had to build. If the owner disagrees with this being handled as a disclosure rather than escalated as a decision, that's worth raising — but there was genuinely no fork to decide between.

### What shipped

- **Schema** (`app/backend/migrations/sprint35_attendance_leave_commission.sql`, appended to `app/backend/schema.sql`, 8549 → 9384 lines): `public.attendance_records` + `create_attendance_record` (GPS lat/lng/accuracy captured, alternation guard rejecting two consecutive same-type clock events), `public.overtime_records` + `derive_overtime_for_date` (pairs in/out records via a lateral join, verified against both a clean 8-hour-schedule case and an explicit irregular-schedule case) plus its approval-decision sync trigger, `public.leave_types`/`public.leave_balances`/`public.leave_applications` + `create_leave_type`/`grant_leave_balance`/`create_leave_application` (balance deduction happens only in the sync trigger on approval, verified unchanged at submission), `public.commission_rules`/`public.commission_calculations` + `create_commission_rule`/`compute_commission_for_invoice`/`mark_commission_paid`, `businesses.commission_trigger_status` and `invoices.agent_party_id` (new columns) + `assign_invoice_agent`, `create_payroll_run` re-defined to fold approved overtime into `gross_pay` before statutory computation, and `revenue_vs_cost_dashboard` (read-only, no new storage).
- **Client-side transport**: `packages/core/src/sync/attendanceLeaveCommissionTransport.ts` — RPC wrappers for the full Attendance/Overtime/Leave/Commission/Dashboard lifecycle, with header and inline caveats on the GPS/offline-testing limitation, the overtime-pay constants, and the explicit-follow-up-RPC commission trigger design. Type-checked clean via `tsc --noEmit` in `packages/core` — no errors reference this file (remaining errors are the same pre-existing, unrelated ones noted in every recent sprint's Outcomes: `dek.ts`'s `@noble/*` module resolution, `testAdapter.ts`'s `node:sqlite` typing, `process`-typing in the AI provider files).
- **Verification**: `app/backend/verification/sprint35_attendance_leave_commission_test.py` — 39 checks, all passing after three test-script bugs were found and fixed (see below), run against a fresh local Postgres database, then re-verified in a full clean-room replay of the actual shipped `schema.sql`. Statutory deductions on overtime-inclusive gross pay were checked against Sprint 34's own independent Python reference (recomputed fresh here); the dashboard's revenue/payroll-cost/commission-cost figures were checked against an independently-summed reference built from the test's own fixture data, not copied from the SQL aggregation logic.

### Bugs found and fixed this sprint

1. **Self-introduced test-script bug, caught before the run was called clean**: an assertion comparing a `recorded_at` timestamp's string representation (`"...+08:00"`) against the value psycopg2 actually returns (normalized to UTC, `"...+00:00"`) — the same instant, different display. Fixed by comparing the actual `datetime` objects instead of their string forms.
2. **Self-introduced test-script bug**: two attendance records for the same employee were inserted with `recorded_at` values out of chronological order relative to an already-inserted later record. `create_attendance_record`'s alternation guard correctly keys off the LATEST `recorded_at` (not insertion order), so inserting an earlier-dated record after a later one produced a guard rejection the test wasn't expecting — not a schema bug, a test-fixture ordering mistake. Fixed by moving that fixture to a later date than every existing record.
3. **Self-introduced test-script bug**: three `decide_pending_task` calls for commission approvals passed the invoice's own id as `subject_id` instead of the CommissionCalculation's own id (the ApprovalTask's actual `subject_id`). Fixed by looking up `commission_calculations.id` by `invoice_id` first, then deciding on that.

None of these were schema or RPC-function bugs — the migration's own SQL applied cleanly with zero errors and zero notices on every run (including the recurring RLS-policy-63-character-limit check, proactively run before the first apply this time and two policy names shortened before any test began).

### Disclosed decisions (implementation-detail level, not escalated)

- `create_attendance_record` rejects two consecutive same-type clock events for the same employee (a data-integrity guard, not named explicitly in Vol 13_0 §11's own schema block) — necessary to keep overtime derivation meaningful.
- No dedicated EmployeeSchedule table this sprint — `derive_overtime_for_date` takes `p_scheduled_hours` as an explicit parameter (default 8), matching Vol 13_0 §11's own OvertimeRecord schema block, which has no such table either.
- Overtime pay is folded directly into `create_payroll_run`'s own `gross_pay` (re-defined via `create or replace`, extending Sprint 34's version) rather than added as a separate Payslip line item, per Vol 13_0 §11's own domain-flow text ("feeds directly into the next PayrollRun's gross-pay calculation"). Hourly rate is assumed as `basic_salary / (26 working days x 8 hours)`, overtime at 1.5x — a common Malaysian payroll convention, not a verified statutory requirement; Vol 13_0 §11 specifies neither constant.
- `OvertimeRecord`/`CommissionCalculation` have no `rejected` value in Vol 13_0 §11's own literal enums — on rejection, the migration DELETES the draft/computed row rather than inventing an unlisted status value, since neither has any downstream effect yet at that point. `LeaveApplication` DOES have a real `rejected` value in its own enum and is handled normally (status updated, row kept).
- Commission's auto-trigger is realised as an explicit follow-up RPC (`compute_commission_for_invoice`) the client calls immediately after the relevant status-changing action, reusing Sprint 33's SST-computation precedent, rather than a hidden database trigger reaching into Sprint 28/29's already-shipped invoice functions. `businesses.commission_trigger_status` (new column, default `'issued'`) is the "business configuration" Vol 13_0 §11 itself names.
- `invoices.agent_party_id` (new nullable column) is a necessary, disclosed addition beyond Vol 13_0 §11's literal Invoice references — nothing in the existing schema otherwise names which agent Party a given invoice's commission belongs to.
- The Dashboard is a single read-only function, `revenue_vs_cost_dashboard` — "no new storage," per Vol 13_0 §11's own framing — not a richer ratio-driven analytics view (explicitly named Safe to Carry Over).

### What's next: Sprint 36 (Legal & Commercial)

Per the sprint plan sequence. Not started, awaiting the owner's explicit go-ahead.

---

*End of Sprint 35.*
