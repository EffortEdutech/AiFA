/**
 * Sprint 7 — AI Workspace tests (Vol 7_2). Covers askWorkspaceQuestion's
 * orchestration (PCB assembly delegated to a scripted provider) and the
 * local heuristic provider's honest keyword-routed fallback, including
 * the explicit "no provider configured" and "out of scope" paths the
 * Sprint 7 Definition of Done requires.
 */
import { runCaptureInterpretation } from "@aifa/core/ai/capturePipeline";
import { getCfoGuidance } from "@aifa/core/ai/cfoGuidance";
import { buildWorkspacePcb } from "@aifa/core/ai/pcb";
import { LocalHeuristicExpenseProvider } from "@aifa/core/ai/providers/localHeuristicProvider";
import { ScriptedCaptureProvider } from "@aifa/core/ai/providers/scriptedProvider";
import { ScriptedWorkspaceProvider } from "@aifa/core/ai/providers/scriptedWorkspaceProvider";
import { askWorkspaceQuestion } from "@aifa/core/ai/workspacePipeline";
import { recordBankTransaction } from "@aifa/core/db/bankingRepository";
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

describe("askWorkspaceQuestion — orchestration", () => {
  test("delegates to the provider with a PCB scoped to CFO guidance, and returns its answer/sources/scope", async () => {
    const db = await setupDb();
    const provider = new ScriptedWorkspaceProvider(({ question }) => ({
      answer: `You asked: ${question}`,
      sources: ["cash_position"],
      out_of_scope: false,
    }));

    const result = await askWorkspaceQuestion(db, provider, {
      businessId: "biz-1",
      question: "What's my cash position?",
    });

    expect(result.answer).toBe("You asked: What's my cash position?");
    expect(result.sources).toEqual(["cash_position"]);
    expect(result.outOfScope).toBe(false);
    expect(result.noProviderConfigured).toBe(false);
  });

  test("an honest 'no provider configured' response when the provider has no answerFinancialQuestion method", async () => {
    const db = await setupDb();
    const provider = new ScriptedCaptureProvider(() => ({
      category: "Sales Revenue",
      confidence: 1,
      reasoning: "unused",
      clarifying_question: null,
      matched_rule_ids: [],
    }));

    const result = await askWorkspaceQuestion(db, provider, {
      businessId: "biz-1",
      question: "Anything at all",
    });

    expect(result.noProviderConfigured).toBe(true);
    expect(result.outOfScope).toBe(true);
    expect(result.answer).toMatch(/No AI model is configured/);
  });

  test("the PCB passed to the provider only ever contains the Vol 0_1 §6 reduced set", async () => {
    const db = await setupDb();
    await runCaptureInterpretation(db, saleProvider(), {
      domain: "sale",
      businessId: "biz-1",
      description: "Sold on credit",
      counterpartyName: "Overdue Co",
      amount: 100,
      currency: "MYR",
      paymentMethod: "unspecified",
    });

    let capturedPcb: unknown;
    const provider = new ScriptedWorkspaceProvider(({ pcb }) => {
      capturedPcb = pcb;
      return { answer: "ok", sources: [], out_of_scope: false };
    });

    await askWorkspaceQuestion(db, provider, {
      businessId: "biz-1",
      question: "anything",
    });

    const fc = (capturedPcb as { financial_context: Record<string, unknown> })
      .financial_context;
    expect(Object.keys(fc).sort()).toEqual(
      [
        "cash_position",
        "overdue_receivables",
        "today_recommendation",
        "upcoming_payables",
      ].sort(),
    );
  });
});

describe("LocalHeuristicExpenseProvider.answerFinancialQuestion — honest keyword routing", () => {
  const provider = new LocalHeuristicExpenseProvider();

  test("answers a cash-position question in scope", async () => {
    const db = await setupDb();
    await recordBankTransaction(db, {
      businessId: "biz-1",
      transactionType: "deposit",
      description: "Capital",
      amount: 300,
      currency: "MYR",
    });
    const guidance = await getCfoGuidance(db, "biz-1");
    const pcb = buildWorkspacePcb(guidance);

    const { result } = await provider.answerFinancialQuestion({
      pcb,
      question: "What's my cash balance?",
    });

    expect(result.out_of_scope).toBe(false);
    expect(result.answer).toContain("300.00");
    expect(result.sources).toEqual(["cash_position"]);
  });

  test("answers 'nothing overdue' honestly when there's nothing to flag", async () => {
    const db = await setupDb();
    const guidance = await getCfoGuidance(db, "biz-1");
    const pcb = buildWorkspacePcb(guidance);

    const { result } = await provider.answerFinancialQuestion({
      pcb,
      question: "Is anything overdue?",
    });

    expect(result.out_of_scope).toBe(false);
    expect(result.answer).toBe("Nothing is currently overdue.");
    expect(result.sources).toEqual([]);
  });

  test("declines an out-of-scope question rather than guessing", async () => {
    const db = await setupDb();
    const guidance = await getCfoGuidance(db, "biz-1");
    const pcb = buildWorkspacePcb(guidance);

    const { result } = await provider.answerFinancialQuestion({
      pcb,
      question: "What will my profit margin be next quarter?",
    });

    expect(result.out_of_scope).toBe(true);
    expect(result.sources).toEqual([]);
  });
});
