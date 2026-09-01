/**
 * Sprint 16 (Vol 12_1 Section 6a.3, Section 8) — the read-only UI state
 * the DoD requires: "the owner sees why (which device is active) and how
 * to reclaim (request activation), not just a generic disabled screen."
 * Deliberately minimal, same "single unobtrusive strip" pattern as
 * ConnectivityBanner.tsx (Sprint 9) — full Devices-panel visibility
 * (every device's label/platform/sync state, Section 8's table) is
 * Sprint 19's job, not this sprint's.
 *
 * Sprint 17 (Vol 12_1 Section 6a.5): the "Make this device active" action
 * now runs through the real handoff protocol instead of calling
 * requestActivation unconditionally -- resolveActivationConfirmation
 * (@aifa/core/sync/handoff.ts) decides whether this device's own
 * primary-vs-not status and the current active device's apparent in-use
 * state require a confirmation prompt at all, and if so which one (the
 * fuller non-primary caution prompt, or the primary device's lightweight
 * single-tap confirmation) -- the decision logic itself lives in
 * @aifa/core so it stays testable without mocking React Native's Alert,
 * and reusable by Sprint 18/19's web client. This component's own job is
 * just: call that resolver, show the right RN Alert if `kind` isn't
 * "none", and call requestActivation or requestPrimaryTakeover
 * accordingly. describeReadOnlyReason (same core module) supplies the
 * banner's own message text, distinguishing a primary-device takeover
 * from an ordinary handoff per Section 6a.5's "the demoted device is
 * told why."
 *
 * This does NOT itself decide whether to render — the caller passes the
 * current write-access state (from syncService.ts's getActiveDeviceInfo,
 * refreshed on the same pull cycle useSyncResume.ts already runs, plus
 * Sprint 17's useDemotionPoll.ts for the continuously-online case) so
 * this component stays close to a pure presentational piece, easy to
 * place in App.tsx next to ConnectivityBanner the same way that file's
 * own comment anticipated ("cross-cutting, not separate screens").
 */
import {
  describeReadOnlyReason,
  resolveActivationConfirmation,
} from "@aifa/core/sync/handoff";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { requestActivation, requestPrimaryTakeover } from "@/db/syncService";

export interface ReadOnlyBannerProps {
  isActiveDevice: boolean;
  activeDeviceId: string | null;
  /** Human-readable label of whichever device currently holds write access, if known — Section 5a.1's "Active" device state is server-authoritative; a null here means "not known yet," not "no device is active." */
  activeDeviceLabel: string | null;
  activeDeviceIsPrimary: boolean;
  /** ISO timestamp — Vol 12_1 Section 6a.1's "genuinely in use" signal, kept fresh by touchDeviceHeartbeat (Sprint 17). */
  activeDeviceLastSeenAt: string | null;
  /** Is THIS device (deviceId below) the owner-designated primary? Drives which confirmation flow applies. */
  requestingIsPrimary: boolean;
  businessId: string;
  deviceId: string;
  dek: Uint8Array;
  onActivated?: () => void;
}

export function ReadOnlyBanner({
  isActiveDevice,
  activeDeviceId,
  activeDeviceLabel,
  activeDeviceIsPrimary,
  activeDeviceLastSeenAt,
  requestingIsPrimary,
  businessId,
  deviceId,
  dek,
  onActivated,
}: ReadOnlyBannerProps) {
  const [isRequesting, setIsRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isActiveDevice) return null;

  const performActivation = async () => {
    setIsRequesting(true);
    setError(null);
    try {
      if (requestingIsPrimary) {
        await requestPrimaryTakeover(businessId, deviceId, dek);
      } else {
        await requestActivation(businessId, deviceId, dek);
      }
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

  const handleRequestActivation = () => {
    const confirmation = resolveActivationConfirmation({
      requestingIsPrimary,
      requestingDeviceId: deviceId,
      activeDeviceId,
      activeDeviceLabel,
      activeDeviceLastSeenAt,
    });

    if (confirmation.kind === "none") {
      performActivation().catch(() => {});
      return;
    }

    // Vol 12_1 Section 6a.5: the primary path's "lightweight" prompt is a
    // single Confirm action with no detail line; the non-primary
    // "caution" prompt names the device and its apparent in-use state.
    // Both still require an explicit tap -- the 2026-08-31 amendment this
    // project's architecture memory records ruled out zero-confirmation
    // entirely, even for primary takeover.
    Alert.alert(
      confirmation.title,
      confirmation.message || undefined,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: confirmation.confirmLabel,
          style: confirmation.kind === "caution" ? "destructive" : "default",
          onPress: () => performActivation().catch(() => {}),
        },
      ],
      { cancelable: true },
    );
  };

  const reasonText = describeReadOnlyReason({
    activeDeviceLabel,
    activeDeviceIsPrimary,
  });

  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.text}>{reasonText}</Text>
      <Pressable
        onPress={handleRequestActivation}
        disabled={isRequesting}
        style={styles.button}
        accessibilityRole="button"
      >
        {isRequesting ? (
          <ActivityIndicator size="small" color="#fff6e5" />
        ) : (
          <Text style={styles.buttonText}>
            {requestingIsPrimary
              ? "Take over as active device"
              : "Make this device active"}
          </Text>
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
