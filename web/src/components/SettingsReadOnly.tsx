import { useEffect, useState } from "react";

import { getAppSettings, type AppSettings } from "@aifa/core/db/appSettingsRepository";
import type { SqlDb } from "@aifa/core/db/types";

import { signOut } from "../lib/auth";

interface Props {
  db: SqlDb;
  businessId: string;
  deviceId: string;
}

/** Settings — Phase 2a "Read-only" row (Vol 12_0 §4). Editing (business profile, notification prefs) is Phase 2b; this sprint only surfaces what's already saved, plus the device id this browser registered as (Sprint 15's register_device, no dedicated Devices panel yet — that's Sprint 19). */
export function SettingsReadOnly({ db, businessId, deviceId }: Props): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    getAppSettings(db, businessId).then(setSettings);
  }, [db, businessId]);

  return (
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
        Full editing, and the Devices panel (Vol 12_1 §8), arrive in later
        sprints — this browser is already registered as device{" "}
        <code>{deviceId.slice(0, 8)}…</code>.
      </p>
      <button onClick={() => void signOut()}>Sign out</button>
    </div>
  );
}
