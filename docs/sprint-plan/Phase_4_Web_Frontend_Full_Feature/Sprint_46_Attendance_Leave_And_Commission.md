# Sprint 46 — Attendance, Leave & Commission

**Duration:** Weeks 19–20 (of Phase 4)
**Architecture references:** Vol 13_0 §11 (Module H: Pengurusan Syarikat Lengkap); Vol 13_3 §3 (`solo_self_resolved`); Vol 12_2 §4.2

---

## Theme

The last People-section module, layered on top of Payroll (overtime pay feeds statutory deductions) and Sales (commission is computed from Invoices).

## Objectives

Attendance can be recorded and leave requested/approved; commission is computed and viewable per invoice/employee; the GPS/offline-capture gap disclosed since Sprint 35 is carried forward honestly, not silently closed by this sprint.

## Task Breakdown

### Attendance & Leave (`attendanceLeaveCommissionTransport.ts`)
- Clock-in/out capture (web equivalent of mobile's own capture — reuses the existing offline-capture/queue pattern per the transport's own note, does not build a new one)
- Leave request/approve flow, linked into Sprint 38's Approvals inbox
- Self-service view for `solo_self_resolved` businesses (Vol 13_3 §3) — a solo owner sees their own records without a separate approval step

### Commission (`attendanceLeaveCommissionTransport.ts`)
- Commission calculation display per invoice/employee, linked into Sprint 40's Invoice detail view where relevant

## Definition of Done

- [x] Attendance/leave lifecycle verified end to end against real test data
- [x] Solo-mode self-resolution verified distinct from team-mode approval routing
- [x] Commission figures verified against a real converted invoice
- [x] The GPS/offline-device-verification gap (open since Sprint 35) is explicitly noted in this sprint's Outcomes as still open, not silently assumed solved by having a web screen now
- [x] Standard five DoD items from `00_Sprint_Plan_Overview.md`

## Dependencies

Sprint 37 (shell), Sprint 38 (Approvals/roles), Sprint 40 (Invoices commission is computed from), Sprint 45 (overtime pay's payroll interaction).

## Risks

| Risk | Mitigation |
|---|---|
| Building a web screen for attendance could read as "closing" Sprint 35's open GPS/offline gap, which this sprint does not actually address (that gap is a mobile-device/GPS testing question, not a web-UI one) | State plainly in this sprint's own Outcomes that the gap remains open and is orthogonal to this sprint's scope |

## Safe to Carry Over

None expected.

---

## Outcomes (recorded 2026-09-03)

**Status: DONE**, with one disclosed pre-existing gap read around (not fixed at the transport level) and the GPS/offline gap explicitly restated as still open, per this sprint's own DoD item.

- **GPS / offline-device-verification gap — STILL OPEN, not closed by this sprint:** this sprint's own web screen (`AttendanceLeavePage.tsx`) is a manual admin-entry form (`source: "manual_admin_entry"`), not the mobile app's GPS-tagged offline-capture flow. That mobile flow already existed before this sprint (Vol 7_4's pattern, reused unmodified per the transport's own header) and is untouched here. A real airplane-mode/on-device verification of the mobile offline queue remains outside what this session's tooling can perform — exactly the same disclosed boundary as Sprint 35's own Outcomes, restated here rather than silently assumed solved because a web screen now exists. The web page's own attendance list visibly distinguishes `mobile` vs `manual entry` source, and shows "no GPS captured" for every web-entered row, so the distinction is visible in the UI itself, not just in this note.
- `web/src/lib/attendanceLeaveCommission.ts` (new): the ninth "no list RPC" lib helper — `attendanceLeaveCommissionTransport.ts` exposes only mutating/lifecycle RPCs plus the one deterministic report (`revenueVsCostDashboard`, called directly, no duplication). Also disclosed and worked around: `invoices.agent_party_id` was added by this same Sprint 35 migration but `quotationInvoiceTransport.ts`'s `Invoice`/`InvoiceRow` types (Sprint 28) were never updated to expose it, and `assignInvoiceAgent` itself discards the RPC's returned row (typed `Promise<void>`) — so `listInvoiceAgentAssignments` reads the column directly, schema-only, same pattern as `delivery_order_lines`/`quotation_lines` elsewhere this phase. Not a transport-level fix (unlike Sprint 44's dead-code removal) since nothing was broken — just an omission worked around the same way this phase has worked around every other under-exposed column.
- `web/src/shell/pages/AttendanceLeavePage.tsx` (new), two tabs (Attendance & Overtime / Leave):
  - Manual clock-in/out entry, explicitly labelled as such (see the GPS note above), plus a recent-attendance list distinguishing `mobile` vs `manual entry` source and showing "no GPS captured" for rows with no coordinates.
  - Derive-overtime-for-date action, verified against the transport's own irregular-schedule case (a non-default `scheduledHours` value is accepted and passed through, not hardcoded to 8).
  - Leave types (configure-gated per the RPC, labelled as such), leave balance grants, and leave applications — with `createLeaveApplication`'s own documented behavior preserved end to end: balance is never deducted at submission time, only on approval (verified by reading the RPC's own comment and the schema's decision-sync-trigger note, not assumed).
  - **Solo vs team framing, this sprint's own required distinction:** every action that opens an ApprovalTask (derive overtime, apply for leave) renders one of two mutually exclusive banners depending on `useAccess().accessModel` — solo: "you're the sole approver... approved automatically (solo_self_resolved), no separate review step"; team: "routes through the Approvals inbox" with a Go to Approvals link. Verified against the schema's own `resolve_approval_task` function, which resolves a solo business's task synchronously in the same transaction (`resolved_via = 'solo_self_resolved'`) — so this page's plain reload-after-create already shows the true final status with no special-casing needed, and the banner text is the only place solo/team behavior needed to be made explicit.
- `web/src/shell/pages/CommissionPage.tsx` (new), three tabs (Invoices / Rules / Revenue vs Cost):
  - Commission rules (business-wide default or agent-specific, gated on `configure` per the RPC).
  - Per-invoice: assign an agent (party must carry the `agent` party type, enforced server-side and mirrored in the picker's own filter), compute commission (the RPC's own specific error — naming both the invoice's actual status and the configured trigger status — is surfaced verbatim rather than this page trying to preflight a setting no transport exposes; see this page's own header), and mark a computed-and-approved commission paid. Verified against a real converted invoice (Sprint 40's quotation→invoice flow): assign agent → compute → (solo: instantly approved) → mark paid, commission amount matches the created rule's rate against the invoice total.
  - Revenue vs Cost dashboard (date range → `revenueVsCostDashboard`), read-only per the transport's own scope.
- `web/src/shell/pages/InvoicesPage.tsx` (Sprint 40, extended this sprint): the expanded invoice detail now shows an "Agent & Commission" section (current agent, computed commission amount/status if any) — satisfying this sprint's task-breakdown line to link commission display into the Invoice detail view — without duplicating the Commission page's own assign/compute actions there.
- `web/src/shell/AppShell.tsx` / `sidebarConfig.ts`: wired both `attendance-leave` and `commission` to `status: "existing"`.
- Onboarding gap remains open by the owner's own explicit instruction, still tracked for a dedicated follow-up.

*End of Sprint 46.*
