/**
 * Mobile read wiring for "Money Moves" (5 October 2026, slice 4 —
 * docs/ideas/AiFA_Improvement_Proposal_Money_Moves.md).
 *
 * The feed itself (ranking, partial-failure handling, reminder text) is
 * shared with web via `@aifa/core/ai/cfoActionFeedLoader` — this file
 * only supplies mobile's own Supabase reads for it, mirroring the web
 * helpers in web/src/lib/{approvals,captureTriage,partiesAndAccounts,
 * purchasesAndCash}.ts (those import web's Vite-only Supabase client, so
 * they cannot be imported here directly; the small row mappers are
 * repeated instead).
 *
 * WHY CLOUD (Path B) DATA ON MOBILE: overdue invoices, payment vouchers,
 * approvals and contract alerts only exist in the cloud tables the web
 * app uses — mobile's local SQLite (Path A) has none of them. So Money
 * Moves on mobile needs the owner signed in, exactly like the web app.
 * READS ONLY; nothing is written.
 */
import type { CfoActionFeedSources } from "@aifa/core/ai/cfoActionFeedLoader";
import type {
  ApprovalTask,
  ApprovalTaskRow,
} from "@aifa/core/sync/approvalEngineTransport";
import type {
  CaptureTriageItem,
  CaptureTriageRow,
} from "@aifa/core/sync/captureTriageTransport";
import { createSupabaseFullAccountingReportsTransport } from "@aifa/core/sync/fullAccountingReportsTransport";
import { createSupabaseLegalCommercialTransport } from "@aifa/core/sync/legalCommercialTransport";
import type {
  PaymentVoucher,
  PaymentVoucherRow,
} from "@aifa/core/sync/paymentVouchersReportsTransport";
import { createSupabasePaymentsCreditNotesTransport } from "@aifa/core/sync/paymentsCreditNotesTransport";

import { supabase } from "@/lib/supabaseClient";

export type MyBusinessResolution =
  | { kind: "one"; businessId: string }
  | { kind: "none" }
  | { kind: "many"; count: number };

/**
 * Which business this signed-in login's Money Moves should read. Same
 * rule as the web app's sign-in bootstrap: active `business_memberships`
 * rows for this user. More than one is reported honestly (mobile has no
 * workspace picker yet) rather than guessing.
 */
export async function resolveMyBusiness(
  userId: string,
): Promise<MyBusinessResolution> {
  const { data, error } = await supabase
    .from("business_memberships")
    .select("business_id")
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;
  const ids = Array.from(
    new Set((data as { business_id: string }[]).map((r) => r.business_id)),
  );
  if (ids.length === 0) return { kind: "none" };
  if (ids.length === 1) return { kind: "one", businessId: ids[0] };
  return { kind: "many", count: ids.length };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function toPaymentVoucher(row: PaymentVoucherRow): PaymentVoucher {
  return {
    id: row.id,
    businessId: row.business_id,
    pvNo: row.pv_no,
    payeePartyId: row.payee_party_id,
    status: row.status,
    expenseCategory: row.expense_category,
    documentIdReceipt: row.document_id_receipt,
    paymentMethod: row.payment_method,
    issueDate: row.issue_date,
    currency: row.currency,
    grandTotal: row.grand_total,
    notes: row.notes,
    capturedByMembershipId: row.captured_by_membership_id,
    createdAt: row.created_at,
  };
}

function toApprovalTask(row: ApprovalTaskRow): ApprovalTask {
  return {
    id: row.id,
    businessId: row.business_id,
    domain: row.domain,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    amount: row.amount,
    aiDraftSummary: row.ai_draft_summary,
    aiConfidence: row.ai_confidence,
    capturedByMembershipId: row.captured_by_membership_id,
    assignedMembershipId: row.assigned_membership_id,
    resolvedVia: row.resolved_via,
    delegatedFromMembershipId: row.delegated_from_membership_id,
    status: row.status,
    decidedByMembershipId: row.decided_by_membership_id,
    decidedAt: row.decided_at,
    nextAction: row.next_action,
    selfApprovedViaEscapeValve: row.self_approved_via_escape_valve,
    createdAt: row.created_at,
  };
}

function toCaptureTriageItem(row: CaptureTriageRow): CaptureTriageItem {
  return {
    id: row.id,
    businessId: row.business_id,
    rawText: row.raw_text,
    detectedDomain: row.detected_domain,
    status: row.status,
    createdByMembershipId: row.created_by_membership_id,
    createdAt: row.created_at,
  };
}

/** Mobile's implementation of the shared feed's read functions, all scoped to one business. */
export function createMobileMoneyMovesSources(
  businessId: string,
): CfoActionFeedSources {
  const reports = createSupabaseFullAccountingReportsTransport(supabase);
  const payments = createSupabasePaymentsCreditNotesTransport(supabase);
  const legal = createSupabaseLegalCommercialTransport(supabase);

  return {
    cashBalance: async () => {
      const tb = await reports.trialBalance({
        businessId,
        asOfDate: todayIso(),
      });
      return tb.find((e) => e.accountCode === "1000")?.balance ?? null;
    },
    arAgeing: () => payments.arAgeingDetail(businessId),
    paymentVouchers: async () => {
      const { data, error } = await supabase
        .from("payment_vouchers")
        .select("*")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as PaymentVoucherRow[]).map(toPaymentVoucher);
    },
    approvalTasks: async () => {
      const { data, error } = await supabase
        .from("approval_tasks")
        .select("*")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as ApprovalTaskRow[]).map(toApprovalTask);
    },
    dueContractAlerts: () => legal.listDueContractAlerts(businessId),
    captureTriage: async () => {
      const { data, error } = await supabase
        .from("capture_triage")
        .select("*")
        .eq("business_id", businessId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as CaptureTriageRow[]).map(toCaptureTriageItem);
    },
    parties: async () => {
      const { data, error } = await supabase
        .from("parties")
        .select("id, display_name, contact_phone")
        .eq("business_id", businessId);
      if (error) throw error;
      return (
        data as {
          id: string;
          display_name: string;
          contact_phone: string | null;
        }[]
      ).map((r) => ({
        id: r.id,
        displayName: r.display_name,
        contactPhone: r.contact_phone,
      }));
    },
  };
}
