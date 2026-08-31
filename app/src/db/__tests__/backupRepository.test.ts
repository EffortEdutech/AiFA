/**
 * Sprint 9 — backup snapshot/restore round-trip (Vol 8_4, Vol 4_4 §4).
 * Exercises the fully engine-agnostic core (backupRepository.ts) against
 * two independent test databases: populate a "source" device with a
 * realistic mix of activity, snapshot it, restore into a fresh "target"
 * device, and verify the target is functionally equivalent -- same cash
 * position, same outstanding receivables/payables, same document/ledger
 * counts. This is the automated equivalence check the Sprint 9 risk
 * register calls for ("build an automated equivalence check rather than
 * relying on manual spot-checks").
 */
import { runCaptureInterpretation } from "@aifa/core/ai/capturePipeline";
import { ScriptedCaptureProvider } from "@aifa/core/ai/providers/scriptedProvider";
import {
  createLocalSnapshot,
  restoreFromSnapshot,
  SNAPSHOT_TABLES,
} from "@aifa/core/db/backupRepository";
import { recordBankTransaction } from "@aifa/core/db/bankingRepository";
import { saveDocument } from "@aifa/core/db/documentRepository";
import {
  getCashPositionSummary,
  getOutstandingPayables,
  getOutstandingReceivables,
} from "@aifa/core/db/financialSummaryRepository";
import { runMigrations } from "@aifa/core/db/migrations";
import type { SqlDb } from "@aifa/core/db/types";
import { createTestDb } from "@aifa/core/testing/testAdapter";

async function setupDb(): Promise<SqlDb> {
  const db = createTestDb();
  await runMigrations(db);
  return db;
}

const saleProvider = () =>
  new ScriptedCaptureProvider(() => ({
    category: "Sales Revenue",
    confidence: 0.95,
    reasoning: "Clear invoice.",
    clarifying_question: null,
    matched_rule_ids: ["SALE-001"],
  }));

const purchaseProvider = () =>
  new ScriptedCaptureProvider(() => ({
    category: "Operating Expenses:Supplies",
    confidence: 0.95,
    reasoning: "Clear bill.",
    clarifying_question: null,
    matched_rule_ids: ["PUR-001"],
  }));

/** Populates a source db with a representative slice of every table Sprint 9 promises to back up. */
async function seedSourceDb(db: SqlDb): Promise<void> {
  await runCaptureInterpretation(db, saleProvider(), {
    domain: "sale",
    businessId: "biz-1",
    description: "Sold on credit",
    counterpartyName: "ABC Trading",
    amount: 1000,
    currency: "MYR",
    paymentMethod: "unspecified",
  });
  await runCaptureInterpretation(db, purchaseProvider(), {
    domain: "purchase",
    businessId: "biz-1",
    description: "Bought supplies on credit",
    counterpartyName: "Supply Co",
    amount: 300,
    currency: "MYR",
    paymentMethod: "unspecified",
  });
  await recordBankTransaction(db, {
    businessId: "biz-1",
    transactionType: "deposit",
    description: "Cash top-up",
    amount: 500,
    currency: "MYR",
  });
  const saleEvent = await db.queryAll<{ id: string }>(
    `SELECT id FROM business_events WHERE domain_hint = 'sale' LIMIT 1;`,
  );
  await saveDocument(db, {
    businessEventId: saleEvent[0].id,
    type: "invoice",
    extractionStatus: "not_attempted",
    mimeType: "image/jpeg",
    base64Data: "ZmFrZQ==",
  });
}

describe("backupRepository — snapshot/restore round-trip", () => {
  test("snapshot includes every SNAPSHOT_TABLES table", async () => {
    const db = await setupDb();
    await seedSourceDb(db);
    const snapshot = await createLocalSnapshot(db);

    expect(snapshot.snapshotVersion).toBe(1);
    for (const table of SNAPSHOT_TABLES) {
      expect(snapshot.tables[table]).toBeDefined();
    }
    expect(snapshot.tables.business_events.length).toBeGreaterThan(0);
    expect(snapshot.tables.ledger_entries.length).toBeGreaterThan(0);
    expect(snapshot.tables.documents.length).toBe(1);
  });

  test("restoring into a fresh db reproduces an equivalent cash position and outstanding lists", async () => {
    const source = await setupDb();
    await seedSourceDb(source);
    const snapshot = await createLocalSnapshot(source);

    const target = await setupDb(); // fresh, empty, already migrated
    await restoreFromSnapshot(target, snapshot);

    const [sourceCash, targetCash] = await Promise.all([
      getCashPositionSummary(source),
      getCashPositionSummary(target),
    ]);
    expect(targetCash.cashPosition).toBe(sourceCash.cashPosition);
    expect(targetCash.moneyIn).toBe(sourceCash.moneyIn);
    expect(targetCash.moneyOut).toBe(sourceCash.moneyOut);

    const [sourceReceivables, targetReceivables] = await Promise.all([
      getOutstandingReceivables(source, "biz-1"),
      getOutstandingReceivables(target, "biz-1"),
    ]);
    expect(targetReceivables).toEqual(sourceReceivables);

    const [sourcePayables, targetPayables] = await Promise.all([
      getOutstandingPayables(source, "biz-1"),
      getOutstandingPayables(target, "biz-1"),
    ]);
    expect(targetPayables).toEqual(sourcePayables);

    for (const table of SNAPSHOT_TABLES) {
      const [sourceRows, targetRows] = await Promise.all([
        source.queryAll(`SELECT COUNT(*) as n FROM ${table};`),
        target.queryAll(`SELECT COUNT(*) as n FROM ${table};`),
      ]);
      expect(targetRows).toEqual(sourceRows);
    }
  });

  test("restoring the same snapshot twice does not duplicate rows (INSERT OR IGNORE idempotency)", async () => {
    const source = await setupDb();
    await seedSourceDb(source);
    const snapshot = await createLocalSnapshot(source);

    const target = await setupDb();
    await restoreFromSnapshot(target, snapshot);
    await restoreFromSnapshot(target, snapshot); // second restore of the SAME snapshot

    const rows = await target.queryAll<{ n: number }>(
      `SELECT COUNT(*) as n FROM business_events;`,
    );
    const sourceRows = await source.queryAll<{ n: number }>(
      `SELECT COUNT(*) as n FROM business_events;`,
    );
    expect(rows[0].n).toBe(sourceRows[0].n);
  });

  test("an empty source produces a snapshot that restores cleanly into a fresh db", async () => {
    const source = await setupDb();
    const snapshot = await createLocalSnapshot(source);

    const target = await setupDb();
    await expect(restoreFromSnapshot(target, snapshot)).resolves.not.toThrow();

    const rows = await target.queryAll<{ n: number }>(
      `SELECT COUNT(*) as n FROM business_events;`,
    );
    expect(rows[0].n).toBe(0);
  });
});
