/**
 * Sprint 11 — Observability (Vol 8_6) and the "why" drill-down
 * explainability surface (Vol 5_3, Vol 1_2 §5). Covers everything new
 * this sprint that has no native/network dependency -- lib/auth.ts-style
 * things (crashReporting.ts's global ErrorUtils hook, exportService.ts/
 * deletionService.ts-style native file writes) remain verified by
 * tsc/eslint only, same precedent as Sprint 9/10.
 */
import {
  runCaptureInterpretation,
  runExpensePhotoInterpretation,
  confirmCategory,
} from "@aifa/core/ai/capturePipeline";
import { ScriptedCaptureProvider } from "@aifa/core/ai/providers/scriptedProvider";
import { ScriptedVisionExpenseProvider } from "@aifa/core/ai/providers/scriptedVisionProvider";
import { getWhyDetailForEvent } from "@aifa/core/ai/whyDetail";
import { recordBackupCompleted } from "@aifa/core/db/appSettingsRepository";
import { recordBankTransaction } from "@aifa/core/db/bankingRepository";
import { getDiagnosticsSummary } from "@aifa/core/db/diagnosticsRepository";
import {
  countAppErrorsSince,
  listRecentAppErrors,
  logAppError,
} from "@aifa/core/db/errorLogRepository";
import { runMigrations } from "@aifa/core/db/migrations";
import type { SqlDb } from "@aifa/core/db/types";
import { createTestDb } from "@aifa/core/testing/testAdapter";

async function setupDb(): Promise<SqlDb> {
  const db = createTestDb();
  await runMigrations(db);
  return db;
}

const BUSINESS_ID = "biz-1";

const autoRecordProvider = () =>
  new ScriptedCaptureProvider(() => ({
    category: "Operating Expenses:Supplies",
    confidence: 0.95,
    reasoning: "Clear vendor match.",
    clarifying_question: null,
    matched_rule_ids: ["EXP-001"],
  }));

const draftConfirmProvider = () =>
  new ScriptedCaptureProvider(() => ({
    category: "Operating Expenses:Supplies",
    confidence: 0.75,
    reasoning: "Plausible but not certain.",
    clarifying_question: null,
    matched_rule_ids: ["EXP-001"],
  }));

const clarifyProvider = () =>
  new ScriptedCaptureProvider(() => ({
    category: null,
    confidence: 0.1,
    reasoning: "No idea.",
    clarifying_question: "What was this for?",
    matched_rule_ids: [],
  }));

const throwingProvider = () =>
  new ScriptedCaptureProvider(() => {
    throw new Error("network request failed");
  });

const throwingVisionProvider = () =>
  new ScriptedVisionExpenseProvider(
    () => ({
      category: null,
      confidence: 0,
      reasoning: "n/a",
      clarifying_question: null,
      matched_rule_ids: [],
    }),
    () => {
      throw new Error("vision network failure");
    },
  );

describe("errorLogRepository", () => {
  test("logAppError writes a row and truncates overlong message/stack", async () => {
    const db = await setupDb();
    const longMessage = "x".repeat(5000);
    const entry = await logAppError(db, {
      errorType: "unhandled_exception",
      message: longMessage,
      stack: "y".repeat(6000),
      context: { screen: "Dashboard" },
    });
    expect(entry.message.length).toBeLessThan(longMessage.length);
    expect(entry.message.endsWith("…")).toBe(true);

    const rows = await listRecentAppErrors(db, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].error_type).toBe("unhandled_exception");
    expect(JSON.parse(rows[0].context ?? "{}")).toEqual({
      screen: "Dashboard",
    });
  });

  test("listRecentAppErrors returns newest first", async () => {
    const db = await setupDb();
    await logAppError(
      db,
      { errorType: "ai_call_error", message: "first" },
      new Date("2026-01-01T00:00:00.000Z"),
    );
    await logAppError(
      db,
      { errorType: "ai_call_error", message: "second" },
      new Date("2026-01-02T00:00:00.000Z"),
    );

    const rows = await listRecentAppErrors(db, 10);
    expect(rows.map((r) => r.message)).toEqual(["second", "first"]);
  });

  test("countAppErrorsSince only counts errors at or after the given time", async () => {
    const db = await setupDb();
    await logAppError(
      db,
      { errorType: "workspace_call_error", message: "old" },
      new Date("2026-01-01T00:00:00.000Z"),
    );
    await logAppError(
      db,
      { errorType: "workspace_call_error", message: "recent" },
      new Date("2026-01-03T00:00:00.000Z"),
    );

    const count = await countAppErrorsSince(db, "2026-01-02T00:00:00.000Z");
    expect(count).toBe(1);
  });
});

describe("diagnosticsRepository — getDiagnosticsSummary", () => {
  test("reports zero queued, null last backup, and zero errors on a fresh db", async () => {
    const db = await setupDb();
    const summary = await getDiagnosticsSummary(db, BUSINESS_ID);
    expect(summary.queuedCount).toBe(0);
    expect(summary.oldestQueuedCapturedAt).toBeNull();
    expect(summary.lastBackupAt).toBeNull();
    expect(summary.recentErrorCount24h).toBe(0);
  });

  test("counts queued/processing events and surfaces the oldest one", async () => {
    const db = await setupDb();
    await runCaptureInterpretation(db, throwingProvider(), {
      domain: "expense",
      businessId: BUSINESS_ID,
      description: "First queued",
      counterpartyName: "Vendor A",
      amount: 10,
      currency: "MYR",
      paymentMethod: "cash",
    });
    await runCaptureInterpretation(db, throwingProvider(), {
      domain: "expense",
      businessId: BUSINESS_ID,
      description: "Second queued",
      counterpartyName: "Vendor B",
      amount: 20,
      currency: "MYR",
      paymentMethod: "cash",
    });

    const summary = await getDiagnosticsSummary(db, BUSINESS_ID);
    expect(summary.queuedCount).toBe(2);
    expect(summary.oldestQueuedCapturedAt).not.toBeNull();
  });

  test("reflects last_backup_at once recordBackupCompleted has run", async () => {
    const db = await setupDb();
    const now = new Date("2026-03-01T12:00:00.000Z");
    await recordBackupCompleted(db, BUSINESS_ID, now);

    const summary = await getDiagnosticsSummary(db, BUSINESS_ID);
    expect(summary.lastBackupAt).toBe(now.toISOString());
  });

  test("recentErrorCount24h reflects the trailing-24h window relative to `now`", async () => {
    const db = await setupDb();
    await logAppError(
      db,
      { errorType: "ai_call_error", message: "too old" },
      new Date("2026-03-01T00:00:00.000Z"),
    );
    await logAppError(
      db,
      { errorType: "ai_call_error", message: "recent" },
      new Date("2026-03-02T23:00:00.000Z"),
    );

    const summary = await getDiagnosticsSummary(
      db,
      BUSINESS_ID,
      new Date("2026-03-03T00:00:00.000Z"),
    );
    expect(summary.recentErrorCount24h).toBe(1);
  });
});

describe("capturePipeline — Sprint 11 AI-call error logging", () => {
  test("a thrown classify() error is both queued AND logged to app_error_log", async () => {
    const db = await setupDb();
    await runCaptureInterpretation(db, throwingProvider(), {
      domain: "expense",
      businessId: BUSINESS_ID,
      description: "Will fail",
      counterpartyName: "Vendor",
      amount: 15,
      currency: "MYR",
      paymentMethod: "cash",
    });

    const errors = await listRecentAppErrors(db, 10);
    expect(errors).toHaveLength(1);
    expect(errors[0].error_type).toBe("ai_call_error");
    expect(errors[0].message).toContain("network request failed");
    expect(JSON.parse(errors[0].context ?? "{}")).toMatchObject({
      domain: "expense",
      operation: "classify",
    });
  });

  test("a thrown vision extraction error is also logged to app_error_log", async () => {
    const db = await setupDb();
    const queued = await runExpensePhotoInterpretation(
      db,
      throwingVisionProvider(),
      {
        businessId: BUSINESS_ID,
        base64Image: "ZmFrZQ==",
        mimeType: "image/jpeg",
        isOnline: true,
      },
    );
    expect(queued.kind).toBe("queued_offline");

    const errors = await listRecentAppErrors(db, 10);
    expect(errors).toHaveLength(1);
    expect(errors[0].error_type).toBe("ai_call_error");
    expect(JSON.parse(errors[0].context ?? "{}")).toMatchObject({
      operation: "extractExpenseFromImage",
    });
  });
});

describe("whyDetail — getWhyDetailForEvent confidence-state classification", () => {
  test("returns null for an unknown event id", async () => {
    const db = await setupDb();
    const detail = await getWhyDetailForEvent(db, "BE-does-not-exist");
    expect(detail).toBeNull();
  });

  test("auto_record confirmed capture -> confirmed_high_confidence", async () => {
    const db = await setupDb();
    const outcome = await runCaptureInterpretation(db, autoRecordProvider(), {
      domain: "expense",
      businessId: BUSINESS_ID,
      description: "Clear expense",
      counterpartyName: "Vendor",
      amount: 50,
      currency: "MYR",
      paymentMethod: "cash",
    });

    const detail = await getWhyDetailForEvent(db, outcome.event.id);
    expect(detail?.confidenceState).toBe("confirmed_high_confidence");
    expect(detail?.wasCorrected).toBe(false);
    expect(detail?.latest?.matched_rule_ids).toContain("EXP-001");
  });

  test("draft_confirm then owner-confirmed -> confirmed_after_review", async () => {
    const db = await setupDb();
    const outcome = await runCaptureInterpretation(db, draftConfirmProvider(), {
      domain: "expense",
      businessId: BUSINESS_ID,
      description: "Plausible expense",
      counterpartyName: "Vendor",
      amount: 50,
      currency: "MYR",
      paymentMethod: "cash",
    });
    expect(outcome.decision).toBe("draft_confirm");

    await confirmCategory(
      db,
      {
        id: outcome.event.id,
        status: "draft",
        domain_hint: "expense",
        business_id: BUSINESS_ID,
      },
      {
        id: outcome.data.id,
        amount: 50,
        currency: "MYR",
        counterparty_name: "Vendor",
      },
      "Operating Expenses:Supplies",
      "cash",
    );

    const detail = await getWhyDetailForEvent(db, outcome.event.id);
    expect(detail?.confidenceState).toBe("confirmed_after_review");
  });

  test("clarify decision, unresolved -> awaiting_clarification", async () => {
    const db = await setupDb();
    const outcome = await runCaptureInterpretation(db, clarifyProvider(), {
      domain: "expense",
      businessId: BUSINESS_ID,
      description: "Unclear expense",
      counterpartyName: "Mystery Vendor",
      amount: 12,
      currency: "MYR",
      paymentMethod: "cash",
    });
    expect(outcome.decision).toBe("clarify");

    const detail = await getWhyDetailForEvent(db, outcome.event.id);
    expect(detail?.confidenceState).toBe("awaiting_clarification");
    expect(detail?.latest?.clarifying_question).toBe("What was this for?");
  });

  test("queued (AI never reached) -> queued_not_yet_interpreted, no interpretation row", async () => {
    const db = await setupDb();
    const outcome = await runCaptureInterpretation(db, throwingProvider(), {
      domain: "expense",
      businessId: BUSINESS_ID,
      description: "Will queue",
      counterpartyName: "Vendor",
      amount: 20,
      currency: "MYR",
      paymentMethod: "cash",
    });
    expect(outcome.decision).toBe("queued_retry");

    const detail = await getWhyDetailForEvent(db, outcome.event.id);
    expect(detail?.confidenceState).toBe("queued_not_yet_interpreted");
    expect(detail?.latest).toBeNull();
    expect(detail?.interpretations).toHaveLength(0);
  });

  test("Banking (manual, non-AI-interpreted) domain -> manual_no_ai", async () => {
    const db = await setupDb();
    await recordBankTransaction(db, {
      businessId: BUSINESS_ID,
      transactionType: "deposit",
      description: "Cash top-up",
      amount: 100,
      currency: "MYR",
    });

    const events = await db.queryAll<{ id: string }>(
      `SELECT id FROM business_events WHERE domain_hint = 'banking' LIMIT 1;`,
    );
    const detail = await getWhyDetailForEvent(db, events[0].id);
    expect(detail?.confidenceState).toBe("manual_no_ai");
    expect(detail?.latest).toBeNull();
  });
});
