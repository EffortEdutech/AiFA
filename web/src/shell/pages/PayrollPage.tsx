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
 *
 * UI polish Phase 4: presentation only — shared header, tables, labelled
 * fields. The encryption-key handling, UI-level capability gate, PCB caveat and
 * Maybank2u "unverified" warnings are unchanged.
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
import { Button, Card, DataTable, Field, PageHeader, StatusPill, formatMoney, type Column } from "../../ui";
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
    <span className="ui-muted" style={{ fontSize: 12 }}>
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

  const stop = (node: JSX.Element): JSX.Element => <div onClick={(e) => e.stopPropagation()}>{node}</div>;

  const employeeColumns: Column<EmployeeProfile>[] = [
    { key: "name", header: "Employee", render: (e) => <strong>{partyName(e.partyId)}</strong> },
    { key: "type", header: "Type", render: (e) => e.employmentType },
    { key: "salary", header: "Basic salary / month", numeric: true, render: (e) => formatMoney(e.basicSalary) },
    {
      key: "hired",
      header: "Employment",
      render: (e) => (
        <>
          hired {e.hireDate}
          {e.resignDate && <div className="ui-cell-sub">resigned {e.resignDate}</div>}
          {e.bankName && <div className="ui-cell-sub">{e.bankName}</div>}
        </>
      ),
    },
    ...(canConfigurePayroll
      ? [
          {
            key: "actions",
            header: "",
            render: (e: EmployeeProfile) => (
              <Button
                size="sm"
                variant="secondary"
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
              </Button>
            ),
          } as Column<EmployeeProfile>,
        ]
      : []),
  ];

  const revealEmployee = employees?.find((e) => e.id === revealFor) ?? null;

  const runColumns: Column<PayrollRun>[] = [
    { key: "period", header: "Period", render: (r) => <strong>{r.period}</strong> },
    { key: "status", header: "Status", render: (r) => <StatusPill status={r.status} /> },
    { key: "net", header: "Total net pay", numeric: true, render: (r) => formatMoney(r.totalNetPay) },
    {
      key: "actions",
      header: "",
      render: (run) => {
        const busy = busyRunId === run.id;
        const hasExport = (exportsByRun[run.id] ?? []).length > 0;
        return stop(
          <div className="ui-inline-actions">
            {run.status === "draft" && (
              <Button size="sm" variant="primary" loading={busy} onClick={() => void handleSubmitRun(run)}>
                {busy ? "Submitting…" : "Submit for approval"}
              </Button>
            )}
            {run.status === "approved" && canConfigurePayroll && !hasExport && (
              <Button size="sm" variant="secondary" onClick={() => setExportKeyFor(exportKeyFor === run.id ? null : run.id)}>
                {exportKeyFor === run.id ? "Cancel" : "Generate bulk payment file"}
              </Button>
            )}
            {run.status === "approved" && !canConfigurePayroll && (
              <span className="ui-muted">You need `payroll` configure access to generate the bulk payment file.</span>
            )}
            {run.status === "approved" && hasExport && (
              <Button size="sm" variant="primary" loading={busy} onClick={() => void handleMarkPaid(run)}>
                {busy ? "Marking paid…" : "Mark Paid (posts ledger entries now)"}
              </Button>
            )}
          </div>,
        );
      },
    },
  ];

  const slipColumns: Column<Payslip>[] = [
    {
      key: "emp",
      header: "Employee",
      render: (sl) => (
        <>
          {partyName(sl.employeePartyId)}
          {sl.ePayslipSentAt && <div className="ui-cell-sub">sent via {sl.ePayslipChannel}</div>}
        </>
      ),
    },
    { key: "gross", header: "Gross", numeric: true, render: (sl) => formatMoney(sl.grossPay) },
    { key: "pcb", header: "PCB", numeric: true, render: (sl) => formatMoney(sl.pcbDeduction) },
    { key: "net", header: "Net", numeric: true, render: (sl) => formatMoney(sl.netPay) },
  ];

  const expandedRun = payrollRuns?.find((r) => r.id === expandedRunId) ?? null;
  const exportRun = payrollRuns?.find((r) => r.id === exportKeyFor) ?? null;
  const exportFileRun = expandedRun && (exportsByRun[expandedRun.id] ?? []).length > 0 ? expandedRun : null;

  return (
    <div className="aifa-page">
      <PageHeader
        title="Payroll"
        actions={
          tab === "employees" ? (
            <Button
              variant="primary"
              icon={showCreate ? undefined : "plus"}
              disabled={!capabilityChecked || !canConfigurePayroll}
              onClick={() => setShowCreate((v) => !v)}
            >
              {showCreate ? "Cancel" : "Add employee profile"}
            </Button>
          ) : undefined
        }
      >
        <TabStrip
          tabs={[
            { id: "employees", label: "Employees", count: employees?.length },
            { id: "payroll-runs", label: "Payroll Runs", count: payrollRuns?.length },
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

      {tab === "employees" && (
        <>
          {capabilityChecked && !canConfigurePayroll && (
            <p className="ui-muted">You need `payroll` configure access to add or view sensitive employee data.</p>
          )}

          {showCreate && canConfigurePayroll && (
            <Card
              title="New employee profile"
              description="IC/EPF/SOCSO/income-tax/bank-account numbers are encrypted server-side with the key below — it is never stored by this app and is cleared from this form the moment you leave it."
            >
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (
                    !createBusy &&
                    createPartyId &&
                    createIcNumber.trim() &&
                    createBankAccountNo.trim() &&
                    createBasicSalary.trim() &&
                    createHireDate &&
                    createKey.trim()
                  )
                    void handleCreateProfile();
                }}
              >
                <div className="ui-form-grid">
                  <Field label="Employee" required>
                    {(p) => (
                      <select {...p} className="ui-select" value={createPartyId} onChange={(e) => setCreatePartyId(e.target.value)}>
                        <option value="">Select employee-typed party…</option>
                        {employeesWithoutProfile.map((pt) => (
                          <option key={pt.id} value={pt.id}>
                            {pt.displayName}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <Field label="Employment type">
                    {(p) => (
                      <select {...p} className="ui-select" value={createEmploymentType} onChange={(e) => setCreateEmploymentType(e.target.value as EmploymentType)}>
                        {EMPLOYMENT_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <Field label="Hire date" required>
                    {(p) => <input {...p} className="ui-input" type="date" value={createHireDate} onChange={(e) => setCreateHireDate(e.target.value)} />}
                  </Field>
                  <Field label="IC number" required>
                    {(p) => <input {...p} className="ui-input" value={createIcNumber} onChange={(e) => setCreateIcNumber(e.target.value)} />}
                  </Field>
                  <Field label="EPF number (optional)">
                    {(p) => <input {...p} className="ui-input" value={createEpfNumber} onChange={(e) => setCreateEpfNumber(e.target.value)} />}
                  </Field>
                  <Field label="SOCSO number (optional)">
                    {(p) => <input {...p} className="ui-input" value={createSocsoNumber} onChange={(e) => setCreateSocsoNumber(e.target.value)} />}
                  </Field>
                  <Field label="Income tax no (optional)">
                    {(p) => <input {...p} className="ui-input" value={createIncomeTaxNo} onChange={(e) => setCreateIncomeTaxNo(e.target.value)} />}
                  </Field>
                  <Field label="Bank name (optional)">
                    {(p) => <input {...p} className="ui-input" value={createBankName} onChange={(e) => setCreateBankName(e.target.value)} />}
                  </Field>
                  <Field label="Bank account no" required>
                    {(p) => <input {...p} className="ui-input" value={createBankAccountNo} onChange={(e) => setCreateBankAccountNo(e.target.value)} />}
                  </Field>
                  <Field label="Basic salary (RM)" required>
                    {(p) => <input {...p} className="ui-input" value={createBasicSalary} onChange={(e) => setCreateBasicSalary(e.target.value)} />}
                  </Field>
                  <Field label="Payroll encryption key" required>
                    {(p) => (
                      <input {...p} className="ui-input" type="password" autoComplete="off" value={createKey} onChange={(e) => setCreateKey(e.target.value)} />
                    )}
                  </Field>
                </div>
                {employeeParties.length === 0 && (
                  <p className="ui-muted">No party is tagged "employee" yet — add one on the Parties page first.</p>
                )}
                <div className="ui-form-actions">
                  <Button
                    type="submit"
                    variant="primary"
                    loading={createBusy}
                    disabled={
                      !createPartyId || !createIcNumber.trim() || !createBankAccountNo.trim() || !createBasicSalary.trim() || !createHireDate || !createKey.trim()
                    }
                  >
                    {createBusy ? "Creating…" : "Create profile"}
                  </Button>
                </div>
                {createError && (
                  <p className="aifa-alert aifa-alert--danger" role="alert">
                    {createError}
                  </p>
                )}
              </form>
            </Card>
          )}

          {revealEmployee && (
            <Card title="Sensitive details" description={partyName(revealEmployee.partyId)}>
              {revealed === null ? (
                <form
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    if (!revealBusy && revealKey.trim()) void handleReveal(revealEmployee.id);
                  }}
                >
                  <div className="ui-inline-actions" style={{ alignItems: "flex-end" }}>
                    <Field label="Payroll encryption key">
                      {(p) => (
                        <input {...p} className="ui-input" type="password" autoComplete="off" value={revealKey} onChange={(ev) => setRevealKey(ev.target.value)} />
                      )}
                    </Field>
                    <Button type="submit" variant="primary" loading={revealBusy} disabled={!revealKey.trim()}>
                      {revealBusy ? "Decrypting…" : "Decrypt"}
                    </Button>
                  </div>
                  {revealError && (
                    <p className="aifa-alert aifa-alert--danger" role="alert">
                      {revealError}
                    </p>
                  )}
                </form>
              ) : (
                <>
                  <ul className="ui-move-list">
                    <li className="ui-move"><span className="ui-muted">IC</span><strong>{String(revealed.icNumber)}</strong></li>
                    <li className="ui-move"><span className="ui-muted">EPF</span><strong>{String(revealed.epfNumber ?? "—")}</strong></li>
                    <li className="ui-move"><span className="ui-muted">SOCSO</span><strong>{String(revealed.socsoNumber ?? "—")}</strong></li>
                    <li className="ui-move"><span className="ui-muted">Income tax no</span><strong>{String(revealed.incomeTaxNo ?? "—")}</strong></li>
                    <li className="ui-move"><span className="ui-muted">Bank account no</span><strong>{String(revealed.bankAccountNo)}</strong></li>
                  </ul>
                  <div className="ui-form-actions">
                    <Button variant="secondary" onClick={closeReveal}>
                      Done — clear from screen
                    </Button>
                  </div>
                </>
              )}
            </Card>
          )}

          <Card flush>
            <DataTable
              caption="Employee profiles"
              columns={employeeColumns}
              rows={loadError ? [] : employees}
              rowKey={(e) => e.id}
              empty={<div className="ui-table-state">No employee profiles yet.</div>}
            />
          </Card>
        </>
      )}

      {tab === "payroll-runs" && (
        <>
          <Card title="Statutory deduction calculator">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!calcBusy && calcGrossPay.trim()) void handleComputeCalc();
              }}
            >
              <div className="ui-inline-actions" style={{ alignItems: "flex-end" }}>
                <Field label="Gross pay (RM)">
                  {(p) => <input {...p} className="ui-input" value={calcGrossPay} onChange={(e) => setCalcGrossPay(e.target.value)} />}
                </Field>
                <Button type="submit" variant="primary" loading={calcBusy} disabled={!calcGrossPay.trim()}>
                  {calcBusy ? "Computing…" : "Compute"}
                </Button>
              </div>
            </form>
            {calcError && (
              <p className="aifa-alert aifa-alert--danger" role="alert">
                {calcError}
              </p>
            )}
            {calcResult && (
              <ul className="ui-move-list" style={{ marginTop: 12 }}>
                <li className="ui-move"><span className="ui-muted">EPF</span><span>employee {formatMoney(calcResult.epfEmployee)} / employer {formatMoney(calcResult.epfEmployer)}</span></li>
                <li className="ui-move"><span className="ui-muted">SOCSO</span><span>employee {formatMoney(calcResult.socsoEmployee)} / employer {formatMoney(calcResult.socsoEmployer)}</span></li>
                <li className="ui-move"><span className="ui-muted">EIS</span><span>employee {formatMoney(calcResult.eisEmployee)} / employer {formatMoney(calcResult.eisEmployer)}</span></li>
                <li className="ui-move">
                  <span className="ui-muted">PCB</span>
                  <span>
                    {formatMoney(calcResult.pcbDeduction)} <PcbCaveat />
                  </span>
                </li>
              </ul>
            )}
          </Card>

          <Card
            title="New payroll run"
            description="Drafts a Payroll Run and one Payslip per active employee, sweeping in any approved claims/salary advances for the period."
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!runCreateBusy && newPeriod.trim()) void handleCreateRun();
              }}
            >
              <div className="ui-inline-actions" style={{ alignItems: "flex-end" }}>
                <Field label="Period" hint="e.g. 2026-08">
                  {(p) => <input {...p} className="ui-input" value={newPeriod} onChange={(e) => setNewPeriod(e.target.value)} />}
                </Field>
                <Button type="submit" variant="primary" loading={runCreateBusy} disabled={!newPeriod.trim()}>
                  {runCreateBusy ? "Creating…" : "Create run"}
                </Button>
              </div>
              {runCreateError && (
                <p className="aifa-alert aifa-alert--danger" role="alert">
                  {runCreateError}
                </p>
              )}
            </form>
          </Card>

          <p className="ui-muted">
            A submitted payroll run always routes through the Approvals inbox — this never auto-approves.{" "}
            {onGoToApprovals ? (
              <button type="button" className="aifa-link-btn" onClick={onGoToApprovals}>
                Go to Approvals
              </button>
            ) : (
              "See the Approvals sidebar item."
            )}
          </p>

          {runActionError && (
            <p className="aifa-alert aifa-alert--danger" role="alert">
              {runActionError}
            </p>
          )}

          {exportRun && (
            <Card title="Generate bulk payment file" description={`Payroll run ${exportRun.period}`}>
              <p className="aifa-alert aifa-alert--warning" role="note">
                ⚠ Unverified against Maybank2u — confirm with your bank before uploading this file. This CSV follows a
                documented-generic Malaysian bulk-pay layout, not Maybank2u's real portal template.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!exportBusy && exportKey.trim()) void handleGenerateExport(exportRun);
                }}
              >
                <div className="ui-inline-actions" style={{ alignItems: "flex-end" }}>
                  <Field label="Payroll encryption key">
                    {(p) => <input {...p} className="ui-input" type="password" autoComplete="off" value={exportKey} onChange={(e) => setExportKey(e.target.value)} />}
                  </Field>
                  <Button type="submit" variant="primary" loading={exportBusy} disabled={!exportKey.trim()}>
                    {exportBusy ? "Generating…" : "Generate"}
                  </Button>
                </div>
                {exportError && (
                  <p className="aifa-alert aifa-alert--danger" role="alert">
                    {exportError}
                  </p>
                )}
              </form>
            </Card>
          )}

          <Card title="Payroll runs" description="Select a run to see its payslips." flush>
            <DataTable
              caption="Payroll runs"
              columns={runColumns}
              rows={loadError ? [] : payrollRuns}
              rowKey={(r) => r.id}
              onRowClick={(r) => void toggleExpand(r)}
              selectedKey={expandedRunId}
              empty={<div className="ui-table-state">No payroll runs yet.</div>}
            />
          </Card>

          {expandedRun && (
            <Card title={`Payslips — ${expandedRun.period}`} flush>
              <DataTable
                caption="Payslips"
                columns={slipColumns}
                rows={payslipsByRun[expandedRun.id] ?? []}
                rowKey={(sl) => sl.id}
                empty={<div className="ui-table-state">No payslips loaded.</div>}
              />
              <p style={{ padding: "0 16px 12px" }}>
                <PcbCaveat />
              </p>
            </Card>
          )}

          {exportFileRun && (
            <Card title={`Bulk payment file — ${exportFileRun.period}`}>
              <p className="aifa-alert aifa-alert--warning" role="note">
                ⚠ Unverified against Maybank2u — confirm with your bank before uploading this file.
              </p>
              <textarea
                className="ui-textarea"
                aria-label="Bulk payment file contents"
                readOnly
                value={exportsByRun[exportFileRun.id][0].fileContent}
                style={{ height: 100, fontFamily: "monospace", fontSize: 12 }}
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
