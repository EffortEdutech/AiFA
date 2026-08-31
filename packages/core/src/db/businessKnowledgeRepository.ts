/**
 * Business Knowledge Store — Phase 1 minimal form (Vol 4_2, Vol 11_1 §7).
 *
 * The Business Knowledge Evolution Engine (BKEE) is implemented in Phase 1
 * as exactly one explicit heuristic — vendor-to-category mapping — not a
 * general-purpose pattern-validation engine (Vol 4_2 §3.1). The
 * governance rule behind BKEE is non-negotiable regardless of that
 * simplification: nothing is ever written here from a single observation.
 * A mapping only graduates to "trusted" after `TRUSTED_CONFIRMATION_THRESHOLD`
 * (3, per Vol 11_1 §7) CONSECUTIVE owner confirmations of the same
 * vendor -> category pairing — a differing confirmation resets the streak
 * to 1 under the new value rather than averaging, ignoring, or silently
 * overwriting it (see recordVendorCategoryConfirmation below).
 *
 * Only explicit owner-certainty actions call recordVendorCategoryConfirmation
 * — confirmCategory and correctConfirmedCapture in capturePipeline.ts, both
 * of which already record confidence 1.0 for exactly this reason. An
 * auto_record decision the owner never touched is an AI guess, not an
 * "explicit owner confirmation" (Vol 4_2 §3), so it must NOT feed this
 * store — doing so would let the heuristic bootstrap trust from its own
 * unverified guesses, which is the "over-eager auto-categorisation erodes
 * trust" risk the Sprint 8 risk register calls out.
 */
import type { SqlDb } from "./types";

export type BusinessKnowledgePatternType =
  "vendor_category_mapping" | "customer_payment_behaviour" | "other";

export interface BusinessKnowledgeEntry {
  id: string;
  business_id: string;
  pattern_type: BusinessKnowledgePatternType;
  key: string;
  value: string;
  confirmation_count: number;
  confirmed_at: string;
}

/**
 * Phase 1 starting config (Vol 0_1 §3.4 precedent — thresholds start as a
 * fixed value, not yet owner-tunable). Raise this if in-field usage shows
 * the heuristic promoting mappings to "trusted" too eagerly, per the
 * Sprint 8 risk register's own stated mitigation.
 */
export const TRUSTED_CONFIRMATION_THRESHOLD = 3;

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Deterministic per (business_id, pattern_type, key) — normalised via
 * `slug` so "ABC Trading" and "abc trading" resolve to the same learned
 * mapping instead of silently forking into two vendors. Mirrors the
 * deterministic-id pattern used by ledgerRepository.ts's `ledgerEntryId`
 * (Sprint 7) — makes a repeat confirmation for the same vendor an UPSERT
 * against one row rather than an accumulating list of rows to aggregate.
 */
function knowledgeEntryId(
  businessId: string,
  patternType: BusinessKnowledgePatternType,
  key: string,
): string {
  return `BKE-${slug(businessId)}-${slug(patternType)}-${slug(key)}`;
}

/**
 * Records one owner-certain confirmation of a vendor -> category mapping.
 * Confirming the SAME category again increments the consecutive streak;
 * confirming a DIFFERENT category for the same vendor resets the streak to
 * 1 under the new value — "consecutive" (Vol 11_1 §7) is enforced
 * literally, not just a running total that could be crossed by an old,
 * since-corrected pattern.
 */
export async function recordVendorCategoryConfirmation(
  db: SqlDb,
  businessId: string,
  vendorKey: string,
  category: string,
  now: Date = new Date(),
): Promise<BusinessKnowledgeEntry> {
  const id = knowledgeEntryId(businessId, "vendor_category_mapping", vendorKey);
  const nowIso = now.toISOString();

  const existing = await db.queryAll<BusinessKnowledgeEntry>(
    `SELECT * FROM business_knowledge_entries WHERE id = ? LIMIT 1;`,
    [id],
  );

  if (existing.length === 0) {
    await db.execute(
      `INSERT INTO business_knowledge_entries
         (id, business_id, pattern_type, key, value, confirmation_count, confirmed_at)
       VALUES (?, ?, 'vendor_category_mapping', ?, ?, 1, ?);`,
      [id, businessId, vendorKey, category, nowIso],
    );
    return {
      id,
      business_id: businessId,
      pattern_type: "vendor_category_mapping",
      key: vendorKey,
      value: category,
      confirmation_count: 1,
      confirmed_at: nowIso,
    };
  }

  const current = existing[0];
  const nextCount =
    current.value === category ? current.confirmation_count + 1 : 1;

  await db.execute(
    `UPDATE business_knowledge_entries
       SET value = ?, confirmation_count = ?, confirmed_at = ?
     WHERE id = ?;`,
    [category, nextCount, nowIso, id],
  );

  return {
    ...current,
    value: category,
    confirmation_count: nextCount,
    confirmed_at: nowIso,
  };
}

/**
 * Looks up the trusted vendor -> category mapping for this vendor, if any.
 * Returns null for both an unknown vendor and a known-but-not-yet-trusted
 * one (confirmation_count below threshold) — callers must never treat
 * "a row exists" alone as trust; this is the one function that applies the
 * threshold, so callers don't each need to re-check it.
 */
export async function getTrustedVendorCategory(
  db: SqlDb,
  businessId: string,
  vendorKey: string,
): Promise<string | null> {
  const id = knowledgeEntryId(businessId, "vendor_category_mapping", vendorKey);
  const rows = await db.queryAll<BusinessKnowledgeEntry>(
    `SELECT * FROM business_knowledge_entries WHERE id = ? LIMIT 1;`,
    [id],
  );
  const entry = rows[0];
  if (!entry || entry.confirmation_count < TRUSTED_CONFIRMATION_THRESHOLD) {
    return null;
  }
  return entry.value;
}
