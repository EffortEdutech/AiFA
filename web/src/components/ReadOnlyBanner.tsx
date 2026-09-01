import { useState } from "react";

import {
  describeReadOnlyReason,
  resolveActivationConfirmation,
} from "@aifa/core/sync/handoff";
import type { SqlDb } from "@aifa/core/db/types";

import { requestActivation, requestPrimaryTakeover, type ActiveDeviceInfo } from "../lib/syncService";

interface Props {
  db: SqlDb;
  businessId: string;
  deviceId: string;
  dek: Uint8Array;
  info: ActiveDeviceInfo;
  onActivated?: () => void;
}

/**
 * Web read-only banner — Sprint 19, the web counterpart to
 * app/src/components/ReadOnlyBanner.tsx. Same handoff logic
 * (resolveActivationConfirmation/describeReadOnlyReason from
 * @aifa/core/sync/handoff), `window.confirm` instead of RN's Alert.alert
 * for the same reason DevicesPanel.tsx (web) uses it — no modal
 * component exists in this package, and this is a smaller investment
 * than building one for a single confirmation dialog.
 */
export function ReadOnlyBanner({ db, businessId, deviceId, dek, info, onActivated }: Props): JSX.Element | null {
  const [isRequesting, setIsRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (info.isActiveDevice) return null;

  const performActivation = async () => {
    setIsRequesting(true);
    setError(null);
    try {
      if (info.requestingIsPrimary) {
        await requestPrimaryTakeover(db, businessId, deviceId, dek);
      } else {
        await requestActivation(db, businessId, deviceId, dek);
      }
      onActivated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not make this device active — try again.");
    } finally {
      setIsRequesting(false);
    }
  };

  const handleRequestActivation = () => {
    const confirmation = resolveActivationConfirmation({
      requestingIsPrimary: info.requestingIsPrimary,
      requestingDeviceId: deviceId,
      activeDeviceId: info.activeDeviceId,
      activeDeviceLabel: info.activeDeviceLabel,
      activeDeviceLastSeenAt: info.activeDeviceLastSeenAt,
    });

    if (confirmation.kind === "none") {
      performActivation().catch(() => {});
      return;
    }

    const proceed = window.confirm(
      [confirmation.title, confirmation.message].filter(Boolean).join("\n\n"),
    );
    if (proceed) performActivation().catch(() => {});
  };

  const reasonText = describeReadOnlyReason({
    activeDeviceLabel: info.activeDeviceLabel,
    activeDeviceIsPrimary: info.activeDeviceIsPrimary,
  });

  return (
    <div
      role="alert"
      style={{
        background: "#4a1f0a",
        color: "#fff6e5",
        padding: "6px 12px",
        textAlign: "center",
        fontSize: 12,
      }}
    >
      <span>{reasonText}</span>{" "}
      <button
        onClick={handleRequestActivation}
        disabled={isRequesting}
        style={{
          marginLeft: 8,
          fontSize: 12,
          padding: "2px 8px",
          background: "transparent",
          color: "#fff6e5",
          border: "1px solid #fff6e5",
          borderRadius: 4,
        }}
      >
        {isRequesting
          ? "Working…"
          : info.requestingIsPrimary
            ? "Take over as active device"
            : "Make this device active"}
      </button>
      {error && (
        <div style={{ color: "#ffb4a3", fontSize: 11, marginTop: 4 }}>{error}</div>
      )}
    </div>
  );
}
