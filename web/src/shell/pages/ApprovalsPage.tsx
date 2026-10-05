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
 *
 * UI polish Phase 4: presentation only — shared header, table and labelled
 * fields. Same calls, gating and confirmations.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabaseApprovalEngineTransport } from "@aifa/core/sync/approvalEngineTransport";
import type { ApprovalTask, ApprovalDelegation, Domain } from "@aifa/core/sync/approvalEngineTransport";
import type { BusinessMembership } from "@aifa/core/sync/teamMembershipTransport";

import { supabase } from "../../lib/supabaseClient";
import { listApprovalTasks, listApprovalDelegations } from "../../lib/approvals";
import { listMemberships, getGrantedCapabilitiesForDomain } from "../../lib/membership";
import { Button, Card, DataTable, Field, PageHeader, StatusPill, formatMoney, type Column } from "../../ui";
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
  const myDelegationsCreated = (delegations ?? []).filter((d) => d.delegatorMembershipId === myId);

  const taskColumns: Column<ApprovalTask>[] = [
    {
      key: "subject",
      header: "Request",
      render: (t) => (
        <>
          <strong>{describeSubject(t)}</strong>
          {t.aiDraftSummary && <div className="ui-cell-sub">{t.aiDraftSummary}</div>}
          {t.nextAction && <div className="ui-cell-sub">{t.nextAction}</div>}
        </>
      ),
    },
    { key: "domain", header: "Domain", render: (t) => t.domain },
    { key: "amount", header: "Amount", numeric: true, render: (t) => (t.amount != null ? formatMoney(t.amount) : "—") },
    { key: "via", header: "Via", render: (t) => t.resolvedVia },
    { key: "status", header: "Status", render: (t) => <StatusPill status={t.status} /> },
    {
      key: "actions",
      header: "",
      render: (t) => {
        const canDecide =
          t.status === "pending_approval" && (t.assignedMembershipId === myId || t.assignedMembershipId === null);
        if (!canDecide) return null;
        const busy = busyTaskId === t.id;
        return (
          <div className="ui-inline-actions">
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void handleDecide(t.id, "approved")}>
              Approve
            </Button>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => void handleDecide(t.id, "rejected")}>
              Reject
            </Button>
          </div>
        );
      },
    },
  ];

  const receivedColumns: Column<ApprovalDelegation>[] = [
    { key: "scope", header: "Scope", render: (d) => d.domainScope ?? "All domains" },
    { key: "from", header: "From", render: (d) => `Member #${d.delegatorMembershipId.slice(0, 8)}` },
    { key: "reason", header: "Reason", render: (d) => d.reason ?? "—" },
    {
      key: "actions",
      header: "",
      render: (d) => (
        <Button size="sm" variant="secondary" onClick={() => void handleRevokeDelegation(d.id)}>
          Revoke
        </Button>
      ),
    },
  ];

  const createdColumns: Column<ApprovalDelegation>[] = [
    { key: "scope", header: "Scope", render: (d) => d.domainScope ?? "All domains" },
    { key: "to", header: "To", render: (d) => `Member #${d.delegateMembershipId.slice(0, 8)}` },
    { key: "status", header: "Status", render: (d) => <StatusPill status={d.status} /> },
    { key: "reason", header: "Reason", render: (d) => d.reason ?? "—" },
    {
      key: "actions",
      header: "",
      render: (d) =>
        d.status === "active" ? (
          <Button size="sm" variant="secondary" onClick={() => void handleRevokeDelegation(d.id)}>
            Revoke
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="aifa-page">
      <PageHeader title="Approvals">
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
      </PageHeader>

      {loadError && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {loadError}
        </p>
      )}
      {actionError && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {actionError}
        </p>
      )}

      {tab !== "my-delegations" && (
        <Card flush>
          <DataTable
            caption="Approval tasks"
            columns={taskColumns}
            rows={loadError ? [] : tasks === null ? null : filtered}
            rowKey={(t) => t.id}
            empty={<div className="ui-table-state">Nothing here.</div>}
          />
        </Card>
      )}

      {tab === "delegated-to-me" && (
        <Card title="Active delegations to you" flush>
          <DataTable
            caption="Active delegations to you"
            columns={receivedColumns}
            rows={loadError ? [] : delegations === null ? null : myDelegationsReceived}
            rowKey={(d) => d.id}
            empty={<div className="ui-table-state">No active delegation right now.</div>}
          />
        </Card>
      )}

      {tab === "my-delegations" && (
        <>
          <Card
            title="Create a delegation"
            description="A domain-scoped delegation only narrows what the delegate can approve — it never grants authority the delegator does not already hold (Vol 13_1 §5). Every affected still-pending task is re-resolved immediately."
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!createDelegationBusy && delegateMembershipId) void handleCreateDelegation();
              }}
            >
              <div className="ui-form-grid">
                {canDelegateOthers && (
                  <Field
                    label="On behalf of"
                    hint="Delegating someone else's authority requires `settings: configure` — you have it, so this picker is available. Without it, you can only delegate your own."
                  >
                    {(p) => (
                      <select {...p} className="ui-select" value={delegatorMembershipId} onChange={(e) => setDelegatorMembershipId(e.target.value)}>
                        {memberships.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.id === myId ? "Me" : `Member #${m.id.slice(0, 8)}`}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                )}
                <Field label="Delegate to">
                  {(p) => (
                    <select {...p} className="ui-select" value={delegateMembershipId} onChange={(e) => setDelegateMembershipId(e.target.value)}>
                      <option value="">Delegate to…</option>
                      {memberships
                        .filter((m) => m.id !== delegatorMembershipId)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            Member #{m.id.slice(0, 8)}
                          </option>
                        ))}
                    </select>
                  )}
                </Field>
                <Field label="Domain">
                  {(p) => (
                    <select {...p} className="ui-select" value={domainScope} onChange={(e) => setDomainScope(e.target.value as Domain | "")}>
                      <option value="">All domains</option>
                      {DOMAIN_OPTIONS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="Ends (optional)">
                  {(p) => <input {...p} className="ui-input" type="date" value={delegationEndsAt} onChange={(e) => setDelegationEndsAt(e.target.value)} />}
                </Field>
                <Field label="Reason (optional)">
                  {(p) => <input {...p} className="ui-input" value={delegationReason} onChange={(e) => setDelegationReason(e.target.value)} />}
                </Field>
              </div>
              <div className="ui-form-actions">
                <Button type="submit" variant="primary" loading={createDelegationBusy} disabled={!delegateMembershipId}>
                  {createDelegationBusy ? "Creating…" : "Create Delegation"}
                </Button>
              </div>
              {createDelegationError && (
                <p className="aifa-alert aifa-alert--danger" role="alert">
                  {createDelegationError}
                </p>
              )}
            </form>
          </Card>

          <Card title="Delegations you've created" flush>
            <DataTable
              caption="Delegations you've created"
              columns={createdColumns}
              rows={loadError ? [] : delegations === null ? null : myDelegationsCreated}
              rowKey={(d) => d.id}
              empty={<div className="ui-table-state">None yet.</div>}
            />
          </Card>
        </>
      )}
    </div>
  );
}
