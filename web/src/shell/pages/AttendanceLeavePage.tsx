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

  if (loadError) {
    return (
      <div className="aifa-page">
        <h1>Attendance &amp; Leave</h1>
        <p className="error">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="aifa-page">
      <h1>Attendance &amp; Leave</h1>
      <TabStrip
        tabs={[
          { id: "attendance", label: "Attendance & Overtime" },
          { id: "leave", label: "Leave" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "attendance" && (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 14, marginTop: 0 }}>Record a clock-in/out (manual entry)</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              This is a manual web entry, not a GPS-tagged mobile capture — the mobile app's own offline-capture
              flow is unaffected and separately unverified by this sprint (open since Sprint 35).
            </p>
            <div className="row">
              <select value={clockEmployeeId} onChange={(e) => setClockEmployeeId(e.target.value)} style={{ padding: 6, minWidth: 200 }}>
                <option value="">Select employee…</option>
                {employees.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
              <select value={clockType} onChange={(e) => setClockType(e.target.value as ClockType)} style={{ padding: 6 }}>
                {CLOCK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    Clock {t}
                  </option>
                ))}
              </select>
              <input type="datetime-local" value={clockAt} onChange={(e) => setClockAt(e.target.value)} style={{ padding: 6 }} />
              <button onClick={() => void handleClock()} disabled={clockBusy || !clockEmployeeId}>
                {clockBusy ? "Recording…" : "Record"}
              </button>
            </div>
            {employees.length === 0 && <p className="muted" style={{ marginTop: 4 }}>No party is tagged "employee" yet — add one on the Parties page first.</p>}
            {clockError && <p className="error">{clockError}</p>}
          </div>

          <h2 style={{ fontSize: 14, marginTop: 16 }}>Recent attendance</h2>
          {attendance === null ? (
            <p className="muted">Loading…</p>
          ) : attendance.length === 0 ? (
            <p className="muted">No attendance recorded yet.</p>
          ) : (
            attendance.slice(0, 30).map((rec) => (
              <div key={rec.id} className="card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span>
                    {employeeName(rec.employeePartyId)} — clock {rec.clockType}
                  </span>
                  <span className="muted">{rec.source === "mobile_app" ? "mobile" : "manual entry"}</span>
                </div>
                <p className="muted" style={{ margin: "4px 0" }}>
                  {rec.recordedAt}
                  {rec.gpsLat !== null && rec.gpsLng !== null ? ` · GPS ${rec.gpsLat.toFixed(4)}, ${rec.gpsLng.toFixed(4)}` : " · no GPS captured"}
                </p>
              </div>
            ))
          )}

          <div className="card" style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: 14, marginTop: 0 }}>Derive overtime for a date</h2>
            <div className="row">
              <select value={otEmployeeId} onChange={(e) => setOtEmployeeId(e.target.value)} style={{ padding: 6, minWidth: 200 }}>
                <option value="">Select employee…</option>
                {employees.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
              <input type="date" value={otDate} onChange={(e) => setOtDate(e.target.value)} style={{ padding: 6 }} />
              <input placeholder="Scheduled hours (default 8)" value={otScheduledHours} onChange={(e) => setOtScheduledHours(e.target.value)} style={{ padding: 6, width: 200 }} />
              <button onClick={() => void handleDeriveOvertime()} disabled={otBusy || !otEmployeeId || !otDate}>
                {otBusy ? "Deriving…" : "Derive"}
              </button>
            </div>
            <p className="muted" style={{ marginTop: 4 }}>
              Pairs that day's in/out attendance records and drafts an OvertimeRecord if worked hours exceed the
              scheduled hours. Overtime pay feeds directly into the next Payroll Run's gross pay.
            </p>
            <p className="muted" style={{ marginTop: 4 }}>
              {accessModel === "solo"
                ? "You're the sole approver — an OvertimeRecord you derive is approved automatically (solo_self_resolved), no separate review step."
                : "A derived OvertimeRecord routes through the Approvals inbox before it feeds into payroll."}{" "}
              {accessModel !== "solo" && onGoToApprovals && (
                <button onClick={onGoToApprovals} style={{ padding: "0 4px" }}>
                  Go to Approvals
                </button>
              )}
            </p>
            {otError && <p className="error">{otError}</p>}
          </div>

          {overtime === null ? null : overtime.length === 0 ? null : (
            <>
              <h2 style={{ fontSize: 14, marginTop: 16 }}>Overtime records</h2>
              {overtime.map((ot) => (
                <div key={ot.id} className="card">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span>
                      {employeeName(ot.employeePartyId)} — {ot.date}
                    </span>
                    <span className="muted">{ot.status}</span>
                  </div>
                  <p className="muted" style={{ margin: "4px 0" }}>{ot.hours} hour(s)</p>
                </div>
              ))}
            </>
          )}
        </>
      )}

      {tab === "leave" && (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 14, marginTop: 0 }}>Leave types</h2>
            <div className="row" style={{ flexWrap: "wrap", marginBottom: 8 }}>
              {leaveTypes.map((t) => (
                <span key={t.id} className="muted" style={{ padding: "2px 8px", border: "1px solid var(--aifa-border, #e2e2e2)", borderRadius: 4 }}>
                  {t.name} ({t.defaultEntitlementDays}d)
                </span>
              ))}
            </div>
            <div className="row">
              <input placeholder="Leave type name" value={newLeaveTypeName} onChange={(e) => setNewLeaveTypeName(e.target.value)} style={{ padding: 6, flex: 1 }} />
              <input placeholder="Default entitlement (days)" value={newLeaveTypeDays} onChange={(e) => setNewLeaveTypeDays(e.target.value)} style={{ padding: 6, width: 200 }} />
              <button onClick={() => void handleCreateLeaveType()} disabled={leaveTypeBusy || !newLeaveTypeName.trim() || !newLeaveTypeDays.trim()}>
                {leaveTypeBusy ? "Creating…" : "Add leave type"}
              </button>
            </div>
            <p className="muted" style={{ marginTop: 4 }}>Requires `configure` on `hr_attendance_leave` — only Owner/Payroll Admin hold that by default.</p>
            {leaveTypeError && <p className="error">{leaveTypeError}</p>}
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 14, marginTop: 0 }}>Grant a leave balance</h2>
            <div className="row">
              <select value={grantEmployeeId} onChange={(e) => setGrantEmployeeId(e.target.value)} style={{ padding: 6, minWidth: 180 }}>
                <option value="">Select employee…</option>
                {employees.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
              <select value={grantLeaveTypeId} onChange={(e) => setGrantLeaveTypeId(e.target.value)} style={{ padding: 6, minWidth: 160 }}>
                <option value="">Select leave type…</option>
                {leaveTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <input placeholder="Year" value={grantYear} onChange={(e) => setGrantYear(e.target.value)} style={{ padding: 6, width: 100 }} />
              <input placeholder="Entitled days (blank = type default)" value={grantDays} onChange={(e) => setGrantDays(e.target.value)} style={{ padding: 6, width: 220 }} />
              <button onClick={() => void handleGrantBalance()} disabled={grantBusy || !grantEmployeeId || !grantLeaveTypeId || !grantYear.trim()}>
                {grantBusy ? "Granting…" : "Grant"}
              </button>
            </div>
            {grantError && <p className="error">{grantError}</p>}
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 14, marginTop: 0 }}>Apply for leave</h2>
            <div className="row">
              <select value={applyEmployeeId} onChange={(e) => setApplyEmployeeId(e.target.value)} style={{ padding: 6, minWidth: 180 }}>
                <option value="">Select employee…</option>
                {employees.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
              <select value={applyLeaveTypeId} onChange={(e) => setApplyLeaveTypeId(e.target.value)} style={{ padding: 6, minWidth: 160 }}>
                <option value="">Select leave type…</option>
                {leaveTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <input type="date" value={applyStartDate} onChange={(e) => setApplyStartDate(e.target.value)} style={{ padding: 6 }} />
              <span className="muted">to</span>
              <input type="date" value={applyEndDate} onChange={(e) => setApplyEndDate(e.target.value)} style={{ padding: 6 }} />
              <button onClick={() => void handleApplyLeave()} disabled={applyBusy || !applyEmployeeId || !applyLeaveTypeId || !applyStartDate || !applyEndDate}>
                {applyBusy ? "Submitting…" : "Apply"}
              </button>
            </div>
            <p className="muted" style={{ marginTop: 4 }}>
              {accessModel === "solo"
                ? "You're the sole approver — a leave application you submit is approved automatically (solo_self_resolved), no separate review step."
                : "A leave application routes through the Approvals inbox. Balance is only deducted once approved."}{" "}
              {accessModel !== "solo" && onGoToApprovals && (
                <button onClick={onGoToApprovals} style={{ padding: "0 4px" }}>
                  Go to Approvals
                </button>
              )}
            </p>
            {applyError && <p className="error">{applyError}</p>}
          </div>

          <h2 style={{ fontSize: 14, marginTop: 16 }}>Leave applications</h2>
          {leaveApplications === null ? (
            <p className="muted">Loading…</p>
          ) : leaveApplications.length === 0 ? (
            <p className="muted">No leave applications yet.</p>
          ) : (
            leaveApplications.map((app) => (
              <div key={app.id} className="card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span>
                    {employeeName(app.employeePartyId)} — {leaveTypeName(app.leaveTypeId)}
                  </span>
                  <span
                    className="muted"
                    style={app.status === "approved" ? { color: "#1b7a3d", fontWeight: 600 } : app.status === "rejected" ? { color: "#c0392b" } : undefined}
                  >
                    {app.status}
                  </span>
                </div>
                <p className="muted" style={{ margin: "4px 0" }}>{app.startDate} to {app.endDate}</p>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}
