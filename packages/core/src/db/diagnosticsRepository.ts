/**
 * Owner-facing diagnostics — Vol 8_6 Section 4: "a limited diagnostics
 * view... showing sync status, last backup time, and installed PKA
 * version/health... without technical noise." Sprint 11. Aggregates
 * existing repositories into one summary call so SettingsScreen.tsx
 * doesn't need to know the shape of `business_events`, `app_settings`, or
 * `app_error_log` directly.
 *
 * PKA version/health is deliberately NOT included here -- it was already
 * built in Sprint 10 (SettingsScreen.tsx reads `pka/accounting_rules.json`
 * directly) and needs no new query; duplicating it here would just be a
 * second source of truth for the same one value.
 */
import { getAppSettings } from "./appSettingsRepository";
import { countAppErrorsSince } from "./errorLogRepository";
import type { SqlDb } from "./types";

export interface DiagnosticsSummary {
  /** Business Events currently 'queued' or 'processing' -- Vol 7_4's "saved, will process when back online" state, not yet resolved. */
  queuedCount: number;
  /** captured_at of the oldest still-queued/processing event, if any -- lets the owner see how long something has been waiting. */
  oldestQueuedCapturedAt: string | null;
  /** null until the first backup ever succeeds on this device (Sprint 9's backupService.ts, recorded via appSettingsRepository.ts's recordBackupCompleted). */
  lastBackupAt: string | null;
  /** Count of app_error_log rows in the trailing 24 hours -- a rough "is something wrong lately" signal, not a full log viewer. */
  recentErrorCount24h: number;
}

const RECENT_ERROR_WINDOW_HOURS = 24;

export async function getDiagnosticsSummary(
  db: SqlDb,
  businessId: string,
  now: Date = new Date(),
): Promise<DiagnosticsSummary> {
  const queueRows = await db.queryAll<{ n: number }>(
    `SELECT COUNT(*) as n FROM business_events
     WHERE business_id = ? AND status IN ('queued', 'processing');`,
    [businessId],
  );
  const oldestRows = await db.queryAll<{ captured_at: string }>(
    `SELECT captured_at FROM business_events
     WHERE business_id = ? AND status IN ('queued', 'processing')
     ORDER BY captured_at ASC LIMIT 1;`,
    [businessId],
  );

  const settings = await getAppSettings(db, businessId);

  const sinceIso = new Date(
    now.getTime() - RECENT_ERROR_WINDOW_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const recentErrorCount24h = await countAppErrorsSince(db, sinceIso);

  return {
    queuedCount: queueRows[0]?.n ?? 0,
    oldestQueuedCapturedAt: oldestRows[0]?.captured_at ?? null,
    lastBackupAt: settings.last_backup_at,
    recentErrorCount24h,
  };
}
