/**
 * Members & Roles — Sprint 38 (Vol 13_1 §4, Vol 12_2 §4.2 Team section).
 *
 * Owner-only for writes (invite/suspend/remove), self-view only for a
 * non-Owner member (Vol 12_2 §4.2's own table) — enforced here at the
 * UI level, on top of RLS which permits any active member to READ every
 * membership row (see lib/membership.ts's own header for why that's
 * safe and correct: the write RPCs are separately, server-side gated on
 * `configure` on `settings`, Vol 13_1 §4).
 *
 * UI polish Phase 4: presentation only — shared header, table and labelled
 * fields. Same calls, gating and confirmations.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabaseTeamMembershipTransport } from "@aifa/core/sync/teamMembershipTransport";
import type { BusinessMembership } from "@aifa/core/sync/teamMembershipTransport";

import { supabase } from "../../lib/supabaseClient";
import {
  describeMembership,
  listMemberIdentities,
  listMemberships,
  listRoles,
  setMyDisplayName,
  type RoleSummary,
} from "../../lib/membership";
import { Button, Card, DataTable, Field, PageHeader, StatusPill, formatMoney, type Column } from "../../ui";
import { useAccess } from "../AccessContext";

const teamMembershipTransport = createSupabaseTeamMembershipTransport(supabase);

interface Props {
  businessId: string;
}

export function MembersPage({ businessId }: Props): JSX.Element {
  const { accessModel, myMembership, membershipChecked, isOwner } = useAccess();

  const [members, setMembers] = useState<BusinessMembership[] | null>(null);
  const [roles, setRoles] = useState<RoleSummary[] | null>(null);
  const [identities, setIdentities] = useState<Map<string, string | null> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRoleId, setInviteRoleId] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [myNameDraft, setMyNameDraft] = useState("");
  const [myNameBusy, setMyNameBusy] = useState(false);
  const [myNameError, setMyNameError] = useState<string | null>(null);

  // Inline editor state for the Owner's per-member label -- deliberately
  // NOT window.prompt(): a native prompt() dialog blocks the page's own
  // event loop until a human dismisses it, which froze this exact flow
  // under browser automation during testing, and is generally fragile UI
  // (no styling, can't be driven by tests). An inline input avoids both.
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [labelBusyId, setLabelBusyId] = useState<string | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [allMembers, allRoles, memberIdentities] = await Promise.all([
        listMemberships(businessId),
        listRoles(),
        // Best-effort: an identity-resolution failure shouldn't block the
        // member/role list itself from rendering (describeMembership's
        // short-id fallback still works with identities left null).
        listMemberIdentities(businessId).catch(() => null),
      ]);
      setMembers(allMembers);
      setRoles(allRoles);
      setIdentities(memberIdentities);
      if (!inviteRoleId && allRoles.length > 0) setInviteRoleId(allRoles[0].id);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load members.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  // Seed the "your display name" input from the resolved identity once
  // both are loaded, but only until the person starts typing -- an empty
  // resolved name (never set) leaves the field blank for them to fill in.
  useEffect(() => {
    if (myMembership && identities && !myNameDraft) {
      const resolved = identities.get(myMembership.id);
      if (resolved) setMyNameDraft(resolved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myMembership, identities]);

  const roleName = (roleId: string) => roles?.find((r) => r.id === roleId)?.name ?? roleId.slice(0, 8);

  const resolvedName = (m: BusinessMembership): string => identities?.get(m.id) || describeMembership(m);

  async function handleSaveMyName(): Promise<void> {
    if (!myNameDraft.trim()) return;
    setMyNameBusy(true);
    setMyNameError(null);
    try {
      await setMyDisplayName(myNameDraft);
      await load();
    } catch (err) {
      setMyNameError(err instanceof Error ? err.message : "Could not save your name.");
    } finally {
      setMyNameBusy(false);
    }
  }

  function startEditingLabel(m: BusinessMembership): void {
    setLabelError(null);
    setLabelDraft(m.ownerLabel ?? "");
    setEditingLabelId(m.id);
  }

  function cancelEditingLabel(): void {
    setEditingLabelId(null);
    setLabelDraft("");
  }

  async function handleSaveLabel(m: BusinessMembership): Promise<void> {
    setLabelBusyId(m.id);
    setLabelError(null);
    try {
      await teamMembershipTransport.setMemberLabel(m.id, labelDraft.trim() === "" ? null : labelDraft.trim());
      setEditingLabelId(null);
      setLabelDraft("");
      await load();
    } catch (err) {
      setLabelError(err instanceof Error ? err.message : "Could not set label.");
    } finally {
      setLabelBusyId(null);
    }
  }

  async function handleInvite(): Promise<void> {
    if (!inviteEmail.trim() || !inviteRoleId) return;
    setInviteBusy(true);
    setInviteError(null);
    try {
      await teamMembershipTransport.inviteMember(businessId, inviteEmail.trim(), inviteRoleId);
      setInviteEmail("");
      await load();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Could not send invite.");
    } finally {
      setInviteBusy(false);
    }
  }

  async function handleSuspend(m: BusinessMembership): Promise<void> {
    if (!window.confirm(`Suspend ${resolvedName(m)}? They will lose access until reinstated.`)) return;
    setActionBusyId(m.id);
    setActionError(null);
    try {
      await teamMembershipTransport.suspendMembership(m.id);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That action could not be completed.");
    } finally {
      setActionBusyId(null);
    }
  }

  async function handleRemove(m: BusinessMembership): Promise<void> {
    if (!window.confirm(`Remove ${resolvedName(m)}? This also revokes every device they hold.`)) return;
    setActionBusyId(m.id);
    setActionError(null);
    try {
      await teamMembershipTransport.removeMembership(m.id);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That action could not be completed.");
    } finally {
      setActionBusyId(null);
    }
  }

  // Vol 12_2 §4.2's own table: a non-Owner sees only their own row.
  const visibleMembers =
    isOwner || !membershipChecked
      ? members
      : members?.filter((m) => myMembership && m.id === myMembership.id) ?? null;

  const columns: Column<BusinessMembership>[] = [
    {
      key: "member",
      header: "Member",
      render: (m) => (
        <strong>
          {resolvedName(m)}
          {myMembership?.id === m.id ? " (you)" : ""}
        </strong>
      ),
    },
    { key: "status", header: "Status", render: (m) => <StatusPill status={m.status} /> },
    {
      key: "role",
      header: "Role",
      render: (m) => (
        <>
          {roleName(m.roleId)}
          {m.approvalLimitMyr != null && <div className="ui-cell-sub">Approval limit {formatMoney(m.approvalLimitMyr)}</div>}
        </>
      ),
    },
    ...(isOwner
      ? [
          {
            key: "actions",
            header: "",
            render: (m: BusinessMembership) => {
              if (m.status === "removed") return null;
              const isSelf = myMembership?.id === m.id;
              const busy = actionBusyId === m.id;
              return (
                <div className="ui-inline-actions">
                  {editingLabelId !== m.id && (
                    <Button size="sm" variant="secondary" onClick={() => startEditingLabel(m)}>
                      Set label
                    </Button>
                  )}
                  {!isSelf && m.status === "active" && (
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void handleSuspend(m)}>
                      Suspend
                    </Button>
                  )}
                  {!isSelf && (
                    <Button size="sm" variant="danger" loading={busy} onClick={() => void handleRemove(m)}>
                      Remove
                    </Button>
                  )}
                </div>
              );
            },
          } as Column<BusinessMembership>,
        ]
      : []),
  ];

  const editingMember = members?.find((m) => m.id === editingLabelId) ?? null;

  return (
    <div className="aifa-page">
      <PageHeader
        title="Members & Roles"
        description={`This business is currently in ${accessModel} mode (Vol 13_3 §2 — automatically becomes "team" once a second active member exists).`}
      />

      {loadError && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {loadError}
        </p>
      )}

      <Card
        title="Your display name"
        description="Shown to teammates in this list, and used to address you by name wherever AiFA refers to who's who."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!myNameBusy && myNameDraft.trim()) void handleSaveMyName();
          }}
        >
          <div className="ui-inline-actions" style={{ alignItems: "flex-end" }}>
            <Field label="Your name">
              {(p) => <input {...p} className="ui-input" type="text" value={myNameDraft} onChange={(e) => setMyNameDraft(e.target.value)} />}
            </Field>
            <Button type="submit" variant="primary" loading={myNameBusy} disabled={!myNameDraft.trim()}>
              {myNameBusy ? "Saving…" : "Save"}
            </Button>
          </div>
          {myNameError && (
            <p className="aifa-alert aifa-alert--danger" role="alert">
              {myNameError}
            </p>
          )}
        </form>
      </Card>

      {isOwner && (
        <Card title="Invite a member">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!inviteBusy && inviteEmail.trim()) void handleInvite();
            }}
          >
            <div className="ui-inline-actions" style={{ alignItems: "flex-end" }}>
              <Field label="Email">
                {(p) => (
                  <input {...p} className="ui-input" type="email" placeholder="email@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
                )}
              </Field>
              <Field label="Role">
                {(p) => (
                  <select {...p} className="ui-select" value={inviteRoleId} onChange={(e) => setInviteRoleId(e.target.value)}>
                    {roles?.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Button type="submit" variant="primary" loading={inviteBusy} disabled={!inviteEmail.trim()}>
                {inviteBusy ? "Sending…" : "Send invite"}
              </Button>
            </div>
            {inviteError && (
              <p className="aifa-alert aifa-alert--danger" role="alert">
                {inviteError}
              </p>
            )}
          </form>
        </Card>
      )}

      {isOwner && editingMember && (
        <Card title="Set label" description={`For ${resolvedName(editingMember)}. Shown to the whole team; blank clears it.`}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (labelBusyId !== editingMember.id) void handleSaveLabel(editingMember);
            }}
          >
            <div className="ui-inline-actions" style={{ alignItems: "flex-end" }}>
              <Field label="Label">
                {(p) => <input {...p} className="ui-input" type="text" value={labelDraft} onChange={(e) => setLabelDraft(e.target.value)} autoFocus />}
              </Field>
              <Button type="submit" variant="primary" loading={labelBusyId === editingMember.id}>
                {labelBusyId === editingMember.id ? "Saving…" : "Save"}
              </Button>
              <Button variant="secondary" disabled={labelBusyId === editingMember.id} onClick={cancelEditingLabel}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {actionError && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {actionError}
        </p>
      )}
      {labelError && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {labelError}
        </p>
      )}

      <Card title="Team" flush>
        <DataTable
          caption="Members"
          columns={columns}
          rows={loadError ? [] : visibleMembers}
          rowKey={(m) => m.id}
          empty={<div className="ui-table-state">No members to show.</div>}
        />
      </Card>
    </div>
  );
}
