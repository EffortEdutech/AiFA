/**
 * LedgerEntry repository — Vol 11_1 §4 (Financial Data, Phase 1 minimal
 * form). Phase 1 does not implement a full general-ledger engine; this is
 * an auditable record of money movement per account bucket, always posted
 * as a balanced debit/credit pair by the caller (Vol 2_2 §6: every posted
 * entry must balance before acceptance — enforced by construction here
 * since callers always pass both legs together, not by a runtime check).
 */
import type { SqlDb } from "./types";
import { assertSyncGateOk, enqueueSyncableWrite } from "../sync/syncHooks";

export type LedgerDirection = "debit" | "credit";

export interface LedgerEntry {
  id: string;
  business_data_id: string;
  account: string;
  direction: LedgerDirection;
  amount: number;
  currency: string;
  posted_at: string;
  reversal_of: string | null;
}

export interface LedgerEntryInput {
  businessDataId: string;
  account: string;
  direction: LedgerDirection;
  amount: number;
  currency: string;
  /**
   * Sprint 7 addition — disambiguates a second entry-set posted against the
   * SAME businessDataId + direction (e.g. a bank-reconciliation settlement
   * posted after the original classify-time posting, both crediting
   * Accounts Receivable on the same BusinessData row). Without this, the
   * deterministic id would collide with the original entry's id and the
   * settlement would be silently swallowed by INSERT OR IGNORE below.
   * Omit for the original/default posting (unchanged behaviour).
   */
  idVariant?: string;
}

/**
 * Deterministic per (businessDataId, direction) — Phase 1's EXP-001 rule
 * always produces exactly one debit and one credit line per BusinessData
 * row, so a deterministic id makes re-running the pipeline for the same
 * row idempotent (paired with INSERT OR IGNORE below) rather than risking
 * duplicate postings.
 */
function ledgerEntryId(
  businessDataId: string,
  direction: LedgerDirection,
  idVariant?: string,
): string {
  const suffix = direction === "debit" ? "DR" : "CR";
  const variantPart = idVariant ? `${idVariant}-` : "";
  return `LE-${businessDataId.replace(/^BD-/, "")}-${variantPart}${suffix}`;
}

export async function createLedgerEntries(
  db: SqlDb,
  entries: LedgerEntryInput[],
): Promise<LedgerEntry[]> {
  await assertSyncGateOk(db);
  const postedAt = new Date().toISOString();
  const result: LedgerEntry[] = [];

  for (const entry of entries) {
    const id = ledgerEntryId(
      entry.businessDataId,
      entry.direction,
      entry.idVariant,
    );
    await db.execute(
      `INSERT OR IGNORE INTO ledger_entries
         (id, business_data_id, account, direction, amount, currency, posted_at, reversal_of)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        id,
        entry.businessDataId,
        entry.account,
        entry.direction,
        entry.amount,
        entry.currency,
        postedAt,
        null,
      ],
    );
    const created: LedgerEntry = {
      id,
      business_data_id: entry.businessDataId,
      account: entry.account,
      direction: entry.direction,
      amount: entry.amount,
      currency: entry.currency,
      posted_at: postedAt,
      reversal_of: null,
    };
    // Deterministic id + INSERT OR IGNORE (above) already makes this
    // function idempotent, so it doubles as the pull-apply path too
    // (sync/applyEnvelope.ts calls it wrapped in
    // runAsPulledEnvelopeApplication, which makes this a no-op — see
    // syncContext.ts).
    await enqueueSyncableWrite(db, "ledger_entry", "insert", created);
    result.push(created);
  }

  return result;
}

export async function listLedgerEntriesForBusinessData(
  db: SqlDb,
  businessDataId: string,
): Promise<LedgerEntry[]> {
  return db.queryAll<LedgerEntry>(
    `SELECT * FROM ledger_entries WHERE business_data_id = ? ORDER BY posted_at ASC, id ASC;`,
    [businessDataId],
  );
}

/**
 * Posts the exact opposite of each given entry (Vol 4_1 §4: corrections are
 * reversing entries, never an in-place edit). Reversal ids are derived from
 * the original id so re-running a correction is idempotent (INSERT OR
 * IGNORE), same pattern as createLedgerEntries. Because reversals flow
 * through the same ledger_entries table with an ordinary direction value,
 * any SUM(debit) - SUM(credit) aggregate (e.g. cash position) nets them out
 * automatically — no special-casing needed at the query layer.
 */
export async function reverseLedgerEntries(
  db: SqlDb,
  entries: LedgerEntry[],
): Promise<LedgerEntry[]> {
  await assertSyncGateOk(db);
  const postedAt = new Date().toISOString();
  const result: LedgerEntry[] = [];

  for (const entry of entries) {
    const id = `${entry.id}-REV`;
    const direction: LedgerDirection =
      entry.direction === "debit" ? "credit" : "debit";
    await db.execute(
      `INSERT OR IGNORE INTO ledger_entries
         (id, business_data_id, account, direction, amount, currency, posted_at, reversal_of)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        id,
        entry.business_data_id,
        entry.account,
        direction,
        entry.amount,
        entry.currency,
        postedAt,
        entry.id,
      ],
    );
    const created: LedgerEntry = {
      id,
      business_data_id: entry.business_data_id,
      account: entry.account,
      direction,
      amount: entry.amount,
      currency: entry.currency,
      posted_at: postedAt,
      reversal_of: entry.id,
    };
    await enqueueSyncableWrite(db, "ledger_entry", "insert", created);
    result.push(created);
  }

  return result;
}

/**
 * Sprint 16 — applies a pulled `ledger_entry` insert envelope directly by
 * the given row's own id (rather than through createLedgerEntries/
 * reverseLedgerEntries, which each RE-DERIVE an id from businessDataId/
 * direction/idVariant — correct for local writes, but reversal ids
 * `{original}-REV` don't fit that derivation, and it would require
 * threading idVariant back out of an opaque already-built id). INSERT OR
 * IGNORE keyed on the envelope's own id is idempotent under replay the
 * same way every other insert-only entity's apply path is.
 */
export async function applyPulledLedgerEntry(
  db: SqlDb,
  entry: LedgerEntry,
): Promise<void> {
  await db.execute(
    `INSERT OR IGNORE INTO ledger_entries
       (id, business_data_id, account, direction, amount, currency, posted_at, reversal_of)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      entry.id,
      entry.business_data_id,
      entry.account,
      entry.direction,
      entry.amount,
      entry.currency,
      entry.posted_at,
      entry.reversal_of,
    ],
  );
}
