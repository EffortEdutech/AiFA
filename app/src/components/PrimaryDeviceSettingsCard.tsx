/**
 * Sprint 17 (Vol 12_1 Section 6a.5's "owner can view and change which
 * device is primary (simple settings action)" — explicitly the minimal
 * version; full device-management polish (renaming, revoking, last-seen
 * timestamps for every device) is Sprint 19's job per this sprint's own
 * "Safe to Carry Over" section). Lists registered devices with a
 * "Set as primary" action per non-primary row — same self-contained
 * "*SettingsCard" pattern as BYOKSettingsCard.tsx (Sprint 13/14).
 *
 * Deliberately does not attempt device revocation, renaming, or a
 * platform/last-seen table — this card exists only to prove the primary
 * reassignment RPC (Sprint 15's set_primary_device) is reachable from
 * somewhere in the app, matching Sprint 17's Definition of Done rather
 * than reaching ahead into Sprint 19's scope.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  getRegisteredDevices,
  setPrimaryDevice,
  type RegisteredDevice,
} from "@/db/syncService";

export interface PrimaryDeviceSettingsCardProps {
  businessId: string;
}

export default function PrimaryDeviceSettingsCard({
  businessId,
}: PrimaryDeviceSettingsCardProps) {
  const [devices, setDevices] = useState<RegisteredDevice[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settingDeviceId, setSettingDeviceId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const list = await getRegisteredDevices(businessId);
      setDevices(list);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Could not load devices.",
      );
    }
  }, [businessId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const handleSetPrimary = async (deviceId: string) => {
    setSettingDeviceId(deviceId);
    setActionError(null);
    try {
      await setPrimaryDevice(deviceId);
      await load();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not set primary device.",
      );
    } finally {
      setSettingDeviceId(null);
    }
  };

  if (loadError) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Primary device</Text>
        <Text style={styles.error}>{loadError}</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Primary device</Text>
      <Text style={styles.hint}>
        Your primary device can always take over as the active device, with just
        one tap to confirm.
      </Text>
      {devices.length === 0 ? (
        <ActivityIndicator size="small" />
      ) : (
        devices.map((device) => (
          <View key={device.deviceId} style={styles.row}>
            <Text style={styles.deviceLabel}>
              {device.deviceLabel}
              {device.isPrimary ? " (Primary)" : ""}
            </Text>
            {!device.isPrimary && (
              <Pressable
                onPress={() =>
                  handleSetPrimary(device.deviceId).catch(() => {})
                }
                disabled={settingDeviceId !== null}
                style={styles.button}
                accessibilityRole="button"
              >
                {settingDeviceId === device.deviceId ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <Text style={styles.buttonText}>Set as primary</Text>
                )}
              </Pressable>
            )}
          </View>
        ))
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
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
  },
  hint: {
    fontSize: 12,
    color: "#767676",
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  deviceLabel: {
    fontSize: 13,
  },
  button: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#333",
  },
  buttonText: {
    fontSize: 12,
    fontWeight: "600",
  },
  error: {
    color: "#c0392b",
    fontSize: 12,
    marginTop: 4,
  },
});
