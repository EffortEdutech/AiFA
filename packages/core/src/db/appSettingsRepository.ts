/**
 * Settings & Business Configuration — Phase 1 persisted store (Vol 7_7).
 *
 * A single row per business (Phase 1 is single-business-per-device, same
 * assumption db/client.ts's getLocalBusinessId already makes) covers two
 * of Vol 7_7's configuration domains in one table: Business Profile
 * (business_name, industry) and Notifications (the full owner-configurable
 * quiet-hours window plus per-kind on/off, closing the gap Sprint 8's own
 * doc explicitly deferred -- see notificationEngine.ts's
 * DEFAULT_QUIET_HOURS_* comment). Finance PKA Management (read-only version
 * display) needs no persisted row -- it reads pka/accounting_rules.json
 * directly (see SettingsScreen.tsx). AI Autonomy and Access & Team are
 * Phase 2 (Vol 0_1 §4, Vol 8_1 §4) and have no columns here at all -- this
 * table only grows to cover them when those features are actually built,
 * not in advance of them.
 *
 * SQLite has no native boolean type; the *_enabled/notify_* columns are
 * INTEGER 0/1 at rest, translated to/from JS booleans at this module's
 * boundary only -- callers never see a 0/1 literal.
 */
import type { SqlDb } from "./types";
import { assertSyncGateOk, enqueueSyncableWrite } from "../sync/syncHooks";

export interface AppSettings {
  business_id: string;
  business_name: string | null;
  industry: string | null;
  quiet_hours_enabled: boolean;
  quiet_hours_start_hour: number;
  quiet_hours_end_hour: number;
  notify_action_needed: boolean;
  notify_confirmation_request: boolean;
  /** Sprint 11 (Vol 8_6 Section 4) -- set by recordBackupCompleted after a successful backupService.ts upload; null until the first backup ever succeeds on this device. */
  last_backup_at: string | null;
  updated_at: string;
}

/** Mirrors notificationEngine.ts's own Sprint 8 defaults -- a business with no saved settings yet behaves exactly as it did before this table existed. */
export const DEFAULT_APP_SETTINGS: Omit<
  AppSettings,
  "business_id" | "updated_at"
> = {
  business_name: null,
  industry: null,
  quiet_hours_enabled: true,
  quiet_hours_start_hour: 21,
  quiet_hours_end_hour: 8,
  notify_action_needed: true,
  notify_confirmation_request: true,
  last_backup_at: null,
};

interface AppSettingsRow {
  business_id: string;
  business_name: string | null;
  industry: string | null;
  quiet_hours_enabled: number;
  quiet_hours_start_hour: number;
  quiet_hours_end_hour: number;
  notify_action_needed: number;
  notify_confirmation_request: number;
  last_backup_at: string | null;
  updated_at: string;
}

function rowToSettings(row: AppSettingsRow): AppSettings {
  return {
    business_id: row.business_id,
    business_name: row.business_name,
    industry: row.industry,
    quiet_hours_enabled: !!row.quiet_hours_enabled,
    quiet_hours_start_hour: row.quiet_hours_start_hour,
    quiet_hours_end_hour: row.quiet_hours_end_hour,
    notify_action_needed: !!row.notify_action_needed,
    notify_confirmation_request: !!row.notify_confirmation_request,
    last_backup_at: row.last_backup_at,
    updated_at: row.updated_at,
  };
}

/**
 * Returns this business's settings, or the Sprint 8 defaults (not yet
 * persisted) when no row exists -- e.g. a business that has never opened
 * Settings, or an app upgraded from before this migration existed.
 */
export async function getAppSettings(
  db: SqlDb,
  businessId: string,
): Promise<AppSettings> {
  const rows = await db.queryAll<AppSettingsRow>(
    `SELECT * FROM app_settings WHERE business_id = ? LIMIT 1;`,
    [businessId],
  );
  if (rows.length === 0) {
    return {
      business_id: businessId,
      ...DEFAULT_APP_SETTINGS,
      updated_at: new Date(0).toISOString(),
    };
  }
  return rowToSettings(rows[0]);
}

/**
 * Sprint 16 — exported (was module-private) so sync/applyEnvelope.ts can
 * apply a pulled `app_settings` upsert envelope as a raw last-write-wins
 * snapshot, per Vol 12_1 Section 7.3, without going through
 * updateBusinessProfile/updateNotificationPreferences (both of which
 * merge against whatever is CURRENTLY local — the wrong basis for
 * applying a remote change, same reasoning as
 * businessKnowledgeRepository.ts's applyPulledBusinessKnowledgeEntry).
 * ON CONFLICT DO UPDATE below already makes this naturally idempotent
 * under envelope replay.
 */
export async function writeSettings(db: SqlDb, settings: AppSettings): Promise<void> {
  await db.execute(
    `INSERT INTO app_settings
       (business_id, business_name, industry, quiet_hours_enabled,
        quiet_hours_start_hour, quiet_hours_end_hour, notify_action_needed,
        notify_confirmation_request, last_backup_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(business_id) DO UPDATE SET
       business_name = excluded.business_name,
       industry = excluded.industry,
       quiet_hours_enabled = excluded.quiet_hours_enabled,
       quiet_hours_start_hour = excluded.quiet_hours_start_hour,
       quiet_hours_end_hour = excluded.quiet_hours_end_hour,
       notify_action_needed = excluded.notify_action_needed,
       notify_confirmation_request = excluded.notify_confirmation_request,
       last_backup_at = excluded.last_backup_at,
       updated_at = excluded.updated_at;`,
    [
      settings.business_id,
      settings.business_name,
      settings.industry,
      settings.quiet_hours_enabled ? 1 : 0,
      settings.quiet_hours_start_hour,
      settings.quiet_hours_end_hour,
      settings.notify_action_needed ? 1 : 0,
      settings.notify_confirmation_request ? 1 : 0,
      settings.last_backup_at,
      settings.updated_at,
    ],
  );
}

export interface BusinessProfileUpdate {
  businessName?: string | null;
  industry?: string | null;
}

/** Vol 7_7's "Business Profile" configuration domain. */
export async function updateBusinessProfile(
  db: SqlDb,
  businessId: string,
  update: BusinessProfileUpdate,
  now: Date = new Date(),
): Promise<AppSettings> {
  await assertSyncGateOk(db);
  const current = await getAppSettings(db, businessId);
  const merged: AppSettings = {
    ...current,
    business_id: businessId,
    business_name:
      update.businessName !== undefined
        ? update.businessName
        : current.business_name,
    industry:
      update.industry !== undefined ? update.industry : current.industry,
    updated_at: now.toISOString(),
  };
  await writeSettings(db, merged);
  await enqueueSyncableWrite(db, "app_settings", "upsert", merged);
  return merged;
}

export interface NotificationPreferencesUpdate {
  quietHoursEnabled?: boolean;
  quietHoursStartHour?: number;
  quietHoursEndHour?: number;
  notifyActionNeeded?: boolean;
  notifyConfirmationRequest?: boolean;
}

/**
 * Vol 7_7's "Notifications" configuration domain -- the full
 * owner-configurable quiet-hours control the Sprint 8 doc's own "Safe to
 * Carry Over" note deferred to this sprint, plus per-kind on/off toggles
 * (Vol 7_5 §2's two Phase 1 "High" urgency categories). Hours are
 * validated to the 0-23 range here rather than trusting the caller (the
 * Settings screen), since notificationEngine.ts's isWithinQuietHours has
 * no bounds-checking of its own.
 */
export async function updateNotificationPreferences(
  db: SqlDb,
  businessId: string,
  update: NotificationPreferencesUpdate,
  now: Date = new Date(),
): Promise<AppSettings> {
  await assertSyncGateOk(db);
  const current = await getAppSettings(db, businessId);

  const clampHour = (hour: number): number =>
    Math.min(23, Math.max(0, Math.round(hour)));

  const merged: AppSettings = {
    ...current,
    business_id: businessId,
    quiet_hours_enabled:
      update.quietHoursEnabled !== undefined
        ? update.quietHoursEnabled
        : current.quiet_hours_enabled,
    quiet_hours_start_hour:
      update.quietHoursStartHour !== undefined
        ? clampHour(update.quietHoursStartHour)
        : current.quiet_hours_start_hour,
    quiet_hours_end_hour:
      update.quietHoursEndHour !== undefined
        ? clampHour(update.quietHoursEndHour)
        : current.quiet_hours_end_hour,
    notify_action_needed:
      update.notifyActionNeeded !== undefined
        ? update.notifyActionNeeded
        : current.notify_action_needed,
    notify_confirmation_request:
      update.notifyConfirmationRequest !== undefined
        ? update.notifyConfirmationRequest
        : current.notify_confirmation_request,
    updated_at: now.toISOString(),
  };
  await writeSettings(db, merged);
  await enqueueSyncableWrite(db, "app_settings", "upsert", merged);
  return merged;
}

/**
 * Sprint 11 (Vol 8_6 Section 4) -- called by backupService.ts's
 * uploadBackup after a successful upload. Deliberately separate from
 * updateNotificationPreferences/updateBusinessProfile -- this is a
 * system-recorded fact, not an owner-editable preference, so it has no
 * corresponding "update" input type a UI could misuse to fake a backup
 * that never happened.
 */
export async function recordBackupCompleted(
  db: SqlDb,
  businessId: string,
  now: Date = new Date(),
): Promise<AppSettings> {
  await assertSyncGateOk(db);
  const current = await getAppSettings(db, businessId);
  const merged: AppSettings = {
    ...current,
    business_id: businessId,
    last_backup_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  await writeSettings(db, merged);
  await enqueueSyncableWrite(db, "app_settings", "upsert", merged);
  return merged;
}
