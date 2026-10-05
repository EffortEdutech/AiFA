import { useCallback, useEffect, useState } from "react";

import {
  describeReadOnlyReason,
  resolveActivationConfirmation,
} from "@aifa/core/sync/handoff";
import type { SqlDb } from "@aifa/core/db/types";

import {
  getActiveDeviceInfo,
  getAllDevices,
  getLocalSyncCheckpoint,
  getMaxServerSeq,
  renameDevice,
  requestActivation,
  requestPrimaryTakeover,
  revokeDevice,
  setPrimaryDevice,
  type ActiveDeviceInfo,
  type RegisteredDevice,
} from "../lib/syncService";
import { useAccess } from "../shell/AccessContext";
import { Button, Card, DataTable, StatusPill, type Column } from "../ui";
import { TabStrip } from "../shell/TabStrip";

interface Props {
  db: SqlDb;
  businessId: string;
  deviceId: string;
  dek: Uint8Array;
}

/**
 * Web Devices panel — Sprint 19 (Vol 12_1 §8), the web counterpart to
 * app/src/components/DevicesPanel.tsx. Same column set, same four
 * actions, same design notes (see that file's header comment for the
 * full reasoning — "Make active" only on this browser's own row, since
 * Vol 12_1 §6a.1 only lets a device request activation for itself;
 * "Set as primary"/"Rename" on any non-revoked row; "Revoke"
 * auto-selects a replacement rather than a second picker UI).
 *
 * Confirmations use `window.confirm` rather than a custom modal — this
 * matches every other confirmation-free, plain-HTML style choice already
 * made across web/src/components (no modal component exists anywhere in
 * this package yet), and is a deliberately smaller investment than
 * porting React Native's Alert.alert semantics to the browser.
 *
 * Sprint 38 (Vol 12_1 §5b, Vol 12_2 §5.4) adds per-membership scoping:
 * a non-Owner member sees only their own devices by default; the Owner
 * gets an additional "All Devices" tab across every membership. This
 * needed `RegisteredDevice.businessMembershipId`, which the underlying
 * transport (packages/core/src/sync/supabaseTransport.ts) had never
 * actually mapped even though the column existed server-side since
 * Sprint 23's ad-hoc migration -- added as a small, disclosed transport
 * fix this sprint (see that file's own note), not a new backend change.
 *
 * UI polish Phase 4: presentation only — a shared Card + DataTable; the
 * read-only-device notice, confirmations and every action are unchanged.
 */
export function DevicesPanel({ db, businessId, deviceId, dek }: Props): JSX.Element {
  const { myMembership, membershipChecked, isOwner } = useAccess();
  const [scopeTab, setScopeTab] = useState<"my" | "all">("my");
  const [devices, setDevices] = useState<RegisteredDevice[] | null>(null);
  const [activeInfo, setActiveInfo] = useState<ActiveDeviceInfo | null>(null);
  const [maxServerSeq, setMaxServerSeq] = useState(0);
  const [myCheckpoint, setMyCheckpoint] = useState(0);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [renamingDeviceId, setRenamingDeviceId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [allDevices, maxSeq, info, checkpoint] = await Promise.all([
        getAllDevices(businessId),
        getMaxServerSeq(businessId),
        getActiveDeviceInfo(businessId, deviceId),
        getLocalSyncCheckpoint(db, businessId),
      ]);
      setDevices(allDevices);
      setMaxServerSeq(maxSeq);
      setActiveInfo(info);
      setMyCheckpoint(checkpoint);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load devices.");
    }
  }, [db, businessId, deviceId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const runAction = async (id: string, action: () => Promise<void>) => {
    setBusyDeviceId(id);
    setActionError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That action could not be completed.");
    } finally {
      setBusyDeviceId(null);
    }
  };

  const performActivation = (requestingIsPrimary: boolean) =>
    runAction(deviceId, async () => {
      if (requestingIsPrimary) {
        await requestPrimaryTakeover(db, businessId, deviceId, dek);
      } else {
        await requestActivation(db, businessId, deviceId, dek);
      }
    });

  const handleMakeActive = () => {
    if (!activeInfo) return;
    const confirmation = resolveActivationConfirmation({
      requestingIsPrimary: activeInfo.requestingIsPrimary,
      requestingDeviceId: deviceId,
      activeDeviceId: activeInfo.activeDeviceId,
      activeDeviceLabel: activeInfo.activeDeviceLabel,
      activeDeviceLastSeenAt: activeInfo.activeDeviceLastSeenAt,
    });

    if (confirmation.kind === "none") {
      performActivation(activeInfo.requestingIsPrimary).catch(() => {});
      return;
    }

    const proceed = window.confirm(
      [confirmation.title, confirmation.message].filter(Boolean).join("\n\n"),
    );
    if (proceed) performActivation(activeInfo.requestingIsPrimary).catch(() => {});
  };

  const handleSetPrimary = (id: string) =>
    runAction(id, async () => {
      await setPrimaryDevice(id);
    });

  const startRename = (device: RegisteredDevice) => {
    setRenamingDeviceId(device.deviceId);
    setRenameDraft(device.deviceLabel);
  };

  const handleConfirmRename = (id: string) => {
    const label = renameDraft.trim();
    if (!label) return;
    runAction(id, async () => {
      await renameDevice(id, label);
    })
      .then(() => setRenamingDeviceId(null))
      .catch(() => {});
  };

  const handleRevoke = (device: RegisteredDevice) => {
    if (!devices) return;
    const isActive = activeInfo?.activeDeviceId === device.deviceId;
    const otherCandidates = devices.filter((d) => d.deviceId !== device.deviceId && !d.revokedAt);

    if ((isActive || device.isPrimary) && otherCandidates.length === 0) {
      setActionError(
        "Register another device before revoking this one — the business can't be left with no possible writer.",
      );
      return;
    }

    const primaryCandidate = otherCandidates.find((d) => d.isPrimary);
    const replacement = primaryCandidate ?? otherCandidates[0];

    const newActiveDeviceId = isActive ? replacement?.deviceId : undefined;
    const newPrimaryDeviceId = device.isPrimary ? replacement?.deviceId : undefined;

    const consequence: string[] = [];
    if (newActiveDeviceId) consequence.push(`${replacement?.deviceLabel} will become the active device.`);
    if (newPrimaryDeviceId) consequence.push(`${replacement?.deviceLabel} will become the primary device.`);

    const proceed = window.confirm(
      [
        `Revoke ${device.deviceLabel}?`,
        "This device will permanently lose write access and can never become active again.",
        ...consequence,
      ].join("\n"),
    );
    if (!proceed) return;

    runAction(device.deviceId, async () => {
      await revokeDevice(device.deviceId, { newActiveDeviceId, newPrimaryDeviceId });
    }).catch(() => {});
  };

  const visibleDevices =
    devices === null
      ? null
      : devices.filter((device) => {
          if (isOwner && scopeTab === "all") return true;
          // Non-Owner, or Owner's own "My Devices" tab: scope to the
          // signed-in user's own membership (Vol 12_1 §5b). While the
          // membership lookup is still in flight, hide every row rather
          // than briefly showing every member's devices (scoping is
          // enforced client-side; getAllDevices returns every device for
          // the business). Once resolved, a null myMembership is the
          // intentional dev-bypass/unrestricted path.
          if (!membershipChecked) return false;
          if (!myMembership) return true;
          return device.businessMembershipId === myMembership.id;
        });

  const columns: Column<RegisteredDevice>[] = [
    {
      key: "device",
      header: "Device",
      render: (device) => {
        const isMe = device.deviceId === deviceId;
        const isActive = !device.revokedAt && activeInfo?.activeDeviceId === device.deviceId;
        if (renamingDeviceId === device.deviceId) {
          return (
            <input
              className="ui-input"
              aria-label="Device name"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              autoFocus
            />
          );
        }
        return (
          <>
            <strong>
              {device.deviceLabel}
              {isMe ? " (this device)" : ""}
            </strong>
            {device.isPrimary && <span style={{ color: "var(--aifa-accent)", marginLeft: 8 }}>★ Primary</span>}
            <div className="ui-cell-sub">
              {describePlatform(device.platform)} · Last seen {relativeTime(device.lastSeenAt)} · Registered{" "}
              {formatDate(device.registeredAt)}
            </div>
            {isActive && activeInfo && (
              <div className="ui-cell-sub">
                {describeReadOnlyReason({
                  activeDeviceLabel: activeInfo.activeDeviceLabel,
                  activeDeviceIsPrimary: activeInfo.activeDeviceIsPrimary,
                })}
              </div>
            )}
          </>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (device) => {
        const isRevoked = !!device.revokedAt;
        const isActive = !isRevoked && activeInfo?.activeDeviceId === device.deviceId;
        const label = isRevoked ? "Revoked" : isActive ? "Active" : "Read-only";
        return <StatusPill status={label} label={label} tone={isRevoked ? "danger" : isActive ? "success" : "neutral"} />;
      },
    },
    {
      key: "sync",
      header: "Sync",
      render: (device) => {
        if (device.revokedAt) return "—";
        const checkpoint = device.deviceId === deviceId ? myCheckpoint : device.lastSyncedServerSeq;
        return describeSyncState(checkpoint, maxServerSeq);
      },
    },
    {
      key: "actions",
      header: "",
      render: (device) => {
        if (device.revokedAt) return null;
        const isMe = device.deviceId === deviceId;
        const isActive = activeInfo?.activeDeviceId === device.deviceId;
        const busy = busyDeviceId === device.deviceId;
        const isRenaming = renamingDeviceId === device.deviceId;
        return (
          <div className="ui-inline-actions">
            {isMe && !isActive && (
              <Button size="sm" variant="primary" disabled={busy} onClick={handleMakeActive}>
                {activeInfo?.requestingIsPrimary ? "Take over as active" : "Make this device active"}
              </Button>
            )}
            {!device.isPrimary && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => handleSetPrimary(device.deviceId).catch(() => {})}>
                Set as primary
              </Button>
            )}
            {isRenaming ? (
              <>
                <Button size="sm" variant="primary" disabled={busy} onClick={() => handleConfirmRename(device.deviceId)}>
                  Save
                </Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setRenamingDeviceId(null)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => startRename(device)}>
                Rename
              </Button>
            )}
            <Button size="sm" variant="danger" loading={busy} onClick={() => handleRevoke(device)}>
              Revoke
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <Card
      title="Devices"
      description="Every device registered for this business — who's active, who's primary, and how caught-up each one is."
    >
      {loadError && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {loadError}
        </p>
      )}
      {isOwner && !loadError && (
        <TabStrip
          tabs={[
            { id: "my", label: "My Devices" },
            { id: "all", label: "All Devices" },
          ]}
          active={scopeTab}
          onChange={setScopeTab}
        />
      )}
      {!loadError && (
        <DataTable
          caption="Registered devices"
          columns={columns}
          rows={visibleDevices}
          rowKey={(d) => d.deviceId}
          empty={<div className="ui-table-state">No devices to show.</div>}
        />
      )}
      {actionError && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {actionError}
        </p>
      )}
    </Card>
  );
}

function describeSyncState(checkpoint: number, maxServerSeq: number): string {
  if (maxServerSeq <= 0) return "Up to date";
  if (checkpoint <= 0) return "Never synced";
  if (checkpoint >= maxServerSeq) return "Up to date";
  const behind = maxServerSeq - checkpoint;
  return `${behind} change${behind === 1 ? "" : "s"} behind`;
}

function describePlatform(platform: RegisteredDevice["platform"]): string {
  if (platform === "ios") return "Mobile (iOS)";
  if (platform === "android") return "Mobile (Android)";
  return "Web";
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  const diffMs = Date.now() - ms;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function formatDate(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleDateString();
}
