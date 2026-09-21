/**
 * Business Settings — Sprint 48 (Vol 12_0 §4's original Phase 2b intent,
 * "Settings & business configuration: Read-only -> Full parity").
 *
 * Promotes `components/SettingsReadOnly.tsx` (superseded, left in the
 * tree, no longer wired from AppShell) to full read/write for Business
 * Profile and Notifications — both already had real write functions in
 * `appSettingsRepository.ts` (`updateBusinessProfile`,
 * `updateNotificationPreferences`) since Phase 1; only the UI to call
 * them was ever missing. This is local-first data (SQLite via `db`,
 * synced through `enqueueSyncableWrite`), unlike every other Sprint
 * 39-47 page, which reads/writes Supabase directly — Settings has
 * always been the one local-first-only domain in this app (Finance PKA
 * Management and AI Autonomy are Phase 2/not-yet-built, per that
 * repository's own header, and stay out of scope here for the same
 * reason).
 *
 * WRITE GATING: edit controls are hidden (read-only view shown instead)
 * unless the caller's membership holds `configure` on `settings`
 * (`getGrantedCapabilitiesForDomain`, the same pattern every other
 * Sprint 45-47 gated page uses) — solo/null-membership is always
 * unrestricted, matching `AccessContext`'s own posture. A write is also
 * naturally blocked by `assertSyncGateOk` (inside both update functions)
 * if this device does not currently hold the active-device lock (Vol
 * 12_1 §6a.3) — that error is surfaced verbatim, not silently retried.
 *
 * The Devices panel (Vol 12_1 §8) is unchanged from Sprint 19/38 —
 * still rendered below, per Vol 12_2 §5.4's "low-risk, mostly
 * relocation" instruction.
 */
import { useCallback, useEffect, useState } from "react";

import { getAppSettings, updateBusinessProfile, updateNotificationPreferences, type AppSettings } from "@aifa/core/db/appSettingsRepository";
import type { SqlDb } from "@aifa/core/db/types";

import { BYOKSettingsCard } from "../../components/BYOKSettingsCard";
import { WebsiteSettingsCard } from "../../components/WebsiteSettingsCard";
import { PublicSiteLinkCard } from "../../components/PublicSiteLinkCard";
import { DevicesPanel } from "../../components/DevicesPanel";
// DomainSettingsCard (Sprint 65) intentionally not imported here as of
// Sprint 70 (21 September 2026 owner decision): binding a custom domain is
// now an Operator-configured add-on, not a Business Owner self-service
// step — PublicSiteLinkCard is what every Owner sees instead. The
// component, domains.ts, and the verify-domain edge function are all left
// in place, unchanged, ready to be wired into an Operator-only surface.
import { signOut } from "../../lib/auth";
import { getGrantedCapabilitiesForDomain } from "../../lib/membership";
import { useAccess } from "../AccessContext";

interface Props {
  db: SqlDb;
  businessId: string;
  deviceId: string;
  dek: Uint8Array;
}

export function BusinessSettingsPage({ db, businessId, deviceId, dek }: Props): JSX.Element {
  const { myMembership, accessModel } = useAccess();

  const [canConfigure, setCanConfigure] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (accessModel === "solo" || myMembership === null) {
      setCanConfigure(true);
      return;
    }
    getGrantedCapabilitiesForDomain(myMembership.roleId, "settings")
      .then((caps) => {
        if (!cancelled) setCanConfigure(caps.has("configure"));
      })
      .catch(() => {
        if (!cancelled) setCanConfigure(false); // fail closed
      });
    return () => {
      cancelled = true;
    };
  }, [accessModel, myMembership]);

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editingProfile, setEditingProfile] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [editingNotifications, setEditingNotifications] = useState(false);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(true);
  const [quietHoursStartHour, setQuietHoursStartHour] = useState(21);
  const [quietHoursEndHour, setQuietHoursEndHour] = useState(8);
  const [notifyActionNeeded, setNotifyActionNeeded] = useState(true);
  const [notifyConfirmationRequest, setNotifyConfirmationRequest] = useState(true);
  const [notificationsBusy, setNotificationsBusy] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const s = await getAppSettings(db, businessId);
      setSettings(s);
      setBusinessName(s.business_name ?? "");
      setIndustry(s.industry ?? "");
      setQuietHoursEnabled(s.quiet_hours_enabled);
      setQuietHoursStartHour(s.quiet_hours_start_hour);
      setQuietHoursEndHour(s.quiet_hours_end_hour);
      setNotifyActionNeeded(s.notify_action_needed);
      setNotifyConfirmationRequest(s.notify_confirmation_request);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load settings.");
    }
  }, [db, businessId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function handleSaveProfile(): Promise<void> {
    setProfileBusy(true);
    setProfileError(null);
    try {
      const updated = await updateBusinessProfile(db, businessId, {
        businessName: businessName.trim() || null,
        industry: industry.trim() || null,
      });
      setSettings(updated);
      setEditingProfile(false);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Could not save the business profile.");
    } finally {
      setProfileBusy(false);
    }
  }

  async function handleSaveNotifications(): Promise<void> {
    setNotificationsBusy(true);
    setNotificationsError(null);
    try {
      const updated = await updateNotificationPreferences(db, businessId, {
        quietHoursEnabled,
        quietHoursStartHour,
        quietHoursEndHour,
        notifyActionNeeded,
        notifyConfirmationRequest,
      });
      setSettings(updated);
      setEditingNotifications(false);
    } catch (err) {
      setNotificationsError(err instanceof Error ? err.message : "Could not save notification preferences.");
    } finally {
      setNotificationsBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Business profile</h2>
          {canConfigure && !editingProfile && <button onClick={() => setEditingProfile(true)}>Edit</button>}
        </div>
        {loadError && <p className="error">{loadError}</p>}
        {!settings ? (
          <p className="muted">Loading…</p>
        ) : editingProfile ? (
          <div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <input placeholder="Business name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} style={{ padding: 6 }} />
              <input placeholder="Industry" value={industry} onChange={(e) => setIndustry(e.target.value)} style={{ padding: 6 }} />
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button onClick={() => void handleSaveProfile()} disabled={profileBusy}>
                {profileBusy ? "Saving…" : "Save"}
              </button>
              <button onClick={() => setEditingProfile(false)} disabled={profileBusy}>
                Cancel
              </button>
            </div>
            {profileError && <p className="error">{profileError}</p>}
          </div>
        ) : (
          <dl>
            <dt className="muted">Business name</dt>
            <dd>{settings.business_name ?? "—"}</dd>
            <dt className="muted">Industry</dt>
            <dd>{settings.industry ?? "—"}</dd>
          </dl>
        )}
        {!canConfigure && (
          <p className="muted">
            Editing requires `settings: configure` access — contact an Owner or Bookkeeper to change this.
          </p>
        )}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Notifications</h2>
          {canConfigure && !editingNotifications && <button onClick={() => setEditingNotifications(true)}>Edit</button>}
        </div>
        {!settings ? (
          <p className="muted">Loading…</p>
        ) : editingNotifications ? (
          <div>
            <label className="row" style={{ gap: 4 }}>
              <input type="checkbox" checked={quietHoursEnabled} onChange={(e) => setQuietHoursEnabled(e.target.checked)} />
              Quiet hours enabled
            </label>
            <div className="row" style={{ gap: 8, marginTop: 6 }}>
              <label>
                Start hour{" "}
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={quietHoursStartHour}
                  onChange={(e) => setQuietHoursStartHour(Number(e.target.value))}
                  style={{ width: 60, padding: 4 }}
                />
              </label>
              <label>
                End hour{" "}
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={quietHoursEndHour}
                  onChange={(e) => setQuietHoursEndHour(Number(e.target.value))}
                  style={{ width: 60, padding: 4 }}
                />
              </label>
            </div>
            <label className="row" style={{ gap: 4, marginTop: 6 }}>
              <input type="checkbox" checked={notifyActionNeeded} onChange={(e) => setNotifyActionNeeded(e.target.checked)} />
              Notify: action needed
            </label>
            <label className="row" style={{ gap: 4, marginTop: 6 }}>
              <input
                type="checkbox"
                checked={notifyConfirmationRequest}
                onChange={(e) => setNotifyConfirmationRequest(e.target.checked)}
              />
              Notify: confirmation request
            </label>
            <div className="row" style={{ marginTop: 8 }}>
              <button onClick={() => void handleSaveNotifications()} disabled={notificationsBusy}>
                {notificationsBusy ? "Saving…" : "Save"}
              </button>
              <button onClick={() => setEditingNotifications(false)} disabled={notificationsBusy}>
                Cancel
              </button>
            </div>
            {notificationsError && <p className="error">{notificationsError}</p>}
          </div>
        ) : (
          <dl>
            <dt className="muted">Quiet hours</dt>
            <dd>
              {settings.quiet_hours_enabled ? `${settings.quiet_hours_start_hour}:00–${settings.quiet_hours_end_hour}:00` : "Off"}
            </dd>
            <dt className="muted">Notify: action needed</dt>
            <dd>{settings.notify_action_needed ? "On" : "Off"}</dd>
            <dt className="muted">Notify: confirmation request</dt>
            <dd>{settings.notify_confirmation_request ? "On" : "Off"}</dd>
          </dl>
        )}
      </div>

      <WebsiteSettingsCard businessId={businessId} canConfigure={canConfigure} />

      <PublicSiteLinkCard businessId={businessId} canConfigure={canConfigure} />

      <BYOKSettingsCard />

      <div className="card">
        <p className="muted">
          This browser is registered as device <code>{deviceId.slice(0, 8)}…</code>.
        </p>
        <button onClick={() => void signOut()}>Sign out</button>
      </div>

      <DevicesPanel db={db} businessId={businessId} deviceId={deviceId} dek={dek} />
    </>
  );
}
