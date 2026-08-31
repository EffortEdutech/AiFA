import {
  correctConfirmedCapture,
  runCaptureInterpretation,
} from "@aifa/core/ai/capturePipeline";
import { ScriptedCaptureProvider } from "@aifa/core/ai/providers/scriptedProvider";
import { getActivityItemByEventId } from "@aifa/core/db/businessEventRepository";
import { getCashPositionSummary } from "@aifa/core/db/financialSummaryRepository";
import { listLedgerEntriesForBusinessData } from "@aifa/core/db/ledgerRepository";
import { runMigrations } from "@aifa/core/db/migrations";
import type { SqlDb } from "@aifa/core/db/types";
import { createTestDb } from "@aifa/core/testing/testAdapter";

async function setupDb(): Promise<SqlDb> {
  const db = createTestDb();
  await runMigrations(db);
  return db;
}

const autoRecordProvider = (category: string) =>
  new ScriptedCaptureProvider(() => ({
    category,
    confidence: 0.95,
    reasoning: "Clear match.",
    clarifying_question: null,
    matched_rule_ids: ["EXP-001"],
  }));

describe("ledger balance-check — debits always equal credits", () => {
  test("across a sequence of captures and a post-confirmation correction", async () => {
    const db = await setupDb();

    const outcome1 = await runCaptureInterpretation(
      db,
      autoRecordProvider("Operating Expenses:Supplies"),
      {
        domain: "expense" as const,
        businessId: "biz-1",
        description: "Stationery",
        amount: 30,
        currency: "MYR",
        paymentMethod: "cash",
      },
    );
    const outcome2 = await runCaptureInterpretation(
      db,
      autoRecordProvider("Operating Expenses:Utilities"),
      {
        domain: "expense" as const,
        businessId: "biz-1",
        description: "Electricity bill",
        amount: 120,
        currency: "MYR",
        paymentMethod: "unspecified",
      },
    );

    await correctConfirmedCapture(
      db,
      outcome1.event.id,
      "Operating Expenses:Marketing",
    );

    const allEntries = [
      ...(await listLedgerEntriesForBusinessData(db, outcome1.data.id)),
      ...(await listLedgerEntriesForBusinessData(db, outcome2.data.id)),
    ];
    // outcome1's correcting event has its own BusinessData id; fetch it too.
    const correctedOriginal = await getActivityItemByEventId(
      db,
      outcome1.event.id,
    );
    expect(correctedOriginal?.event.superseded_by).toBeTruthy();
    const correctingEventId = correctedOriginal!.event.superseded_by!;
    const correctingItem = await getActivityItemByEventId(
      db,
      correctingEventId,
    );
    const correctionEntries = await listLedgerEntriesForBusinessData(
      db,
      correctingItem!.data.id,
    );

    const everyEntry = [...allEntries, ...correctionEntries];
    const totalDebits = everyEntry
      .filter((e) => e.direction === "debit")
      .reduce((sum, e) => sum + e.amount, 0);
    const totalCredits = everyEntry
      .filter((e) => e.direction === "credit")
      .reduce((sum, e) => sum + e.amount, 0);

    expect(totalDebits).toBeCloseTo(totalCredits, 8);
  });
});

describe("correctConfirmedCapture — reversal-based correction (Vol 4_1 §4)", () => {
  test("reverses the original posting and posts a new one under the corrected category", async () => {
    const db = await setupDb();
    const outcome = await runCaptureInterpretation(
      db,
      autoRecordProvider("Operating Expenses:Supplies"),
      {
        domain: "expense" as const,
        businessId: "biz-1",
        description: "Office chairs",
        amount: 500,
        currency: "MYR",
        paymentMethod: "cash",
      },
    );

    const { correctingEvent, correctingData } = await correctConfirmedCapture(
      db,
      outcome.event.id,
      "Operating Expenses:Other",
    );

    expect(correctingEvent.status).toBe("confirmed");
    expect(correctingData.category_guess).toBe("Operating Expenses:Other");

    const originalEntries = await listLedgerEntriesForBusinessData(
      db,
      outcome.data.id,
    );
    // Original 2 postings + 2 reversal postings = 4, netting to zero for that BusinessData.
    expect(originalEntries).toHaveLength(4);
    const netByAccount: Record<string, number> = {};
    for (const entry of originalEntries) {
      const sign = entry.direction === "debit" ? 1 : -1;
      netByAccount[entry.account] =
        (netByAccount[entry.account] ?? 0) + sign * entry.amount;
    }
    for (const net of Object.values(netByAccount)) {
      expect(net).toBeCloseTo(0, 8);
    }

    const newEntries = await listLedgerEntriesForBusinessData(
      db,
      correctingData.id,
    );
    expect(newEntries).toHaveLength(2);
    expect(newEntries.find((e) => e.direction === "debit")?.account).toBe(
      "Operating Expenses:Other",
    );

    const original = await getActivityItemByEventId(db, outcome.event.id);
    expect(original?.event.superseded_by).toBe(correctingEvent.id);

    // The original row must remain otherwise untouched (still 'confirmed',
    // same category_guess it was finalised with).
    expect(original?.event.status).toBe("confirmed");
    expect(original?.data.category_guess).toBe("Operating Expenses:Supplies");
  });

  test("rejects correcting a non-confirmed event", async () => {
    const db = await setupDb();
    const outcome = await runCaptureInterpretation(
      db,
      new ScriptedCaptureProvider(() => ({
        category: "Operating Expenses:Supplies",
        confidence: 0.7,
        reasoning: "Draft band.",
        clarifying_question: null,
        matched_rule_ids: ["EXP-001"],
      })),
      {
        domain: "expense" as const,
        businessId: "biz-1",
        description: "Something",
        amount: 10,
        currency: "MYR",
        paymentMethod: "cash",
      },
    );
    expect(outcome.event.status).toBe("draft");

    await expect(
      correctConfirmedCapture(db, outcome.event.id, "Operating Expenses:Other"),
    ).rejects.toThrow(/only applies to a 'confirmed' event/);
  });

  test("rejects correcting the same event twice", async () => {
    const db = await setupDb();
    const outcome = await runCaptureInterpretation(
      db,
      autoRecordProvider("Operating Expenses:Supplies"),
      {
        domain: "expense" as const,
        businessId: "biz-1",
        description: "Printer paper",
        amount: 20,
        currency: "MYR",
        paymentMethod: "cash",
      },
    );

    await correctConfirmedCapture(
      db,
      outcome.event.id,
      "Operating Expenses:Other",
    );

    await expect(
      correctConfirmedCapture(db, outcome.event.id, "Operating Expenses:Rent"),
    ).rejects.toThrow(/already been corrected/);
  });

  test("the migration 4 trigger still blocks unrelated field changes on a confirmed row", async () => {
    const db = await setupDb();
    const outcome = await runCaptureInterpretation(
      db,
      autoRecordProvider("Operating Expenses:Supplies"),
      {
        domain: "expense" as const,
        businessId: "biz-1",
        description: "Notebooks",
        amount: 15,
        currency: "MYR",
        paymentMethod: "cash",
      },
    );

    await expect(
      db.execute(
        `UPDATE business_events SET domain_hint = 'sale' WHERE id = ?;`,
        [outcome.event.id],
      ),
    ).rejects.toThrow(/immutable once confirmed/);

    // Setting superseded_by a second time (simulated directly at the SQL
    // layer) must also be rejected, even though the *shape* of the change
    // is the one the trigger otherwise allows.
    await correctConfirmedCapture(
      db,
      outcome.event.id,
      "Operating Expenses:Other",
    );
    await expect(
      db.execute(
        `UPDATE business_events SET superseded_by = 'BE-FAKE' WHERE id = ?;`,
        [outcome.event.id],
      ),
    ).rejects.toThrow(/immutable once confirmed/);
  });
});

describe("getCashPositionSummary — hand-calculated scenario", () => {
  test("matches a manually-worked-out cash position and 30-day trend", async () => {
    const db = await setupDb();

    // Cash-paid expense: Cash/Bank credited 50 (money out).
    await runCaptureInterpretation(
      db,
      autoRecordProvider("Operating Expenses:Supplies"),
      {
        domain: "expense" as const,
        businessId: "biz-1",
        description: "Supplies A",
        amount: 50,
        currency: "MYR",
        paymentMethod: "cash",
      },
    );
    // Deferred expense: Accounts Payable credited, NOT Cash/Bank -- must not
    // affect cash position (no cash has left yet).
    await runCaptureInterpretation(
      db,
      autoRecordProvider("Operating Expenses:Rent"),
      {
        domain: "expense" as const,
        businessId: "biz-1",
        description: "Rent invoice",
        amount: 800,
        currency: "MYR",
        paymentMethod: "unspecified",
      },
    );
    // Another cash-paid expense.
    const third = await runCaptureInterpretation(
      db,
      autoRecordProvider("Operating Expenses:Utilities"),
      {
        domain: "expense" as const,
        businessId: "biz-1",
        description: "Electricity",
        amount: 25.5,
        currency: "MYR",
        paymentMethod: "card",
      },
    );
    // Correct the third one -- reversal must not change the net cash
    // position (same amount, still a Cash/Bank credit either way).
    await correctConfirmedCapture(
      db,
      third.event.id,
      "Operating Expenses:Other",
    );

    const summary = await getCashPositionSummary(db, { trendDays: 30 });

    // Hand calculation:
    //  - Supplies (cash, 50): credits Cash/Bank 50 -> moneyOut
    //  - Rent (unspecified, 800): credits Accounts Payable, NOT Cash/Bank
    //    -> no cash impact at all, correctly excluded
    //  - Electricity (card, 25.5): credits Cash/Bank 25.5 -> moneyOut
    //  - Correcting Electricity reverses that posting (a genuine debit to
    //    Cash/Bank of 25.5 -> moneyIn) and reposts under the corrected
    //    category, again crediting Cash/Bank 25.5 -> moneyOut. The gross
    //    reversal + repost both show up in the trend (honest audit trail),
    //    even though they net to the same economic outcome.
    // moneyOut = 50 + 25.5 + 25.5 = 101; moneyIn = 25.5 (the reversal only)
    // cashPosition = moneyIn - moneyOut = 25.5 - 101 = -75.5
    expect(summary.cashPosition).toBeCloseTo(-75.5, 8);
    expect(summary.moneyIn).toBeCloseTo(25.5, 8);
    expect(summary.moneyOut).toBeCloseTo(101, 8);
    expect(summary.currency).toBe("MYR");
  });

  test("returns zeroes with no data recorded yet", async () => {
    const db = await setupDb();
    const summary = await getCashPositionSummary(db, { trendDays: 30 });
    expect(summary.cashPosition).toBe(0);
    expect(summary.moneyIn).toBe(0);
    expect(summary.moneyOut).toBe(0);
  });
});
