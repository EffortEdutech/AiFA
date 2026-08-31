/**
 * Backup snapshot/restore — Phase 1 upload-only backup (Vol 8_4 §2, Vol
 * 4_4 §4, Vol 11_0 §5). This module is the engine-agnostic core: build a
 * portable JSON snapshot of every Phase 1 table from any `SqlDb`, and
 * restore that snapshot into any `SqlDb` (including a freshly-migrated,
 * empty one). Deliberately generic (`SELECT *` / column-name-driven
 * INSERT) rather than one hand-written mapper per table, so adding a new
 * table to Phase 1 later only means adding its name to `SNAPSHOT_TABLES`,
 * not writing a new serialize/deserialize pair.
 *
 * `schema_migrations` is intentionally excluded — the destination
 * database gets its own via `runMigrations`, not a copy of the source
 * device's migration history (Vol 11_0 §3, schema evolution is a
 * per-install concern, not backed-up state).
 *
 * This module has NO dependency on op-sqlite, Supabase, or any native
 * module — it operates purely through the SqlDb interface, so the
 * snapshot/restore logic itself is fully exercised by Jest against the
 * Node test adapter (see backupRepository.test.ts). The separate
 * encryption/upload/download layer (backupService.ts) is where the
 * native/network-dependent, sandbox-untestable part of Sprint 9 lives —
 * kept out of this file on purpose so the core logic isn't entangled with
 * what can't be verified here.
 */
import type { SqlDb } from "./types";

/**
 * Every Phase 1 table that constitutes "the business's data" per Vol 4_4
 * §3 (What Lives Locally) — excludes schema_migrations (see above) and
 * excludes nothing else: Business Events, Business Data, Financial Data
 * (ledger_entries), explainability (ai_interpretations), Documents (both
 * metadata and blobs), Banking reconciliation records, and the Business
 * Knowledge Store are all named explicitly in the Sprint 9 task breakdown
 * ("Backup includes Business Events, Business Data, Financial Data,
 * Business Knowledge Store, and Documents") plus the two tables that
 * exist but predate that sentence being written (bank_reconciliations,
 * ai_interpretations) -- omitting either would be a silent, undocumented
 * gap, so both are included too.
 */
export const SNAPSHOT_TABLES = [
  "business_events",
  "document_blobs",
  "documents",
  "business_data",
  "ledger_entries",
  "ai_interpretations",
  "bank_reconciliations",
  "business_knowledge_entries",
] as const;

export type SnapshotTableName = (typeof SNAPSHOT_TABLES)[number];

export interface BackupSnapshot {
  /** Schema/format version of the SNAPSHOT ITSELF (independent of schema_migrations) -- bump if SNAPSHOT_TABLES or the row shape ever changes incompatibly. */
  snapshotVersion: 1;
  createdAt: string;
  tables: Record<SnapshotTableName, Record<string, unknown>[]>;
}

/**
 * Reads every row of every Phase 1 table into a single portable object.
 * Nothing here interprets or validates the data — it's a faithful copy of
 * whatever `SELECT *` returns, column names included, so restore can be
 * equally generic.
 */
export async function createLocalSnapshot(db: SqlDb): Promise<BackupSnapshot> {
  const tables = {} as Record<SnapshotTableName, Record<string, unknown>[]>;
  for (const table of SNAPSHOT_TABLES) {
    tables[table] = await db.queryAll<Record<string, unknown>>(
      `SELECT * FROM ${table};`,
    );
  }
  return {
    snapshotVersion: 1,
    createdAt: new Date().toISOString(),
    tables,
  };
}

/**
 * Restores a snapshot into `db` (expected to already have `runMigrations`
 * applied, so every table in SNAPSHOT_TABLES exists). Uses `INSERT OR
 * IGNORE`, the same idempotency convention every repository in this
 * codebase already uses for deterministic ids (ledgerRepository.ts,
 * businessKnowledgeRepository.ts) -- restoring the same snapshot twice, or
 * restoring on top of a partially-restored attempt, does not duplicate or
 * error, it just leaves existing rows alone.
 *
 * Column names are read off the FIRST row of each table in the snapshot;
 * an empty table in the snapshot is simply skipped (nothing to insert, and
 * no column list to infer one from).
 */
export async function restoreFromSnapshot(
  db: SqlDb,
  snapshot: BackupSnapshot,
): Promise<void> {
  for (const table of SNAPSHOT_TABLES) {
    const rows = snapshot.tables[table] ?? [];
    if (rows.length === 0) continue;

    const columns = Object.keys(rows[0]);
    const placeholders = columns.map(() => "?").join(", ");
    const sql = `INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES (${placeholders});`;

    for (const row of rows) {
      await db.execute(
        sql,
        columns.map((col) => row[col]),
      );
    }
  }
}
