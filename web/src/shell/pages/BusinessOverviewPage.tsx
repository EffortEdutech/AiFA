/**
 * Business Overview — Sprint 48 (Vol 12_2 §5.1), replacing Sprint 37's
 * temporary `OverviewPage.tsx` composition now that every module sprint
 * it draws from has shipped (Sprints 39-47).
 *
 * FIXED TAB SET (Vol 12_2 §5.1's own hard rule, not a guideline): exactly
 * four tabs — Snapshot, Sales Pipeline, Compliance Status, Team Activity
 * — each a focused view against one or two existing reads, never an
 * open-ended widget grid. The Snapshot tab in particular is a small,
 * fixed set of headline figures (cash position, AR/AP totals, pending
 * approvals count), each a single number with a one-line label in a
 * compact strip — not a wall of cards. A reviewer should be able to
 * count the figures against Vol 12_2 §5.1's own list.
 *
 * QUICK CAPTURE — DISCLOSED, DELIBERATE RETIREMENT: Sprint 37's interim
 * Overview page carried a "Quick Capture" tab wrapping the old Phase 1/2
 * generic AI `CaptureForm`. Vol 12_2 §1.1 formally supersedes Vol 12_0
 * §4's old feature table (which had that as a single generic "capture"
 * row), and Vol 12_2 §4.2's 19-item sidebar inventory — declared "the
 * complete Phase 1-3 inventory" — has no Quick Capture slot at all.
 * Every domain now has its own dedicated, RPC-correct capture screen
 * (Quotations' create form, Payment Vouchers/Expense Quick Capture,
 * Attendance clock-in, Contracts &amp; Alerts' create form, etc.), which
 * supersede the old one-size-fits-all classifier flow. This page
 * therefore does not carry a Quick Capture tab — a deliberate, disclosed
 * IA decision, not a silently dropped feature. `CaptureForm.tsx` itself
 * is left in the tree, simply no longer wired here.
 *
 * AP TOTAL — DISCLOSED REAL ZERO: `Accounts Payable` (account_code
 * '2000') is seeded in every business's Chart of Accounts but no RPC in
 * this schema ever posts to it — Payment Vouchers post cash-basis
 * directly against Cash/Bank ('1000'), never accruing a payable first.
 * The Snapshot tab's AP figure is therefore always RM0.00, genuinely,
 * not a missing-data placeholder — labelled as such rather than shown
 * as a bare, unexplained zero.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabaseFullAccountingReportsTransport } from "@aifa/core/sync/fullAccountingReportsTransport";
import type { TrialBalanceEntry } from "@aifa/core/sync/fullAccountingReportsTransport";
import type { Quotation, QuotationStatus } from "@aifa/core/sync/quotationInvoiceTransport";
import type { ArAgeingEntry } from "@aifa/core/sync/paymentsCreditNotesTransport";
import { createSupabasePaymentsCreditNotesTransport } from "@aifa/core/sync/paymentsCreditNotesTransport";
import type { ApprovalTask } from "@aifa/core/sync/approvalEngineTransport";
import type { EInvoiceSubmission, EInvoiceSubmissionStatus } from "@aifa/core/sync/eInvoiceSstTransport";
import type { ContractAlert } from "@aifa/core/sync/legalCommercialTransport";
import { createSupabaseLegalCommercialTransport } from "@aifa/core/sync/legalCommercialTransport";
import type { BusinessMembership } from "@aifa/core/sync/teamMembershipTransport";

import { supabase } from "../../lib/supabaseClient";
import { listQuotations } from "../../lib/salesCycle";
import { listApprovalTasks } from "../../lib/approvals";
import { listEInvoiceSubmissions } from "../../lib/einvoiceSst";
import { listMemberships, listRoles, type RoleSummary } from "../../lib/membership";
import { TabStrip } from "../TabStrip";

const fullAccountingReportsTransport = createSupabaseFullAccountingReportsTransport(supabase);
const paymentsCreditNotesTransport = createSupabasePaymentsCreditNotesTransport(supabase);
const legalCommercialTransport = createSupabaseLegalCommercialTransport(supabase);

type OverviewTab = "snapshot" | "sales-pipeline" | "compliance-status" | "team-activity";

interface Props {
  businessId: string;
  onGoToApprovals?: () => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmt(n: number): string {
  return `RM${n.toFixed(2)}`;
}

const QUOTATION_STATUSES: QuotationStatus[] = ["draft", "sent", "accepted", "rejected", "expired", "converted_to_invoice"];
const EINVOICE_STATUSES: EInvoiceSubmissionStatus[] = ["draft", "submitted", "validated", "rejected", "cancelled"];

export function BusinessOverviewPage({ businessId, onGoToApprovals }: Props): JSX.Element {
  const [tab, setTab] = useState<OverviewTab>("snapshot");
  const [loadError, setLoadError] = useState<string | null>(null);

  // Snapshot
  const [trialBalance, setTrialBalance] = useState<TrialBalanceEntry[] | null>(null);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState<number | null>(null);

  // Sales Pipeline
  const [quotations, setQuotations] = useState<Quotation[] | null>(null);
  const [arEntries, setArEntries] = useState<ArAgeingEntry[] | null>(null);

  // Compliance Status
  const [eInvoiceSubmissions, setEInvoiceSubmissions] = useState<EInvoiceSubmission[] | null>(null);
  const [dueContractAlerts, setDueContractAlerts] = useState<ContractAlert[] | null>(null);

  // Team Activity
  const [memberships, setMemberships] = useState<BusinessMembership[] | null>(null);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [recentDecisions, setRecentDecisions] = useState<ApprovalTask[] | null>(null);

  const loadSnapshot = useCallback(async () => {
    const [tb, tasks] = await Promise.all([
      fullAccountingReportsTransport.trialBalance({ businessId, asOfDate: todayIso() }),
      listApprovalTasks(businessId),
    ]);
    setTrialBalance(tb);
    setPendingApprovalsCount(tasks.filter((t) => t.status === "pending_approval").length);
  }, [businessId]);

  const loadSalesPipeline = useCallback(async () => {
    const [q, ar] = await Promise.all([
      listQuotations(businessId),
      paymentsCreditNotesTransport.arAgeingDetail(businessId),
    ]);
    setQuotations(q);
    setArEntries(ar);
  }, [businessId]);

  const loadComplianceStatus = useCallback(async () => {
    const [subs, alerts] = await Promise.all([
      listEInvoiceSubmissions(businessId),
      legalCommercialTransport.listDueContractAlerts(businessId),
    ]);
    setEInvoiceSubmissions(subs);
    setDueContractAlerts(alerts);
  }, [businessId]);

  const loadTeamActivity = useCallback(async () => {
    const [m, r, tasks] = await Promise.all([listMemberships(businessId), listRoles(), listApprovalTasks(businessId)]);
    setMemberships(m);
    setRoles(r);
    setRecentDecisions(
      tasks
        .filter((t) => t.status !== "pending_approval" && t.decidedAt !== null)
        .sort((a, b) => (a.decidedAt! < b.decidedAt! ? 1 : -1))
        .slice(0, 15),
    );
  }, [businessId]);

  useEffect(() => {
    setLoadError(null);
    const load =
      tab === "snapshot"
        ? loadSnapshot
        : tab === "sales-pipeline"
          ? loadSalesPipeline
          : tab === "compliance-status"
            ? loadComplianceStatus
            : loadTeamActivity;
    load().catch((err) => setLoadError(err instanceof Error ? err.message : "Could not load this tab."));
  }, [tab, loadSnapshot, loadSalesPipeline, loadComplianceStatus, loadTeamActivity]);

  function roleName(roleId: string): string {
    return roles.find((r) => r.id === roleId)?.name ?? roleId.slice(0, 8);
  }

  const cashBalance = trialBalance?.find((e) => e.accountCode === "1000")?.balance ?? null;
  const arBalance = trialBalance?.find((e) => e.accountCode === "1100")?.balance ?? null;
  const apBalance = trialBalance?.find((e) => e.accountCode === "2000")?.balance ?? 0;

  return (
    <div className="aifa-page">
      <h1>Business Overview</h1>
      <TabStrip
        tabs={[
          { id: "snapshot", label: "Snapshot" },
          { id: "sales-pipeline", label: "Sales Pipeline" },
          { id: "compliance-status", label: "Compliance Status" },
          { id: "team-activity", label: "Team Activity" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {loadError && <p className="error">{loadError}</p>}

      {tab === "snapshot" && (
        <div className="card">
          <div className="row" style={{ gap: 32, flexWrap: "wrap" }}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Cash position</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{cashBalance == null ? "…" : fmt(cashBalance)}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Accounts Receivable</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{arBalance == null ? "…" : fmt(arBalance)}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Accounts Payable</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{fmt(apBalance)}</div>
              {apBalance === 0 && (
                <div className="muted" style={{ fontSize: 11 }}>
                  Always RM0.00 — Payment Vouchers post cash-basis, nothing accrues to this account yet.
                </div>
              )}
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Pending Approvals</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{pendingApprovalsCount ?? "…"}</div>
              {onGoToApprovals && pendingApprovalsCount !== null && pendingApprovalsCount > 0 && (
                <button onClick={onGoToApprovals} style={{ padding: "0 4px", marginTop: 4 }}>
                  Go to Approvals
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "sales-pipeline" && (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <strong>Quotations by status</strong>
            <div className="row" style={{ gap: 24, marginTop: 8, flexWrap: "wrap" }}>
              {QUOTATION_STATUSES.map((s) => (
                <div key={s}>
                  <div className="muted" style={{ fontSize: 12 }}>{s}</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>
                    {quotations === null ? "…" : quotations.filter((q) => q.status === s).length}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <strong>Overdue Invoices (AR Ageing)</strong>
            <p className="muted" style={{ margin: "4px 0" }}>
              Any ageing bucket other than "current" — same `arAgeingDetail` source AR Ageing's own page uses.
            </p>
            {arEntries === null ? (
              <p className="muted">Loading…</p>
            ) : (
              <div className="row" style={{ gap: 24, flexWrap: "wrap" }}>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>Overdue invoices</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>
                    {arEntries.filter((e) => e.ageingBucket !== "current").length}
                  </div>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>Overdue amount</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>
                    {fmt(arEntries.filter((e) => e.ageingBucket !== "current").reduce((sum, e) => sum + e.outstandingBalance, 0))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {tab === "compliance-status" && (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <strong>e-Invoice submissions by status</strong>
            <p className="muted" style={{ margin: "4px 0" }}>
              ⚠ Simulated provider (see e-Invoice &amp; SST's own page) — these figures reflect the stub, not real
              LHDN MyInvois submissions.
            </p>
            <div className="row" style={{ gap: 24, flexWrap: "wrap" }}>
              {EINVOICE_STATUSES.map((s) => (
                <div key={s}>
                  <div className="muted" style={{ fontSize: 12 }}>{s}</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>
                    {eInvoiceSubmissions === null ? "…" : eInvoiceSubmissions.filter((e) => e.status === s).length}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <strong>Contract alerts due</strong>
            {dueContractAlerts === null ? (
              <p className="muted">Loading…</p>
            ) : dueContractAlerts.length === 0 ? (
              <p className="muted">No alerts due today.</p>
            ) : (
              <p style={{ margin: "4px 0" }}>{dueContractAlerts.length} alert(s) due — see Contracts &amp; Alerts.</p>
            )}
          </div>
        </>
      )}

      {tab === "team-activity" && (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <strong>Membership roster</strong>
            {memberships === null ? (
              <p className="muted">Loading…</p>
            ) : (
              memberships.map((m) => (
                <p key={m.id} className="muted" style={{ margin: "4px 0" }}>
                  {roleName(m.roleId)} · {m.status}
                </p>
              ))
            )}
          </div>
          <div className="card">
            <strong>Recent approval decisions</strong>
            {recentDecisions === null ? (
              <p className="muted">Loading…</p>
            ) : recentDecisions.length === 0 ? (
              <p className="muted">No decisions recorded yet.</p>
            ) : (
              recentDecisions.map((t) => (
                <p key={t.id} className="muted" style={{ margin: "4px 0" }}>
                  {t.domain} / {t.subjectType} #{t.subjectId.slice(0, 8)} — {t.status} ({t.resolvedVia})
                  {t.decidedAt && ` · ${t.decidedAt.slice(0, 10)}`}
                </p>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
