/**
 * Account/business deletion — Vol 7_7 "Data & Privacy" configuration
 * domain, Sprint 10 Data Rights task breakdown. The Sprint 10 risk
 * register calls this out explicitly: "deletion interacting badly with
 * backup -- explicitly test that deletion propagates to backup storage,
 * not just the local device."
 *
 * Split the same way backup (Sprint 9) and export (this sprint) are
 * split: `deleteAllLocalData` is pure `SqlDb` logic with zero native/
 * network dependency, fully unit-testable; `deleteRemoteAccountData`
 * (deletionService.ts) is the auth-gated, best-effort remote counterpart.
 * Local deletion must never be BLOCKED by the remote step failing or by
 * there being no signed-in account at all (Vol 4_4 §2 "local-first" --
 * an owner who never connected an account must still be able to fully
 * wipe their local data), which is why these are two separate functions
 * a caller composes, not one function that could partially fail.
 */
import { SNAPSHOT_TABLES } from "./backupRepository";
import type { SqlDb } from "./types";

/**
 * Every Phase 1 table holding business or configuration data --
 * `SNAPSHOT_TABLES` (Sprint 9's own definition of "the business's data")
 * plus `app_settings` (Sprint 10), which is device configuration rather
 * than business data proper and so was correctly left out of backup
 * snapshots, but a full "delete my business" action must still clear it.
 * `schema_migrations` is deliberately excluded -- wiping business data is
 * not the same as uninstalling the app; the schema itself stays applied
 * so the (now-empty) local database remains immediately usable.
 *
 * Deleted in child-before-parent order for hygiene even though this
 * project does not currently enable SQLite's `PRAGMA foreign_keys`
 * enforcement (a future-proofing choice, not a functional requirement
 * today).
 */
export const LOCAL_DELETION_TABLES = [
  "ai_interpretations",
  "ledger_entries",
  "bank_reconciliations",
  "documents",
  "document_blobs",
  "business_data",
  "business_events",
  "business_knowledge_entries",
  "app_settings",
] as const;

// Compile-time check that every SNAPSHOT_TABLES entry (Sprint 9's backup
// scope) also appears above -- if a future table is added to backup and
// this list is forgotten, this line fails to type-check rather than
// silently under-deleting.
type _AssertAllSnapshotTablesCovered =
  (typeof SNAPSHOT_TABLES)[number] extends (typeof LOCAL_DELETION_TABLES)[number]
    ? true
    : never;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _typeCheck: _AssertAllSnapshotTablesCovered = true;

/**
 * Deletes every row of every Phase 1 business/configuration table on THIS
 * device. Does not drop tables or touch `schema_migrations` -- the app
 * remains fully functional afterwards, just with an empty ledger, exactly
 * as if the owner were starting fresh (Vol 11_0 §3 schema evolution stays
 * a separate, per-install concern from this data-only wipe).
 */
export async function deleteAllLocalData(db: SqlDb): Promise<void> {
  for (const table of LOCAL_DELETION_TABLES) {
    await db.execute(`DELETE FROM ${table};`);
  }
}
