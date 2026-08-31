/**
 * Sprint 6 — Sales & Purchase domain tests. Exercises the same
 * capturePipeline.ts machinery Sprint 3 proved on Expense (see
 * capturePipeline.test.ts), now parameterised by domain, plus the
 * Sprint 6 receivables/payables queries. This is the "pipeline reuse
 * validation" the Sprint 6 plan calls for -- these tests would fail if any
 * Expense-only assumption (e.g. "always debit the category, credit cash")
 * had silently carried over uncorrected.
 */
import {
  confirmCategory,
  correctConfirmedCapture,
  runCaptureInterpretation,
} from "@aifa/core/ai/capturePipeline";
import { ScriptedCaptureProvider } from "@aifa/core/ai/providers/scriptedProvider";
import { getActivityItemByEventId } from "@aifa/core/db/businessEventRepository";
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

const saleAutoProvider = () =>
  new ScriptedCaptureProvider(() => ({
    category: "Sales Revenue",
    confidence: 0.95,
    reasoning: "Clear invoice.",
    clarifying_question: null,
    matched_rule_ids: ["SALE-001"],
  }));

const purchaseAutoProvider = (category: string) =>
  new ScriptedCaptureProvider(() => ({
    category,
    confidence: 0.95,
    reasoning: "Clear supplier bill.",
    clarifying_question: null,
    matched_rule_ids: ["PUR-001"],
  }));

describe("Sales domain — runCaptureInterpretation (Vol 6_1)", () => {
  test("cash sale: debits Cash/Bank, credits Sales Revenue", async () => {
    const db = await setupDb();
    const outcome = await runCaptureInterpretation(db, saleAutoProvider(), {
      domain: "sale",
      businessId: "biz-1",
      description: "10 units to ABC Trading",
      counterpartyName: "ABC Trading",
      amount: 1200,
      currency: "MYR",
      paymentMethod: "cash",
    });

    expect(outcome.decision).toBe("auto_record");
    expect(outcome.event.status).toBe("confirmed");
    expect(outcome.category).toBe("Sales Revenue");

    const entries = await listLedgerEntriesForBusinessData(db, outcome.data.id);
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.direction === "debit")?.account).toBe(
      "Cash / Bank",
    );
    expect(entries.find((e) => e.direction === "credit")?.account).toBe(
      "Sales Revenue",
    );
  });

  test("credit sale (payment_method unspecified): debits Accounts Receivable, credits Sales Revenue", async () => {
    const db = await setupDb();
    const outcome = await runCaptureInterpretation(db, saleAutoProvider(), {
      domain: "sale",
      businessId: "biz-1",
      description: "Sold on credit to XYZ Sdn Bhd",
      counterpartyName: "XYZ Sdn Bhd",
      amount: 2400,
      currency: "MYR",
      paymentMethod: "unspecified",
    });

    const entries = await listLedgerEntriesForBusinessData(db, outcome.data.id);
    expect(entries.find((e) => e.direction === "debit")?.account).toBe(
      "Accounts Receivable",
    );
    expect(entries.find((e) => e.direction === "credit")?.account).toBe(
      "Sales Revenue",
    );
  });

  test("a Sale event cannot be confirmed against an Expense-only category (domain scoping is enforced, not cosmetic)", async () => {
    const db = await setupDb();
    const draftProvider = new ScriptedCaptureProvider(() => ({
      category: "Sales Revenue",
      confidence: 0.7,
      reasoning: "Probably right.",
      clarifying_question: null,
      matched_rule_ids: ["SALE-001"],
    }));
    const outcome = await runCaptureInterpretation(db, draftProvider, {
      domain: "sale",
      businessId: "biz-1",
      description: "Sold something",
      amount: 100,
      currency: "MYR",
      paymentMethod: "cash",
    });
    expect(outcome.event.status).toBe("draft");

    await expect(
      confirmCategory(
        db,
        outcome.event,
        outcome.data,
        "Operating Expenses:Supplies", // an Expense category, not a Sale one
        "cash",
      ),
    ).rejects.toThrow(/not a recognised Phase 1 'sale' category/);
  });
});

describe("Purchase domain — runCaptureInterpretation (Vol 6_2)", () => {
  test("cash purchase of resale goods: debits Cost of Goods Sold, credits Cash/Bank", async () => {
    const db = await setupDb();
    const outcome = await runCaptureInterpretation(
      db,
      purchaseAutoProvider("Cost of Goods Sold"),
      {
        domain: "purchase",
        businessId: "biz-1",
        description: "Raw materials from XYZ Supplies",
        counterpartyName: "XYZ Supplies",
        amount: 3000,
        currency: "MYR",
        paymentMethod: "cash",
      },
    );

    const entries = await listLedgerEntriesForBusinessData(db, outcome.data.id);
    expect(entries.find((e) => e.direction === "debit")?.account).toBe(
      "Cost of Goods Sold",
    );
    expect(entries.find((e) => e.direction === "credit")?.account).toBe(
      "Cash / Bank",
    );
  });

  test("purchase on credit (payment_method unspecified): debits matched category, credits Accounts Payable", async () => {
    const db = await setupDb();
    const outcome = await runCaptureInterpretation(
      db,
      purchaseAutoProvider("Operating Expenses:Supplies"),
      {
        domain: "purchase",
        businessId: "biz-1",
        description: "Office supplies on account",
        amount: 450,
        currency: "MYR",
        paymentMethod: "unspecified",
      },
    );

    const entries = await listLedgerEntriesForBusinessData(db, outcome.data.id);
    expect(entries.find((e) => e.direction === "debit")?.account).toBe(
      "Operating Expenses:Supplies",
    );
    expect(entries.find((e) => e.direction === "credit")?.account).toBe(
      "Accounts Payable",
    );
  });
});

describe("correctConfirmedCapture — works across domains (Sprint 4 mechanism reused, not re-derived)", () => {
  test("corrects a confirmed Sale's category via reversal, same as Expense", async () => {
    const db = await setupDb();
    const outcome = await runCaptureInterpretation(db, saleAutoProvider(), {
      domain: "sale",
      businessId: "biz-1",
      description: "Consulting invoice",
      amount: 600,
      currency: "MYR",
      paymentMethod: "cash",
    });

    // Sales Revenue is Phase 1's only sale category, so correct it back to
    // itself just to prove the domain-generic correction path executes
    // cleanly for a non-Expense domain (a real second category would be
    // used once Sales has more than one, per accounting_rules.json's
    // documented Phase 1 limitation).
    const { correctingEvent } = await correctConfirmedCapture(
      db,
      outcome.event.id,
      "Sales Revenue",
    );

    expect(correctingEvent.status).toBe("confirmed");
    const original = await getActivityItemByEventId(db, outcome.event.id);
    expect(original?.event.superseded_by).toBe(correctingEvent.id);
  });
});

describe("Outstanding receivables/payables (Vol 6_1 §5, Vol 6_2 §5)", () => {
  test("a credit sale appears as an outstanding receivable; a cash sale does not", async () => {
    const db = await setupDb();
    await runCaptureInterpretation(db, saleAutoProvider(), {
      domain: "sale",
      businessId: "biz-1",
      description: "On credit",
      counterpartyName: "Credit Customer",
      amount: 500,
      currency: "MYR",
      paymentMethod: "unspecified",
    });
    await runCaptureInterpretation(db, saleAutoProvider(), {
      domain: "sale",
      businessId: "biz-1",
      description: "Paid immediately",
      counterpartyName: "Cash Customer",
      amount: 200,
      currency: "MYR",
      paymentMethod: "cash",
    });

    const receivables = await getOutstandingReceivables(db, "biz-1");
    expect(receivables).toHaveLength(1);
    expect(receivables[0].counterpartyName).toBe("Credit Customer");
    expect(receivables[0].amount).toBe(500);
  });

  test("a credit purchase appears as an outstanding payable; a cash purchase does not", async () => {
    const db = await setupDb();
    await runCaptureInterpretation(
      db,
      purchaseAutoProvider("Operating Expenses:Supplies"),
      {
        domain: "purchase",
        businessId: "biz-1",
        description: "On account",
        counterpartyName: "Credit Supplier",
        amount: 900,
        currency: "MYR",
        paymentMethod: "unspecified",
      },
    );
    await runCaptureInterpretation(
      db,
      purchaseAutoProvider("Operating Expenses:Supplies"),
      {
        domain: "purchase",
        businessId: "biz-1",
        description: "Paid immediately",
        counterpartyName: "Cash Supplier",
        amount: 300,
        currency: "MYR",
        paymentMethod: "cash",
      },
    );

    const payables = await getOutstandingPayables(db, "biz-1");
    expect(payables).toHaveLength(1);
    expect(payables[0].counterpartyName).toBe("Credit Supplier");
    expect(payables[0].amount).toBe(900);
  });

  test("correcting a confirmed credit sale removes it from outstanding receivables (reversal nets to zero)", async () => {
    const db = await setupDb();
    const outcome = await runCaptureInterpretation(db, saleAutoProvider(), {
      domain: "sale",
      businessId: "biz-1",
      description: "On credit, later corrected",
      counterpartyName: "Corrected Customer",
      amount: 750,
      currency: "MYR",
      paymentMethod: "unspecified",
    });

    let receivables = await getOutstandingReceivables(db, "biz-1");
    expect(receivables).toHaveLength(1);

    await correctConfirmedCapture(db, outcome.event.id, "Sales Revenue");

    // The corrected/reversed original must drop out. The correction itself
    // re-posts under recordCaptureQueued -> finalizeCategory using the
    // SAME payment method as the original (unspecified), so it lands back
    // on Accounts Receivable as a brand-new outstanding item -- correct
    // behaviour (the customer still owes the money after a category
    // correction; only the category changed, not the payment terms).
    receivables = await getOutstandingReceivables(db, "biz-1");
    expect(receivables).toHaveLength(1);
    expect(receivables[0].businessDataId).not.toBe(outcome.data.id);
  });

  test("returns an empty list when nothing is outstanding", async () => {
    const db = await setupDb();
    expect(await getOutstandingReceivables(db, "biz-1")).toHaveLength(0);
    expect(await getOutstandingPayables(db, "biz-1")).toHaveLength(0);
  });
});
