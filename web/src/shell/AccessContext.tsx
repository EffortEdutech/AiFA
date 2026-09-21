/**
 * Role-based sidebar visibility engine — Sprint 37 (Vol 12_2 §4.4),
 * wired to real per-membership data in Sprint 38.
 *
 * Sprint 37 shipped this engine against a dev-only stub because no
 * queryable source for a membership's granted domains was known to
 * exist yet. Sprint 38's own Team/Roles work (Vol 13_1 §4) surfaced
 * that `public.roles` / `public.role_permissions` are both real,
 * RLS-readable tables (see `web/src/lib/membership.ts`'s own header for
 * the full RLS reasoning) — so this context now computes real
 * visibility from the signed-in user's own active membership's role
 * grants, not a stub. Solo mode's "always fully visible" guarantee
 * (Vol 13_3 §2) still holds unconditionally and independently of that
 * lookup, as a belt-and-braces default — the Owner system role already
 * has every domain/capability granted at the data level (see the
 * schema's own seed), so in practice the two paths agree for a solo
 * business; the explicit `accessModel === "solo"` short-circuit is kept
 * so visibility is never accidentally wrong for the common case even if
 * the membership/role lookup is still loading or fails.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { Domain } from "@aifa/core/sync/approvalEngineTransport";
import type { EffectiveAccessModel } from "@aifa/core/sync/teamMembershipTransport";
import type { BusinessMembership } from "@aifa/core/sync/teamMembershipTransport";

import { OWNER_ROLE_ID, getGrantedDomainsForRole, getMyActiveMembership } from "../lib/membership";

export type VisibleDomains = "all" | ReadonlySet<Domain>;

interface AccessContextValue {
  accessModel: EffectiveAccessModel;
  /** The signed-in user's own active membership for this business, or
   * null while loading / for the dev-bypass path (see membership.ts's
   * own note — treated as unrestricted, not an error). */
  myMembership: BusinessMembership | null;
  /** False until the membership lookup has resolved at least once (or
   * there is no userId at all, e.g. still loading). Callers that gate
   * Owner-only UI on `isOwner` should also check this to avoid a brief
   * flash of Owner-level controls before a real restricted membership
   * loads -- the underlying write RPCs are server-gated regardless, but
   * the UI shouldn't visibly flicker. */
  membershipChecked: boolean;
  isOwner: boolean;
  visibleDomains: VisibleDomains;
  isDomainVisible: (domain: Domain | null) => boolean;
  /** Dev-only escape hatch, unchanged from Sprint 37 — lets a developer
   * override the computed set to prove the hiding behaviour itself
   * works, independent of what real membership data is loaded. Never
   * shown or reachable outside `import.meta.env.DEV`. */
  setVisibleDomainsForTesting: (domains: VisibleDomains) => void;
}

const AccessContext = createContext<AccessContextValue | null>(null);

export function AccessProvider({
  accessModel,
  businessId,
  userId,
  children,
}: {
  accessModel: EffectiveAccessModel;
  businessId: string;
  userId: string | null;
  children: ReactNode;
}): JSX.Element {
  const [myMembership, setMyMembership] = useState<BusinessMembership | null>(null);
  const [membershipChecked, setMembershipChecked] = useState(false);
  const [grantedDomains, setGrantedDomains] = useState<VisibleDomains>("all");
  const [testOverride, setTestOverride] = useState<VisibleDomains | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getMyActiveMembership(businessId, userId)
      .then(async (membership) => {
        if (cancelled) return;
        setMyMembership(membership);
        if (!membership) {
          if (!cancelled) setMembershipChecked(true);
          return; // dev-bypass path — stay "all" (unrestricted).
        }
        const domains = await getGrantedDomainsForRole(membership.roleId);
        if (!cancelled) {
          setGrantedDomains(domains);
          setMembershipChecked(true);
        }
      })
      .catch(() => {
        // Best-effort — "all" (the permissive default) never wrongly
        // hides a sidebar item that should be visible.
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, userId]);

  const value = useMemo<AccessContextValue>(() => {
    const effectiveVisible = testOverride ?? grantedDomains;
    function isDomainVisible(domain: Domain | null): boolean {
      if (domain === null) return true;
      if (accessModel === "solo") return true; // Vol 13_3 §2 — never restricted.
      if (effectiveVisible === "all") return true;
      return effectiveVisible.has(domain);
    }
    return {
      accessModel,
      myMembership,
      membershipChecked,
      isOwner: myMembership === null || myMembership.roleId === OWNER_ROLE_ID,
      visibleDomains: effectiveVisible,
      isDomainVisible,
      setVisibleDomainsForTesting: setTestOverride,
    };
  }, [accessModel, myMembership, membershipChecked, grantedDomains, testOverride]);

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): AccessContextValue {
  const ctx = useContext(AccessContext);
  if (!ctx) throw new Error("useAccess must be used within an AccessProvider");
  return ctx;
}
