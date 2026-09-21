/**
 * Membership/role read helpers — Sprint 38 (Vol 13_1 §4, Vol 12_2 §4.2's
 * Team section).
 *
 * No RPC in this codebase lists members, roles, or a role's granted
 * domains (`teamMembershipTransport.ts` only exposes the mutating
 * lifecycle calls -- invite/accept/suspend/remove/setMemberLabel --
 * plus the business-wide `getEffectiveAccessModel`). These reads go
 * directly against the underlying tables instead, exactly the pattern
 * `getAllDevices` (packages/core/src/sync/supabaseTransport.ts) already
 * established for the Devices panel -- RLS (Sprint 23's migration,
 * `app/backend/schema.sql`) already scopes every one of these selects
 * correctly:
 *   - `roles` / `role_permissions`: system templates are visible to any
 *     authenticated user, a business's own custom roles/grants are
 *     visible to that business's active members only.
 *   - `business_memberships`: visible to any active member of the same
 *     business (not just their own row) -- Members & Roles page UI
 *     narrows a non-Owner's VIEW to their own row on top of this, since
 *     Vol 12_2 §4.2 draws that line at the UI/product level, not RLS.
 *
 * MEMBER IDENTITY (Sprint 50 — closes this file's own former DISCLOSED
 * GAP): plain RLS still can't give a non-self caller another member's
 * name (`public.profiles` only lets a user read their OWN row), so
 * `listMemberIdentities` below wraps the new `list_member_identities`
 * SECURITY DEFINER RPC (mirrors `is_active_member`'s own gating
 * pattern) instead of a direct `.from(...)` select.
 *
 * `setMyDisplayName` also wraps an RPC (`set_my_display_name`), NOT a
 * direct table write, despite `profiles` having its own "view/update/
 * insert own row" RLS policies that would appear to cover this --
 * confirmed live (Sprint 50) that those RLS policies were never backed
 * by the matching table-level GRANT: `00000000000001_grant_authenticated_
 * select.sql` deliberately grants `authenticated` SELECT only, on the
 * documented assumption that "every write path" in this schema goes
 * through a SECURITY DEFINER RPC (that migration's own words) -- Postgres
 * enforces GRANTs and RLS as two independent layers, so a correct RLS
 * policy with no GRANT still fails closed with `permission denied`. A
 * direct `.from("profiles").upsert(...)` here would have been the first
 * plain client-side table WRITE anywhere in this codebase, breaking that
 * established convention; `set_my_display_name` keeps it consistent with
 * every other mutation (invite/suspend/remove/setMemberLabel etc).
 *
 * `describeMembership` keeps its short-id fallback only for a member
 * whose name genuinely isn't set yet anywhere (own name never set, no
 * Owner label, invite already accepted) -- callers that have already
 * loaded `listMemberIdentities` should prefer that resolved name over
 * calling `describeMembership` blind.
 */
import { supabase } from "./supabaseClient";
import type { Domain } from "@aifa/core/sync/approvalEngineTransport";
import type { BusinessMembership, BusinessMembershipRow } from "@aifa/core/sync/teamMembershipTransport";

/** Fixed, well-known Owner role id -- same constant the schema itself
 * seeds and pins (see app/backend/schema.sql's own comment on why it
 * must be a literal, not a lookup). */
export const OWNER_ROLE_ID = "00000000-0000-0000-0000-000000000001";

export interface RoleSummary {
  id: string;
  name: string;
  businessId: string | null;
  isSystemTemplate: boolean;
  description: string | null;
  defaultApprovalLimitMyr: number | null;
}

interface RoleRow {
  id: string;
  name: string;
  business_id: string | null;
  is_system_template: boolean;
  description: string | null;
  default_approval_limit_myr: number | null;
}

function toRoleSummary(row: RoleRow): RoleSummary {
  return {
    id: row.id,
    name: row.name,
    businessId: row.business_id,
    isSystemTemplate: row.is_system_template,
    description: row.description,
    defaultApprovalLimitMyr: row.default_approval_limit_myr,
  };
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

/** Every role visible to the current user for this business -- the six
 * system templates plus this business's own custom roles, per the RLS
 * policies described in this file's own header. */
export async function listRoles(): Promise<RoleSummary[]> {
  const { data, error } = await supabase.from("roles").select("*").order("name");
  if (error) throw error;
  return (data as RoleRow[]).map(toRoleSummary);
}

/** Every membership row for this business the current user can see
 * (RLS: any active member, all statuses). */
export async function listMemberships(businessId: string): Promise<BusinessMembership[]> {
  const { data, error } = await supabase
    .from("business_memberships")
    .select("*")
    .eq("business_id", businessId)
    .order("invited_at", { ascending: true });
  if (error) throw error;
  return (data as BusinessMembershipRow[]).map(toBusinessMembership);
}

/** The signed-in user's own active membership for this business, or
 * null if none (should not normally happen once past DeviceSetupScreen,
 * but the dev-bypass business id path, App.tsx's onDevBypass, has no
 * real membership row at all -- callers treat null as "solo/Owner-like,
 * unrestricted" rather than failing). */
export async function getMyActiveMembership(
  businessId: string,
  userId: string,
): Promise<BusinessMembership | null> {
  const { data, error } = await supabase
    .from("business_memberships")
    .select("*")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data ? toBusinessMembership(data as BusinessMembershipRow) : null;
}

/** Every domain a role has at least one capability grant in (view,
 * capture, approve, or configure) -- Vol 12_2 §4.4 only needs "is this
 * domain visible at all", not which capability; each page's own actions
 * still enforce the finer-grained capability server-side via the
 * existing RPCs (Vol 13_2). */
export async function getGrantedDomainsForRole(roleId: string): Promise<Set<Domain>> {
  const { data, error } = await supabase
    .from("role_permissions")
    .select("domain")
    .eq("role_id", roleId);
  if (error) throw error;
  return new Set((data as { domain: Domain }[]).map((r) => r.domain));
}

/** Every capability a role has been granted for one specific domain --
 * finer-grained than `getGrantedDomainsForRole` (which only answers "is
 * this domain visible at all"). Added Sprint 45 for Payroll's own
 * stricter-than-backend UI gate: several payroll RPCs only require
 * `view`, but this sprint deliberately gates rendering of an Employee
 * Profile's decrypted sensitive fields (and the bulk payment file
 * export, which also decrypts a bank account number) behind `configure`
 * client-side -- see PayrollPage.tsx's own header for the full
 * reasoning. Same RLS-readable `role_permissions` table as
 * `getGrantedDomainsForRole`, just narrowed to one domain and returning
 * the capability set instead of a boolean. */
export async function getGrantedCapabilitiesForDomain(roleId: string, domain: Domain): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("role_permissions")
    .select("capability")
    .eq("role_id", roleId)
    .eq("domain", domain);
  if (error) throw error;
  return new Set((data as { capability: string }[]).map((r) => r.capability));
}

/** Best-effort display label for a membership row when no resolved
 * identity (from `listMemberIdentities`) is available -- e.g. before
 * that call has loaded, or for a member whose name genuinely isn't set
 * anywhere yet (no Owner label, own display_name never set, invite
 * already accepted so invitedEmail no longer applies). Prefer the
 * resolved name from `listMemberIdentities` over this when you have
 * it. */
export function describeMembership(membership: BusinessMembership): string {
  if (membership.ownerLabel) {
    return membership.ownerLabel;
  }
  if (membership.status === "invited" && membership.invitedEmail) {
    return `${membership.invitedEmail} (invited)`;
  }
  return `Member #${membership.id.slice(0, 8)}`;
}

/** Every member's resolved display name for this business -- Sprint 50,
 * wraps `list_member_identities` (SECURITY DEFINER; gated the same way
 * `is_active_member` gates every other membership read). Resolution
 * order server-side: Owner's per-member label, then that member's own
 * `profiles.display_name`, then (for a still-pending invite only) the
 * invited email -- an accepted member with neither a label nor a
 * self-set name resolves to `null`, which callers should fall back to
 * `describeMembership`'s short-id label for. */
export async function listMemberIdentities(businessId: string): Promise<Map<string, string | null>> {
  const { data, error } = await supabase.rpc("list_member_identities", { p_business_id: businessId });
  if (error) throw error;
  const rows = data as Array<{ membership_id: string; display_name: string | null }>;
  return new Map(rows.map((r) => [r.membership_id, r.display_name]));
}

/** Sets the CALLER's own display name via `set_my_display_name` --
 * SECURITY DEFINER, self-service only (uses auth.uid() server-side, no
 * target user id accepted) -- see this file's header for why this is an
 * RPC rather than a direct table write. No profiles row is auto-created
 * on signup (see auth.ts/deviceBootstrap.ts -- neither ever inserts
 * one), so the RPC upserts rather than assuming one exists. */
export async function setMyDisplayName(displayName: string): Promise<void> {
  const trimmed = displayName.trim();
  const { error } = await supabase.rpc("set_my_display_name", {
    p_display_name: trimmed === "" ? null : trimmed,
  });
  if (error) throw error;
}
