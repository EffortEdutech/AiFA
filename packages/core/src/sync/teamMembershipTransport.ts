/**
 * Team-membership / growth-adaptive-access-model RPC glue — Sprint 24
 * (Vol 13_1 §4 Membership; Vol 13_3 full — Growth-Adaptive Access Model).
 *
 * Mirrors `createSupabaseDevicesTransport`'s shape in this same directory
 * (Sprint 19's own established pattern: one object per platform to
 * construct/re-export, injected `SupabaseClientLike` rather than the real
 * `SupabaseClient` type — see that file's header comment for why).
 *
 * Scope note (Sprint 24): this file is the shared, single source of
 * truth for computing `effectiveAccessModel` — the DoD's own risk
 * register asks for exactly this ("Implement as a single shared
 * function in @aifa/core, called everywhere this matters... never
 * re-derived ad hoc per call site"). It does NOT include the Team/
 * Roles/Approvals screen visibility wiring Sprint 24's "UX Consequence"
 * task also names — no such screens exist yet anywhere in app/src or
 * web/src (Sprint 23 built no UI at all, deliberately; Sprint 24's own
 * lifecycle work is backend-first for the same reason). That wiring
 * belongs to whichever future sprint actually builds those screens; the
 * function this file exports is what that sprint should call to decide
 * visibility, rather than re-deriving the solo/team check itself.
 *
 * `effectiveAccessModel` is deliberately NEVER cached on the client —
 * every call re-reads it from the backend RPC (which itself never
 * caches, per Vol 13_3 §2: "computed, never stored as the primary
 * source of truth"). A caller that needs it repeatedly in one render
 * pass should call it once and pass the result down, not memoize it
 * across time — membership count can change from another device at any
 * moment.
 */

/** See supabaseTransport.ts's own header comment for why this exists instead of importing `SupabaseClient` from `@supabase/supabase-js` directly. */
export interface SupabaseClientLike {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export type EffectiveAccessModel = "solo" | "team";
export type AccessModelOverride = "forced_solo" | "forced_team" | null;

/** Row shape of public.businesses (Vol 13_1 §2; ssm_registration_number added Vol 13_4). */
export interface BusinessRow {
  id: string;
  owner_user_id: string;
  legal_name: string | null;
  industry: string | null;
  ssm_registration_number: string | null;
  pka_version: string | null;
  created_at: string;
}

export interface Business {
  id: string;
  ownerUserId: string;
  legalName: string | null;
  industry: string | null;
  ssmRegistrationNumber: string | null;
  pkaVersion: string | null;
  createdAt: string;
}

function toBusiness(row: BusinessRow): Business {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    legalName: row.legal_name,
    industry: row.industry,
    ssmRegistrationNumber: row.ssm_registration_number,
    pkaVersion: row.pka_version,
    createdAt: row.created_at,
  };
}

/** Row shape returned by public.list_my_businesses() (Sprint 63, Architecture §2.1 —
 * docs/aifa-platform/Architecture.md). One row per Client Business the calling
 * login has an ACTIVE business_membership in. */
export interface MyBusinessRow {
  business_id: string;
  legal_name: string | null;
  role_id: string;
  membership_status: "invited" | "active" | "suspended" | "removed";
}

export interface MyBusinessSummary {
  businessId: string;
  legalName: string | null;
  roleId: string;
  membershipStatus: "invited" | "active" | "suspended" | "removed";
}

function toMyBusinessSummary(row: MyBusinessRow): MyBusinessSummary {
  return {
    businessId: row.business_id,
    legalName: row.legal_name,
    roleId: row.role_id,
    membershipStatus: row.membership_status,
  };
}

/** Row shape of public.business_memberships (Sprint 23/24, Vol 13_1 §4). */
export interface BusinessMembershipRow {
  id: string;
  business_id: string;
  user_id: string | null;
  role_id: string;
  party_id: string | null;
  approval_limit_myr: number | null;
  status: "invited" | "active" | "suspended" | "removed";
  invited_by_membership_id: string | null;
  invited_at: string;
  accepted_at: string | null;
  removed_at: string | null;
  invited_email: string | null;
  /** Owner-set per-business override/nickname (Sprint 50, member identity) — see set_member_label(). Independent of the member's own profiles.display_name. */
  owner_label: string | null;
}

export interface BusinessMembership {
  id: string;
  businessId: string;
  userId: string | null;
  roleId: string;
  partyId: string | null;
  approvalLimitMyr: number | null;
  status: "invited" | "active" | "suspended" | "removed";
  invitedByMembershipId: string | null;
  invitedAt: string;
  acceptedAt: string | null;
  removedAt: string | null;
  invitedEmail: string | null;
  ownerLabel: string | null;
}

function toBusinessMembership(row: BusinessMembershipRow): BusinessMembership {
  return {
    id: row.id,
    businessId: row.business_id,
    userId: row.user_id,
    roleId: row.role_id,
    partyId: row.party_id,
    approvalLimitMyr: row.approval_limit_myr,
    status: row.status,
    invitedByMembershipId: row.invited_by_membership_id,
    invitedAt: row.invited_at,
    acceptedAt: row.accepted_at,
    removedAt: row.removed_at,
    invitedEmail: row.invited_email,
    ownerLabel: row.owner_label,
  };
}

/**
 * Team-membership lifecycle + growth-adaptive access model RPC glue,
 * shared between platforms — everything Sprint 24 added on top of
 * Sprint 23's schema.
 */
export interface SupabaseTeamMembershipTransport {
  /** Vol 13_3 §2 — always resolves to exactly 'solo' or 'team', never a raw override string (Section 2 of this sprint's migration normalizes this server-side; do not re-derive from access_model_override on the client). */
  getEffectiveAccessModel(businessId: string): Promise<EffectiveAccessModel>;
  /** Vol 13_3 §7 — `configure` on `settings`-gated server-side; pass null to clear back to auto-detect. */
  setAccessModelOverride(
    businessId: string,
    override: AccessModelOverride,
  ): Promise<{ accessModelOverride: AccessModelOverride }>;
  /** Vol 13_4 §2, revised Sprint 63 (Architecture §2.2) — creates a new Client
   * Business for the caller (fresh, independently-generated `id`; one Owner
   * membership created in the same call). The one-login-owns-at-most-one-
   * business guard is REMOVED as of Sprint 63: the same login may call this
   * more than once, ending up with an Owner membership in each resulting
   * business. Pre-Sprint-63 businesses keep their existing `id` (which
   * happens to equal their owner's `auth.uid()`) unchanged. */
  createBusiness(
    legalName: string,
    industry?: string | null,
    ssmRegistrationNumber?: string | null,
  ): Promise<Business>;
  /** Sprint 63 (Architecture §2.1) — every Client Business the calling login
   * has an ACTIVE business_membership in, for Workspace Resolution on
   * sign-in: zero rows means no business yet (route to BusinessCreatePage or
   * an invite-acceptance screen), one row auto-selects, more than one offers
   * the Workspace Switcher. */
  listMyBusinesses(): Promise<MyBusinessSummary[]>;
  /** Vol 13_1 §4, Vol 13_3 §4 — role is assigned at invite time, never deferred to acceptance. `configure` on `settings`-gated. */
  inviteMember(
    businessId: string,
    invitedEmail: string,
    roleId: string,
  ): Promise<BusinessMembership>;
  /** Caller must already be signed in as the invited person (their own auth session's email is matched server-side against the pending invite) — this takes no separate token/secret, per Sprint 24's own "minimal viable channel" scope. */
  acceptMembershipInvitation(businessId: string): Promise<BusinessMembership>;
  /** Self-service for one's own membership; `configure` on `settings` required to suspend someone else's. Blocked at the operation level (a clear error, not just the DB trigger) if the target is the business's sole active Owner. */
  suspendMembership(targetMembershipId: string): Promise<BusinessMembership>;
  /** Always requires `configure` on `settings` (no self-service removal — Vol 13_1 does not describe a "leave this business" flow, only an administrative one). Blocked at the operation level if the target is the sole active Owner. Auto-revokes every device the removed membership held. */
  removeMembership(targetMembershipId: string): Promise<BusinessMembership>;
  /** Member identity (Sprint 50) — `configure` on `settings` required, same gate `inviteMember` uses. Sets/clears this membership's Owner-assigned label, which takes priority over the member's own `profiles.display_name` when resolving a display name (see `list_member_identities`). Pass null/empty to clear back to the member's own name. */
  setMemberLabel(targetMembershipId: string, label: string | null): Promise<BusinessMembership>;
}

export function createSupabaseTeamMembershipTransport(
  client: SupabaseClientLike,
): SupabaseTeamMembershipTransport {
  return {
    async createBusiness(legalName, industry, ssmRegistrationNumber) {
      const { data, error } = await client.rpc("create_business", {
        p_legal_name: legalName,
        p_industry: industry ?? null,
        p_ssm_registration_number: ssmRegistrationNumber ?? null,
      });
      if (error) throw error;
      return toBusiness(data as BusinessRow);
    },

    async listMyBusinesses() {
      const { data, error } = await client.rpc("list_my_businesses");
      if (error) throw error;
      return (data as MyBusinessRow[]).map(toMyBusinessSummary);
    },

    async getEffectiveAccessModel(businessId) {
      const { data, error } = await client.rpc("effective_access_model", {
        p_business_id: businessId,
      });
      if (error) throw error;
      return data as EffectiveAccessModel;
    },

    async setAccessModelOverride(businessId, override) {
      const { data, error } = await client.rpc("set_access_model_override", {
        p_business_id: businessId,
        p_override: override,
      });
      if (error) throw error;
      const row = data as { access_model_override: AccessModelOverride };
      return { accessModelOverride: row.access_model_override };
    },

    async inviteMember(businessId, invitedEmail, roleId) {
      const { data, error } = await client.rpc("invite_member", {
        p_business_id: businessId,
        p_invited_email: invitedEmail,
        p_role_id: roleId,
      });
      if (error) throw error;
      return toBusinessMembership(data as BusinessMembershipRow);
    },

    async acceptMembershipInvitation(businessId) {
      const { data, error } = await client.rpc("accept_membership_invitation", {
        p_business_id: businessId,
      });
      if (error) throw error;
      return toBusinessMembership(data as BusinessMembershipRow);
    },

    async suspendMembership(targetMembershipId) {
      const { data, error } = await client.rpc("suspend_membership", {
        p_target_membership_id: targetMembershipId,
      });
      if (error) throw error;
      return toBusinessMembership(data as BusinessMembershipRow);
    },

    async removeMembership(targetMembershipId) {
      const { data, error } = await client.rpc("remove_membership", {
        p_target_membership_id: targetMembershipId,
      });
      if (error) throw error;
      return toBusinessMembership(data as BusinessMembershipRow);
    },

    async setMemberLabel(targetMembershipId, label) {
      const { data, error } = await client.rpc("set_member_label", {
        p_membership_id: targetMembershipId,
        p_label: label,
      });
      if (error) throw error;
      return toBusinessMembership(data as BusinessMembershipRow);
    },
  };
}
