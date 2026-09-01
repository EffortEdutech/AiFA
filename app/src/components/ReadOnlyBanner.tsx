/**
 * Sprint 16 (Vol 12_1 Section 6a.3, Section 8) — the read-only UI state
 * the DoD requires: "the owner sees why (which device is active) and how
 * to reclaim (request activation), not just a generic disabled screen."
 * Deliberately minimal, same "single unobtrusive strip" pattern as
 * ConnectivityBanner.tsx (Sprint 9) — full Devices-panel visibility
 * (every device's label/platform/sync state, Section 8's table) is
 * Sprint 19's job, not this sprint's.
 *
 * This does NOT itself decide whether to render — the caller passes the
 * current write-access state (from syncService.ts's getWriteAccessState,
 * refreshed on the same pull cycle useSyncResume.ts already runs) so this
 * component stays a pure presentational piece, easy to place in App.tsx
 * next to ConnectivityBanner the same way that file's own comment
 * anticipated ("cross-cutting, not separate screens").
 */
import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { requestActivation } from "@/db/syncService";

export interface ReadOnlyBannerProps {
  isActiveDevice: boolean;
  /** Human-readable label of whichever device currently holds write access, if known — Section 5a.1's "Active" device state is server-authoritative; a null here means "not known yet," not "no device is active." */
  activeDeviceLabel: string | null;
  businessId: string;
  deviceId: string;
  dek: Uint8Array;
  onActivated?: () => void;
}

export function ReadOnlyBanner({
  isActiveDevice,
  activeDeviceLabel,
  businessId,
  deviceId,
  dek,
  onActivated,
}: ReadOnlyBannerProps) {
  const [isRequesting, setIsRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isActiveDevice) return null;

  const handleRequestActivation = async () => {
    setIsRequesting(true);
    setError(null);
    try {
      await requestActivation(businessId, deviceId, dek);
      onActivated?.();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not make this device active — try again.",
      );
    } finally {
      setIsRequesting(false);
    }
  };

  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.text}>
        {activeDeviceLabel
          ? `${activeDeviceLabel} is currently active — this device is read-only.`
          : "Another device is currently active — this device is read-only."}
      </Text>
      <Pressable
        onPress={handleRequestActivation}
        disabled={isRequesting}
        style={styles.button}
        accessibilityRole="button"
      >
        {isRequesting ? (
          <ActivityIndicator size="small" color="#fff6e5" />
        ) : (
          <Text style={styles.buttonText}>Make this device active</Text>
        )}
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: "#4a1f0a",
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  text: {
    color: "#fff6e5",
    fontSize: 12,
    textAlign: "center",
  },
  button: {
    marginTop: 4,
    alignSelf: "center",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#fff6e5",
  },
  buttonText: {
    color: "#fff6e5",
    fontSize: 12,
    fontWeight: "600",
  },
  error: {
    color: "#ffb4a3",
    fontSize: 11,
    textAlign: "center",
    marginTop: 4,
  },
});
