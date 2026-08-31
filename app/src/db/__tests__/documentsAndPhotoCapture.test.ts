import {
  completePhotoCapture,
  runExpensePhotoInterpretation,
} from "@aifa/core/ai/capturePipeline";
import { ScriptedCaptureProvider } from "@aifa/core/ai/providers/scriptedProvider";
import { ScriptedVisionExpenseProvider } from "@aifa/core/ai/providers/scriptedVisionProvider";
import {
  createQueuedPhotoEvent,
  getActivityItemByEventId,
} from "@aifa/core/db/businessEventRepository";
import {
  getDocumentBlob,
  listDocumentLibrary,
  listDocumentsForEvent,
  saveDocument,
} from "@aifa/core/db/documentRepository";
import { listLedgerEntriesForBusinessData } from "@aifa/core/db/ledgerRepository";
import { runMigrations } from "@aifa/core/db/migrations";
import type { SqlDb } from "@aifa/core/db/types";
import { createTestDb } from "@aifa/core/testing/testAdapter";

async function setupDb(): Promise<SqlDb> {
  const db = createTestDb();
  await runMigrations(db);
  return db;
}

const FAKE_IMAGE_BASE64 = "ZmFrZS1pbWFnZS1ieXRlcw=="; // "fake-image-bytes"

describe("documentRepository", () => {
  test("saveDocument links a blob + metadata row to a BusinessEvent", async () => {
    const db = await setupDb();
    // documents.business_event_id is a real foreign key -- a genuine
    // BusinessEvent row must exist first, not an arbitrary string id.
    const event = await createQueuedPhotoEvent(db, { businessId: "biz-1" });

    const { document, blob } = await saveDocument(db, {
      businessEventId: event.id,
      type: "receipt",
      extractionStatus: "not_attempted",
      mimeType: "image/jpeg",
      base64Data: FAKE_IMAGE_BASE64,
    });

    expect(document.file_ref).toBe(blob.id);
    const fetchedBlob = await getDocumentBlob(db, blob.id);
    expect(fetchedBlob?.base64_data).toBe(FAKE_IMAGE_BASE64);

    const docsForEvent = await listDocumentsForEvent(db, event.id);
    expect(docsForEvent).toHaveLength(1);
    expect(docsForEvent[0].id).toBe(document.id);
  });
});

describe("runExpensePhotoInterpretation — Vol 7_1 §5.1 failure modes", () => {
  test("no connectivity: event stays queued, document not_attempted, nothing else happens", async () => {
    const db = await setupDb();
    const provider = new ScriptedCaptureProvider(() => ({
      category: "Operating Expenses:Supplies",
      confidence: 0.95,
      reasoning: "n/a",
      clarifying_question: null,
      matched_rule_ids: [],
    }));

    const outcome = await runExpensePhotoInterpretation(db, provider, {
      businessId: "biz-1",
      base64Image: FAKE_IMAGE_BASE64,
      mimeType: "image/jpeg",
      isOnline: false,
    });

    expect(outcome.kind).toBe("queued_offline");
    if (outcome.kind !== "queued_offline") throw new Error("unreachable");
    expect(outcome.event.status).toBe("queued");

    const docs = await listDocumentsForEvent(db, outcome.event.id);
    expect(docs[0].extraction_status).toBe("not_attempted");
  });

  test("provider without vision capability is treated as extraction failing entirely", async () => {
    const db = await setupDb();
    // ScriptedCaptureProvider has no extractExpenseFromImage method.
    const provider = new ScriptedCaptureProvider(() => ({
      category: null,
      confidence: 0,
      reasoning: "n/a",
      clarifying_question: null,
      matched_rule_ids: [],
    }));

    const outcome = await runExpensePhotoInterpretation(db, provider, {
      businessId: "biz-1",
      base64Image: FAKE_IMAGE_BASE64,
      mimeType: "image/jpeg",
      isOnline: true,
    });

    expect(outcome.kind).toBe("needs_manual_entry");
    if (outcome.kind !== "needs_manual_entry") throw new Error("unreachable");
    expect(outcome.prefill).toBeNull();
    expect(outcome.event.status).toBe("needs_clarification");

    const docs = await listDocumentsForEvent(db, outcome.event.id);
    expect(docs[0].extraction_status).toBe("failed");
  });

  test("vision extraction fails entirely: needs_manual_entry, no prefill", async () => {
    const db = await setupDb();
    const provider = new ScriptedVisionExpenseProvider(
      () => ({
        category: null,
        confidence: 0,
        reasoning: "n/a",
        clarifying_question: null,
        matched_rule_ids: [],
      }),
      () => ({
        extractedFields: {
          description: null,
          counterpartyName: null,
          amount: null,
          currency: null,
        },
        extractionStatus: "failed",
      }),
    );

    const outcome = await runExpensePhotoInterpretation(db, provider, {
      businessId: "biz-1",
      base64Image: FAKE_IMAGE_BASE64,
      mimeType: "image/jpeg",
      isOnline: true,
    });

    expect(outcome.kind).toBe("needs_manual_entry");
    if (outcome.kind !== "needs_manual_entry") throw new Error("unreachable");
    expect(outcome.prefill).toBeNull();
  });

  test("vision extraction partial: needs_manual_entry with prefill, missing amount", async () => {
    const db = await setupDb();
    const provider = new ScriptedVisionExpenseProvider(
      () => ({
        category: null,
        confidence: 0,
        reasoning: "n/a",
        clarifying_question: null,
        matched_rule_ids: [],
      }),
      () => ({
        extractedFields: {
          description: "Blurry receipt from a hardware store",
          counterpartyName: "Hardware Co",
          amount: null,
          currency: null,
        },
        extractionStatus: "partial",
      }),
    );

    const outcome = await runExpensePhotoInterpretation(db, provider, {
      businessId: "biz-1",
      base64Image: FAKE_IMAGE_BASE64,
      mimeType: "image/jpeg",
      isOnline: true,
    });

    expect(outcome.kind).toBe("needs_manual_entry");
    if (outcome.kind !== "needs_manual_entry") throw new Error("unreachable");
    expect(outcome.prefill?.counterpartyName).toBe("Hardware Co");
    expect(outcome.prefill?.amount).toBeNull();

    const docs = await listDocumentsForEvent(db, outcome.event.id);
    expect(docs[0].extraction_status).toBe("partial");
  });

  test("vision extraction complete: attaches data and auto-records through the same routing as text", async () => {
    const db = await setupDb();
    const provider = new ScriptedVisionExpenseProvider(
      () => ({
        category: "Operating Expenses:Supplies",
        confidence: 0.97,
        reasoning: "Clear match from extracted fields.",
        clarifying_question: null,
        matched_rule_ids: ["EXP-001"],
      }),
      () => ({
        extractedFields: {
          description: "Printer paper and pens",
          counterpartyName: "Stationery World",
          amount: 42.9,
          currency: "MYR",
        },
        extractionStatus: "complete",
      }),
    );

    const outcome = await runExpensePhotoInterpretation(db, provider, {
      businessId: "biz-1",
      base64Image: FAKE_IMAGE_BASE64,
      mimeType: "image/jpeg",
      isOnline: true,
    });

    expect(outcome.kind).toBe("interpreted");
    if (outcome.kind !== "interpreted") throw new Error("unreachable");
    expect(outcome.outcome.decision).toBe("auto_record");
    expect(outcome.outcome.event.status).toBe("confirmed");

    const entries = await listLedgerEntriesForBusinessData(
      db,
      outcome.outcome.data.id,
    );
    expect(entries).toHaveLength(2);

    const docs = await listDocumentsForEvent(db, outcome.outcome.event.id);
    expect(docs[0].extraction_status).toBe("complete");
  });

  test("a 'complete' result missing amount/currency is defensively treated as failed, not guessed", async () => {
    const db = await setupDb();
    const provider = new ScriptedVisionExpenseProvider(
      () => ({
        category: null,
        confidence: 0,
        reasoning: "n/a",
        clarifying_question: null,
        matched_rule_ids: [],
      }),
      () => ({
        extractedFields: {
          description: "Something",
          counterpartyName: null,
          amount: null, // contract violation: 'complete' but amount missing
          currency: null,
        },
        extractionStatus: "complete",
      }),
    );

    const outcome = await runExpensePhotoInterpretation(db, provider, {
      businessId: "biz-1",
      base64Image: FAKE_IMAGE_BASE64,
      mimeType: "image/jpeg",
      isOnline: true,
    });

    expect(outcome.kind).toBe("needs_manual_entry");
    const docs = await listDocumentsForEvent(
      db,
      outcome.kind === "needs_manual_entry" ? outcome.event.id : "",
    );
    expect(docs[0].extraction_status).toBe("failed");
  });
});

describe("completePhotoCapture — owner finishes the Vol 7_1 §5.1 fallback form", () => {
  test("attaches BusinessData to the existing photo event and classifies it", async () => {
    const db = await setupDb();
    const classifyProvider = new ScriptedCaptureProvider(() => ({
      category: "Operating Expenses:Rent",
      confidence: 0.7,
      reasoning: "Draft band.",
      clarifying_question: null,
      matched_rule_ids: ["EXP-001"],
    }));

    const photoOutcome = await runExpensePhotoInterpretation(
      db,
      classifyProvider,
      {
        businessId: "biz-1",
        base64Image: FAKE_IMAGE_BASE64,
        mimeType: "image/jpeg",
        isOnline: true,
      },
    );
    expect(photoOutcome.kind).toBe("needs_manual_entry");
    if (photoOutcome.kind !== "needs_manual_entry")
      throw new Error("unreachable");

    const outcome = await completePhotoCapture(db, classifyProvider, {
      eventId: photoOutcome.event.id,
      description: "Monthly rent, paid in cash",
      counterpartyName: "Landlord",
      amount: 900,
      currency: "MYR",
      paymentMethod: "cash",
    });

    expect(outcome.decision).toBe("draft_confirm");
    expect(outcome.event.status).toBe("draft");
    expect(outcome.data.amount).toBe(900);

    const item = await getActivityItemByEventId(db, photoOutcome.event.id);
    expect(item?.data.amount).toBe(900);
    expect(item?.event.raw_input_ref).toBe("Monthly rent, paid in cash");
  });
});

describe("listDocumentLibrary — Vol 7_6 §3 basic browse", () => {
  test("joins document metadata with its BusinessEvent/BusinessData context", async () => {
    const db = await setupDb();
    const provider = new ScriptedVisionExpenseProvider(
      () => ({
        category: "Operating Expenses:Supplies",
        confidence: 0.95,
        reasoning: "n/a",
        clarifying_question: null,
        matched_rule_ids: ["EXP-001"],
      }),
      () => ({
        extractedFields: {
          description: "Notebooks",
          counterpartyName: "Bookshop",
          amount: 12,
          currency: "MYR",
        },
        extractionStatus: "complete",
      }),
    );

    await runExpensePhotoInterpretation(db, provider, {
      businessId: "biz-lib",
      base64Image: FAKE_IMAGE_BASE64,
      mimeType: "image/jpeg",
      isOnline: true,
    });

    const library = await listDocumentLibrary(db, "biz-lib");
    expect(library).toHaveLength(1);
    expect(library[0].counterpartyName).toBe("Bookshop");
    expect(library[0].amount).toBe(12);
    expect(library[0].document.extraction_status).toBe("complete");
  });
});
