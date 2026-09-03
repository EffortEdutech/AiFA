/**
 * Delegated, SoD-aware approval engine RPC glue — Sprint 25 (Vol 13_1
 * §5 Delegation, §6 ApprovalTask; Vol 13_2 full — Role-Gated Capture &
 * Segregation of Duties; Vol 13_3 §3's solo_self_resolved extension).
 *
 * Mirrors teamMembershipTransport.ts's own shape in this same directory
 * (itself mirroring devicesTransport's — see that file's header for why
 * `SupabaseClientLike` exists instead of importing the real
 * `SupabaseClient` type).
 *
 * This is the generic engine every future Vol 13_0 module sprint
 * (starting Sprint 26) calls rather than re-implementing approval
 * resolution per module: call `createApprovalTask` once a module's own
 * capture flow has a subject to route for approval, and `decideApprovalTask`
 * from whatever approval-queue UI a later sprint builds. `checkCapturePermission`
 * is the Vol 13_2 §3 gate `capturePipeline.ts` (Vol 6_1 §6) should call
 * BEFORE handing anything to the AI pipeline — see this file's own
 * migration header comment for why that gate is implemented as an RPC
 * rather than a DB constraint (BusinessEvent's fields mostly live inside
 * `sync_envelopes.payload_ciphertext`, unreadable server-side by
 * design under Vol 13_1 §8's Path A local-first model).
 */

/** See supabaseTransport.ts's own header comment for why this exists instead of importing `SupabaseClient` from `@supabase/supabase-js` directly. */
export interface SupabaseClientLike {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/** Vol 13_1 §3's fixed 11-domain permission catalog. */
export type Domain =
  | "sales"
  | "pricing"
  | "expense"
  | "inventory"
  | "accounting_reports"
  | "tax_compliance"
  | "payroll"
  | "hr_attendance_leave"
  | "commission"
  | "legal_contract"
  | "settings";

/** Vol 13_2 §2's domain_hint -> Domain mapping input; 'unclassified' can never pass the capture gate by construction. */
export type DomainHint = "sale" | "purchase" | "expense" | "banking" | "unclassified";

export type ResolvedVia =
  | "direct_permission"
  | "delegation"
  | "escalation"
  | "auto_approved"
  | "solo_self_resolved"
  | "blocked_awaiting_reviewer";

export type ApprovalTaskStatus = "pending_approval" | "approved" | "rejected" | "auto_approved";

/** Row shape of public.approval_tasks (Sprint 25, Vol 13_1 §6). */
export interface ApprovalTaskRow {
  id: string;
  business_id: string;
  domain: Domain;
  subject_type: string;
  subject_id: string;
  amount: number | null;
  ai_draft_summary: string | null;
  ai_confidence: number | null;
  captured_by_membership_id: string | null;
  assigned_membership_id: string | null;
  resolved_via: ResolvedVia;
  delegated_from_membership_id: string | null;
  status: ApprovalTaskStatus;
  decided_by_membership_id: string | null;
  decided_at: string | null;
  next_action: string | null;
  self_approved_via_escape_valve: boolean;
  created_at: string;
}

export interface ApprovalTask {
  id: string;
  businessId: string;
  domain: Domain;
  subjectType: string;
  subjectId: string;
  amount: number | null;
  aiDraftSummary: string | null;
  aiConfidence: number | null;
  capturedByMembershipId: string | null;
  assignedMembershipId: string | null;
  resolvedVia: ResolvedVia;
  delegatedFromMembershipId: string | null;
  status: ApprovalTaskStatus;
  decidedByMembershipId: string | null;
  decidedAt: string | null;
  /** A human-readable explanation — populated when resolvedVia is `blocked_awaiting_reviewer` (Vol 13_2 §4.3's escape valve, disabled). */
  nextAction: string | null;
  /** Vol 13_2 §5 — true only when the escape valve mechanism itself is what let the capturer approve their own task; never true for an ordinary below-threshold or no-policy self-approval. */
  selfApprovedViaEscapeValve: boolean;
  createdAt: string;
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

/** Row shape of public.approval_delegations (Sprint 25, Vol 13_1 §5). */
export interface ApprovalDelegationRow {
  id: string;
  business_id: string;
  delegator_membership_id: string;
  delegate_membership_id: string;
  domain_scope: Domain | null;
  starts_at: string;
  ends_at: string | null;
  reason: string | null;
  created_by_membership_id: string;
  status: "active" | "expired" | "revoked";
}

export interface ApprovalDelegation {
  id: string;
  businessId: string;
  delegatorMembershipId: string;
  delegateMembershipId: string;
  /** null = every domain the delegator can approve (Vol 13_1 §5 — narrowing-only, never widens the delegator's own grants). */
  domainScope: Domain | null;
  startsAt: string;
  endsAt: string | null;
  reason: string | null;
  createdByMembershipId: string;
  status: "active" | "expired" | "revoked";
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

/** Row shape of public.segregation_of_duties_policies (Sprint 25, Vol 13_2 §4.3). */
export interface SegregationOfDutiesPolicyRow {
  business_id: string;
  domain: Domain;
  enforce_maker_checker: boolean;
  amount_threshold_myr: number | null;
  allow_self_approval_if_sole_eligible: boolean;
}

export interface SegregationOfDutiesPolicy {
  businessId: string;
  domain: Domain;
  enforceMakerChecker: boolean;
  amountThresholdMyr: number | null;
  allowSelfApprovalIfSoleEligible: boolean;
}

function toSegregationOfDutiesPolicy(row: SegregationOfDutiesPolicyRow): SegregationOfDutiesPolicy {
  return {
    businessId: row.business_id,
    domain: row.domain,
    enforceMakerChecker: row.enforce_maker_checker,
    amountThresholdMyr: row.amount_threshold_myr,
    allowSelfApprovalIfSoleEligible: row.allow_self_approval_if_sole_eligible,
  };
}

/**
 * Approval-engine + capture-gate + delegation + SoD-policy RPC glue,
 * shared between platforms.
 */
export interface SupabaseApprovalEngineTransport {
  /** Vol 13_2 §3 — call BEFORE handing captured input to the AI pipeline. Resolves the caller's own active membership internally; throws a specific error (never a swallowed rejection) when the mapped domain has no `capture` grant, or when domain_hint maps to nothing (`unclassified`). Returns the caller's membership id to stamp onto the BusinessEvent/envelope on success. */
  checkCapturePermission(businessId: string, domainHint: DomainHint): Promise<string>;

  /**
   * Vol 13_1 §6.1's full resolution algorithm runs synchronously inside
   * this call. `autoApproved` is Vol 13_0 §3.3's existing AI-confidence
   * shortcut (Vol 13_1 §6.1 Step 5) — the server hard-bars this for
   * `domain: 'payroll'` unconditionally (Vol 13_0 §10), regardless of
   * what this flag is set to, so callers do not need to re-implement
   * that guard client-side (though they should still never pass true
   * for payroll — the rejection is a backstop, not the primary check).
   */
  createApprovalTask(params: {
    businessId: string;
    domain: Domain;
    subjectType: string;
    subjectId: string;
    amount: number | null;
    aiDraftSummary: string | null;
    aiConfidence: number | null;
    capturedByMembershipId: string | null;
    autoApproved?: boolean;
  }): Promise<ApprovalTask>;

  /** The assigned member decides, or — for an open shared queue (`assignedMembershipId` is null) — any currently-eligible member; first to act wins, a losing racer gets a clear "already actioned" rejection. */
  decideApprovalTask(taskId: string, decision: "approved" | "rejected"): Promise<ApprovalTask>;

  /** Vol 13_1 §5. Self-service for one's own membership; `configure` on `settings` required to delegate someone else's authority (e.g. an Owner arranging cover for a Bookkeeper's leave). Re-runs resolution on every affected still-pending task. */
  createApprovalDelegation(params: {
    businessId: string;
    delegatorMembershipId: string;
    delegateMembershipId: string;
    domainScope: Domain | null;
    startsAt?: string;
    endsAt?: string | null;
    reason?: string | null;
  }): Promise<ApprovalDelegation>;

  /** Self-service for one's own delegation, or `configure` on `settings`. Re-runs resolution on every affected still-pending task (Vol 13_1 §6.1: "re-run if it is still pending_approval when a relevant ApprovalDelegation starts or ends"). */
  revokeApprovalDelegation(delegationId: string): Promise<ApprovalDelegation>;

  /** Vol 13_2 §4.3 — owner-adjustable (`configure` on `settings`). Businesses get sensible defaults seeded automatically the first time they cross into team mode (Vol 13_3 §4's growth trigger); this is how an Owner changes them afterward. */
  setSegregationOfDutiesPolicy(params: {
    businessId: string;
    domain: Domain;
    enforceMakerChecker: boolean;
    amountThresholdMyr: number | null;
    allowSelfApprovalIfSoleEligible: boolean;
  }): Promise<SegregationOfDutiesPolicy>;
}

export function createSupabaseApprovalEngineTransport(
  client: SupabaseClientLike,
): SupabaseApprovalEngineTransport {
  return {
    async checkCapturePermission(businessId, domainHint) {
      const { data, error } = await client.rpc("check_capture_permission", {
        p_business_id: businessId,
        p_domain_hint: domainHint,
      });
      if (error) throw error;
      return data as string;
    },

    async createApprovalTask(params) {
      const { data, error } = await client.rpc("create_approval_task", {
        p_business_id: params.businessId,
        p_domain: params.domain,
        p_subject_type: params.subjectType,
        p_subject_id: params.subjectId,
        p_amount: params.amount,
        p_ai_draft_summary: params.aiDraftSummary,
        p_ai_confidence: params.aiConfidence,
        p_captured_by_membership_id: params.capturedByMembershipId,
        p_auto_approved: params.autoApproved ?? false,
      });
      if (error) throw error;
      return toApprovalTask(data as ApprovalTaskRow);
    },

    async decideApprovalTask(taskId, decision) {
      const { data, error } = await client.rpc("decide_approval_task", {
        p_task_id: taskId,
        p_decision: decision,
      });
      if (error) throw error;
      return toApprovalTask(data as ApprovalTaskRow);
    },

    async createApprovalDelegation(params) {
      const { data, error } = await client.rpc("create_approval_delegation", {
        p_business_id: params.businessId,
        p_delegator_membership_id: params.delegatorMembershipId,
        p_delegate_membership_id: params.delegateMembershipId,
        p_domain_scope: params.domainScope,
        p_starts_at: params.startsAt ?? null,
        p_ends_at: params.endsAt ?? null,
        p_reason: params.reason ?? null,
      });
      if (error) throw error;
      return toApprovalDelegation(data as ApprovalDelegationRow);
    },

    async revokeApprovalDelegation(delegationId) {
      const { data, error } = await client.rpc("revoke_approval_delegation", {
        p_delegation_id: delegationId,
      });
      if (error) throw error;
      return toApprovalDelegation(data as ApprovalDelegationRow);
    },

    async setSegregationOfDutiesPolicy(params) {
      const { data, error } = await client.rpc("set_sod_policy", {
        p_business_id: params.businessId,
        p_domain: params.domain,
        p_enforce_maker_checker: params.enforceMakerChecker,
        p_amount_threshold_myr: params.amountThresholdMyr,
        p_allow_self_approval_if_sole_eligible: params.allowSelfApprovalIfSoleEligible,
      });
      if (error) throw error;
      return toSegregationOfDutiesPolicy(data as SegregationOfDutiesPolicyRow);
    },
  };
}
