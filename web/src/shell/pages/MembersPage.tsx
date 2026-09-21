/**
 * Members & Roles — Sprint 38 (Vol 13_1 §4, Vol 12_2 §4.2 Team section).
 *
 * Owner-only for writes (invite/suspend/remove), self-view only for a
 * non-Owner member (Vol 12_2 §4.2's own table) — enforced here at the
 * UI level, on top of RLS which permits any active member to READ every
 * membership row (see lib/membership.ts's own header for why that's
 * safe and correct: the write RPCs are separately, server-side gated on
 * `configure` on `settings`, Vol 13_1 §4).
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

  if (loadError) {
    return (
      <div className="aifa-page">
        <h1>Members & Roles</h1>
        <p className="error">{loadError}</p>
      </div>
    );
  }

  // Vol 12_2 §4.2's own table: a non-Owner sees only their own row.
  const visibleMembers =
    isOwner || !membershipChecked
      ? members
      : members?.filter((m) => myMembership && m.id === myMembership.id) ?? null;

  return (
    <div className="aifa-page">
      <h1>Members & Roles</h1>
      <p className="muted">
        This business is currently in <strong>{accessModel}</strong> mode (Vol 13_3 §2 —
        automatically becomes &quot;team&quot; once a second active member exists).
      </p>

      <div className="card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Your display name</h2>
        <p className="muted" style={{ margin: "0 0 8px" }}>
          Shown to teammates in this list, and used to address you by name wherever AiFA refers to who's who.
        </p>
        <div className="row">
          <input
            type="text"
            placeholder="Your name"
            value={myNameDraft}
            onChange={(e) => setMyNameDraft(e.target.value)}
            style={{ padding: 6, flex: 1, minWidth: 220 }}
          />
          <button onClick={() => void handleSaveMyName()} disabled={myNameBusy || !myNameDraft.trim()}>
            {myNameBusy ? "Saving…" : "Save"}
          </button>
        </div>
        {myNameError && <p className="error">{myNameError}</p>}
      </div>

      {isOwner && (
        <div className="card">
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Invite a member</h2>
          <div className="row">
            <input
              type="email"
              placeholder="email@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              style={{ padding: 6, flex: 1, minWidth: 220 }}
            />
            <select value={inviteRoleId} onChange={(e) => setInviteRoleId(e.target.value)} style={{ padding: 6 }}>
              {roles?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <button onClick={() => void handleInvite()} disabled={inviteBusy || !inviteEmail.trim()}>
              {inviteBusy ? "Sending…" : "Send invite"}
            </button>
          </div>
          {inviteError && <p className="error">{inviteError}</p>}
        </div>
      )}

      {visibleMembers === null ? (
        <p className="muted">Loading…</p>
      ) : (
        visibleMembers.map((m) => {
          const isSelf = myMembership?.id === m.id;
          const busy = actionBusyId === m.id;
          return (
            <div key={m.id} className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>
                  {resolvedName(m)}
                  {isSelf ? " (you)" : ""}
                </strong>
                <span className="muted">{m.status}</span>
              </div>
              <p className="muted" style={{ margin: "4px 0" }}>
                Role: {roleName(m.roleId)}
                {m.approvalLimitMyr != null && ` · Approval limit RM${m.approvalLimitMyr.toFixed(2)}`}
              </p>
              {isOwner && editingLabelId === m.id && (
                <div className="row" style={{ margin: "4px 0" }}>
                  <input
                    type="text"
                    placeholder="Label shown to the whole team (blank clears it)"
                    value={labelDraft}
                    onChange={(e) => setLabelDraft(e.target.value)}
                    style={{ padding: 6, flex: 1, minWidth: 220 }}
                    autoFocus
                  />
                  <button onClick={() => void handleSaveLabel(m)} disabled={labelBusyId === m.id}>
                    {labelBusyId === m.id ? "Saving…" : "Save"}
                  </button>
                  <button onClick={cancelEditingLabel} disabled={labelBusyId === m.id}>
                    Cancel
                  </button>
                </div>
              )}
              {isOwner && m.status !== "removed" && (
                <div className="row" style={{ marginTop: 4 }}>
                  {editingLabelId !== m.id && (
                    <button onClick={() => startEditingLabel(m)}>Set label</button>
                  )}
                  {!isSelf && m.status === "active" && (
                    <button onClick={() => void handleSuspend(m)} disabled={busy}>
                      Suspend
                    </button>
                  )}
                  {!isSelf && (
                    <button
                      onClick={() => void handleRemove(m)}
                      disabled={busy}
                      style={{ color: "#c0392b", borderColor: "#c0392b" }}
                    >
                      {busy ? "…" : "Remove"}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
      {actionError && <p className="error">{actionError}</p>}
      {labelError && <p className="error">{labelError}</p>}
    </div>
  );
}
