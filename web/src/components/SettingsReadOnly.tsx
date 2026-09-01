import { useEffect, useState } from "react";

import { getAppSettings, type AppSettings } from "@aifa/core/db/appSettingsRepository";
import type { SqlDb } from "@aifa/core/db/types";

import { DevicesPanel } from "./DevicesPanel";
import { signOut } from "../lib/auth";

interface Props {
  db: SqlDb;
  businessId: string;
  deviceId: string;
  /** Sprint 19 — this browser's raw Business DEK bytes, needed by DevicesPanel's "Make this device active" action (requestActivation/requestPrimaryTakeover). */
  dek: Uint8Array;
}

/** Settings — Phase 2a "Read-only" row (Vol 12_0 §4) for business profile/notifications (editing those is still Phase 2b). Sprint 19 adds the full Devices panel (Vol 12_1 §8), which is NOT part of that read-only phasing — device sync management is its own, separately-specified scope. */
export function SettingsReadOnly({ db, businessId, deviceId, dek }: Props): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    getAppSettings(db, businessId).then(setSettings);
  }, [db, businessId]);

  return (
    <>
    <div className="card">
      <h2 style={{ fontSize: 16, marginTop: 0 }}>Business profile (read-only)</h2>
      {settings ? (
        <dl>
          <dt className="muted">Business name</dt>
          <dd>{settings.business_name ?? "—"}</dd>
          <dt className="muted">Industry</dt>
          <dd>{settings.industry ?? "—"}</dd>
          <dt className="muted">Quiet hours</dt>
          <dd>
            {settings.quiet_hours_enabled
              ? `${settings.quiet_hours_start_hour}:00–${settings.quiet_hours_end_hour}:00`
              : "Off"}
          </dd>
        </dl>
      ) : (
        <p className="muted">Loading…</p>
      )}
      <p className="muted">
        Full business-profile/notification editing arrives in a later
        sprint (Phase 2b) — this browser is registered as device{" "}
        <code>{deviceId.slice(0, 8)}…</code>.
      </p>
      <button onClick={() => void signOut()}>Sign out</button>
    </div>

    <DevicesPanel db={db} businessId={businessId} deviceId={deviceId} dek={dek} />
    </>
  );
}
