import {
  confirmCategory,
  runCaptureInterpretation,
} from "@aifa/core/ai/capturePipeline";
import { ScriptedCaptureProvider } from "@aifa/core/ai/providers/scriptedProvider";
import { listAiInterpretationsForEvent } from "@aifa/core/db/aiInterpretationRepository";
import { getActivityItemByEventId } from "@aifa/core/db/businessEventRepository";
import { listLedgerEntriesForBusinessData } from "@aifa/core/db/ledgerRepository";
import { runMigrations } from "@aifa/core/db/migrations";
import type { SqlDb } from "@aifa/core/db/types";
import { createTestDb } from "@aifa/core/testing/testAdapter";

async function setupDb(): Promise<SqlDb> {
  const db = createTestDb();
  await runMigrations(db);
  return db;
}

const BASE_INPUT = {
  domain: "expense" as const,
  businessId: "test-business",
  description: "Office stationery purchased",
  counterpartyName: "ABC Stationery",
  amount: 45.5,
  currency: "MYR",
  paymentMethod: "cash" as const,
};

describe("runCaptureInterpretation — confidence routing (Vol 2_2 §4.1), Expense domain", () => {
  test("confidence >= 90% auto-records: event confirmed, ledger posted", async () => {
    const db = await setupDb();
    const provider = new ScriptedCaptureProvider(() => ({
      category: "Operating Expenses:Supplies",
      confidence: 0.95,
      reasoning: "Clearly office supplies.",
      clarifying_question: null,
      matched_rule_ids: ["EXP-001"],
    }));

    const outcome = await runCaptureInterpretation(db, provider, BASE_INPUT);

    expect(outcome.decision).toBe("auto_record");
    expect(outcome.event.status).toBe("confirmed");
    expect(outcome.category).toBe("Operating Expenses:Supplies");

    const entries = await listLedgerEntriesForBusinessData(db, outcome.data.id);
    expect(entries).toHaveLength(2);
    const debit = entries.find((e) => e.direction === "debit");
    const credit = entries.find((e) => e.direction === "credit");
    expect(debit?.account).toBe("Operating Expenses:Supplies");
    expect(credit?.account).toBe("Cash / Bank"); // paymentMethod: cash
    expect(debit?.amount).toBe(45.5);
    expect(credit?.amount).toBe(45.5);

    // Attempting to mutate a confirmed event must still fail (Sprint 2 guarantee holds under Sprint 3's new paths too).
    await expect(
      db.execute(
        `UPDATE business_events SET domain_hint = 'sale' WHERE id = ?;`,
        [outcome.event.id],
      ),
    ).rejects.toThrow(/immutable once confirmed/);
  });

  test("60-89% confidence records a draft, does not post ledger entries yet", async () => {
    const db = await setupDb();
    const provider = new ScriptedCaptureProvider(() => ({
      category: "Operating Expenses:Supplies",
      confidence: 0.75,
      reasoning: "Probably supplies, not fully certain.",
      clarifying_question: null,
      matched_rule_ids: ["EXP-001"],
    }));

    const outcome = await runCaptureInterpretation(db, provider, BASE_INPUT);

    expect(outcome.decision).toBe("draft_confirm");
    expect(outcome.event.status).toBe("draft");
    expect(outcome.confidence).toBe(0.75);

    const entries = await listLedgerEntriesForBusinessData(db, outcome.data.id);
    expect(entries).toHaveLength(0);

    // Draft events are not yet 'confirmed', so mutation must still be allowed
    // (Sprint 2's trigger is scoped to OLD.status='confirmed' only).
    const item = await getActivityItemByEventId(db, outcome.event.id);
    expect(item?.data.category_guess).toBe("Operating Expenses:Supplies");
  });

  test("below 60% confidence asks a specific clarifying question, records no category", async () => {
    const db = await setupDb();
    const provider = new ScriptedCaptureProvider(() => ({
      category: null,
      confidence: 0.2,
      reasoning: "Ambiguous description.",
      clarifying_question: "Is this an expense, or inventory for resale?",
      matched_rule_ids: [],
    }));

    const outcome = await runCaptureInterpretation(db, provider, BASE_INPUT);

    expect(outcome.decision).toBe("clarify");
    expect(outcome.event.status).toBe("needs_clarification");
    expect(outcome.category).toBeNull();
    expect(outcome.clarifyingQuestion).toBe(
      "Is this an expense, or inventory for resale?",
    );

    const item = await getActivityItemByEventId(db, outcome.event.id);
    expect(item?.latestInterpretation?.clarifyingQuestion).toBe(
      "Is this an expense, or inventory for resale?",
    );

    const entries = await listLedgerEntriesForBusinessData(db, outcome.data.id);
    expect(entries).toHaveLength(0);
  });

  test("a category outside the PKA's known list is treated as zero confidence (never invents treatment)", async () => {
    const db = await setupDb();
    const provider = new ScriptedCaptureProvider(() => ({
      category: "Made Up Category",
      confidence: 0.99,
      reasoning: "Hallucinated category outside the PKA bundle.",
      clarifying_question: null,
      matched_rule_ids: [],
    }));

    const outcome = await runCaptureInterpretation(db, provider, BASE_INPUT);

    expect(outcome.decision).toBe("clarify");
    expect(outcome.category).toBeNull();
    expect(outcome.confidence).toBe(0);
  });

  test("every AI decision persists a traceable interpretation record with cost/latency metrics", async () => {
    const db = await setupDb();
    const provider = new ScriptedCaptureProvider(() => ({
      category: "Operating Expenses:Rent",
      confidence: 0.92,
      reasoning: "Matches rent vendor pattern.",
      clarifying_question: null,
      matched_rule_ids: ["EXP-001"],
    }));

    const outcome = await runCaptureInterpretation(db, provider, {
      ...BASE_INPUT,
      description: "Monthly office rent",
      counterpartyName: "Landlord Sdn Bhd",
    });

    const interpretations = await listAiInterpretationsForEvent(
      db,
      outcome.event.id,
    );
    expect(interpretations).toHaveLength(1);
    expect(interpretations[0].decision).toBe("auto_record");
    expect(interpretations[0].category).toBe("Operating Expenses:Rent");
    expect(JSON.parse(interpretations[0].source_references)).toEqual([
      outcome.event.id,
    ]);
    expect(JSON.parse(interpretations[0].matched_rule_ids)).toEqual([
      "EXP-001",
    ]);
    expect(typeof interpretations[0].latency_ms).toBe("number");
  });

  test("payment_method 'unspecified' credits Accounts Payable instead of Cash / Bank", async () => {
    const db = await setupDb();
    const provider = new ScriptedCaptureProvider(() => ({
      category: "Operating Expenses:Utilities",
      confidence: 0.93,
      reasoning: "Utility bill, deferred payment.",
      clarifying_question: null,
      matched_rule_ids: ["EXP-001"],
    }));

    const outcome = await runCaptureInterpretation(db, provider, {
      ...BASE_INPUT,
      paymentMethod: "unspecified",
    });

    const entries = await listLedgerEntriesForBusinessData(db, outcome.data.id);
    const credit = entries.find((e) => e.direction === "credit");
    expect(credit?.account).toBe("Accounts Payable");
  });
});

describe("confirmCategory — owner accept/correct/clarify-answer", () => {
  test("owner confirms a draft as-is: posts ledger, event becomes confirmed", async () => {
    const db = await setupDb();
    const provider = new ScriptedCaptureProvider(() => ({
      category: "Operating Expenses:Marketing",
      confidence: 0.7,
      reasoning: "Likely marketing spend.",
      clarifying_question: null,
      matched_rule_ids: ["EXP-001"],
    }));
    const outcome = await runCaptureInterpretation(db, provider, BASE_INPUT);
    expect(outcome.event.status).toBe("draft");

    await confirmCategory(
      db,
      outcome.event,
      outcome.data,
      "Operating Expenses:Marketing",
      BASE_INPUT.paymentMethod,
    );

    const item = await getActivityItemByEventId(db, outcome.event.id);
    expect(item?.event.status).toBe("confirmed");
    expect(item?.data.confidence).toBe(1.0);
    const entries = await listLedgerEntriesForBusinessData(db, outcome.data.id);
    expect(entries).toHaveLength(2);
  });

  test("owner corrects a draft to a different category: correction is stored and posted", async () => {
    const db = await setupDb();
    const provider = new ScriptedCaptureProvider(() => ({
      category: "Operating Expenses:Other",
      confidence: 0.65,
      reasoning: "Low-signal guess.",
      clarifying_question: null,
      matched_rule_ids: ["EXP-001"],
    }));
    const outcome = await runCaptureInterpretation(db, provider, BASE_INPUT);

    await confirmCategory(
      db,
      outcome.event,
      outcome.data,
      "Operating Expenses:Supplies", // owner's correction, different from the AI's guess
      BASE_INPUT.paymentMethod,
    );

    const item = await getActivityItemByEventId(db, outcome.event.id);
    expect(item?.data.category_guess).toBe("Operating Expenses:Supplies");
    const entries = await listLedgerEntriesForBusinessData(db, outcome.data.id);
    expect(entries.find((e) => e.direction === "debit")?.account).toBe(
      "Operating Expenses:Supplies",
    );
  });

  test("owner answers a clarifying question: resolves needs_clarification to confirmed", async () => {
    const db = await setupDb();
    const provider = new ScriptedCaptureProvider(() => ({
      category: null,
      confidence: 0.1,
      reasoning: "Too ambiguous.",
      clarifying_question: "What kind of expense is this?",
      matched_rule_ids: [],
    }));
    const outcome = await runCaptureInterpretation(db, provider, BASE_INPUT);
    expect(outcome.event.status).toBe("needs_clarification");

    await confirmCategory(
      db,
      outcome.event,
      outcome.data,
      "Operating Expenses:Supplies",
      BASE_INPUT.paymentMethod,
    );

    const item = await getActivityItemByEventId(db, outcome.event.id);
    expect(item?.event.status).toBe("confirmed");
  });

  test("rejects confirming an already-confirmed event", async () => {
    const db = await setupDb();
    const provider = new ScriptedCaptureProvider(() => ({
      category: "Operating Expenses:Supplies",
      confidence: 0.95,
      reasoning: "Clear.",
      clarifying_question: null,
      matched_rule_ids: ["EXP-001"],
    }));
    const outcome = await runCaptureInterpretation(db, provider, BASE_INPUT);
    expect(outcome.event.status).toBe("confirmed");

    await expect(
      confirmCategory(
        db,
        outcome.event,
        outcome.data,
        "Operating Expenses:Supplies",
        BASE_INPUT.paymentMethod,
      ),
    ).rejects.toThrow(
      /Cannot confirm a category for a Business Event in status 'confirmed'/,
    );
  });

  test("rejects an unrecognised category", async () => {
    const db = await setupDb();
    const provider = new ScriptedCaptureProvider(() => ({
      category: null,
      confidence: 0.1,
      reasoning: "Ambiguous.",
      clarifying_question: "Which category?",
      matched_rule_ids: [],
    }));
    const outcome = await runCaptureInterpretation(db, provider, BASE_INPUT);

    await expect(
      confirmCategory(
        db,
        outcome.event,
        outcome.data,
        "Not A Real Category",
        BASE_INPUT.paymentMethod,
      ),
    ).rejects.toThrow(/not a recognised Phase 1 'expense' category/);
  });
});
