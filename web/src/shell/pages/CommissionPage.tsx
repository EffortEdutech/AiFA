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
 *
 * UI polish Phase 4: presentation only — tables for rules and invoices, a
 * labelled rule form, stat tiles for Revenue vs Cost. Same calls and copy.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabaseAttendanceLeaveCommissionTransport } from "@aifa/core/sync/attendanceLeaveCommissionTransport";
import type { CommissionBasis, CommissionRule, CommissionCalculation, RevenueVsCostDashboard } from "@aifa/core/sync/attendanceLeaveCommissionTransport";
import type { Party } from "@aifa/core/sync/partyAndLedgerTransport";
import type { Invoice } from "@aifa/core/sync/quotationInvoiceTransport";

import { Button, Card, DataTable, Field, PageHeader, StatGrid, StatTile, StatusPill, formatMoney, humanizeStatus, type Column } from "../../ui";
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

  const ruleColumns: Column<CommissionRule>[] = [
    {
      key: "who",
      header: "Applies to",
      render: (r) => (r.appliesToPartyId ? agentName(r.appliesToPartyId) : "Business-wide default"),
    },
    { key: "basis", header: "Basis", render: (r) => humanizeStatus(r.basis) },
    { key: "rate", header: "Rate", numeric: true, render: (r) => r.rate },
    { key: "scope", header: "Product scope", render: (r) => r.productScope ?? "—" },
  ];

  const invoiceColumns: Column<Invoice>[] = [
    {
      key: "inv",
      header: "Invoice",
      render: (inv) => (
        <>
          <strong>{inv.invoiceNo}</strong>
          <div className="ui-cell-sub">{agentName(agentByInvoiceId[inv.id] ?? null)}</div>
        </>
      ),
    },
    { key: "status", header: "Status", render: (inv) => <StatusPill status={inv.status} label={humanizeStatus(inv.status)} /> },
    {
      key: "total",
      header: "Total",
      numeric: true,
      render: (inv) => (inv.currency === "MYR" ? formatMoney(inv.grandTotal) : `${inv.currency} ${inv.grandTotal.toFixed(2)}`),
    },
    {
      key: "calc",
      header: "Commission",
      render: (inv) => {
        const calc = calculationForInvoice(inv.id);
        return calc ? (
          <>
            {formatMoney(calc.amount)} <StatusPill status={calc.status} label={humanizeStatus(calc.status)} />
          </>
        ) : (
          "—"
        );
      },
    },
    {
      key: "actions",
      header: "",
      render: (inv) => {
        const agentId = agentByInvoiceId[inv.id] ?? null;
        const calc = calculationForInvoice(inv.id);
        const busy = busyInvoiceId === inv.id;
        if (calc) {
          return calc.status === "approved" ? (
            <Button size="sm" variant="primary" loading={busy} onClick={() => void handleMarkPaid(calc)}>
              {busy ? "Marking paid…" : "Mark commission paid"}
            </Button>
          ) : null;
        }
        return agentId ? (
          <Button size="sm" variant="secondary" loading={busy} onClick={() => void handleCompute(inv.id)}>
            {busy ? "Computing…" : "Compute commission"}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setAssignAgentFor(assignAgentFor === inv.id ? null : inv.id)}>
            {assignAgentFor === inv.id ? "Cancel" : "Assign agent"}
          </Button>
        );
      },
    },
  ];

  const assignInvoice = assignAgentFor ? invoices.find((i) => i.id === assignAgentFor) : undefined;

  return (
    <div className="aifa-page">
      <PageHeader title="Commission" description="Agent commission on invoices, and revenue against payroll and commission cost.">
        <TabStrip
          tabs={[
            { id: "invoices", label: "Invoices" },
            { id: "rules", label: "Rules" },
            { id: "dashboard", label: "Revenue vs Cost" },
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

      {tab === "rules" && (
        <>
          <Card
            title="New commission rule"
            description="Requires `configure` on `commission`. A specific-agent rule wins over the business-wide default when computing commission for that agent's invoices."
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!ruleBusy && ruleRate.trim()) void handleCreateRule();
              }}
            >
              <div className="ui-form-grid">
                <Field label="Applies to">
                  {(p) => (
                    <select {...p} className="ui-select" value={ruleAppliesTo} onChange={(e) => setRuleAppliesTo(e.target.value)}>
                      <option value="">Business-wide default (no specific agent)</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.displayName}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="Basis">
                  {(p) => (
                    <select {...p} className="ui-select" value={ruleBasis} onChange={(e) => setRuleBasis(e.target.value as CommissionBasis)}>
                      {COMMISSION_BASES.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="Rate" required>
                  {(p) => <input {...p} className="ui-input" inputMode="decimal" value={ruleRate} onChange={(e) => setRuleRate(e.target.value)} />}
                </Field>
                <Field label="Product scope (optional)">
                  {(p) => <input {...p} className="ui-input" value={ruleProductScope} onChange={(e) => setRuleProductScope(e.target.value)} />}
                </Field>
              </div>
              <div className="ui-form-actions">
                <Button type="submit" variant="primary" loading={ruleBusy} disabled={!ruleRate.trim()}>
                  {ruleBusy ? "Creating…" : "Create rule"}
                </Button>
              </div>
              {ruleError && (
                <p className="aifa-alert aifa-alert--danger" role="alert">
                  {ruleError}
                </p>
              )}
            </form>
          </Card>

          <Card flush>
            <DataTable
              caption="Commission rules"
              columns={ruleColumns}
              rows={loadError ? [] : rules}
              rowKey={(r) => r.id}
              empty={<div className="ui-table-state">No commission rules yet.</div>}
            />
          </Card>
        </>
      )}

      {tab === "invoices" && (
        <>
          <p className="ui-muted" style={{ marginTop: 0 }}>
            {accessModel === "solo"
              ? "You're the sole approver — a computed commission is approved automatically (solo_self_resolved), no separate review step."
              : "Computing a commission routes it through the Approvals inbox before it can be marked paid."}{" "}
            {accessModel !== "solo" && onGoToApprovals && (
              <button type="button" className="aifa-link-btn" onClick={onGoToApprovals}>
                Go to Approvals
              </button>
            )}
          </p>

          {computeError && (
            <p className="aifa-alert aifa-alert--danger" role="alert">
              {computeError}
            </p>
          )}
          {assignError && (
            <p className="aifa-alert aifa-alert--danger" role="alert">
              {assignError}
            </p>
          )}

          {assignInvoice && (
            <Card title={`Assign an agent to ${assignInvoice.invoiceNo}`}>
              <div className="ui-inline-actions" style={{ alignItems: "flex-end" }}>
                <div style={{ minWidth: 240 }}>
                  <Field
                    label="Agent"
                    hint={agents.length === 0 ? 'No party is tagged "agent" yet — add one on the Parties page first.' : undefined}
                  >
                    {(p) => (
                      <select {...p} className="ui-select" value={assignAgentId} onChange={(e) => setAssignAgentId(e.target.value)}>
                        <option value="">Select agent-typed party…</option>
                        {agents.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.displayName}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                </div>
                <Button variant="primary" loading={assignBusy} disabled={!assignAgentId} onClick={() => void handleAssignAgent(assignInvoice.id)}>
                  {assignBusy ? "Assigning…" : "Assign"}
                </Button>
              </div>
            </Card>
          )}

          <Card flush>
            <DataTable
              caption="Invoices and their commission"
              columns={invoiceColumns}
              rows={loadError ? [] : invoices}
              rowKey={(inv) => inv.id}
              empty={<div className="ui-table-state">No invoices yet.</div>}
            />
          </Card>
        </>
      )}

      {tab === "dashboard" && (
        <>
          <Card>
            <div className="ui-inline-actions" style={{ alignItems: "flex-end" }}>
              <Field label="From">
                {(p) => <input {...p} className="ui-input" type="date" value={dashDateFrom} onChange={(e) => setDashDateFrom(e.target.value)} />}
              </Field>
              <Field label="To">
                {(p) => <input {...p} className="ui-input" type="date" value={dashDateTo} onChange={(e) => setDashDateTo(e.target.value)} />}
              </Field>
              <Button variant="secondary" loading={dashBusy} onClick={() => void loadDashboard()}>
                {dashBusy ? "Loading…" : "Refresh"}
              </Button>
            </div>
          </Card>
          {dashError && (
            <p className="aifa-alert aifa-alert--danger" role="alert">
              {dashError}
            </p>
          )}
          {dashboard ? (
            <>
              <StatGrid>
                <StatTile label="Revenue" value={formatMoney(dashboard.revenue)} />
                <StatTile label="Payroll cost" value={formatMoney(dashboard.payrollCost)} />
                <StatTile label="Commission cost" value={formatMoney(dashboard.commissionCost)} />
                <StatTile label="Net" value={formatMoney(dashboard.net)} tone={dashboard.net >= 0 ? "success" : "danger"} />
              </StatGrid>
              <p className="ui-note">
                Payroll cost sums approved/paid Payroll Runs whose period falls in range; commission cost sums
                approved/paid commission calculations computed in range.
              </p>
            </>
          ) : (
            !dashError && (
              <StatGrid>
                <StatTile label="Revenue" value={null} />
                <StatTile label="Payroll cost" value={null} />
                <StatTile label="Commission cost" value={null} />
                <StatTile label="Net" value={null} />
              </StatGrid>
            )
          )}
        </>
      )}
    </div>
  );
}
