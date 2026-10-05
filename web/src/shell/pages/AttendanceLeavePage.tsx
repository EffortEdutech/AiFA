/**
 * Attendance & Leave — Sprint 46 (Vol 13_0 §11 Module H).
 *
 * GPS / OFFLINE-CAPTURE NOTE (disclosed, open since Sprint 35 — carried
 * forward, not closed by this sprint): this page's own clock-in/out
 * form is a MANUAL web entry point (`source: "manual_admin_entry"`),
 * for an admin recording attendance on someone's behalf after the
 * fact. It is NOT the mobile app's own GPS-tagged offline-capture flow
 * — that flow already exists on mobile (Vol 7_4's pattern, reused
 * unmodified per this sprint's own transport header) and this web page
 * neither replaces nor verifies it. A real airplane-mode/on-device
 * verification of the mobile offline queue remains outside what this
 * session's tooling can perform. Building this web screen does not
 * "close" that gap — see this sprint's own Outcomes for the explicit
 * restatement.
 *
 * SOLO VS TEAM APPROVAL ROUTING: leave applications and derived
 * overtime records each open a real ApprovalTask. For a solo business
 * (`accessModel === "solo"`), the backend resolves that task in the
 * SAME transaction as creation (`resolved_via = 'solo_self_resolved'`,
 * Vol 13_3 §3) — so reloading the list after creating one already
 * shows its true final status; there is no separate "pending" state a
 * solo owner needs to go approve themselves. This page's banners say
 * so explicitly, distinct from the team-mode "routes through Approvals"
 * messaging every other capture-then-approve flow this phase uses.
 *
 * UI polish Phase 4: presentation only — shared header, tables, labelled
 * fields. Every disclosure note (manual entry, solo/team routing) is kept.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabaseAttendanceLeaveCommissionTransport } from "@aifa/core/sync/attendanceLeaveCommissionTransport";
import type { AttendanceRecord, ClockType, OvertimeRecord, LeaveType, LeaveApplication } from "@aifa/core/sync/attendanceLeaveCommissionTransport";
import type { Party } from "@aifa/core/sync/partyAndLedgerTransport";

import { supabase } from "../../lib/supabaseClient";
import { listParties } from "../../lib/partiesAndAccounts";
import {
  listAttendanceRecords,
  listOvertimeRecords,
  listLeaveTypes,
  listLeaveApplications,
} from "../../lib/attendanceLeaveCommission";
import { Button, Card, DataTable, Field, PageHeader, StatusPill, formatDate, type Column } from "../../ui";
import { useAccess } from "../AccessContext";
import { TabStrip } from "../TabStrip";

const attendanceLeaveCommissionTransport = createSupabaseAttendanceLeaveCommissionTransport(supabase);

const CLOCK_TYPES: ClockType[] = ["in", "out"];

type AttendanceLeaveTab = "attendance" | "leave";

interface Props {
  businessId: string;
  onGoToApprovals?: () => void;
}

function nowLocalInput(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function AttendanceLeavePage({ businessId, onGoToApprovals }: Props): JSX.Element {
  const { accessModel } = useAccess();
  const [tab, setTab] = useState<AttendanceLeaveTab>("attendance");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [employees, setEmployees] = useState<Party[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[] | null>(null);
  const [overtime, setOvertime] = useState<OvertimeRecord[] | null>(null);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [leaveApplications, setLeaveApplications] = useState<LeaveApplication[] | null>(null);

  const [clockEmployeeId, setClockEmployeeId] = useState("");
  const [clockType, setClockType] = useState<ClockType>("in");
  const [clockAt, setClockAt] = useState(nowLocalInput());
  const [clockBusy, setClockBusy] = useState(false);
  const [clockError, setClockError] = useState<string | null>(null);

  const [otEmployeeId, setOtEmployeeId] = useState("");
  const [otDate, setOtDate] = useState("");
  const [otScheduledHours, setOtScheduledHours] = useState("8");
  const [otBusy, setOtBusy] = useState(false);
  const [otError, setOtError] = useState<string | null>(null);

  const [newLeaveTypeName, setNewLeaveTypeName] = useState("");
  const [newLeaveTypeDays, setNewLeaveTypeDays] = useState("");
  const [leaveTypeBusy, setLeaveTypeBusy] = useState(false);
  const [leaveTypeError, setLeaveTypeError] = useState<string | null>(null);

  const [grantEmployeeId, setGrantEmployeeId] = useState("");
  const [grantLeaveTypeId, setGrantLeaveTypeId] = useState("");
  const [grantYear, setGrantYear] = useState(String(new Date().getFullYear()));
  const [grantDays, setGrantDays] = useState("");
  const [grantBusy, setGrantBusy] = useState(false);
  const [grantError, setGrantError] = useState<string | null>(null);

  const [applyEmployeeId, setApplyEmployeeId] = useState("");
  const [applyLeaveTypeId, setApplyLeaveTypeId] = useState("");
  const [applyStartDate, setApplyStartDate] = useState("");
  const [applyEndDate, setApplyEndDate] = useState("");
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [parties, att, ot, types, apps] = await Promise.all([
        listParties(businessId),
        listAttendanceRecords(businessId),
        listOvertimeRecords(businessId),
        listLeaveTypes(businessId),
        listLeaveApplications(businessId),
      ]);
      setEmployees(parties.filter((p) => p.partyTypes.includes("employee")));
      setAttendance(att);
      setOvertime(ot);
      setLeaveTypes(types);
      setLeaveApplications(apps);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load attendance/leave data.");
    }
  }, [businessId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  function employeeName(id: string): string {
    return employees.find((p) => p.id === id)?.displayName ?? `Employee #${id.slice(0, 8)}`;
  }

  function leaveTypeName(id: string): string {
    return leaveTypes.find((t) => t.id === id)?.name ?? `Leave type #${id.slice(0, 8)}`;
  }

  async function handleClock(): Promise<void> {
    if (!clockEmployeeId || !clockAt) return;
    setClockBusy(true);
    setClockError(null);
    try {
      await attendanceLeaveCommissionTransport.createAttendanceRecord({
        businessId,
        employeePartyId: clockEmployeeId,
        clockType,
        recordedAt: new Date(clockAt).toISOString(),
        source: "manual_admin_entry",
      });
      setClockAt(nowLocalInput());
      await load();
    } catch (err) {
      setClockError(err instanceof Error ? err.message : "Could not record this attendance event.");
    } finally {
      setClockBusy(false);
    }
  }

  async function handleDeriveOvertime(): Promise<void> {
    if (!otEmployeeId || !otDate) return;
    setOtBusy(true);
    setOtError(null);
    try {
      await attendanceLeaveCommissionTransport.deriveOvertimeForDate({
        businessId,
        employeePartyId: otEmployeeId,
        date: otDate,
        scheduledHours: otScheduledHours.trim() ? Number(otScheduledHours) : undefined,
      });
      setOtDate("");
      await load();
    } catch (err) {
      setOtError(err instanceof Error ? err.message : "Could not derive overtime for this date — there may be no qualifying paired in/out records, or no overtime worked.");
    } finally {
      setOtBusy(false);
    }
  }

  async function handleCreateLeaveType(): Promise<void> {
    if (!newLeaveTypeName.trim() || !newLeaveTypeDays.trim()) return;
    setLeaveTypeBusy(true);
    setLeaveTypeError(null);
    try {
      await attendanceLeaveCommissionTransport.createLeaveType({
        businessId,
        name: newLeaveTypeName.trim(),
        defaultEntitlementDays: Number(newLeaveTypeDays),
      });
      setNewLeaveTypeName("");
      setNewLeaveTypeDays("");
      await load();
    } catch (err) {
      setLeaveTypeError(err instanceof Error ? err.message : "Could not create this leave type — check you hold `configure` on `hr_attendance_leave`.");
    } finally {
      setLeaveTypeBusy(false);
    }
  }

  async function handleGrantBalance(): Promise<void> {
    if (!grantEmployeeId || !grantLeaveTypeId || !grantYear.trim()) return;
    setGrantBusy(true);
    setGrantError(null);
    try {
      await attendanceLeaveCommissionTransport.grantLeaveBalance({
        employeePartyId: grantEmployeeId,
        leaveTypeId: grantLeaveTypeId,
        year: Number(grantYear),
        entitledDays: grantDays.trim() ? Number(grantDays) : null,
      });
      setGrantDays("");
      await load();
    } catch (err) {
      setGrantError(err instanceof Error ? err.message : "Could not grant this leave balance — check you hold `configure` on `hr_attendance_leave`.");
    } finally {
      setGrantBusy(false);
    }
  }

  async function handleApplyLeave(): Promise<void> {
    if (!applyEmployeeId || !applyLeaveTypeId || !applyStartDate || !applyEndDate) return;
    setApplyBusy(true);
    setApplyError(null);
    try {
      await attendanceLeaveCommissionTransport.createLeaveApplication({
        businessId,
        employeePartyId: applyEmployeeId,
        leaveTypeId: applyLeaveTypeId,
        startDate: applyStartDate,
        endDate: applyEndDate,
      });
      setApplyStartDate("");
      setApplyEndDate("");
      await load();
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : "Could not submit this leave application — check the employee's remaining balance for this leave type/year.");
    } finally {
      setApplyBusy(false);
    }
  }

  const employeeSelect = (label: string, value: string, set: (v: string) => void): JSX.Element => (
    <Field label={label}>
      {(p) => (
        <select {...p} className="ui-select" value={value} onChange={(e) => set(e.target.value)}>
          <option value="">Select employee…</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.displayName}
            </option>
          ))}
        </select>
      )}
    </Field>
  );

  const leaveTypeSelect = (value: string, set: (v: string) => void): JSX.Element => (
    <Field label="Leave type">
      {(p) => (
        <select {...p} className="ui-select" value={value} onChange={(e) => set(e.target.value)}>
          <option value="">Select leave type…</option>
          {leaveTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
    </Field>
  );

  const approvalsLink =
    accessModel !== "solo" && onGoToApprovals ? (
      <button type="button" className="aifa-link-btn" onClick={onGoToApprovals}>
        Go to Approvals
      </button>
    ) : null;

  const attendanceColumns: Column<AttendanceRecord>[] = [
    { key: "emp", header: "Employee", render: (r) => employeeName(r.employeePartyId) },
    { key: "type", header: "Clock", render: (r) => `Clock ${r.clockType}` },
    { key: "at", header: "Recorded", render: (r) => r.recordedAt },
    {
      key: "gps",
      header: "GPS",
      render: (r) => (r.gpsLat !== null && r.gpsLng !== null ? `${r.gpsLat.toFixed(4)}, ${r.gpsLng.toFixed(4)}` : "no GPS captured"),
    },
    { key: "src", header: "Source", render: (r) => (r.source === "mobile_app" ? "mobile" : "manual entry") },
  ];

  const overtimeColumns: Column<OvertimeRecord>[] = [
    { key: "emp", header: "Employee", render: (o) => employeeName(o.employeePartyId) },
    { key: "date", header: "Date", render: (o) => formatDate(o.date) },
    { key: "hours", header: "Hours", numeric: true, render: (o) => `${o.hours} hour(s)` },
    { key: "status", header: "Status", render: (o) => <StatusPill status={o.status} /> },
  ];

  const leaveColumns: Column<LeaveApplication>[] = [
    { key: "emp", header: "Employee", render: (a) => employeeName(a.employeePartyId) },
    { key: "type", header: "Leave type", render: (a) => leaveTypeName(a.leaveTypeId) },
    { key: "period", header: "Period", render: (a) => `${a.startDate} to ${a.endDate}` },
    { key: "status", header: "Status", render: (a) => <StatusPill status={a.status} /> },
  ];

  const submitOn = (ok: boolean, busy: boolean, run: () => Promise<void>) => (e: React.FormEvent) => {
    e.preventDefault();
    if (ok && !busy) void run();
  };

  return (
    <div className="aifa-page">
      <PageHeader title="Attendance & Leave">
        <TabStrip
          tabs={[
            { id: "attendance", label: "Attendance & Overtime" },
            { id: "leave", label: "Leave" },
          ]}
          active={tab}
          onChange={setTab}
        />
      </PageHeader>

      {loadError && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {loadError}
        </p>
      )}

      {tab === "attendance" && (
        <>
          <Card
            title="Record a clock-in/out (manual entry)"
            description="This is a manual web entry, not a GPS-tagged mobile capture — the mobile app's own offline-capture flow is unaffected and separately unverified by this sprint (open since Sprint 35)."
          >
            <form onSubmit={submitOn(!!clockEmployeeId, clockBusy, handleClock)}>
              <div className="ui-form-grid">
                {employeeSelect("Employee", clockEmployeeId, setClockEmployeeId)}
                <Field label="Clock">
                  {(p) => (
                    <select {...p} className="ui-select" value={clockType} onChange={(e) => setClockType(e.target.value as ClockType)}>
                      {CLOCK_TYPES.map((t) => (
                        <option key={t} value={t}>
                          Clock {t}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="Date & time">
                  {(p) => <input {...p} className="ui-input" type="datetime-local" value={clockAt} onChange={(e) => setClockAt(e.target.value)} />}
                </Field>
              </div>
              <div className="ui-form-actions">
                <Button type="submit" variant="primary" loading={clockBusy} disabled={!clockEmployeeId}>
                  {clockBusy ? "Recording…" : "Record"}
                </Button>
              </div>
              {employees.length === 0 && <p className="ui-muted">No party is tagged "employee" yet — add one on the Parties page first.</p>}
              {clockError && (
                <p className="aifa-alert aifa-alert--danger" role="alert">
                  {clockError}
                </p>
              )}
            </form>
          </Card>

          <Card title="Recent attendance" flush>
            <DataTable
              caption="Recent attendance"
              columns={attendanceColumns}
              rows={loadError ? [] : attendance === null ? null : attendance.slice(0, 30)}
              rowKey={(r) => r.id}
              empty={<div className="ui-table-state">No attendance recorded yet.</div>}
            />
          </Card>

          <Card
            title="Derive overtime for a date"
            description="Pairs that day's in/out attendance records and drafts an OvertimeRecord if worked hours exceed the scheduled hours. Overtime pay feeds directly into the next Payroll Run's gross pay."
          >
            <form onSubmit={submitOn(!!otEmployeeId && !!otDate, otBusy, handleDeriveOvertime)}>
              <div className="ui-form-grid">
                {employeeSelect("Employee", otEmployeeId, setOtEmployeeId)}
                <Field label="Date">
                  {(p) => <input {...p} className="ui-input" type="date" value={otDate} onChange={(e) => setOtDate(e.target.value)} />}
                </Field>
                <Field label="Scheduled hours" hint="Default 8">
                  {(p) => <input {...p} className="ui-input" value={otScheduledHours} onChange={(e) => setOtScheduledHours(e.target.value)} />}
                </Field>
              </div>
              <div className="ui-form-actions">
                <Button type="submit" variant="primary" loading={otBusy} disabled={!otEmployeeId || !otDate}>
                  {otBusy ? "Deriving…" : "Derive"}
                </Button>
              </div>
              <p className="ui-muted">
                {accessModel === "solo"
                  ? "You're the sole approver — an OvertimeRecord you derive is approved automatically (solo_self_resolved), no separate review step."
                  : "A derived OvertimeRecord routes through the Approvals inbox before it feeds into payroll."}{" "}
                {approvalsLink}
              </p>
              {otError && (
                <p className="aifa-alert aifa-alert--danger" role="alert">
                  {otError}
                </p>
              )}
            </form>
          </Card>

          {overtime !== null && overtime.length > 0 && (
            <Card title="Overtime records" flush>
              <DataTable caption="Overtime records" columns={overtimeColumns} rows={overtime} rowKey={(o) => o.id} />
            </Card>
          )}
        </>
      )}

      {tab === "leave" && (
        <>
          <Card title="Leave types" description="Requires `configure` on `hr_attendance_leave` — only Owner/Payroll Admin hold that by default.">
            {leaveTypes.length > 0 && (
              <div className="ui-inline-actions" style={{ marginBottom: 12 }}>
                {leaveTypes.map((t) => (
                  <span key={t.id} className="ui-chip">
                    {t.name} ({t.defaultEntitlementDays}d)
                  </span>
                ))}
              </div>
            )}
            <form onSubmit={submitOn(!!newLeaveTypeName.trim() && !!newLeaveTypeDays.trim(), leaveTypeBusy, handleCreateLeaveType)}>
              <div className="ui-form-grid">
                <Field label="Leave type name">
                  {(p) => <input {...p} className="ui-input" value={newLeaveTypeName} onChange={(e) => setNewLeaveTypeName(e.target.value)} />}
                </Field>
                <Field label="Default entitlement (days)">
                  {(p) => <input {...p} className="ui-input" value={newLeaveTypeDays} onChange={(e) => setNewLeaveTypeDays(e.target.value)} />}
                </Field>
              </div>
              <div className="ui-form-actions">
                <Button type="submit" variant="primary" loading={leaveTypeBusy} disabled={!newLeaveTypeName.trim() || !newLeaveTypeDays.trim()}>
                  {leaveTypeBusy ? "Creating…" : "Add leave type"}
                </Button>
              </div>
              {leaveTypeError && (
                <p className="aifa-alert aifa-alert--danger" role="alert">
                  {leaveTypeError}
                </p>
              )}
            </form>
          </Card>

          <Card title="Grant a leave balance">
            <form onSubmit={submitOn(!!grantEmployeeId && !!grantLeaveTypeId && !!grantYear.trim(), grantBusy, handleGrantBalance)}>
              <div className="ui-form-grid">
                {employeeSelect("Employee", grantEmployeeId, setGrantEmployeeId)}
                {leaveTypeSelect(grantLeaveTypeId, setGrantLeaveTypeId)}
                <Field label="Year">
                  {(p) => <input {...p} className="ui-input" value={grantYear} onChange={(e) => setGrantYear(e.target.value)} />}
                </Field>
                <Field label="Entitled days" hint="Blank = type default">
                  {(p) => <input {...p} className="ui-input" value={grantDays} onChange={(e) => setGrantDays(e.target.value)} />}
                </Field>
              </div>
              <div className="ui-form-actions">
                <Button type="submit" variant="primary" loading={grantBusy} disabled={!grantEmployeeId || !grantLeaveTypeId || !grantYear.trim()}>
                  {grantBusy ? "Granting…" : "Grant"}
                </Button>
              </div>
              {grantError && (
                <p className="aifa-alert aifa-alert--danger" role="alert">
                  {grantError}
                </p>
              )}
            </form>
          </Card>

          <Card title="Apply for leave">
            <form onSubmit={submitOn(!!applyEmployeeId && !!applyLeaveTypeId && !!applyStartDate && !!applyEndDate, applyBusy, handleApplyLeave)}>
              <div className="ui-form-grid">
                {employeeSelect("Employee", applyEmployeeId, setApplyEmployeeId)}
                {leaveTypeSelect(applyLeaveTypeId, setApplyLeaveTypeId)}
                <Field label="From">
                  {(p) => <input {...p} className="ui-input" type="date" value={applyStartDate} onChange={(e) => setApplyStartDate(e.target.value)} />}
                </Field>
                <Field label="To">
                  {(p) => <input {...p} className="ui-input" type="date" value={applyEndDate} onChange={(e) => setApplyEndDate(e.target.value)} />}
                </Field>
              </div>
              <div className="ui-form-actions">
                <Button
                  type="submit"
                  variant="primary"
                  loading={applyBusy}
                  disabled={!applyEmployeeId || !applyLeaveTypeId || !applyStartDate || !applyEndDate}
                >
                  {applyBusy ? "Submitting…" : "Apply"}
                </Button>
              </div>
              <p className="ui-muted">
                {accessModel === "solo"
                  ? "You're the sole approver — a leave application you submit is approved automatically (solo_self_resolved), no separate review step."
                  : "A leave application routes through the Approvals inbox. Balance is only deducted once approved."}{" "}
                {approvalsLink}
              </p>
              {applyError && (
                <p className="aifa-alert aifa-alert--danger" role="alert">
                  {applyError}
                </p>
              )}
            </form>
          </Card>

          <Card title="Leave applications" flush>
            <DataTable
              caption="Leave applications"
              columns={leaveColumns}
              rows={loadError ? [] : leaveApplications}
              rowKey={(a) => a.id}
              empty={<div className="ui-table-state">No leave applications yet.</div>}
            />
          </Card>
        </>
      )}
    </div>
  );
}
