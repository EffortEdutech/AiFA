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
 * AMENDMENT (1 October 2026, owner decision — "Money Moves" proposal,
 * docs/ideas/AiFA_Improvement_Proposal_Money_Moves.md): the fixed tab set
 * above gains exactly ONE tab, "Today", placed first and opened by
 * default. It is still a single focused view (a ranked list of at most
 * five next actions from `@aifa/core/ai/cfoActionFeed`, rendered by
 * `TodayMoneyMovesTab.tsx`), not an open-ended widget grid — the "tabs,
 * not noticeboards" rule itself is unchanged. Vol 12_2 §5.1 is amended
 * to match.
 *
 * AP TOTAL — DISCLOSED REAL ZERO: `Accounts Payable` (account_code
 * '2000') is seeded in every business's Chart of Accounts but no RPC in
 * this schema ever posts to it — Payment Vouchers post cash-basis
 * directly against Cash/Bank ('1000'), never accruing a payable first.
 * The Snapshot tab's AP figure is therefore always RM0.00, genuinely,
 * not a missing-data placeholder — labelled as such rather than shown
 * as a bare, unexplained zero.
 *
 * UI polish Phase 3 (pilot page): presentation only — headline figures
 * are stat tiles, lists are tables, and the tab set, reads and disclosure
 * labels (AP RM0.00, simulated e-Invoice provider) are unchanged.
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
import {
  Button,
  Card,
  DataTable,
  Icon,
  PageHeader,
  SkeletonLines,
  StatGrid,
  StatTile,
  StatusPill,
  formatDate,
  formatMoney,
  humanizeStatus,
  statusTone,
  type Column,
} from "../../ui";
import { TabStrip } from "../TabStrip";
import { TodayMoneyMovesTab } from "./TodayMoneyMovesTab";

const fullAccountingReportsTransport = createSupabaseFullAccountingReportsTransport(supabase);
const paymentsCreditNotesTransport = createSupabasePaymentsCreditNotesTransport(supabase);
const legalCommercialTransport = createSupabaseLegalCommercialTransport(supabase);

type OverviewTab = "today" | "snapshot" | "sales-pipeline" | "compliance-status" | "team-activity";

interface Props {
  businessId: string;
  onGoToApprovals?: () => void;
  /** Jump to any sidebar item — used by the Today tab's action buttons. */
  onNavigate?: (sidebarItemId: string) => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const QUOTATION_STATUSES: QuotationStatus[] = ["draft", "sent", "accepted", "rejected", "expired", "converted_to_invoice"];
const EINVOICE_STATUSES: EInvoiceSubmissionStatus[] = ["draft", "submitted", "validated", "rejected", "cancelled"];

export function BusinessOverviewPage({ businessId, onGoToApprovals, onNavigate }: Props): JSX.Element {
  const [tab, setTab] = useState<OverviewTab>("today");
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
    // The Today tab loads its own data (TodayMoneyMovesTab.tsx).
    if (tab === "today") return;
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

  // Once the trial balance has loaded, an account with no row has no postings yet: RM0.00.
  const cashBalance = trialBalance === null ? null : (trialBalance.find((e) => e.accountCode === "1000")?.balance ?? 0);
  const arBalance = trialBalance === null ? null : (trialBalance.find((e) => e.accountCode === "1100")?.balance ?? 0);
  const apBalance = trialBalance?.find((e) => e.accountCode === "2000")?.balance ?? 0;

  const overdueEntries = arEntries === null ? null : arEntries.filter((e) => e.ageingBucket !== "current");

  const membershipColumns: Column<BusinessMembership>[] = [
    { key: "role", header: "Role", render: (m) => roleName(m.roleId) },
    { key: "status", header: "Status", render: (m) => <StatusPill status={m.status} /> },
  ];

  const decisionColumns: Column<ApprovalTask>[] = [
    { key: "area", header: "Area", render: (t) => humanizeStatus(t.domain) },
    {
      key: "subject",
      header: "Subject",
      render: (t) => `${humanizeStatus(t.subjectType)} #${t.subjectId.slice(0, 8)}`,
    },
    { key: "status", header: "Decision", render: (t) => <StatusPill status={t.status} /> },
    { key: "via", header: "Resolved via", render: (t) => humanizeStatus(String(t.resolvedVia ?? "")) || "—" },
    { key: "date", header: "Decided", render: (t) => formatDate(t.decidedAt) },
  ];

  return (
    <div className="ui-page">
      <PageHeader title="Business Overview" description="What needs attention today, and where the business stands.">
        <TabStrip
          tabs={[
            { id: "today", label: "Today" },
            { id: "snapshot", label: "Snapshot" },
            { id: "sales-pipeline", label: "Sales Pipeline" },
            { id: "compliance-status", label: "Compliance Status" },
            { id: "team-activity", label: "Team Activity" },
          ]}
          active={tab}
          onChange={setTab}
        />
      </PageHeader>

      {loadError && (
        <p className="aifa-alert aifa-alert--danger" role="alert" style={{ marginBottom: "var(--aifa-space-4)" }}>
          {loadError}
        </p>
      )}

      {tab === "today" && <TodayMoneyMovesTab businessId={businessId} onNavigate={onNavigate} />}

      {tab === "snapshot" && (
        <StatGrid>
          <StatTile label="Cash position" value={cashBalance === null ? null : formatMoney(cashBalance)} />
          <StatTile label="Accounts Receivable" value={arBalance === null ? null : formatMoney(arBalance)} />
          <StatTile
            label="Accounts Payable"
            value={formatMoney(apBalance)}
            hint={
              apBalance === 0
                ? "Always RM0.00 — Payment Vouchers post cash-basis, nothing accrues to this account yet."
                : undefined
            }
          />
          <StatTile
            label="Pending Approvals"
            value={pendingApprovalsCount}
            tone={pendingApprovalsCount !== null && pendingApprovalsCount > 0 ? "warning" : "neutral"}
            hint={
              onGoToApprovals && pendingApprovalsCount !== null && pendingApprovalsCount > 0 ? (
                <Button size="sm" variant="secondary" onClick={onGoToApprovals}>
                  Go to Approvals
                </Button>
              ) : undefined
            }
          />
        </StatGrid>
      )}

      {tab === "sales-pipeline" && (
        <>
          <Card title="Quotations by status">
            <StatGrid>
              {QUOTATION_STATUSES.map((s) => (
                <StatTile
                  key={s}
                  label={humanizeStatus(s)}
                  value={quotations === null ? null : quotations.filter((q) => q.status === s).length}
                  tone={statusTone(s)}
                />
              ))}
            </StatGrid>
          </Card>
          <Card
            title="Overdue invoices (AR ageing)"
            description="Invoices in any ageing bucket other than current — the same source as the AR Ageing page."
            actions={
              onNavigate ? (
                <Button size="sm" variant="secondary" onClick={() => onNavigate("ar-ageing")}>
                  View AR Ageing
                </Button>
              ) : undefined
            }
          >
            <StatGrid>
              <StatTile
                label="Overdue invoices"
                value={overdueEntries === null ? null : overdueEntries.length}
                tone={overdueEntries !== null && overdueEntries.length > 0 ? "danger" : "neutral"}
              />
              <StatTile
                label="Overdue amount"
                value={
                  overdueEntries === null
                    ? null
                    : formatMoney(overdueEntries.reduce((sum, e) => sum + e.outstandingBalance, 0))
                }
                tone={overdueEntries !== null && overdueEntries.length > 0 ? "danger" : "neutral"}
              />
            </StatGrid>
          </Card>
        </>
      )}

      {tab === "compliance-status" && (
        <>
          <Card title="e-Invoice submissions by status">
            <p className="aifa-alert aifa-alert--warning" style={{ marginBottom: "var(--aifa-space-4)" }}>
              <Icon name="alert" size={16} /> Simulated provider (see e-Invoice &amp; SST's own page) — these figures
              reflect the stub, not real LHDN MyInvois submissions.
            </p>
            <StatGrid>
              {EINVOICE_STATUSES.map((s) => (
                <StatTile
                  key={s}
                  label={humanizeStatus(s)}
                  value={eInvoiceSubmissions === null ? null : eInvoiceSubmissions.filter((e) => e.status === s).length}
                  tone={statusTone(s)}
                />
              ))}
            </StatGrid>
          </Card>
          <Card
            title="Contract alerts due"
            actions={
              onNavigate && dueContractAlerts !== null && dueContractAlerts.length > 0 ? (
                <Button size="sm" variant="secondary" onClick={() => onNavigate("contracts-alerts")}>
                  View Contracts &amp; Alerts
                </Button>
              ) : undefined
            }
          >
            {dueContractAlerts === null ? (
              <SkeletonLines lines={1} />
            ) : dueContractAlerts.length === 0 ? (
              <p className="ui-muted" style={{ margin: 0 }}>
                No alerts due today.
              </p>
            ) : (
              <p style={{ margin: 0 }}>{dueContractAlerts.length} alert(s) due — see Contracts &amp; Alerts.</p>
            )}
          </Card>
        </>
      )}

      {tab === "team-activity" && (
        <>
          <Card title="Membership roster" flush>
            <DataTable
              caption="Membership roster"
              columns={membershipColumns}
              rows={memberships}
              rowKey={(m) => m.id}
              empty={<div className="ui-table-state">No members yet.</div>}
            />
          </Card>
          <Card title="Recent approval decisions" flush>
            <DataTable
              caption="Recent approval decisions"
              columns={decisionColumns}
              rows={recentDecisions}
              rowKey={(t) => t.id}
              empty={<div className="ui-table-state">No decisions recorded yet.</div>}
            />
          </Card>
        </>
      )}
    </div>
  );
}
