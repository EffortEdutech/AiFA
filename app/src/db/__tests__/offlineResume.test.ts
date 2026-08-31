/**
 * Sprint 9 — offline queueing hardening (Vol 7_4 §2-4): every capture path
 * must leave a captured event in a resumable state under connectivity
 * loss, and resumeQueuedWork must be able to pick it back up later with no
 * data loss or duplication.
 */
import {
  resumeQueuedCaptures,
  resumeQueuedPhotoCaptures,
  resumeQueuedWork,
  runCaptureInterpretation,
  runExpensePhotoInterpretation,
} from "@aifa/core/ai/capturePipeline";
import { ScriptedCaptureProvider } from "@aifa/core/ai/providers/scriptedProvider";
import { ScriptedVisionExpenseProvider } from "@aifa/core/ai/providers/scriptedVisionProvider";
import { getActivityItemByEventId } from "@aifa/core/db/businessEventRepository";
import { listDocumentsForEvent } from "@aifa/core/db/documentRepository";
import { runMigrations } from "@aifa/core/db/migrations";
import type { SqlDb } from "@aifa/core/db/types";
import { createTestDb } from "@aifa/core/testing/testAdapter";

async function setupDb(): Promise<SqlDb> {
  const db = createTestDb();
  await runMigrations(db);
  return db;
}

const autoRecordProvider = () =>
  new ScriptedCaptureProvider(() => ({
    category: "Operating Expenses:Supplies",
    confidence: 0.95,
    reasoning: "Clear.",
    clarifying_question: null,
    matched_rule_ids: ["EXP-001"],
  }));

const throwingProvider = () =>
  new ScriptedCaptureProvider(() => {
    throw new Error("network request failed");
  });

describe("runCaptureInterpretation — offline/failure handling (Vol 7_4 §2)", () => {
  test("isOnline: false skips the network call and leaves the event queued", async () => {
    const db = await setupDb();
    const outcome = await runCaptureInterpretation(db, autoRecordProvider(), {
      domain: "expense",
      businessId: "biz-1",
      description: "Bought supplies",
      counterpartyName: "Some Vendor",
      amount: 40,
      currency: "MYR",
      paymentMethod: "cash",
      isOnline: false,
    });

    expect(outcome.decision).toBe("queued_retry");
    expect(outcome.event.status).toBe("queued");

    const rows = await db.queryAll<{ n: number }>(
      `SELECT COUNT(*) as n FROM ai_interpretations WHERE business_event_id = ?;`,
      [outcome.event.id],
    );
    // No classification was ever attempted -- nothing genuine to log.
    expect(rows[0].n).toBe(0);
  });

  test("a network failure mid-call leaves the event queued, not stuck processing", async () => {
    const db = await setupDb();
    const outcome = await runCaptureInterpretation(db, throwingProvider(), {
      domain: "expense",
      businessId: "biz-1",
      description: "Bought supplies",
      counterpartyName: "Some Vendor",
      amount: 40,
      currency: "MYR",
      paymentMethod: "cash",
    });

    expect(outcome.decision).toBe("queued_retry");
    expect(outcome.event.status).toBe("queued");

    const stored = await getActivityItemByEventId(db, outcome.event.id);
    expect(stored?.event.status).toBe("queued");
  });
});

describe("resumeQueuedCaptures (Vol 7_4 §4)", () => {
  test("retries a queued text capture once connectivity returns, no duplication", async () => {
    const db = await setupDb();
    const stuck = await runCaptureInterpretation(db, throwingProvider(), {
      domain: "expense",
      businessId: "biz-1",
      description: "Bought supplies",
      counterpartyName: "Some Vendor",
      amount: 40,
      currency: "MYR",
      paymentMethod: "cash",
    });
    expect(stuck.decision).toBe("queued_retry");

    const resumed = await resumeQueuedCaptures(
      db,
      autoRecordProvider(),
      "biz-1",
    );
    expect(resumed).toHaveLength(1);
    expect(resumed[0].event.id).toBe(stuck.event.id);
    expect(resumed[0].decision).toBe("auto_record");
    expect(resumed[0].event.status).toBe("confirmed");

    // Exactly one Business Event exists for this capture -- nothing was
    // duplicated by the retry.
    const rows = await db.queryAll<{ n: number }>(
      `SELECT COUNT(*) as n FROM business_events WHERE id = ?;`,
      [stuck.event.id],
    );
    expect(rows[0].n).toBe(1);
  });

  test("returns an empty array when nothing is queued", async () => {
    const db = await setupDb();
    const resumed = await resumeQueuedCaptures(
      db,
      autoRecordProvider(),
      "biz-1",
    );
    expect(resumed).toEqual([]);
  });

  test("resuming twice does not re-process an already-confirmed event", async () => {
    const db = await setupDb();
    const stuck = await runCaptureInterpretation(db, throwingProvider(), {
      domain: "expense",
      businessId: "biz-1",
      description: "Bought supplies",
      counterpartyName: "Some Vendor",
      amount: 40,
      currency: "MYR",
      paymentMethod: "cash",
    });
    await resumeQueuedCaptures(db, autoRecordProvider(), "biz-1");

    // Second resume pass should find nothing left queued for this event.
    const secondPass = await resumeQueuedCaptures(
      db,
      autoRecordProvider(),
      "biz-1",
    );
    expect(
      secondPass.find((o) => o.event.id === stuck.event.id),
    ).toBeUndefined();
  });
});

const FAKE_IMAGE_BASE64 = "ZmFrZS1pbWFnZS1ieXRlcw==";

describe("runExpensePhotoInterpretation + resumeQueuedPhotoCaptures (Vol 7_4 §2, §4)", () => {
  test("offline capture stays queued with the document not_attempted, then resumes successfully", async () => {
    const db = await setupDb();
    const outcome = await runExpensePhotoInterpretation(
      db,
      new ScriptedVisionExpenseProvider(
        () => ({
          category: "Operating Expenses:Supplies",
          confidence: 0.95,
          reasoning: "n/a",
          clarifying_question: null,
          matched_rule_ids: [],
        }),
        () => ({
          extractionStatus: "complete",
          extractedFields: {
            description: "Receipt",
            counterpartyName: "Photo Vendor",
            amount: 25,
            currency: "MYR",
          },
        }),
      ),
      {
        businessId: "biz-1",
        base64Image: FAKE_IMAGE_BASE64,
        mimeType: "image/jpeg",
        isOnline: false,
      },
    );
    expect(outcome.kind).toBe("queued_offline");

    const docs = await listDocumentsForEvent(
      db,
      outcome.kind === "queued_offline" ? outcome.event.id : "",
    );
    expect(docs[0]?.extraction_status).toBe("not_attempted");

    const resumed = await resumeQueuedPhotoCaptures(
      db,
      new ScriptedVisionExpenseProvider(
        () => ({
          category: "Operating Expenses:Supplies",
          confidence: 0.95,
          reasoning: "n/a",
          clarifying_question: null,
          matched_rule_ids: [],
        }),
        () => ({
          extractionStatus: "complete",
          extractedFields: {
            description: "Receipt",
            counterpartyName: "Photo Vendor",
            amount: 25,
            currency: "MYR",
          },
        }),
      ),
      "biz-1",
    );

    expect(resumed).toHaveLength(1);
    expect(resumed[0].kind).toBe("interpreted");
    if (resumed[0].kind === "interpreted") {
      expect(resumed[0].outcome.decision).toBe("auto_record");
      expect(resumed[0].outcome.event.status).toBe("confirmed");
    }
  });

  test("a thrown extraction error also leaves the capture resumable, not misfiled as needs_clarification", async () => {
    const db = await setupDb();
    const outcome = await runExpensePhotoInterpretation(
      db,
      new ScriptedVisionExpenseProvider(
        () => {
          throw new Error("should not be called");
        },
        () => {
          throw new Error("network request failed");
        },
      ),
      {
        businessId: "biz-1",
        base64Image: FAKE_IMAGE_BASE64,
        mimeType: "image/jpeg",
        isOnline: true,
      },
    );
    expect(outcome.kind).toBe("queued_offline");

    const resumed = await resumeQueuedPhotoCaptures(
      db,
      new ScriptedVisionExpenseProvider(
        () => ({
          category: "Operating Expenses:Supplies",
          confidence: 0.95,
          reasoning: "n/a",
          clarifying_question: null,
          matched_rule_ids: [],
        }),
        () => ({
          extractionStatus: "complete",
          extractedFields: {
            description: "Receipt",
            counterpartyName: "Photo Vendor",
            amount: 25,
            currency: "MYR",
          },
        }),
      ),
      "biz-1",
    );
    expect(resumed).toHaveLength(1);
    expect(resumed[0].kind).toBe("interpreted");
  });

  test("resumeQueuedPhotoCaptures returns an empty array when nothing is queued", async () => {
    const db = await setupDb();
    const resumed = await resumeQueuedPhotoCaptures(
      db,
      new ScriptedVisionExpenseProvider(
        () => ({
          category: "x",
          confidence: 0,
          reasoning: "",
          clarifying_question: null,
          matched_rule_ids: [],
        }),
        () => ({
          extractionStatus: "failed",
          extractedFields: undefined as never,
        }),
      ),
      "biz-1",
    );
    expect(resumed).toEqual([]);
  });
});

describe("resumeQueuedWork concurrency guard (Sprint 12 bug-bash finding)", () => {
  test("an overlapping second call for the same business is a no-op, not a duplicate pass", async () => {
    const db = await setupDb();
    const stuck = await runCaptureInterpretation(db, throwingProvider(), {
      domain: "expense",
      businessId: "biz-1",
      description: "Bought supplies",
      counterpartyName: "Some Vendor",
      amount: 40,
      currency: "MYR",
      paymentMethod: "cash",
    });
    expect(stuck.decision).toBe("queued_retry");

    // A slow provider so the two resumeQueuedWork calls below genuinely
    // overlap (mirrors a real AI round-trip taking longer than a rapid
    // offline->online->offline->online connectivity flap).
    const slowAutoRecordProvider = {
      name: "slow-test-provider",
      async classify() {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          result: {
            category: "Operating Expenses:Supplies",
            confidence: 0.95,
            reasoning: "Clear.",
            clarifying_question: null,
            matched_rule_ids: ["EXP-001"],
          },
          metrics: { latencyMs: 20, estimatedCostUsd: 0, model: "slow" },
        };
      },
    };

    const [first, second] = await Promise.all([
      resumeQueuedWork(db, slowAutoRecordProvider, "biz-1"),
      resumeQueuedWork(db, slowAutoRecordProvider, "biz-1"),
    ]);

    const results = [first, second];
    const withWork = results.filter((r) => r.resumedCaptures.length > 0);
    const noOps = results.filter((r) => r.resumedCaptures.length === 0);
    // Exactly one of the two overlapping calls actually did the work; the
    // other is the guard's no-op.
    expect(withWork).toHaveLength(1);
    expect(noOps).toHaveLength(1);

    // Exactly one ai_interpretations row was written for this event -- not
    // two -- confirming the race identified in the bug-bash pass is closed.
    const rows = await db.queryAll<{ n: number }>(
      `SELECT COUNT(*) as n FROM ai_interpretations WHERE business_event_id = ?;`,
      [stuck.event.id],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("resumeQueuedWork (Vol 7_4 §4)", () => {
  test("resumes both a stuck text capture and a stuck photo capture in one call", async () => {
    const db = await setupDb();
    await runCaptureInterpretation(db, throwingProvider(), {
      domain: "expense",
      businessId: "biz-1",
      description: "Bought supplies",
      counterpartyName: "Text Vendor",
      amount: 40,
      currency: "MYR",
      paymentMethod: "cash",
    });
    await runExpensePhotoInterpretation(
      db,
      new ScriptedVisionExpenseProvider(
        () => ({
          category: "x",
          confidence: 0,
          reasoning: "",
          clarifying_question: null,
          matched_rule_ids: [],
        }),
        () => ({
          extractionStatus: "failed",
          extractedFields: undefined as never,
        }),
      ),
      {
        businessId: "biz-1",
        base64Image: FAKE_IMAGE_BASE64,
        mimeType: "image/jpeg",
        isOnline: false,
      },
    );

    const summary = await resumeQueuedWork(db, autoRecordProvider(), "biz-1");
    expect(summary.resumedCaptures).toHaveLength(1);
    expect(summary.resumedPhotos).toHaveLength(1);
  });
});
