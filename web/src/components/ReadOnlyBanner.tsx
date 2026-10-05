import { useState } from "react";

import {
  describeReadOnlyReason,
  resolveActivationConfirmation,
} from "@aifa/core/sync/handoff";
import type { SqlDb } from "@aifa/core/db/types";

import { requestActivation, requestPrimaryTakeover, type ActiveDeviceInfo } from "../lib/syncService";
import { Button, ConfirmDialog } from "../ui";

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
 * @aifa/core/sync/handoff).
 *
 * UI polish Phase 2: the confirmation that used `window.confirm` now uses
 * the ui kit's ConfirmDialog (same title and message from the handoff
 * logic, themed and keyboard-safe). The read-only notice itself — the
 * disclosure that this device cannot write — is unchanged in wording.
 */
export function ReadOnlyBanner({ db, businessId, deviceId, dek, info, onActivated }: Props): JSX.Element | null {
  const [isRequesting, setIsRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
  } | null>(null);

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

    setPendingConfirmation({
      title: confirmation.title || "Make this device active?",
      message: confirmation.message,
      confirmLabel: confirmation.confirmLabel || "Confirm",
    });
  };

  const reasonText = describeReadOnlyReason({
    activeDeviceLabel: info.activeDeviceLabel,
    activeDeviceIsPrimary: info.activeDeviceIsPrimary,
  });

  return (
    <>
      <div role="alert" className="aifa-banner aifa-banner--warning">
        <span>{reasonText}</span>
        <Button size="sm" variant="secondary" onClick={handleRequestActivation} loading={isRequesting}>
          {isRequesting
            ? "Working…"
            : info.requestingIsPrimary
              ? "Take over as active device"
              : "Make this device active"}
        </Button>
        {error && <span className="aifa-banner__error">{error}</span>}
      </div>
      <ConfirmDialog
        open={pendingConfirmation !== null}
        title={pendingConfirmation?.title ?? ""}
        message={pendingConfirmation?.message ?? ""}
        confirmLabel={pendingConfirmation?.confirmLabel}
        onCancel={() => setPendingConfirmation(null)}
        onConfirm={() => {
          setPendingConfirmation(null);
          performActivation().catch(() => {});
        }}
      />
    </>
  );
}
