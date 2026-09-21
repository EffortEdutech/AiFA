/**
 * Approval task / delegation read helpers — Sprint 38 (Vol 13_1 §6 §5,
 * Vol 12_2 §5.3's shared Approvals inbox).
 *
 * Mirrors membership.ts's own reasoning: no RPC in
 * approvalEngineTransport.ts lists tasks or delegations (only
 * create/decide/delegate/revoke mutating calls exist), so these reads
 * go directly against `public.approval_tasks` / `public.approval_delegations`,
 * both RLS-scoped to "any active member of this business" (see
 * app/backend/schema.sql's own policies) — the same read pattern
 * `getAllDevices` and `listMemberships` already use.
 */
import { supabase } from "./supabaseClient";
import type {
  ApprovalTask,
  ApprovalTaskRow,
  ApprovalDelegation,
  ApprovalDelegationRow,
} from "@aifa/core/sync/approvalEngineTransport";

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

function toApprovalDelegation(row: ApprovalDelegationRow): ApprovalDelegation {
  return {
    id: row.id,
    businessId: row.business_id,
    delegatorMembershipId: row.delegator_membership_id,
    delegateMembershipId: row.delegate_membership_id,
    domainScope: row.domain_scope,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    reason: row.reason,
    createdByMembershipId: row.created_by_membership_id,
    status: row.status,
  };
}

export async function listApprovalTasks(businessId: string): Promise<ApprovalTask[]> {
  const { data, error } = await supabase
    .from("approval_tasks")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as ApprovalTaskRow[]).map(toApprovalTask);
}

export async function listApprovalDelegations(businessId: string): Promise<ApprovalDelegation[]> {
  const { data, error } = await supabase
    .from("approval_delegations")
    .select("*")
    .eq("business_id", businessId)
    .order("starts_at", { ascending: false });
  if (error) throw error;
  return (data as ApprovalDelegationRow[]).map(toApprovalDelegation);
}
