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
 *
 * UI polish Phase 4: presentation only — shared card, labelled fields and
 * buttons. Same data calls, gating and copy.
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
import { Button, Card, Field, PageHeader } from "../../ui";
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

  const kv = (label: string, value: string): JSX.Element => (
    <li className="ui-move">
      <span className="ui-muted">{label}</span>
      <strong>{value}</strong>
    </li>
  );

  return (
    <div className="aifa-page">
      <PageHeader title="Settings" />

      <Card
        title="Business profile"
        actions={
          canConfigure && !editingProfile ? (
            <Button size="sm" variant="secondary" onClick={() => setEditingProfile(true)}>
              Edit
            </Button>
          ) : undefined
        }
      >
        {loadError && (
          <p className="aifa-alert aifa-alert--danger" role="alert">
            {loadError}
          </p>
        )}
        {!settings ? (
          <p className="ui-muted">{loadError ? "Not available." : "Loading…"}</p>
        ) : editingProfile ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!profileBusy) void handleSaveProfile();
            }}
          >
            <div className="ui-form-grid">
              <Field label="Business name">
                {(p) => <input {...p} className="ui-input" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />}
              </Field>
              <Field label="Industry">
                {(p) => <input {...p} className="ui-input" value={industry} onChange={(e) => setIndustry(e.target.value)} />}
              </Field>
            </div>
            <div className="ui-form-actions">
              <Button type="submit" variant="primary" loading={profileBusy}>
                {profileBusy ? "Saving…" : "Save"}
              </Button>
              <Button variant="secondary" disabled={profileBusy} onClick={() => setEditingProfile(false)}>
                Cancel
              </Button>
            </div>
            {profileError && (
              <p className="aifa-alert aifa-alert--danger" role="alert">
                {profileError}
              </p>
            )}
          </form>
        ) : (
          <ul className="ui-move-list">
            {kv("Business name", settings.business_name ?? "—")}
            {kv("Industry", settings.industry ?? "—")}
          </ul>
        )}
        {!canConfigure && (
          <p className="ui-muted">
            Editing requires `settings: configure` access — contact an Owner or Bookkeeper to change this.
          </p>
        )}
      </Card>

      <Card
        title="Notifications"
        actions={
          canConfigure && !editingNotifications ? (
            <Button size="sm" variant="secondary" onClick={() => setEditingNotifications(true)}>
              Edit
            </Button>
          ) : undefined
        }
      >
        {!settings ? (
          <p className="ui-muted">{loadError ? "Not available." : "Loading…"}</p>
        ) : editingNotifications ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!notificationsBusy) void handleSaveNotifications();
            }}
          >
            <div className="ui-check-group">
              <label className="ui-check">
                <input type="checkbox" checked={quietHoursEnabled} onChange={(e) => setQuietHoursEnabled(e.target.checked)} />
                Quiet hours enabled
              </label>
              <label className="ui-check">
                <input type="checkbox" checked={notifyActionNeeded} onChange={(e) => setNotifyActionNeeded(e.target.checked)} />
                Notify: action needed
              </label>
              <label className="ui-check">
                <input
                  type="checkbox"
                  checked={notifyConfirmationRequest}
                  onChange={(e) => setNotifyConfirmationRequest(e.target.checked)}
                />
                Notify: confirmation request
              </label>
            </div>
            <div className="ui-form-grid" style={{ marginTop: 12 }}>
              <Field label="Start hour">
                {(p) => (
                  <input
                    {...p}
                    className="ui-input"
                    type="number"
                    min={0}
                    max={23}
                    value={quietHoursStartHour}
                    onChange={(e) => setQuietHoursStartHour(Number(e.target.value))}
                  />
                )}
              </Field>
              <Field label="End hour">
                {(p) => (
                  <input
                    {...p}
                    className="ui-input"
                    type="number"
                    min={0}
                    max={23}
                    value={quietHoursEndHour}
                    onChange={(e) => setQuietHoursEndHour(Number(e.target.value))}
                  />
                )}
              </Field>
            </div>
            <div className="ui-form-actions">
              <Button type="submit" variant="primary" loading={notificationsBusy}>
                {notificationsBusy ? "Saving…" : "Save"}
              </Button>
              <Button variant="secondary" disabled={notificationsBusy} onClick={() => setEditingNotifications(false)}>
                Cancel
              </Button>
            </div>
            {notificationsError && (
              <p className="aifa-alert aifa-alert--danger" role="alert">
                {notificationsError}
              </p>
            )}
          </form>
        ) : (
          <ul className="ui-move-list">
            {kv(
              "Quiet hours",
              settings.quiet_hours_enabled ? `${settings.quiet_hours_start_hour}:00–${settings.quiet_hours_end_hour}:00` : "Off",
            )}
            {kv("Notify: action needed", settings.notify_action_needed ? "On" : "Off")}
            {kv("Notify: confirmation request", settings.notify_confirmation_request ? "On" : "Off")}
          </ul>
        )}
      </Card>

      <WebsiteSettingsCard businessId={businessId} canConfigure={canConfigure} />

      <PublicSiteLinkCard businessId={businessId} canConfigure={canConfigure} />

      <BYOKSettingsCard />

      <Card title="This browser">
        <p className="ui-muted" style={{ marginTop: 0 }}>
          This browser is registered as device <code>{deviceId.slice(0, 8)}…</code>.
        </p>
        <Button variant="secondary" icon="logout" onClick={() => void signOut()}>
          Sign out
        </Button>
      </Card>

      <DevicesPanel db={db} businessId={businessId} deviceId={deviceId} dek={dek} />
    </div>
  );
}
