/**
 * Sprint 7 — Banking (manual entry + reconciliation, Vol 6_4) and CFO
 * Guidance v1 (Vol 2_4, Vol 0_1 §6) tests.
 */
import { runCaptureInterpretation } from "@aifa/core/ai/capturePipeline";
import { getCfoGuidance } from "@aifa/core/ai/cfoGuidance";
import { ScriptedCaptureProvider } from "@aifa/core/ai/providers/scriptedProvider";
import { recordBankTransaction } from "@aifa/core/db/bankingRepository";
import {
  getOutstandingPayables,
  getOutstandingReceivables,
} from "@aifa/core/db/financialSummaryRepository";
import { listLedgerEntriesForBusinessData } from "@aifa/core/db/ledgerRepository";
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

const purchaseProvider = (category: string) =>
  new ScriptedCaptureProvider(() => ({
    category,
    confidence: 0.95,
    reasoning: "Clear supplier bill.",
    clarifying_question: null,
    matched_rule_ids: ["PUR-001"],
  }));

async function captureCreditSale(
  db: SqlDb,
  amount: number,
  counterparty: string,
) {
  return runCaptureInterpretation(db, saleProvider(), {
    domain: "sale",
    businessId: "biz-1",
    description: "Sold on credit",
    counterpartyName: counterparty,
    amount,
    currency: "MYR",
    paymentMethod: "unspecified",
  });
}

async function captureCreditPurchase(
  db: SqlDb,
  amount: number,
  counterparty: string,
) {
  return runCaptureInterpretation(
    db,
    purchaseProvider("Operating Expenses:Supplies"),
    {
      domain: "purchase",
      businessId: "biz-1",
      description: "Bought on credit",
      counterpartyName: counterparty,
      amount,
      currency: "MYR",
      paymentMethod: "unspecified",
    },
  );
}

describe("recordBankTransaction — unmatched (Vol 6_4 §2)", () => {
  test("unmatched deposit debits Cash/Bank, credits Owner's Equity / Drawings", async () => {
    const db = await setupDb();
    const { event, data, matched } = await recordBankTransaction(db, {
      businessId: "biz-1",
      transactionType: "deposit",
      description: "Cash top-up",
      amount: 500,
      currency: "MYR",
    });

    expect(event.status).toBe("confirmed");
    expect(matched).toBe(false);
    const entries = await listLedgerEntriesForBusinessData(db, data.id);
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.direction === "debit")?.account).toBe(
      "Cash / Bank",
    );
    expect(entries.find((e) => e.direction === "credit")?.account).toBe(
      "Owner's Equity / Drawings",
    );
  });

  test("unmatched withdrawal debits Owner's Equity / Drawings, credits Cash/Bank", async () => {
    const db = await setupDb();
    const { data } = await recordBankTransaction(db, {
      businessId: "biz-1",
      transactionType: "withdrawal",
      description: "Owner draw",
      amount: 200,
      currency: "MYR",
    });

    const entries = await listLedgerEntriesForBusinessData(db, data.id);
    expect(entries.find((e) => e.direction === "debit")?.account).toBe(
      "Owner's Equity / Drawings",
    );
    expect(entries.find((e) => e.direction === "credit")?.account).toBe(
      "Cash / Bank",
    );
  });

  test("bank fee debits Operating Expenses:Bank Fees, credits Cash/Bank", async () => {
    const db = await setupDb();
    const { data } = await recordBankTransaction(db, {
      businessId: "biz-1",
      transactionType: "bank_fee",
      description: "Monthly account fee",
      amount: 8,
      currency: "MYR",
    });

    const entries = await listLedgerEntriesForBusinessData(db, data.id);
    expect(entries.find((e) => e.direction === "debit")?.account).toBe(
      "Operating Expenses:Bank Fees",
    );
    expect(entries.find((e) => e.direction === "credit")?.account).toBe(
      "Cash / Bank",
    );
  });

  test("bank fee rejects a reconciliation match", async () => {
    const db = await setupDb();
    await expect(
      recordBankTransaction(db, {
        businessId: "biz-1",
        transactionType: "bank_fee",
        description: "Fee",
        amount: 5,
        currency: "MYR",
        matchBusinessDataId: "BD-does-not-matter",
      }),
    ).rejects.toThrow(/only valid for 'deposit' or 'withdrawal'/);
  });

  test("transfer posts no ledger entries but is still recorded for audit trail", async () => {
    const db = await setupDb();
    const { event, data, matched } = await recordBankTransaction(db, {
      businessId: "biz-1",
      transactionType: "transfer",
      description: "Moved to savings",
      amount: 1000,
      currency: "MYR",
    });

    expect(event.status).toBe("confirmed");
    expect(matched).toBe(false);
    const entries = await listLedgerEntriesForBusinessData(db, data.id);
    expect(entries).toHaveLength(0);
  });
});

describe("recordBankTransaction — reconciliation (Vol 6_4 §4)", () => {
  test("a deposit matched to an outstanding sale settles it: Cash/Bank debited, receivable credited, drops from outstanding", async () => {
    const db = await setupDb();
    const sale = await captureCreditSale(db, 500, "ABC Trading");

    const { matched } = await recordBankTransaction(db, {
      businessId: "biz-1",
      transactionType: "deposit",
      description: "Payment from ABC Trading",
      amount: 500,
      currency: "MYR",
      matchBusinessDataId: sale.data.id,
    });
    expect(matched).toBe(true);

    const entries = await listLedgerEntriesForBusinessData(db, sale.data.id);
    // 2 original (debit AR, credit Sales Revenue) + 2 settlement (debit Cash/Bank, credit AR) = 4
    expect(entries).toHaveLength(4);
    const arEntries = entries.filter(
      (e) => e.account === "Accounts Receivable",
    );
    const netAr = arEntries.reduce(
      (sum, e) => sum + (e.direction === "debit" ? e.amount : -e.amount),
      0,
    );
    expect(netAr).toBeCloseTo(0, 8);

    const outstanding = await getOutstandingReceivables(db, "biz-1");
    expect(outstanding).toHaveLength(0);
  });

  test("a withdrawal matched to an outstanding purchase settles it: payable debited, Cash/Bank credited, drops from outstanding", async () => {
    const db = await setupDb();
    const purchase = await captureCreditPurchase(db, 900, "XYZ Supplies");

    const { matched } = await recordBankTransaction(db, {
      businessId: "biz-1",
      transactionType: "withdrawal",
      description: "Paid XYZ Supplies",
      amount: 900,
      currency: "MYR",
      matchBusinessDataId: purchase.data.id,
    });
    expect(matched).toBe(true);

    const entries = await listLedgerEntriesForBusinessData(
      db,
      purchase.data.id,
    );
    expect(entries).toHaveLength(4);
    const apEntries = entries.filter((e) => e.account === "Accounts Payable");
    const netAp = apEntries.reduce(
      (sum, e) => sum + (e.direction === "credit" ? e.amount : -e.amount),
      0,
    );
    expect(netAp).toBeCloseTo(0, 8);

    const outstanding = await getOutstandingPayables(db, "biz-1");
    expect(outstanding).toHaveLength(0);
  });

  test("rejects a deposit matched to a purchase (wrong type)", async () => {
    const db = await setupDb();
    const purchase = await captureCreditPurchase(db, 300, "Some Supplier");

    await expect(
      recordBankTransaction(db, {
        businessId: "biz-1",
        transactionType: "deposit",
        description: "Wrong match",
        amount: 300,
        currency: "MYR",
        matchBusinessDataId: purchase.data.id,
      }),
    ).rejects.toThrow(/can only be matched to an outstanding sale/);
  });

  test("rejects a withdrawal matched to a sale (wrong type)", async () => {
    const db = await setupDb();
    const sale = await captureCreditSale(db, 300, "Some Customer");

    await expect(
      recordBankTransaction(db, {
        businessId: "biz-1",
        transactionType: "withdrawal",
        description: "Wrong match",
        amount: 300,
        currency: "MYR",
        matchBusinessDataId: sale.data.id,
      }),
    ).rejects.toThrow(/can only be matched to an outstanding purchase/);
  });

  test("rejects a settlement amount that doesn't match the outstanding balance", async () => {
    const db = await setupDb();
    const sale = await captureCreditSale(db, 500, "Partial Payer");

    await expect(
      recordBankTransaction(db, {
        businessId: "biz-1",
        transactionType: "deposit",
        description: "Partial payment",
        amount: 250,
        currency: "MYR",
        matchBusinessDataId: sale.data.id,
      }),
    ).rejects.toThrow(/does not match the outstanding balance/);
  });

  test("rejects settling the same item twice", async () => {
    const db = await setupDb();
    const sale = await captureCreditSale(db, 400, "Twice Payer");

    await recordBankTransaction(db, {
      businessId: "biz-1",
      transactionType: "deposit",
      description: "Payment",
      amount: 400,
      currency: "MYR",
      matchBusinessDataId: sale.data.id,
    });

    await expect(
      recordBankTransaction(db, {
        businessId: "biz-1",
        transactionType: "deposit",
        description: "Duplicate payment attempt",
        amount: 400,
        currency: "MYR",
        matchBusinessDataId: sale.data.id,
      }),
    ).rejects.toThrow(/already been reconciled/);
  });
});

describe("getCfoGuidance — overdue recommendation (Vol 0_1 §6)", () => {
  test("nothing overdue means no false alarm", async () => {
    const db = await setupDb();
    await captureCreditSale(db, 200, "Fresh Customer");

    const guidance = await getCfoGuidance(db, "biz-1", { now: new Date() });
    expect(guidance.overdueReceivables).toHaveLength(0);
    expect(guidance.todayRecommendation).toBeNull();
  });

  test("a genuinely overdue invoice triggers the daily recommendation", async () => {
    const db = await setupDb();
    const sale = await captureCreditSale(db, 750, "Late Customer");

    const thirtyOneDaysLater = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    const guidance = await getCfoGuidance(db, "biz-1", {
      now: thirtyOneDaysLater,
    });

    expect(guidance.overdueReceivables).toHaveLength(1);
    expect(
      guidance.overdueReceivables[0].daysOutstanding,
    ).toBeGreaterThanOrEqual(31);
    expect(guidance.todayRecommendation).not.toBeNull();
    expect(guidance.todayRecommendation?.message).toContain("Late Customer");
    expect(guidance.todayRecommendation?.sourceBusinessEventId).toBe(
      sale.event.id,
    );
  });

  test("settling an old receivable removes it from overdue, even at the same 'now'", async () => {
    const db = await setupDb();
    const sale = await captureCreditSale(db, 300, "Eventually Paid");
    const thirtyOneDaysLater = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);

    await recordBankTransaction(db, {
      businessId: "biz-1",
      transactionType: "deposit",
      description: "Late payment received",
      amount: 300,
      currency: "MYR",
      matchBusinessDataId: sale.data.id,
    });

    const guidance = await getCfoGuidance(db, "biz-1", {
      now: thirtyOneDaysLater,
    });
    expect(guidance.overdueReceivables).toHaveLength(0);
    expect(guidance.todayRecommendation).toBeNull();
  });

  test("upcoming payables list matches the Sprint 6 outstanding-payables query directly", async () => {
    const db = await setupDb();
    await captureCreditPurchase(db, 150, "Bill Due Supplier");

    const guidance = await getCfoGuidance(db, "biz-1");
    expect(guidance.upcomingPayables).toHaveLength(1);
    expect(guidance.totalUpcomingPayableAmount).toBe(150);
  });

  test("cash position is included and reflects banking activity", async () => {
    const db = await setupDb();
    await recordBankTransaction(db, {
      businessId: "biz-1",
      transactionType: "deposit",
      description: "Capital injection",
      amount: 1000,
      currency: "MYR",
    });

    const guidance = await getCfoGuidance(db, "biz-1");
    expect(guidance.cashPosition.cashPosition).toBe(1000);
  });
});
