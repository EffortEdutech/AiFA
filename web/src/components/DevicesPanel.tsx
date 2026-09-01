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
 */
export function DevicesPanel({ db, businessId, deviceId, dek }: Props): JSX.Element {
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

  if (loadError) {
    return (
      <div className="card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Devices</h2>
        <p className="error">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: 16, marginTop: 0 }}>Devices</h2>
      <p className="muted">
        Every device registered for this business — who's active, who's
        primary, and how caught-up each one is.
      </p>
      {devices === null ? (
        <p className="muted">Loading…</p>
      ) : (
        devices.map((device) => {
          const isMe = device.deviceId === deviceId;
          const isRevoked = !!device.revokedAt;
          const isActive = !isRevoked && activeInfo?.activeDeviceId === device.deviceId;
          const status = isRevoked ? "Revoked" : isActive ? "Active" : "Read-only";
          const checkpoint = isMe ? myCheckpoint : device.lastSyncedServerSeq;
          const syncState = isRevoked ? "—" : describeSyncState(checkpoint, maxServerSeq);
          const busy = busyDeviceId === device.deviceId;
          const isRenaming = renamingDeviceId === device.deviceId;

          return (
            <div
              key={device.deviceId}
              style={{ borderTop: "1px solid #e2e2e5", paddingTop: 10, marginTop: 8 }}
            >
              <div className="row" style={{ justifyContent: "space-between" }}>
                {isRenaming ? (
                  <input
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    style={{ padding: 6, flex: 1 }}
                    autoFocus
                  />
                ) : (
                  <strong>
                    {device.deviceLabel}
                    {isMe ? " (this device)" : ""}
                  </strong>
                )}
                {device.isPrimary && <span style={{ color: "#b8860b" }}>★ Primary</span>}
              </div>

              <p className="muted" style={{ margin: "4px 0" }}>
                {describePlatform(device.platform)} · {status} · {syncState}
              </p>
              <p className="muted" style={{ margin: "4px 0" }}>
                Last seen {relativeTime(device.lastSeenAt)} · Registered{" "}
                {formatDate(device.registeredAt)}
              </p>
              {isActive && activeInfo && (
                <p className="muted" style={{ margin: "4px 0" }}>
                  {describeReadOnlyReason({
                    activeDeviceLabel: activeInfo.activeDeviceLabel,
                    activeDeviceIsPrimary: activeInfo.activeDeviceIsPrimary,
                  })}
                </p>
              )}

              {!isRevoked && (
                <div className="row" style={{ marginTop: 4 }}>
                  {isMe && !isActive && (
                    <button onClick={handleMakeActive} disabled={busy}>
                      {activeInfo?.requestingIsPrimary ? "Take over as active" : "Make this device active"}
                    </button>
                  )}
                  {!device.isPrimary && (
                    <button
                      onClick={() => handleSetPrimary(device.deviceId).catch(() => {})}
                      disabled={busy}
                    >
                      Set as primary
                    </button>
                  )}
                  {isRenaming ? (
                    <>
                      <button onClick={() => handleConfirmRename(device.deviceId)} disabled={busy}>
                        Save
                      </button>
                      <button onClick={() => setRenamingDeviceId(null)} disabled={busy}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button onClick={() => startRename(device)} disabled={busy}>
                      Rename
                    </button>
                  )}
                  <button
                    onClick={() => handleRevoke(device)}
                    disabled={busy}
                    style={{ color: "#c0392b", borderColor: "#c0392b" }}
                  >
                    {busy ? "…" : "Revoke"}
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}
      {actionError && <p className="error">{actionError}</p>}
    </div>
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
