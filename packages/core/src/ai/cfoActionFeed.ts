/**
 * CFO Action Feed ("Money Moves") — Path B port of the AI CFO Assistant
 * Engine (Vol 2_4), proposed 1 October 2026
 * (docs/ideas/AiFA_Improvement_Proposal_Money_Moves.md).
 *
 * WHY THIS EXISTS: `cfoGuidance.ts` (Phase 1) is the only CFO-engine code
 * in the product, and it reads Path A — the local, encrypted mobile tables
 * no live web page reads from. The live web shell (Path B) shows figures
 * (Business Overview's Snapshot/Sales Pipeline/Compliance tabs) but never
 * answers the owner's real question: "what should I do next?". "One Input.
 * AI Does the Rest." needs that second half — after capture, AiFA should
 * tell the owner the next money move, not leave them to read four tabs.
 *
 * DESIGN (same discipline as cfoGuidance.ts):
 * - Deterministic and rule-based. No AI provider call — "is this invoice
 *   overdue" is a computation, not a guess. Zero cost, works with no key.
 * - Pure function over data the existing Path B transports already return
 *   (`arAgeingDetail`, payment vouchers, approval tasks,
 *   `listDueContractAlerts`, capture triage). No new RPC, no schema change.
 * - Every action carries a plain-language `why` (Phase 1's "Why?"
 *   explainability rule) and a `targetPage` sidebar id to act on it.
 * - Capped (default 5) and honest: an empty feed is returned as empty,
 *   never padded with manufactured advice.
 */
import type { ApprovalTask } from "../sync/approvalEngineTransport";
import type { CaptureTriageItem } from "../sync/captureTriageTransport";
import type { ContractAlert } from "../sync/legalCommercialTransport";
import type { PaymentVoucher } from "../sync/paymentVouchersReportsTransport";
import type { ArAgeingEntry } from "../sync/paymentsCreditNotesTransport";

export type CfoActionKind =
  | "cash_shortfall"
  | "overdue_receivable"
  | "contract_alert"
  | "stale_approvals"
  | "approved_unpaid_vouchers"
  | "triage_backlog";

export interface CfoAction {
  /** Stable, deterministic id (kind + subject) — safe as a React key or a "dismissed" marker. */
  id: string;
  kind: CfoActionKind;
  /** 0-100, higher = more urgent. Ranking only — not shown to the owner as a score. */
  priority: number;
  title: string;
  /** Plain-language reason this action was surfaced (explainability rule). */
  why: string;
  amount: number | null;
  /** A `sidebarConfig.ts` item id the owner can jump to to act. */
  targetPage: string;
  subjectId: string | null;
  /** Present only on `overdue_receivable` actions — everything needed to draft a payment reminder (see `paymentReminder.ts`). */
  invoice?: OverdueInvoiceRef;
}

export interface OverdueInvoiceRef {
  invoiceId: string;
  invoiceNo: string;
  partyId: string;
  /** Display name when known (from `partyNames`), else null. */
  partyName: string | null;
  outstandingBalance: number;
  dueDate: string;
  daysOverdue: number;
}

export interface CfoActionFeedInput {
  /** Cash/Bank (account 1000) balance from the trial balance; null when unknown — cash checks are then skipped, not guessed. */
  cashBalance: number | null;
  arAgeing: ArAgeingEntry[];
  paymentVouchers: PaymentVoucher[];
  approvalTasks: ApprovalTask[];
  dueContractAlerts: ContractAlert[];
  captureTriage: CaptureTriageItem[];
  /** Optional partyId -> display name; falls back to the invoice number alone. */
  partyNames?: Record<string, string>;
}

export interface CfoActionFeedOptions {
  now?: Date;
  /** Max actions returned (default 5) — a short list, not a wall of cards (Vol 12_2 §5.1 spirit). */
  limit?: number;
  /** A pending approval older than this is "stale" (default 48h). */
  staleApprovalHours?: number;
}

export interface CfoActionFeed {
  actions: CfoAction[];
  /** How many candidate actions existed before the limit was applied. */
  totalCandidates: number;
  generatedAt: string;
}

export const DEFAULT_ACTION_LIMIT = 5;
export const DEFAULT_STALE_APPROVAL_HOURS = 48;

const HOUR_MS = 60 * 60 * 1000;

function rm(n: number): string {
  return `RM${n.toFixed(2)}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function overdueReceivableActions(input: CfoActionFeedInput): CfoAction[] {
  return input.arAgeing
    .filter((e) => e.daysOverdue > 0 && e.outstandingBalance > 0)
    .map((e) => {
      const who = input.partyNames?.[e.partyId];
      const label = who ? `${who} (${e.invoiceNo})` : e.invoiceNo;
      return {
        id: `overdue_receivable:${e.invoiceId}`,
        kind: "overdue_receivable" as const,
        // 60 at 1 day overdue, rising to 90 at ~90 days — age drives a
        // collection nudge, same prioritisation choice as cfoGuidance.ts.
        priority: 60 + clamp(Math.floor(e.daysOverdue / 3), 0, 30),
        title: `Chase ${label} — ${rm(e.outstandingBalance)} overdue`,
        why: `Due ${e.dueDate}, now ${e.daysOverdue} day(s) overdue (${e.ageingBucket} bucket).`,
        amount: e.outstandingBalance,
        targetPage: "ar-ageing",
        subjectId: e.invoiceId,
        invoice: {
          invoiceId: e.invoiceId,
          invoiceNo: e.invoiceNo,
          partyId: e.partyId,
          partyName: who ?? null,
          outstandingBalance: e.outstandingBalance,
          dueDate: e.dueDate,
          daysOverdue: e.daysOverdue,
        },
      };
    });
}

const CONTRACT_PRIORITY: Record<ContractAlert["alertType"], number> = {
  expired: 75,
  expiring: 65,
  renewal_upcoming: 45,
};
const CONTRACT_WORDING: Record<ContractAlert["alertType"], string> = {
  expired: "has expired",
  expiring: "is expiring",
  renewal_upcoming: "is coming up for renewal",
};

function contractAlertActions(input: CfoActionFeedInput): CfoAction[] {
  return input.dueContractAlerts
    .filter((a) => a.status === "pending")
    .map((a) => ({
      id: `contract_alert:${a.id}`,
      kind: "contract_alert" as const,
      priority: CONTRACT_PRIORITY[a.alertType],
      title: `Review contract — it ${CONTRACT_WORDING[a.alertType]}`,
      why: `Alert triggered on ${a.triggerDate} and has not been acknowledged yet.`,
      amount: null,
      targetPage: "contracts-alerts",
      subjectId: a.contractId,
    }));
}

function staleApprovalAction(
  input: CfoActionFeedInput,
  now: Date,
  staleHours: number,
): CfoAction | null {
  const stale = input.approvalTasks.filter(
    (t) =>
      t.status === "pending_approval" &&
      now.getTime() - new Date(t.createdAt).getTime() >= staleHours * HOUR_MS,
  );
  if (stale.length === 0) return null;
  const oldestMs = Math.min(
    ...stale.map((t) => new Date(t.createdAt).getTime()),
  );
  const oldestDays = Math.floor((now.getTime() - oldestMs) / (24 * HOUR_MS));
  const total = stale.reduce((s, t) => s + (t.amount ?? 0), 0);
  return {
    id: "stale_approvals",
    kind: "stale_approvals",
    priority: 55 + clamp(oldestDays * 2, 0, 20),
    title: `${stale.length} approval(s) waiting on you`,
    why: `Oldest has waited ${oldestDays} day(s). Captured work does not move forward until it is approved.`,
    amount: total > 0 ? total : null,
    targetPage: "approvals",
    subjectId: null,
  };
}

function cashActions(input: CfoActionFeedInput): CfoAction[] {
  const approved = input.paymentVouchers.filter((v) => v.status === "approved");
  if (approved.length === 0) return [];
  const count = approved.length;
  const total = approved.reduce((s, v) => s + v.grandTotal, 0);
  if (input.cashBalance !== null && total > input.cashBalance) {
    const gap = total - input.cashBalance;
    return [
      {
        id: "cash_shortfall",
        kind: "cash_shortfall",
        priority: 100,
        title: `Cash short by ${rm(gap)} for approved bills`,
        why: `${count} approved voucher(s) total ${rm(total)} but cash/bank stands at ${rm(input.cashBalance)}. Collect receivables or reschedule payments first.`,
        amount: gap,
        targetPage: "payment-vouchers",
        subjectId: null,
      },
    ];
  }
  return [
    {
      id: "approved_unpaid_vouchers",
      kind: "approved_unpaid_vouchers",
      priority: 50,
      title: `${count} approved voucher(s) ready to pay — ${rm(total)}`,
      why:
        input.cashBalance === null
          ? "Approved but not yet marked paid. Cash balance unknown, so affordability was not checked."
          : `Approved but not yet marked paid; cash/bank (${rm(input.cashBalance)}) covers them.`,
      amount: total,
      targetPage: "payment-vouchers",
      subjectId: null,
    },
  ];
}

function triageAction(input: CfoActionFeedInput): CfoAction | null {
  const pending = input.captureTriage.filter((t) => t.status === "pending");
  if (pending.length === 0) return null;
  return {
    id: "triage_backlog",
    kind: "triage_backlog",
    priority: 40 + clamp(pending.length, 0, 15),
    title: `${pending.length} capture(s) AiFA could not file`,
    why: "These inputs are sitting in Capture Triage and are not in your books yet.",
    amount: null,
    targetPage: "quick-capture",
    subjectId: null,
  };
}

/**
 * Builds the ranked "what to do next" list. Deterministic: same input and
 * `now` always produce the same output (ties broken by amount, then id).
 */
export function buildCfoActionFeed(
  input: CfoActionFeedInput,
  options?: CfoActionFeedOptions,
): CfoActionFeed {
  const now = options?.now ?? new Date();
  const limit = options?.limit ?? DEFAULT_ACTION_LIMIT;
  const staleHours =
    options?.staleApprovalHours ?? DEFAULT_STALE_APPROVAL_HOURS;

  const candidates: CfoAction[] = [
    ...cashActions(input),
    ...overdueReceivableActions(input),
    ...contractAlertActions(input),
  ];
  const stale = staleApprovalAction(input, now, staleHours);
  if (stale) candidates.push(stale);
  const triage = triageAction(input);
  if (triage) candidates.push(triage);

  candidates.sort(
    (a, b) =>
      b.priority - a.priority ||
      (b.amount ?? 0) - (a.amount ?? 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  return {
    actions: candidates.slice(0, Math.max(0, limit)),
    totalCandidates: candidates.length,
    generatedAt: now.toISOString(),
  };
}
