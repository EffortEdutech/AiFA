/**
 * Payroll & Statutory Contributions — Sprint 45 (Vol 13_0 §10 Module
 * G). This sprint's own theme: `payroll` is the most access-sensitive
 * domain in the sidebar, so this page's central discipline is making
 * the UI's own gating airtight, not just relying on the backend RPCs'
 * capability checks.
 *
 * ENCRYPTION KEY (owner decision, this sprint's kickoff): no established
 * convention exists anywhere in this codebase for how the payroll
 * `encryptionKey` deployment secret reaches a client — it is explicitly
 * "never generated, stored, or hardcoded" by the transport. The owner
 * chose: prompt for it interactively, per session, from whoever is
 * about to use it. It lives ONLY in this component's own React state
 * (`encryptionKey` below) — never written to localStorage,
 * sessionStorage, an env var, or any debug output — and is cleared
 * whenever the decrypt/export panel that needed it is closed.
 *
 * UI-LEVEL CAPABILITY GATE (stricter than the backend): the backend
 * only requires `view` on `payroll` for `getEmployeeProfileDecrypted`
 * (and `capture` for `generateBulkPaymentFileExport`) — but this page
 * deliberately hides both the decrypt-read UI and the bulk-export UI
 * unless the signed-in membership's role holds `configure` on
 * `payroll`, computed client-side via
 * `membership.ts`'s `getGrantedCapabilitiesForDomain`. This is a real,
 * disclosed UI-only restriction, tighter than what the RPCs themselves
 * would allow: the seed "Bookkeeper / Accountant" role has `payroll:
 * view` but NOT `configure` — under this page's gate, that role sees
 * the plain Employee Profile list (non-sensitive columns only) but
 * never the "View sensitive details" or "Generate bulk payment file"
 * controls at all; only "Payroll Admin" (and Owner) do. This is the
 * sprint's own restricted-role test case, verified by inspecting the
 * seed role_permissions directly (see this sprint's own Outcomes).
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabasePayrollTransport } from "@aifa/core/sync/payrollTransport";
import type {
  EmployeeProfile,
  EmploymentType,
  PayrollRun,
  Payslip,
  StatutoryDeductions,
  BulkPaymentFileExport,
} from "@aifa/core/sync/payrollTransport";
import type { Party } from "@aifa/core/sync/partyAndLedgerTransport";

import { supabase } from "../../lib/supabaseClient";
import { listParties } from "../../lib/partiesAndAccounts";
import {
  listEmployeeProfiles,
  listPayrollRuns,
  listPayslips,
  listBulkPaymentFileExports,
} from "../../lib/payroll";
import { getGrantedCapabilitiesForDomain } from "../../lib/membership";
import { useAccess } from "../AccessContext";
import { TabStrip } from "../TabStrip";

const payrollTransport = createSupabasePayrollTransport(supabase);

const EMPLOYMENT_TYPES: EmploymentType[] = ["full_time", "part_time", "contract"];

type PayrollTab = "employees" | "payroll-runs";

interface Props {
  businessId: string;
  onGoToApprovals?: () => void;
}

function PcbCaveat(): JSX.Element {
  return (
    <span className="muted" style={{ fontSize: 12 }}>
      (PCB is a simplified approximation of LHDN's real PCB Schedule/Formula Method — not a filing-ready figure)
    </span>
  );
}

export function PayrollPage({ businessId, onGoToApprovals }: Props): JSX.Element {
  const { myMembership, accessModel } = useAccess();

  const [canConfigurePayroll, setCanConfigurePayroll] = useState(false);
  const [capabilityChecked, setCapabilityChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (accessModel === "solo" || myMembership === null) {
      setCanConfigurePayroll(true);
      setCapabilityChecked(true);
      return;
    }
    getGrantedCapabilitiesForDomain(myMembership.roleId, "payroll")
      .then((caps) => {
        if (!cancelled) {
          setCanConfigurePayroll(caps.has("configure"));
          setCapabilityChecked(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          // Fail closed — an error resolving capability never grants sensitive-field access.
          setCanConfigurePayroll(false);
          setCapabilityChecked(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accessModel, myMembership]);

  const [tab, setTab] = useState<PayrollTab>("employees");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [employees, setEmployees] = useState<EmployeeProfile[] | null>(null);
  const [employeeParties, setEmployeeParties] = useState<Party[]>([]);

  const [showCreate, setShowCreate] = useState(false);
  const [createPartyId, setCreatePartyId] = useState("");
  const [createIcNumber, setCreateIcNumber] = useState("");
  const [createEpfNumber, setCreateEpfNumber] = useState("");
  const [createSocsoNumber, setCreateSocsoNumber] = useState("");
  const [createIncomeTaxNo, setCreateIncomeTaxNo] = useState("");
  const [createBankName, setCreateBankName] = useState("");
  const [createBankAccountNo, setCreateBankAccountNo] = useState("");
  const [createBasicSalary, setCreateBasicSalary] = useState("");
  const [createEmploymentType, setCreateEmploymentType] = useState<EmploymentType>("full_time");
  const [createHireDate, setCreateHireDate] = useState("");
  const [createKey, setCreateKey] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [revealFor, setRevealFor] = useState<string | null>(null);
  const [revealKey, setRevealKey] = useState("");
  const [revealBusy, setRevealBusy] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, unknown> | null>(null);

  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[] | null>(null);
  const [newPeriod, setNewPeriod] = useState("");
  const [runCreateBusy, setRunCreateBusy] = useState(false);
  const [runCreateError, setRunCreateError] = useState<string | null>(null);
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [runActionError, setRunActionError] = useState<string | null>(null);

  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [payslipsByRun, setPayslipsByRun] = useState<Record<string, Payslip[]>>({});
  const [exportsByRun, setExportsByRun] = useState<Record<string, BulkPaymentFileExport[]>>({});

  const [exportKeyFor, setExportKeyFor] = useState<string | null>(null);
  const [exportKey, setExportKey] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [calcGrossPay, setCalcGrossPay] = useState("");
  const [calcResult, setCalcResult] = useState<StatutoryDeductions | null>(null);
  const [calcBusy, setCalcBusy] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [profiles, parties, runs] = await Promise.all([
        listEmployeeProfiles(businessId),
        listParties(businessId),
        listPayrollRuns(businessId),
      ]);
      setEmployees(profiles);
      setEmployeeParties(parties.filter((p) => p.partyTypes.includes("employee")));
      setPayrollRuns(runs);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load payroll data.");
    }
  }, [businessId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  function partyName(id: string): string {
    return employeeParties.find((p) => p.id === id)?.displayName ?? `Party #${id.slice(0, 8)}`;
  }

  const employeesWithoutProfile = employeeParties.filter((p) => !(employees ?? []).some((e) => e.partyId === p.id));

  async function handleCreateProfile(): Promise<void> {
    if (!createPartyId || !createIcNumber.trim() || !createBankAccountNo.trim() || !createBasicSalary.trim() || !createHireDate || !createKey.trim()) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      await payrollTransport.createEmployeeProfile({
        businessId,
        partyId: createPartyId,
        icNumber: createIcNumber.trim(),
        epfNumber: createEpfNumber.trim() || null,
        socsoNumber: createSocsoNumber.trim() || null,
        incomeTaxNo: createIncomeTaxNo.trim() || null,
        bankName: createBankName.trim() || null,
        bankAccountNo: createBankAccountNo.trim(),
        basicSalary: Number(createBasicSalary),
        employmentType: createEmploymentType,
        hireDate: createHireDate,
        encryptionKey: createKey,
      });
      setCreatePartyId("");
      setCreateIcNumber("");
      setCreateEpfNumber("");
      setCreateSocsoNumber("");
      setCreateIncomeTaxNo("");
      setCreateBankName("");
      setCreateBankAccountNo("");
      setCreateBasicSalary("");
      setCreateHireDate("");
      setCreateKey("");
      setShowCreate(false);
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create this employee profile — check the encryption key.");
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleReveal(employeeProfileId: string): Promise<void> {
    if (!revealKey.trim()) return;
    setRevealBusy(true);
    setRevealError(null);
    try {
      const decrypted = await payrollTransport.getEmployeeProfileDecrypted(employeeProfileId, revealKey);
      setRevealed(decrypted as unknown as Record<string, unknown>);
    } catch (err) {
      setRevealError(err instanceof Error ? err.message : "Could not decrypt — check the encryption key.");
    } finally {
      setRevealBusy(false);
    }
  }

  function closeReveal(): void {
    setRevealFor(null);
    setRevealKey("");
    setRevealed(null);
    setRevealError(null);
  }

  async function handleCreateRun(): Promise<void> {
    if (!newPeriod.trim()) return;
    setRunCreateBusy(true);
    setRunCreateError(null);
    try {
      await payrollTransport.createPayrollRun({ businessId, period: newPeriod.trim() });
      setNewPeriod("");
      await load();
    } catch (err) {
      setRunCreateError(err instanceof Error ? err.message : "Could not create this payroll run.");
    } finally {
      setRunCreateBusy(false);
    }
  }

  async function handleSubmitRun(run: PayrollRun): Promise<void> {
    setBusyRunId(run.id);
    setRunActionError(null);
    try {
      await payrollTransport.submitPayrollRun(run.id);
      await load();
    } catch (err) {
      setRunActionError(err instanceof Error ? err.message : "Could not submit this payroll run.");
    } finally {
      setBusyRunId(null);
    }
  }

  async function handleMarkPaid(run: PayrollRun): Promise<void> {
    setBusyRunId(run.id);
    setRunActionError(null);
    try {
      await payrollTransport.markPayrollRunPaid(run.id);
      await load();
    } catch (err) {
      setRunActionError(err instanceof Error ? err.message : "Could not mark this payroll run paid — a bulk payment file may not have been generated yet.");
    } finally {
      setBusyRunId(null);
    }
  }

  async function toggleExpand(run: PayrollRun): Promise<void> {
    if (expandedRunId === run.id) {
      setExpandedRunId(null);
      return;
    }
    setExpandedRunId(run.id);
    try {
      const [slips, exports] = await Promise.all([
        payslipsByRun[run.id] ? Promise.resolve(payslipsByRun[run.id]) : listPayslips(run.id),
        exportsByRun[run.id] ? Promise.resolve(exportsByRun[run.id]) : listBulkPaymentFileExports(run.id),
      ]);
      setPayslipsByRun((prev) => ({ ...prev, [run.id]: slips }));
      setExportsByRun((prev) => ({ ...prev, [run.id]: exports }));
    } catch {
      // detail-on-expand is a nice-to-have; leave silently empty on failure
    }
  }

  async function handleGenerateExport(run: PayrollRun): Promise<void> {
    if (!exportKey.trim()) return;
    setExportBusy(true);
    setExportError(null);
    try {
      await payrollTransport.generateBulkPaymentFileExport({ payrollRunId: run.id, encryptionKey: exportKey });
      setExportKeyFor(null);
      setExportKey("");
      const [freshExports, slips] = await Promise.all([
        listBulkPaymentFileExports(run.id),
        payslipsByRun[run.id] ? Promise.resolve(payslipsByRun[run.id]) : listPayslips(run.id),
      ]);
      setExportsByRun((prev) => ({ ...prev, [run.id]: freshExports }));
      setPayslipsByRun((prev) => ({ ...prev, [run.id]: slips }));
      setExpandedRunId(run.id);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Could not generate the bulk payment file — check the encryption key.");
    } finally {
      setExportBusy(false);
    }
  }

  async function handleComputeCalc(): Promise<void> {
    if (!calcGrossPay.trim()) return;
    setCalcBusy(true);
    setCalcError(null);
    try {
      const result = await payrollTransport.computeStatutoryDeductions(Number(calcGrossPay));
      setCalcResult(result);
    } catch (err) {
      setCalcError(err instanceof Error ? err.message : "Could not compute statutory deductions.");
    } finally {
      setCalcBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="aifa-page">
        <h1>Payroll</h1>
        <p className="error">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="aifa-page">
      <h1>Payroll</h1>
      <TabStrip
        tabs={[
          { id: "employees", label: "Employees", count: employees?.length },
          { id: "payroll-runs", label: "Payroll Runs", count: payrollRuns?.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "employees" && (
        <>
          <div className="row" style={{ margin: "12px 0" }}>
            <button onClick={() => setShowCreate((s) => !s)} disabled={!capabilityChecked || !canConfigurePayroll}>
              {showCreate ? "Cancel" : "Add employee profile"}
            </button>
            {capabilityChecked && !canConfigurePayroll && (
              <span className="muted">You need `payroll` configure access to add or view sensitive employee data.</span>
            )}
          </div>

          {showCreate && canConfigurePayroll && (
            <div className="card" style={{ marginBottom: 12, borderColor: "#7a1f1f" }}>
              <h2 style={{ fontSize: 16, marginTop: 0 }}>New employee profile</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                IC/EPF/SOCSO/income-tax/bank-account numbers are encrypted server-side with the key below — it is
                never stored by this app and is cleared from this form the moment you leave it.
              </p>
              <div className="row">
                <select value={createPartyId} onChange={(e) => setCreatePartyId(e.target.value)} style={{ padding: 6, minWidth: 220 }}>
                  <option value="">Select employee-typed party…</option>
                  {employeesWithoutProfile.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
                <select value={createEmploymentType} onChange={(e) => setCreateEmploymentType(e.target.value as EmploymentType)} style={{ padding: 6 }}>
                  {EMPLOYMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <input type="date" value={createHireDate} onChange={(e) => setCreateHireDate(e.target.value)} style={{ padding: 6 }} />
              </div>
              {employeeParties.length === 0 && (
                <p className="muted" style={{ marginTop: 4 }}>
                  No party is tagged "employee" yet — add one on the Parties page first.
                </p>
              )}
              <div className="row" style={{ marginTop: 8 }}>
                <input placeholder="IC number" value={createIcNumber} onChange={(e) => setCreateIcNumber(e.target.value)} style={{ padding: 6, width: 160 }} />
                <input placeholder="EPF number (optional)" value={createEpfNumber} onChange={(e) => setCreateEpfNumber(e.target.value)} style={{ padding: 6, width: 160 }} />
                <input placeholder="SOCSO number (optional)" value={createSocsoNumber} onChange={(e) => setCreateSocsoNumber(e.target.value)} style={{ padding: 6, width: 160 }} />
                <input placeholder="Income tax no (optional)" value={createIncomeTaxNo} onChange={(e) => setCreateIncomeTaxNo(e.target.value)} style={{ padding: 6, width: 160 }} />
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <input placeholder="Bank name (optional)" value={createBankName} onChange={(e) => setCreateBankName(e.target.value)} style={{ padding: 6, width: 180 }} />
                <input placeholder="Bank account no" value={createBankAccountNo} onChange={(e) => setCreateBankAccountNo(e.target.value)} style={{ padding: 6, width: 180 }} />
                <input placeholder="Basic salary (RM)" value={createBasicSalary} onChange={(e) => setCreateBasicSalary(e.target.value)} style={{ padding: 6, width: 160 }} />
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <input
                  type="password"
                  placeholder="Payroll encryption key"
                  value={createKey}
                  onChange={(e) => setCreateKey(e.target.value)}
                  style={{ padding: 6, flex: 1 }}
                  autoComplete="off"
                />
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button
                  onClick={() => void handleCreateProfile()}
                  disabled={createBusy || !createPartyId || !createIcNumber.trim() || !createBankAccountNo.trim() || !createBasicSalary.trim() || !createHireDate || !createKey.trim()}
                >
                  {createBusy ? "Creating…" : "Create profile"}
                </button>
              </div>
              {createError && <p className="error">{createError}</p>}
            </div>
          )}

          {employees === null ? (
            <p className="muted">Loading…</p>
          ) : employees.length === 0 ? (
            <p className="muted">No employee profiles yet.</p>
          ) : (
            employees.map((e) => (
              <div key={e.id} className="card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{partyName(e.partyId)}</strong>
                  <span className="muted">{e.employmentType}</span>
                </div>
                <p className="muted" style={{ margin: "4px 0" }}>
                  RM{e.basicSalary.toFixed(2)}/month · hired {e.hireDate}
                  {e.resignDate && ` · resigned ${e.resignDate}`}
                  {e.bankName && ` · ${e.bankName}`}
                </p>
                {canConfigurePayroll && (
                  <div className="row" style={{ marginTop: 6 }}>
                    <button
                      onClick={() => {
                        if (revealFor === e.id) closeReveal();
                        else {
                          setRevealFor(e.id);
                          setRevealed(null);
                          setRevealError(null);
                        }
                      }}
                    >
                      {revealFor === e.id ? "Hide sensitive details" : "View sensitive details"}
                    </button>
                  </div>
                )}
                {revealFor === e.id && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--aifa-border, #e2e2e2)" }}>
                    {revealed === null ? (
                      <>
                        <div className="row">
                          <input
                            type="password"
                            placeholder="Payroll encryption key"
                            value={revealKey}
                            onChange={(ev) => setRevealKey(ev.target.value)}
                            style={{ padding: 6, flex: 1 }}
                            autoComplete="off"
                          />
                          <button onClick={() => void handleReveal(e.id)} disabled={revealBusy || !revealKey.trim()}>
                            {revealBusy ? "Decrypting…" : "Decrypt"}
                          </button>
                        </div>
                        {revealError && <p className="error">{revealError}</p>}
                      </>
                    ) : (
                      <>
                        <p className="muted" style={{ margin: "2px 0" }}>IC: {String(revealed.icNumber)}</p>
                        <p className="muted" style={{ margin: "2px 0" }}>EPF: {String(revealed.epfNumber ?? "—")}</p>
                        <p className="muted" style={{ margin: "2px 0" }}>SOCSO: {String(revealed.socsoNumber ?? "—")}</p>
                        <p className="muted" style={{ margin: "2px 0" }}>Income tax no: {String(revealed.incomeTaxNo ?? "—")}</p>
                        <p className="muted" style={{ margin: "2px 0" }}>Bank account no: {String(revealed.bankAccountNo)}</p>
                        <button onClick={closeReveal} style={{ marginTop: 6 }}>
                          Done — clear from screen
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </>
      )}

      {tab === "payroll-runs" && (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 14, marginTop: 0 }}>Statutory deduction calculator</h2>
            <div className="row">
              <input placeholder="Gross pay (RM)" value={calcGrossPay} onChange={(e) => setCalcGrossPay(e.target.value)} style={{ padding: 6, width: 160 }} />
              <button onClick={() => void handleComputeCalc()} disabled={calcBusy || !calcGrossPay.trim()}>
                {calcBusy ? "Computing…" : "Compute"}
              </button>
            </div>
            {calcError && <p className="error">{calcError}</p>}
            {calcResult && (
              <div style={{ marginTop: 8 }}>
                <p className="muted" style={{ margin: "2px 0" }}>EPF — employee RM{calcResult.epfEmployee.toFixed(2)} / employer RM{calcResult.epfEmployer.toFixed(2)}</p>
                <p className="muted" style={{ margin: "2px 0" }}>SOCSO — employee RM{calcResult.socsoEmployee.toFixed(2)} / employer RM{calcResult.socsoEmployer.toFixed(2)}</p>
                <p className="muted" style={{ margin: "2px 0" }}>EIS — employee RM{calcResult.eisEmployee.toFixed(2)} / employer RM{calcResult.eisEmployer.toFixed(2)}</p>
                <p className="muted" style={{ margin: "2px 0" }}>
                  PCB: RM{calcResult.pcbDeduction.toFixed(2)} <PcbCaveat />
                </p>
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 14, marginTop: 0 }}>New payroll run</h2>
            <div className="row">
              <input placeholder="Period (e.g. 2026-08)" value={newPeriod} onChange={(e) => setNewPeriod(e.target.value)} style={{ padding: 6, width: 160 }} />
              <button onClick={() => void handleCreateRun()} disabled={runCreateBusy || !newPeriod.trim()}>
                {runCreateBusy ? "Creating…" : "Create run"}
              </button>
            </div>
            <p className="muted" style={{ marginTop: 4 }}>
              Drafts a Payroll Run and one Payslip per active employee, sweeping in any approved claims/salary
              advances for the period.
            </p>
            {runCreateError && <p className="error">{runCreateError}</p>}
          </div>

          <p className="muted" style={{ margin: "8px 0" }}>
            A submitted payroll run always routes through the Approvals inbox — this never auto-approves.{" "}
            {onGoToApprovals ? (
              <button onClick={onGoToApprovals} style={{ padding: "0 4px" }}>
                Go to Approvals
              </button>
            ) : (
              "See the Approvals sidebar item."
            )}
          </p>

          {runActionError && <p className="error">{runActionError}</p>}

          {payrollRuns === null ? (
            <p className="muted">Loading…</p>
          ) : payrollRuns.length === 0 ? (
            <p className="muted">No payroll runs yet.</p>
          ) : (
            payrollRuns.map((run) => {
              const busy = busyRunId === run.id;
              const expanded = expandedRunId === run.id;
              const exports = exportsByRun[run.id] ?? [];
              const hasExport = exports.length > 0;
              return (
                <div key={run.id} className="card">
                  <div className="row" style={{ justifyContent: "space-between", cursor: "pointer" }} onClick={() => void toggleExpand(run)}>
                    <strong>{run.period}</strong>
                    <span className="muted">{run.status}</span>
                  </div>
                  <p className="muted" style={{ margin: "4px 0" }}>Total net pay: RM{run.totalNetPay.toFixed(2)}</p>

                  {expanded && (
                    <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--aifa-border, #e2e2e2)" }}>
                      {(payslipsByRun[run.id] ?? []).length === 0 ? (
                        <p className="muted">No payslips loaded.</p>
                      ) : (
                        payslipsByRun[run.id].map((slip) => (
                          <p key={slip.id} className="muted" style={{ margin: "2px 0" }}>
                            {partyName(slip.employeePartyId)}: gross RM{slip.grossPay.toFixed(2)}, PCB RM{slip.pcbDeduction.toFixed(2)}, net RM{slip.netPay.toFixed(2)}
                            {slip.ePayslipSentAt ? ` · sent via ${slip.ePayslipChannel}` : ""}
                          </p>
                        ))
                      )}
                      <p className="muted" style={{ marginTop: 4 }}>
                        <PcbCaveat />
                      </p>
                    </div>
                  )}

                  <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
                    {run.status === "draft" && (
                      <button onClick={() => void handleSubmitRun(run)} disabled={busy}>
                        {busy ? "Submitting…" : "Submit for approval"}
                      </button>
                    )}
                    {run.status === "approved" && canConfigurePayroll && !hasExport && (
                      <button onClick={() => setExportKeyFor(exportKeyFor === run.id ? null : run.id)}>
                        {exportKeyFor === run.id ? "Cancel" : "Generate bulk payment file"}
                      </button>
                    )}
                    {run.status === "approved" && !canConfigurePayroll && (
                      <span className="muted">You need `payroll` configure access to generate the bulk payment file.</span>
                    )}
                    {run.status === "approved" && hasExport && (
                      <button onClick={() => void handleMarkPaid(run)} disabled={busy}>
                        {busy ? "Marking paid…" : "Mark Paid (posts ledger entries now)"}
                      </button>
                    )}
                  </div>

                  {exportKeyFor === run.id && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--aifa-border, #e2e2e2)" }}>
                      <p className="error" style={{ margin: "4px 0" }}>
                        ⚠ Unverified against Maybank2u — confirm with your bank before uploading this file. This CSV
                        follows a documented-generic Malaysian bulk-pay layout, not Maybank2u's real portal template.
                      </p>
                      <div className="row">
                        <input
                          type="password"
                          placeholder="Payroll encryption key"
                          value={exportKey}
                          onChange={(e) => setExportKey(e.target.value)}
                          style={{ padding: 6, flex: 1 }}
                          autoComplete="off"
                        />
                        <button onClick={() => void handleGenerateExport(run)} disabled={exportBusy || !exportKey.trim()}>
                          {exportBusy ? "Generating…" : "Generate"}
                        </button>
                      </div>
                      {exportError && <p className="error">{exportError}</p>}
                    </div>
                  )}

                  {hasExport && (
                    <div style={{ marginTop: 8 }}>
                      <p className="error" style={{ margin: "4px 0" }}>
                        ⚠ Unverified against Maybank2u — confirm with your bank before uploading this file.
                      </p>
                      <textarea readOnly value={exports[0].fileContent} style={{ width: "100%", height: 100, fontFamily: "monospace", fontSize: 12 }} />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </>
      )}
    </div>
  );
}
