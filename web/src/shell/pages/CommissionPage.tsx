/**
 * Commission — Sprint 46 (Vol 13_0 §11 Module H).
 *
 * TRIGGER NOTE: `computeCommissionForInvoice` must be called explicitly
 * right after an invoice reaches the business's own configured
 * `commission_trigger_status` ('issued' or 'paid', default 'issued')
 * — there is no hidden database trigger, and (disclosed gap) no
 * transport RPC or type exposes that setting to a client to read or
 * change it, so this page doesn't try to preflight it: the "Compute"
 * button just surfaces the RPC's own specific error verbatim
 * (`invoice_has_not_reached_the_configured_commission_trigger_status`
 * names both the invoice's actual status and the configured trigger)
 * rather than guessing.
 *
 * SOLO VS TEAM: `computeCommissionForInvoice` opens an ApprovalTask
 * like every other capture-then-approve flow this phase — for a solo
 * business it resolves in the same transaction (Vol 13_3 §3), so a
 * freshly-computed calculation already shows its real final status on
 * reload, same posture as AttendanceLeavePage.tsx.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabaseAttendanceLeaveCommissionTransport } from "@aifa/core/sync/attendanceLeaveCommissionTransport";
import type { CommissionBasis, CommissionRule, CommissionCalculation, RevenueVsCostDashboard } from "@aifa/core/sync/attendanceLeaveCommissionTransport";
import type { Party } from "@aifa/core/sync/partyAndLedgerTransport";
import type { Invoice } from "@aifa/core/sync/quotationInvoiceTransport";

import { supabase } from "../../lib/supabaseClient";
import { listParties } from "../../lib/partiesAndAccounts";
import { listInvoices } from "../../lib/salesCycle";
import {
  listCommissionRules,
  listCommissionCalculations,
  listInvoiceAgentAssignments,
} from "../../lib/attendanceLeaveCommission";
import { useAccess } from "../AccessContext";
import { TabStrip } from "../TabStrip";

const attendanceLeaveCommissionTransport = createSupabaseAttendanceLeaveCommissionTransport(supabase);

const COMMISSION_BASES: CommissionBasis[] = ["percent_of_invoice", "percent_of_margin", "flat_per_unit"];

type CommissionTab = "rules" | "invoices" | "dashboard";

interface Props {
  businessId: string;
  onGoToApprovals?: () => void;
}

function defaultDateFrom(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CommissionPage({ businessId, onGoToApprovals }: Props): JSX.Element {
  const { accessModel } = useAccess();
  const [tab, setTab] = useState<CommissionTab>("invoices");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [agents, setAgents] = useState<Party[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [agentByInvoiceId, setAgentByInvoiceId] = useState<Record<string, string | null>>({});
  const [rules, setRules] = useState<CommissionRule[] | null>(null);
  const [calculations, setCalculations] = useState<CommissionCalculation[] | null>(null);

  const [ruleAppliesTo, setRuleAppliesTo] = useState("");
  const [ruleBasis, setRuleBasis] = useState<CommissionBasis>("percent_of_invoice");
  const [ruleRate, setRuleRate] = useState("");
  const [ruleProductScope, setRuleProductScope] = useState("");
  const [ruleBusy, setRuleBusy] = useState(false);
  const [ruleError, setRuleError] = useState<string | null>(null);

  const [assignAgentFor, setAssignAgentFor] = useState<string | null>(null);
  const [assignAgentId, setAssignAgentId] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  const [busyInvoiceId, setBusyInvoiceId] = useState<string | null>(null);
  const [computeError, setComputeError] = useState<string | null>(null);

  const [dashDateFrom, setDashDateFrom] = useState(defaultDateFrom());
  const [dashDateTo, setDashDateTo] = useState(today());
  const [dashboard, setDashboard] = useState<RevenueVsCostDashboard | null>(null);
  const [dashBusy, setDashBusy] = useState(false);
  const [dashError, setDashError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [parties, inv, agentMap, r, c] = await Promise.all([
        listParties(businessId),
        listInvoices(businessId),
        listInvoiceAgentAssignments(businessId),
        listCommissionRules(businessId),
        listCommissionCalculations(businessId),
      ]);
      setAgents(parties.filter((p) => p.partyTypes.includes("agent")));
      setInvoices(inv);
      setAgentByInvoiceId(agentMap);
      setRules(r);
      setCalculations(c);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load commission data.");
    }
  }, [businessId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  function agentName(id: string | null): string {
    if (!id) return "No agent assigned";
    return agents.find((p) => p.id === id)?.displayName ?? `Agent #${id.slice(0, 8)}`;
  }

  function calculationForInvoice(invoiceId: string): CommissionCalculation | undefined {
    return (calculations ?? []).find((c) => c.invoiceId === invoiceId);
  }

  const loadDashboard = useCallback(async () => {
    setDashBusy(true);
    setDashError(null);
    try {
      const result = await attendanceLeaveCommissionTransport.revenueVsCostDashboard(businessId, dashDateFrom, dashDateTo);
      setDashboard(result);
    } catch (err) {
      setDashError(err instanceof Error ? err.message : "Could not load the dashboard.");
    } finally {
      setDashBusy(false);
    }
  }, [businessId, dashDateFrom, dashDateTo]);

  useEffect(() => {
    if (tab === "dashboard") loadDashboard().catch(() => {});
  }, [tab, loadDashboard]);

  async function handleCreateRule(): Promise<void> {
    if (!ruleRate.trim()) return;
    setRuleBusy(true);
    setRuleError(null);
    try {
      await attendanceLeaveCommissionTransport.createCommissionRule({
        businessId,
        basis: ruleBasis,
        rate: Number(ruleRate),
        appliesToPartyId: ruleAppliesTo || null,
        productScope: ruleProductScope.trim() || null,
      });
      setRuleAppliesTo("");
      setRuleRate("");
      setRuleProductScope("");
      await load();
    } catch (err) {
      setRuleError(err instanceof Error ? err.message : "Could not create this commission rule — check you hold `configure` on `commission`.");
    } finally {
      setRuleBusy(false);
    }
  }

  async function handleAssignAgent(invoiceId: string): Promise<void> {
    if (!assignAgentId) return;
    setAssignBusy(true);
    setAssignError(null);
    try {
      await attendanceLeaveCommissionTransport.assignInvoiceAgent(invoiceId, assignAgentId);
      setAssignAgentFor(null);
      setAssignAgentId("");
      await load();
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : "Could not assign this agent.");
    } finally {
      setAssignBusy(false);
    }
  }

  async function handleCompute(invoiceId: string): Promise<void> {
    setBusyInvoiceId(invoiceId);
    setComputeError(null);
    try {
      await attendanceLeaveCommissionTransport.computeCommissionForInvoice(invoiceId);
      await load();
    } catch (err) {
      setComputeError(err instanceof Error ? err.message : "Could not compute commission for this invoice.");
    } finally {
      setBusyInvoiceId(null);
    }
  }

  async function handleMarkPaid(calc: CommissionCalculation): Promise<void> {
    setBusyInvoiceId(calc.invoiceId);
    setComputeError(null);
    try {
      await attendanceLeaveCommissionTransport.markCommissionPaid(calc.id);
      await load();
    } catch (err) {
      setComputeError(err instanceof Error ? err.message : "Could not mark this commission paid — it may not be approved yet.");
    } finally {
      setBusyInvoiceId(null);
    }
  }

  if (loadError) {
    return (
      <div className="aifa-page">
        <h1>Commission</h1>
        <p className="error">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="aifa-page">
      <h1>Commission</h1>
      <TabStrip
        tabs={[
          { id: "invoices", label: "Invoices" },
          { id: "rules", label: "Rules" },
          { id: "dashboard", label: "Revenue vs Cost" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "rules" && (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 14, marginTop: 0 }}>New commission rule</h2>
            <div className="row">
              <select value={ruleAppliesTo} onChange={(e) => setRuleAppliesTo(e.target.value)} style={{ padding: 6, minWidth: 220 }}>
                <option value="">Business-wide default (no specific agent)</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName}
                  </option>
                ))}
              </select>
              <select value={ruleBasis} onChange={(e) => setRuleBasis(e.target.value as CommissionBasis)} style={{ padding: 6 }}>
                {COMMISSION_BASES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
              <input placeholder="Rate" value={ruleRate} onChange={(e) => setRuleRate(e.target.value)} style={{ padding: 6, width: 120 }} />
              <input placeholder="Product scope (optional)" value={ruleProductScope} onChange={(e) => setRuleProductScope(e.target.value)} style={{ padding: 6, width: 180 }} />
              <button onClick={() => void handleCreateRule()} disabled={ruleBusy || !ruleRate.trim()}>
                {ruleBusy ? "Creating…" : "Create rule"}
              </button>
            </div>
            <p className="muted" style={{ marginTop: 4 }}>
              Requires `configure` on `commission`. A specific-agent rule wins over the business-wide default when
              computing commission for that agent's invoices.
            </p>
            {ruleError && <p className="error">{ruleError}</p>}
          </div>

          {rules === null ? (
            <p className="muted">Loading…</p>
          ) : rules.length === 0 ? (
            <p className="muted">No commission rules yet.</p>
          ) : (
            rules.map((r) => (
              <div key={r.id} className="card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{r.appliesToPartyId ? agentName(r.appliesToPartyId) : "Business-wide default"}</strong>
                  <span className="muted">{r.basis}</span>
                </div>
                <p className="muted" style={{ margin: "4px 0" }}>
                  Rate {r.rate}
                  {r.productScope && ` · scoped to ${r.productScope}`}
                </p>
              </div>
            ))
          )}
        </>
      )}

      {tab === "invoices" && (
        <>
          <p className="muted" style={{ margin: "8px 0" }}>
            {accessModel === "solo"
              ? "You're the sole approver — a computed commission is approved automatically (solo_self_resolved), no separate review step."
              : "Computing a commission routes it through the Approvals inbox before it can be marked paid."}{" "}
            {accessModel !== "solo" && onGoToApprovals && (
              <button onClick={onGoToApprovals} style={{ padding: "0 4px" }}>
                Go to Approvals
              </button>
            )}
          </p>

          {computeError && <p className="error">{computeError}</p>}
          {assignError && <p className="error">{assignError}</p>}

          {invoices.length === 0 ? (
            <p className="muted">No invoices yet.</p>
          ) : (
            invoices.map((inv) => {
              const agentId = agentByInvoiceId[inv.id] ?? null;
              const calc = calculationForInvoice(inv.id);
              const busy = busyInvoiceId === inv.id;
              return (
                <div key={inv.id} className="card">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <strong>{inv.invoiceNo}</strong>
                    <span className="muted">{inv.status}</span>
                  </div>
                  <p className="muted" style={{ margin: "4px 0" }}>
                    {inv.currency} {inv.grandTotal.toFixed(2)} · agent: {agentName(agentId)}
                  </p>

                  {calc ? (
                    <p className="muted" style={{ margin: "4px 0" }}>
                      Commission: RM{calc.amount.toFixed(2)} — <span style={calc.status === "paid" ? { color: "#1b7a3d", fontWeight: 600 } : undefined}>{calc.status}</span>
                    </p>
                  ) : (
                    <div className="row" style={{ marginTop: 6, flexWrap: "wrap" }}>
                      {agentId ? (
                        <button onClick={() => void handleCompute(inv.id)} disabled={busy}>
                          {busy ? "Computing…" : "Compute commission"}
                        </button>
                      ) : (
                        <button onClick={() => setAssignAgentFor(assignAgentFor === inv.id ? null : inv.id)}>
                          {assignAgentFor === inv.id ? "Cancel" : "Assign agent"}
                        </button>
                      )}
                    </div>
                  )}

                  {calc && calc.status === "approved" && (
                    <div className="row" style={{ marginTop: 6 }}>
                      <button onClick={() => void handleMarkPaid(calc)} disabled={busy}>
                        {busy ? "Marking paid…" : "Mark commission paid"}
                      </button>
                    </div>
                  )}

                  {assignAgentFor === inv.id && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--aifa-border, #e2e2e2)" }}>
                      <div className="row">
                        <select value={assignAgentId} onChange={(e) => setAssignAgentId(e.target.value)} style={{ padding: 6, minWidth: 200 }}>
                          <option value="">Select agent-typed party…</option>
                          {agents.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.displayName}
                            </option>
                          ))}
                        </select>
                        <button onClick={() => void handleAssignAgent(inv.id)} disabled={assignBusy || !assignAgentId}>
                          {assignBusy ? "Assigning…" : "Assign"}
                        </button>
                      </div>
                      {agents.length === 0 && <p className="muted" style={{ marginTop: 4 }}>No party is tagged "agent" yet — add one on the Parties page first.</p>}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </>
      )}

      {tab === "dashboard" && (
        <>
          <div className="row" style={{ margin: "12px 0" }}>
            <input type="date" value={dashDateFrom} onChange={(e) => setDashDateFrom(e.target.value)} style={{ padding: 6 }} />
            <span className="muted">to</span>
            <input type="date" value={dashDateTo} onChange={(e) => setDashDateTo(e.target.value)} style={{ padding: 6 }} />
            <button onClick={() => void loadDashboard()} disabled={dashBusy}>
              {dashBusy ? "Loading…" : "Refresh"}
            </button>
          </div>
          {dashError && <p className="error">{dashError}</p>}
          {dashboard && (
            <div className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span>Revenue</span>
                <strong>RM{dashboard.revenue.toFixed(2)}</strong>
              </div>
              <div className="row" style={{ justifyContent: "space-between", marginTop: 4 }}>
                <span>Payroll cost</span>
                <strong>RM{dashboard.payrollCost.toFixed(2)}</strong>
              </div>
              <div className="row" style={{ justifyContent: "space-between", marginTop: 4 }}>
                <span>Commission cost</span>
                <strong>RM{dashboard.commissionCost.toFixed(2)}</strong>
              </div>
              <div
                className="row"
                style={{ justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--aifa-border, #e2e2e2)" }}
              >
                <span>Net</span>
                <strong style={{ color: dashboard.net >= 0 ? "#1b7a3d" : "#c0392b" }}>RM{dashboard.net.toFixed(2)}</strong>
              </div>
              <p className="muted" style={{ marginTop: 8 }}>
                Payroll cost sums approved/paid Payroll Runs whose period falls in range; commission cost sums
                approved/paid commission calculations computed in range.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
