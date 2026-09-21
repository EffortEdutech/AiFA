/**
 * Approvals inbox — Sprint 38 (Vol 12_2 §5.3), the single shared
 * implementation every future module page's "view pending approval"
 * link routes into (Vol 12_2 §5.3's own rule — no module sprint builds
 * its own mini-approval-list).
 *
 * Generic, `subjectType`-keyed rendering: no module beyond Team/Devices
 * exists yet in this frontend (Sprint 39 onward build them), so
 * `describeSubject` below has one fallback case today and a clear
 * extension point — each later module sprint adds its own case rather
 * than rebuilding this page.
 *
 * DELEGATION CREATION (Sprint 48 — closes Sprint 38's own "Safe to
 * Carry Over" item): `createApprovalDelegation` was always a real RPC
 * (Vol 13_1 §5) but this page only ever offered view/revoke. Adds a
 * "My Delegations" tab: self-service delegation of one's OWN authority
 * needs no extra gate (the RPC's own header says so); delegating
 * someone ELSE's authority (an Owner arranging cover) is only offered
 * when the caller holds `configure` on `settings`
 * (`getGrantedCapabilitiesForDomain`, same pattern as every other
 * Sprint 45-48 gated action) — solo/null-membership unrestricted.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabaseApprovalEngineTransport } from "@aifa/core/sync/approvalEngineTransport";
import type { ApprovalTask, ApprovalDelegation, Domain } from "@aifa/core/sync/approvalEngineTransport";
import type { BusinessMembership } from "@aifa/core/sync/teamMembershipTransport";

import { supabase } from "../../lib/supabaseClient";
import { listApprovalTasks, listApprovalDelegations } from "../../lib/approvals";
import { listMemberships, getGrantedCapabilitiesForDomain } from "../../lib/membership";
import { useAccess } from "../AccessContext";
import { TabStrip } from "../TabStrip";

const approvalEngineTransport = createSupabaseApprovalEngineTransport(supabase);

const DOMAIN_OPTIONS: Domain[] = [
  "sales", "pricing", "expense", "inventory", "accounting_reports", "tax_compliance",
  "payroll", "hr_attendance_leave", "commission", "legal_contract", "settings",
];

type ApprovalTab = "my-pending" | "delegated-to-me" | "all" | "history" | "my-delegations";

interface Props {
  businessId: string;
}

function describeSubject(task: ApprovalTask): string {
  // Extension point for Sprint 39+ (Vol 12_2 §5.3's own note) — add a
  // case per subject_type as each module ships its own capture flow.
  // Sprint 40 adds the two sales-cycle subject types it introduces;
  // resolving the quotation/credit-note number itself would mean this
  // shared inbox depending on every module's own lib helpers, so it
  // stays at "kind + short id" the same as the fallback case, just
  // with a friendlier label.
  switch (task.subjectType) {
    case "quotation":
      return `Quotation #${task.subjectId.slice(0, 8)}`;
    case "credit_note":
      return `Credit Note #${task.subjectId.slice(0, 8)}`;
    case "payment_voucher":
      return `Payment Voucher #${task.subjectId.slice(0, 8)}`;
    case "delivery_order":
      return `Delivery Order #${task.subjectId.slice(0, 8)}`;
    default:
      return `${task.subjectType} #${task.subjectId.slice(0, 8)}`;
  }
}

export function ApprovalsPage({ businessId }: Props): JSX.Element {
  const { myMembership, accessModel } = useAccess();

  const [tab, setTab] = useState<ApprovalTab>("my-pending");
  const [tasks, setTasks] = useState<ApprovalTask[] | null>(null);
  const [delegations, setDelegations] = useState<ApprovalDelegation[] | null>(null);
  const [memberships, setMemberships] = useState<BusinessMembership[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [canDelegateOthers, setCanDelegateOthers] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (accessModel === "solo" || myMembership === null) {
      setCanDelegateOthers(true);
      return;
    }
    getGrantedCapabilitiesForDomain(myMembership.roleId, "settings")
      .then((caps) => {
        if (!cancelled) setCanDelegateOthers(caps.has("configure"));
      })
      .catch(() => {
        if (!cancelled) setCanDelegateOthers(false); // fail closed
      });
    return () => {
      cancelled = true;
    };
  }, [accessModel, myMembership]);

  const [delegatorMembershipId, setDelegatorMembershipId] = useState("");
  const [delegateMembershipId, setDelegateMembershipId] = useState("");
  const [domainScope, setDomainScope] = useState<Domain | "">("");
  const [delegationReason, setDelegationReason] = useState("");
  const [delegationEndsAt, setDelegationEndsAt] = useState("");
  const [createDelegationBusy, setCreateDelegationBusy] = useState(false);
  const [createDelegationError, setCreateDelegationError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [allTasks, allDelegations, allMemberships] = await Promise.all([
        listApprovalTasks(businessId),
        listApprovalDelegations(businessId),
        listMemberships(businessId),
      ]);
      setTasks(allTasks);
      setDelegations(allDelegations);
      setMemberships(allMemberships);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load approvals.");
    }
  }, [businessId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  useEffect(() => {
    if (myMembership && !delegatorMembershipId) setDelegatorMembershipId(myMembership.id);
  }, [myMembership, delegatorMembershipId]);

  async function handleCreateDelegation(): Promise<void> {
    if (!delegatorMembershipId || !delegateMembershipId) return;
    setCreateDelegationBusy(true);
    setCreateDelegationError(null);
    try {
      await approvalEngineTransport.createApprovalDelegation({
        businessId,
        delegatorMembershipId,
        delegateMembershipId,
        domainScope: domainScope || null,
        endsAt: delegationEndsAt.trim() || null,
        reason: delegationReason.trim() || null,
      });
      setDelegateMembershipId("");
      setDomainScope("");
      setDelegationReason("");
      setDelegationEndsAt("");
      await load();
    } catch (err) {
      setCreateDelegationError(err instanceof Error ? err.message : "Could not create this delegation.");
    } finally {
      setCreateDelegationBusy(false);
    }
  }

  async function handleDecide(taskId: string, decision: "approved" | "rejected"): Promise<void> {
    setBusyTaskId(taskId);
    setActionError(null);
    try {
      await approvalEngineTransport.decideApprovalTask(taskId, decision);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That decision could not be recorded.");
    } finally {
      setBusyTaskId(null);
    }
  }

  async function handleRevokeDelegation(id: string): Promise<void> {
    setActionError(null);
    try {
      await approvalEngineTransport.revokeApprovalDelegation(id);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That delegation could not be revoked.");
    }
  }

  if (loadError) {
    return (
      <div className="aifa-page">
        <h1>Approvals</h1>
        <p className="error">{loadError}</p>
      </div>
    );
  }

  const myId = myMembership?.id ?? null;
  const filtered = (tasks ?? []).filter((t) => {
    if (tab === "my-pending") return t.status === "pending_approval" && t.assignedMembershipId === myId;
    if (tab === "delegated-to-me")
      return t.status === "pending_approval" && t.resolvedVia === "delegation" && t.assignedMembershipId === myId;
    if (tab === "history") return t.status !== "pending_approval";
    return true; // "all"
  });

  const myDelegationsReceived = (delegations ?? []).filter(
    (d) => d.status === "active" && d.delegateMembershipId === myId,
  );

  return (
    <div className="aifa-page">
      <h1>Approvals</h1>
      <TabStrip
        tabs={[
          { id: "my-pending", label: "My Pending", count: tasks?.filter((t) => t.status === "pending_approval" && t.assignedMembershipId === myId).length },
          { id: "delegated-to-me", label: "Delegated to Me", count: myDelegationsReceived.length || undefined },
          { id: "all", label: "All" },
          { id: "history", label: "History" },
          { id: "my-delegations", label: "My Delegations" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "my-delegations" ? null : tasks === null ? (
        <p className="muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">Nothing here.</p>
      ) : (
        filtered.map((task) => {
          const busy = busyTaskId === task.id;
          const canDecide =
            task.status === "pending_approval" && (task.assignedMembershipId === myId || task.assignedMembershipId === null);
          return (
            <div key={task.id} className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{describeSubject(task)}</strong>
                <span className="muted">{task.status}</span>
              </div>
              <p className="muted" style={{ margin: "4px 0" }}>
                Domain: {task.domain}
                {task.amount != null && ` · RM${task.amount.toFixed(2)}`} · via {task.resolvedVia}
              </p>
              {task.aiDraftSummary && <p style={{ margin: "4px 0" }}>{task.aiDraftSummary}</p>}
              {task.nextAction && <p className="muted" style={{ margin: "4px 0" }}>{task.nextAction}</p>}
              {canDecide && (
                <div className="row" style={{ marginTop: 4 }}>
                  <button onClick={() => void handleDecide(task.id, "approved")} disabled={busy}>
                    Approve
                  </button>
                  <button
                    onClick={() => void handleDecide(task.id, "rejected")}
                    disabled={busy}
                    style={{ color: "#c0392b", borderColor: "#c0392b" }}
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}

      {tab === "delegated-to-me" && (
        <div className="card">
          <h2 style={{ fontSize: 14, marginTop: 0 }}>Active delegations to you</h2>
          {myDelegationsReceived.length === 0 ? (
            <p className="muted">No active delegation right now.</p>
          ) : (
            myDelegationsReceived.map((d) => (
              <p key={d.id} className="muted" style={{ margin: "4px 0" }}>
                {d.domainScope ?? "All domains"} · from Member #{d.delegatorMembershipId.slice(0, 8)}
                {d.reason ? ` — ${d.reason}` : ""}
                {" · "}
                <button onClick={() => void handleRevokeDelegation(d.id)} style={{ padding: "0 4px" }}>
                  Revoke
                </button>
              </p>
            ))
          )}
        </div>
      )}

      {tab === "my-delegations" && (
        <>
          <div className="card">
            <h2 style={{ fontSize: 14, marginTop: 0 }}>Create a delegation</h2>
            {canDelegateOthers && (
              <div style={{ marginBottom: 8 }}>
                <label className="muted">
                  On behalf of{" "}
                  <select value={delegatorMembershipId} onChange={(e) => setDelegatorMembershipId(e.target.value)} style={{ padding: 4 }}>
                    {memberships.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id === myId ? "Me" : `Member #${m.id.slice(0, 8)}`}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="muted" style={{ fontSize: 12, margin: "2px 0" }}>
                  Delegating someone else's authority requires `settings: configure` — you have it, so this picker is
                  available. Without it, you can only delegate your own.
                </p>
              </div>
            )}
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <select value={delegateMembershipId} onChange={(e) => setDelegateMembershipId(e.target.value)} style={{ padding: 6 }}>
                <option value="">Delegate to…</option>
                {memberships
                  .filter((m) => m.id !== delegatorMembershipId)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      Member #{m.id.slice(0, 8)}
                    </option>
                  ))}
              </select>
              <select value={domainScope} onChange={(e) => setDomainScope(e.target.value as Domain | "")} style={{ padding: 6 }}>
                <option value="">All domains</option>
                {DOMAIN_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <input type="date" placeholder="Ends (optional)" value={delegationEndsAt} onChange={(e) => setDelegationEndsAt(e.target.value)} style={{ padding: 6 }} />
              <input placeholder="Reason (optional)" value={delegationReason} onChange={(e) => setDelegationReason(e.target.value)} style={{ padding: 6, minWidth: 200 }} />
              <button onClick={() => void handleCreateDelegation()} disabled={createDelegationBusy || !delegateMembershipId}>
                {createDelegationBusy ? "Creating…" : "Create Delegation"}
              </button>
            </div>
            <p className="muted" style={{ marginTop: 6 }}>
              A domain-scoped delegation only narrows what the delegate can approve — it never grants authority the
              delegator does not already hold (Vol 13_1 §5). Every affected still-pending task is re-resolved
              immediately.
            </p>
            {createDelegationError && <p className="error">{createDelegationError}</p>}
          </div>

          <div className="card">
            <h2 style={{ fontSize: 14, marginTop: 0 }}>Delegations you've created</h2>
            {(delegations ?? []).filter((d) => d.delegatorMembershipId === myId).length === 0 ? (
              <p className="muted">None yet.</p>
            ) : (
              (delegations ?? [])
                .filter((d) => d.delegatorMembershipId === myId)
                .map((d) => (
                  <p key={d.id} className="muted" style={{ margin: "4px 0" }}>
                    {d.domainScope ?? "All domains"} · to Member #{d.delegateMembershipId.slice(0, 8)} · {d.status}
                    {d.reason ? ` — ${d.reason}` : ""}
                    {d.status === "active" && (
                      <>
                        {" · "}
                        <button onClick={() => void handleRevokeDelegation(d.id)} style={{ padding: "0 4px" }}>
                          Revoke
                        </button>
                      </>
                    )}
                  </p>
                ))
            )}
          </div>
        </>
      )}

      {actionError && <p className="error">{actionError}</p>}
    </div>
  );
}
