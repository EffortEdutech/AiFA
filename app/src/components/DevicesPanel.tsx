/**
 * Sprint 19 (Vol 12_1 Section 8) — the full cross-platform Devices panel,
 * replacing Sprint 17's minimal PrimaryDeviceSettingsCard (still kept
 * around only if some other screen references it; SettingsScreen.tsx now
 * renders this instead). Implements every column and action Section 8's
 * table specifies: Device label, Platform, Status, Primary badge, Sync
 * state, Last seen, Registered, and the four actions (Make active, Set
 * as primary, Rename, Revoke).
 *
 * Design notes (documented here rather than left implicit, matching this
 * project's established practice — see the Sprint 19 runbook for the
 * fuller version):
 *
 * - "Make this device active" only ever appears on the row for the
 *   device the owner is currently viewing the panel FROM. Vol 12_1
 *   Section 6a.1 is explicit that a device can only ever request
 *   activation for itself — there is no RPC that lets one device push
 *   another one active — so showing that button on every row would be
 *   misleading. This mirrors ReadOnlyBanner.tsx's existing activation
 *   flow (resolveActivationConfirmation + requestActivation /
 *   requestPrimaryTakeover) rather than inventing a second one.
 * - "Set as primary" and "Rename" are available on any non-revoked row
 *   — both are pure administrative reassignments the owner can make from
 *   wherever they happen to be looking at the panel, same as Sprint 17's
 *   PrimaryDeviceSettingsCard already assumed for primary reassignment.
 * - "Revoke" auto-selects a replacement active/primary device rather
 *   than presenting a second picker UI: it defaults to the current
 *   primary device (if one exists and isn't the device being revoked),
 *   falling back to any other remaining non-revoked device. This is a
 *   deliberate, disclosed simplification — a full "choose your own
 *   replacement" picker is a real UI investment this sprint didn't spend
 *   on Vol 12_1 §8's own required behaviour ("defaulting to the primary
 *   device if one exists") already covers the common case. If revoking
 *   the LAST remaining non-revoked device, Revoke is disabled entirely
 *   (there is no valid replacement — the backend would reject it, and
 *   the business can never be left with zero possible writers).
 * - Per the Sprint 19 runbook: revoking a device here does NOT force-
 *   sign-out that device's Supabase session (a real, disclosed gap — see
 *   revoke_device's own SQL comment, app/backend/schema.sql). What IS
 *   guaranteed: a revoked device can never again pass any
 *   `revoked_at is null` check, so it can never become or remain the
 *   active writer, full stop.
 */
import {
  describeReadOnlyReason,
  resolveActivationConfirmation,
} from "@aifa/core/sync/handoff";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { restoreSyncContextIfBootstrapped } from "@/db/syncBootstrap";
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
} from "@/db/syncService";

export interface DevicesPanelProps {
  businessId: string;
}

type SyncStateLabel = "Up to date" | "Never synced" | string;

function describeSyncState(
  checkpoint: number,
  maxServerSeq: number,
): SyncStateLabel {
  if (maxServerSeq <= 0) return "Up to date"; // nothing has ever synced for this business yet
  if (checkpoint <= 0) return "Never synced";
  if (checkpoint >= maxServerSeq) return "Up to date";
  return `${maxServerSeq - checkpoint} change${maxServerSeq - checkpoint === 1 ? "" : "s"} behind`;
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

export default function DevicesPanel({ businessId }: DevicesPanelProps) {
  const [devices, setDevices] = useState<RegisteredDevice[] | null>(null);
  const [activeInfo, setActiveInfo] = useState<ActiveDeviceInfo | null>(null);
  const [myDeviceId, setMyDeviceId] = useState<string | null>(null);
  const [myDek, setMyDek] = useState<Uint8Array | null>(null);
  const [maxServerSeq, setMaxServerSeq] = useState(0);
  const [myCheckpoint, setMyCheckpoint] = useState(0);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [renamingDeviceId, setRenamingDeviceId] = useState<string | null>(
    null,
  );
  const [renameDraft, setRenameDraft] = useState("");

  const load = useCallback(async () => {
    try {
      setLoadError(null);

      // Safe to call every time this panel mounts/refreshes -- idempotent,
      // same as App.tsx's own use of it on every launch (syncBootstrap.ts's
      // own doc). Gives us this device's id/dek without needing App.tsx to
      // prop-drill them down into SettingsScreen.
      const restored = await restoreSyncContextIfBootstrapped(businessId);
      const deviceId = restored?.deviceId ?? null;
      setMyDeviceId(deviceId);
      setMyDek(restored?.dek ?? null);

      const [allDevices, maxSeq] = await Promise.all([
        getAllDevices(businessId),
        getMaxServerSeq(businessId),
      ]);
      setDevices(allDevices);
      setMaxServerSeq(maxSeq);

      if (deviceId) {
        const [info, checkpoint] = await Promise.all([
          getActiveDeviceInfo(businessId, deviceId),
          getLocalSyncCheckpoint(businessId),
        ]);
        setActiveInfo(info);
        setMyCheckpoint(checkpoint);
      } else {
        setActiveInfo(null);
        setMyCheckpoint(0);
      }
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Could not load devices.",
      );
    }
  }, [businessId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const runAction = async (deviceId: string, action: () => Promise<void>) => {
    setBusyDeviceId(deviceId);
    setActionError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "That action could not be completed.",
      );
    } finally {
      setBusyDeviceId(null);
    }
  };

  const performActivation = (deviceId: string, requestingIsPrimary: boolean) =>
    runAction(deviceId, async () => {
      if (!myDek) throw new Error("This device's sync key isn't available.");
      if (requestingIsPrimary) {
        await requestPrimaryTakeover(businessId, deviceId, myDek);
      } else {
        await requestActivation(businessId, deviceId, myDek);
      }
    });

  const handleMakeActive = () => {
    if (!myDeviceId || !activeInfo) return;
    const confirmation = resolveActivationConfirmation({
      requestingIsPrimary: activeInfo.requestingIsPrimary,
      requestingDeviceId: myDeviceId,
      activeDeviceId: activeInfo.activeDeviceId,
      activeDeviceLabel: activeInfo.activeDeviceLabel,
      activeDeviceLastSeenAt: activeInfo.activeDeviceLastSeenAt,
    });

    if (confirmation.kind === "none") {
      performActivation(myDeviceId, activeInfo.requestingIsPrimary).catch(
        () => {},
      );
      return;
    }

    Alert.alert(
      confirmation.title,
      confirmation.message || undefined,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: confirmation.confirmLabel,
          style: confirmation.kind === "caution" ? "destructive" : "default",
          onPress: () =>
            performActivation(myDeviceId, activeInfo.requestingIsPrimary).catch(
              () => {},
            ),
        },
      ],
      { cancelable: true },
    );
  };

  const handleSetPrimary = (deviceId: string) =>
    runAction(deviceId, async () => {
      await setPrimaryDevice(deviceId);
    });

  const startRename = (device: RegisteredDevice) => {
    setRenamingDeviceId(device.deviceId);
    setRenameDraft(device.deviceLabel);
  };

  const handleConfirmRename = (deviceId: string) => {
    const label = renameDraft.trim();
    if (!label) return;
    runAction(deviceId, async () => {
      await renameDevice(deviceId, label);
    })
      .then(() => setRenamingDeviceId(null))
      .catch(() => {});
  };

  const handleRevoke = (device: RegisteredDevice) => {
    if (!devices) return;
    const isActive = activeInfo?.activeDeviceId === device.deviceId;
    const otherCandidates = devices.filter(
      (d) => d.deviceId !== device.deviceId && !d.revokedAt,
    );

    if ((isActive || device.isPrimary) && otherCandidates.length === 0) {
      setActionError(
        "Register another device before revoking this one — the business can't be left with no possible writer.",
      );
      return;
    }

    const primaryCandidate = otherCandidates.find((d) => d.isPrimary);
    const replacement = primaryCandidate ?? otherCandidates[0];

    const needsActiveReplacement = isActive ? replacement?.deviceId : undefined;
    const needsPrimaryReplacement = device.isPrimary
      ? replacement?.deviceId
      : undefined;

    const consequence: string[] = [];
    if (needsActiveReplacement) {
      consequence.push(`${replacement?.deviceLabel} will become the active device.`);
    }
    if (needsPrimaryReplacement) {
      consequence.push(`${replacement?.deviceLabel} will become the primary device.`);
    }

    Alert.alert(
      `Revoke ${device.deviceLabel}?`,
      [
        "This device will permanently lose write access and can never become active again.",
        ...consequence,
      ].join(" "),
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revoke",
          style: "destructive",
          onPress: () =>
            runAction(device.deviceId, async () => {
              await revokeDevice(device.deviceId, {
                newActiveDeviceId: needsActiveReplacement,
                newPrimaryDeviceId: needsPrimaryReplacement,
              });
            }).catch(() => {}),
        },
      ],
      { cancelable: true },
    );
  };

  if (loadError) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Devices</Text>
        <Text style={styles.error}>{loadError}</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Devices</Text>
      <Text style={styles.hint}>
        Every device registered for this business — who's active, who's
        primary, and how caught-up each one is.
      </Text>
      {devices === null ? (
        <ActivityIndicator size="small" />
      ) : (
        devices.map((device) => {
          const isMe = device.deviceId === myDeviceId;
          const isRevoked = !!device.revokedAt;
          const isActive =
            !isRevoked && activeInfo?.activeDeviceId === device.deviceId;
          const status = isRevoked ? "Revoked" : isActive ? "Active" : "Read-only";
          const checkpoint = isMe ? myCheckpoint : device.lastSyncedServerSeq;
          const syncState = isRevoked
            ? "—"
            : describeSyncState(checkpoint, maxServerSeq);
          const busy = busyDeviceId === device.deviceId;
          const isRenaming = renamingDeviceId === device.deviceId;

          return (
            <View key={device.deviceId} style={styles.deviceRow}>
              <View style={styles.deviceHeaderRow}>
                {isRenaming ? (
                  <TextInput
                    style={styles.renameInput}
                    value={renameDraft}
                    onChangeText={setRenameDraft}
                    autoFocus
                  />
                ) : (
                  <Text style={styles.deviceLabel}>
                    {device.deviceLabel}
                    {isMe ? " (this device)" : ""}
                  </Text>
                )}
                {device.isPrimary && <Text style={styles.primaryBadge}>★ Primary</Text>}
              </View>

              <Text style={styles.metaText}>
                {describePlatform(device.platform)} · {status} · {syncState}
              </Text>
              <Text style={styles.metaText}>
                Last seen {relativeTime(device.lastSeenAt)} · Registered{" "}
                {formatDate(device.registeredAt)}
              </Text>
              {isActive && activeInfo && (
                <Text style={styles.metaText}>
                  {describeReadOnlyReason({
                    activeDeviceLabel: activeInfo.activeDeviceLabel,
                    activeDeviceIsPrimary: activeInfo.activeDeviceIsPrimary,
                  })}
                </Text>
              )}

              {!isRevoked && (
                <View style={styles.actionsRow}>
                  {isMe && !isActive && (
                    <Pressable
                      onPress={handleMakeActive}
                      disabled={busy}
                      style={styles.button}
                      accessibilityRole="button"
                    >
                      <Text style={styles.buttonText}>
                        {activeInfo?.requestingIsPrimary
                          ? "Take over as active"
                          : "Make this device active"}
                      </Text>
                    </Pressable>
                  )}

                  {!device.isPrimary && (
                    <Pressable
                      onPress={() =>
                        handleSetPrimary(device.deviceId).catch(() => {})
                      }
                      disabled={busy}
                      style={styles.button}
                      accessibilityRole="button"
                    >
                      <Text style={styles.buttonText}>Set as primary</Text>
                    </Pressable>
                  )}

                  {isRenaming ? (
                    <>
                      <Pressable
                        onPress={() => handleConfirmRename(device.deviceId)}
                        disabled={busy}
                        style={styles.button}
                        accessibilityRole="button"
                      >
                        <Text style={styles.buttonText}>Save</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setRenamingDeviceId(null)}
                        disabled={busy}
                        style={styles.button}
                        accessibilityRole="button"
                      >
                        <Text style={styles.buttonText}>Cancel</Text>
                      </Pressable>
                    </>
                  ) : (
                    <Pressable
                      onPress={() => startRename(device)}
                      disabled={busy}
                      style={styles.button}
                      accessibilityRole="button"
                    >
                      <Text style={styles.buttonText}>Rename</Text>
                    </Pressable>
                  )}

                  <Pressable
                    onPress={() => handleRevoke(device)}
                    disabled={busy}
                    style={[styles.button, styles.dangerButton]}
                    accessibilityRole="button"
                  >
                    {busy ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <Text style={styles.buttonText}>Revoke</Text>
                    )}
                  </Pressable>
                </View>
              )}
            </View>
          );
        })
      )}
      {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 12,
    marginVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    gap: 8,
  },
  title: { fontSize: 14, fontWeight: "600" },
  hint: { fontSize: 12, color: "#767676" },
  deviceRow: {
    borderTopWidth: 1,
    borderTopColor: "#eee",
    paddingTop: 8,
    marginTop: 4,
    gap: 4,
  },
  deviceHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  deviceLabel: { fontSize: 13, fontWeight: "600" },
  primaryBadge: { fontSize: 11, color: "#b8860b", fontWeight: "600" },
  metaText: { fontSize: 12, color: "#555" },
  renameInput: {
    flex: 1,
    fontSize: 13,
    backgroundColor: "#fff",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#ccc",
  },
  actionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 2,
  },
  button: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#333",
  },
  dangerButton: { borderColor: "#c0392b" },
  buttonText: { fontSize: 11, fontWeight: "600" },
  error: { color: "#c0392b", fontSize: 12, marginTop: 4 },
});
