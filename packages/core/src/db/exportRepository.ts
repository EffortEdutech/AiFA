/**
 * Data export — Vol 7_7 "Data & Privacy" configuration domain, Sprint 10
 * Data Rights task breakdown ("Data export flow built... produces
 * complete, readable record"). Split the same way Sprint 9 split backup
 * (backupRepository.ts vs backupService.ts): this module is pure,
 * engine-agnostic string-building with zero native/network dependency, so
 * it is fully unit-testable against the Node test adapter; the actual
 * file-write-to-disk step lives in exportService.ts.
 *
 * Two outputs, matching the sprint's own "Safe to Carry Over: export
 * format polish can be basic CSV/JSON" allowance:
 * - A full JSON snapshot (reuses backupRepository.ts's createLocalSnapshot
 *   directly -- the export IS a backup snapshot, just written to a file
 *   the owner can access themselves instead of uploaded to Supabase
 *   Storage; no reason to duplicate that read logic).
 * - A human-readable CSV of business activity (one row per captured
 *   Business Event + its BusinessData), for an owner or accountant who
 *   wants to open it in a spreadsheet rather than read raw JSON.
 */
import { createLocalSnapshot, type BackupSnapshot } from "./backupRepository";
import { listRecentActivity } from "./businessEventRepository";
import type { SqlDb } from "./types";

/**
 * Phase 1 data volume makes a single generous query pass cheap (same
 * reasoning `listRecentActivity`'s own comment already applies to its
 * default limit) -- a full export intentionally does NOT cap at the
 * dashboard's small "recent activity" limit, since "complete... record"
 * (this sprint's Definition of Done) requires every event, not just the
 * newest ones.
 */
const EXPORT_ACTIVITY_LIMIT = 1_000_000;

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const ACTIVITY_CSV_HEADERS = [
  "captured_at",
  "domain",
  "description",
  "counterparty_name",
  "amount",
  "currency",
  "payment_method",
  "category",
  "status",
] as const;

/**
 * Builds the CSV export as a plain string. Newest-first, matching
 * `listRecentActivity`'s own ordering -- an owner opening this file sees
 * their most recent activity at the top, same as the app's own feed.
 */
export async function buildActivityCsv(
  db: SqlDb,
  businessId: string,
): Promise<string> {
  const activity = await listRecentActivity(
    db,
    businessId,
    EXPORT_ACTIVITY_LIMIT,
  );

  const lines = [ACTIVITY_CSV_HEADERS.join(",")];
  for (const item of activity) {
    const row = [
      item.event.captured_at,
      item.event.domain_hint,
      item.event.raw_input_ref,
      item.data.counterparty_name,
      item.data.amount,
      item.data.currency,
      item.data.payment_method,
      item.data.category_guess,
      item.event.status,
    ].map(csvEscape);
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

export interface ExportBundle {
  generatedAt: string;
  snapshot: BackupSnapshot;
  snapshotJson: string;
  activityCsv: string;
}

/**
 * Builds both export artifacts in one pass. Returns the in-memory content
 * only -- exportService.ts is responsible for writing these strings to
 * actual files (Vol 4_4's local-first model: exporting never requires
 * connectivity or a signed-in account, unlike backup).
 */
export async function buildExportBundle(
  db: SqlDb,
  businessId: string,
): Promise<ExportBundle> {
  const [snapshot, activityCsv] = await Promise.all([
    createLocalSnapshot(db),
    buildActivityCsv(db, businessId),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    snapshot,
    snapshotJson: JSON.stringify(snapshot, null, 2),
    activityCsv,
  };
}
