/**
 * Local business-id reconciliation — Sprint 14, closing a gap `db/client.ts`
 * flagged since Sprint 2 but never resolved.
 *
 * Phase 1 (Vol 8_1 §4, single-user/single-business) generates a random,
 * device-local `business_id` (`getLocalBusinessId`) before any account
 * exists — `db/client.ts`'s own comment says this value "is reconciled
 * with real account identity when auth screens are built (Sprint 10)," but
 * Sprint 10 built auth (`lib/auth.ts`) without ever doing that
 * reconciliation. Cross-device cloud sync (this volume) cannot work
 * without fixing this: `public.sync_envelopes.business_id` and its RLS
 * policy (`auth.uid() = business_id`) need `business_id` to actually BE
 * the signed-in Supabase user's id (already true of `public.profiles.id`,
 * Vol 11_0 §5) — not an unrelated random value the server has never seen.
 *
 * This module performs that one-time reconciliation locally: every row
 * carrying the old, locally-generated `business_id` is repointed at the
 * canonical one (the signed-in `auth.uid()`), across every table that
 * actually stores it. Safe to call multiple times — a no-op once the two
 * ids already match.
 */
import type { SqlDb } from "../db/types";

/**
 * Every local table with its own `business_id` column, per Vol 11_1's
 * schema (`db/migrations.ts`). Deliberately NOT every table in the
 * database — most Phase 1 tables (`business_data`, `ledger_entries`,
 * `documents`, `ai_interpretations`, `bank_reconciliations`,
 * `app_error_log`, ...) reach a business only indirectly, through a
 * foreign key back to one of these three, so they need no update of their
 * own. Kept as an explicit list (not derived from the schema at runtime)
 * so a future migration that adds a fourth business_id-bearing table has
 * to touch this list deliberately, the same discipline
 * `deletionRepository.ts`'s `LOCAL_DELETION_TABLES` already uses for a
 * near-identical "don't silently miss a table" risk.
 */
const BUSINESS_ID_TABLES = ["business_events", "business_knowledge_entries", "app_settings"] as const;

/**
 * Repoints every row under `oldBusinessId` to `canonicalBusinessId` (the
 * signed-in Supabase user's id). Call once, right after the owner first
 * authenticates and enters the recovery code (Vol 12_1 §5/§9) — the same
 * moment the device registers and derives the Business DEK. A no-op if the
 * two ids already match, so it is safe to call on every sign-in rather
 * than needing its own "have I already reconciled?" flag.
 */
export async function reconcileLocalBusinessId(
  db: SqlDb,
  oldBusinessId: string,
  canonicalBusinessId: string,
): Promise<void> {
  if (!oldBusinessId || !canonicalBusinessId) {
    throw new Error("reconcileLocalBusinessId: both ids are required");
  }
  if (oldBusinessId === canonicalBusinessId) return;

  for (const table of BUSINESS_ID_TABLES) {
    await db.execute(`UPDATE ${table} SET business_id = ? WHERE business_id = ?`, [
      canonicalBusinessId,
      oldBusinessId,
    ]);
  }
}
