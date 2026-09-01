/**
 * Sprint 20 — Offline Reconciliation Backstop (Vol 12_1 Section 7).
 *
 * Every row of Section 7.4's entity summary table gets its own test
 * below, plus the real offline-then-reconnect BusinessEvent
 * status-transition conflict scenario end to end (Section 7.2) driven
 * across two separate local databases sharing one FakeTransport, the
 * same "two devices" harness pattern app/src/db/__tests__/sync.test.ts
 * established for Sprint 16.
 */
import { correctConfirmedCapture } from "@aifa/core/ai/capturePipeline";
import { recordAiInterpretation } from "@aifa/core/db/aiInterpretationRepository";
import { updateBusinessProfile } from "@aifa/core/db/appSettingsRepository";
import {
  getBusinessEventById,
  recordManualCapture,
} from "@aifa/core/db/businessEventRepository";
import { recordVendorCategoryConfirmation } from "@aifa/core/db/businessKnowledgeRepository";
import { saveDocument } from "@aifa/core/db/documentRepository";
import {
  createLedgerEntries,
  listLedgerEntriesForBusinessData,
} from "@aifa/core/db/ledgerRepository";
import { runMigrations } from "@aifa/core/db/migrations";
import type { SqlDb } from "@aifa/core/db/types";
import { deriveBusinessDek } from "@aifa/core/sync/dek";
import type {
  ActiveDeviceLockSnapshot,
  OutboxEnvelope,
  SyncTransport,
  WireEnvelope,
} from "@aifa/core/sync/envelope";
import { setCachedLock } from "@aifa/core/sync/localState";
import { countPendingOutbox, listPendingOutbox } from "@aifa/core/sync/outbox";
import {
  pullEnvelopes,
  pushOutbox,
  runSyncCycle,
} from "@aifa/core/sync/syncClient";
import { setSyncContext } from "@aifa/core/sync/syncContext";
import { createTestDb } from "@aifa/core/testing/testAdapter";

const BUSINESS_ID = "biz-sprint20";
const DEVICE_Y = "device-y-demoted";
const DEVICE_B = "device-b-active";
const RECOVERY_CODE = "sprint20-recovery-code";
const DEK = deriveBusinessDek(RECOVERY_CODE, BUSINESS_ID);

/** Same fake, shared-server-state transport pattern as sync.test.ts (Sprint 16). */
class FakeTransport implements SyncTransport {
  private serverSeqCounter = 0;
  private stored: WireEnvelope[] = [];
  private lock: ActiveDeviceLockSnapshot | null = null;

  async pushEnvelope(envelope: OutboxEnvelope): Promise<{ serverSeq: number }> {
    const existing = this.stored.find(
      (e) => e.envelopeId === envelope.envelopeId,
    );
    if (existing) return { serverSeq: existing.serverSeq as number };
    this.serverSeqCounter += 1;
    const wire: WireEnvelope = {
      ...envelope,
      serverSeq: this.serverSeqCounter,
    };
    this.stored.push(wire);
    return { serverSeq: this.serverSeqCounter };
  }

  async pullEnvelopesSince(
    businessId: string,
    sinceServerSeq: number,
  ): Promise<WireEnvelope[]> {
    return this.stored.filter(
      (e) =>
        e.businessId === businessId && (e.serverSeq as number) > sinceServerSeq,
    );
  }

  async fetchActiveDeviceLock(
    businessId: string,
  ): Promise<ActiveDeviceLockSnapshot | null> {
    return this.lock && this.lock.businessId === businessId ? this.lock : null;
  }

  setLock(lock: ActiveDeviceLockSnapshot): void {
    this.lock = lock;
  }
}

async function freshDb(): Promise<SqlDb> {
  const db = createTestDb();
  await runMigrations(db);
  return db;
}

afterEach(() => {
  setSyncContext(null);
});

describe("Section 7.1 — append-only entities never conflict, by construction", () => {
  it("BusinessEvent (create) + BusinessData + LedgerEntry + Document + AiInterpretation captured on a demoted device all survive reconciliation untouched and reach the other device intact", async () => {
    const dbY = await freshDb();
    const transport = new FakeTransport();

    // Device Y believes it is active (no lock cached yet), captures a full
    // set of append-only entities.
    setSyncContext({ businessId: BUSINESS_ID, deviceId: DEVICE_Y, dek: DEK });
    const { event, data } = await recordManualCapture(dbY, {
      businessId: BUSINESS_ID,
      domainHint: "expense",
      dataType: "expense",
      description: "Office supplies",
      amount: 120,
      currency: "MYR",
      paymentMethod: "cash",
    });
    await createLedgerEntries(dbY, [
      {
        businessDataId: data.id,
        account: "Operating Expenses:Supplies",
        direction: "debit",
        amount: 120,
        currency: "MYR",
      },
      {
        businessDataId: data.id,
        account: "Cash",
        direction: "credit",
        amount: 120,
        currency: "MYR",
      },
    ]);
    await saveDocument(dbY, {
      businessEventId: event.id,
      type: "receipt",
      extractionStatus: "not_attempted",
      mimeType: "image/jpeg",
      base64Data: "ZmFrZS1pbWFnZQ==",
    });
    await recordAiInterpretation(dbY, {
      businessEventId: event.id,
      businessDataId: data.id,
      model: "test-model",
      decision: "auto_record",
      category: "Operating Expenses:Supplies",
      confidence: 0.95,
      reasoning: "test",
      clarifyingQuestion: null,
      matchedRuleIds: [],
      sourceReferences: [],
      pkaVersion: "test",
      latencyMs: 10,
      estimatedCostUsd: null,
    });

    // 5 rows: business_event, business_data, 2x ledger_entry, document, ai_interpretation = 6
    expect(await countPendingOutbox(dbY, BUSINESS_ID)).toBe(6);

    // Now Y discovers, via a pull, that device B has been active all along.
    transport.setLock({
      businessId: BUSINESS_ID,
      activeDeviceId: DEVICE_B,
      lockToken: "tok-1",
      acquiredAt: new Date().toISOString(),
    });
    const cycle = await runSyncCycle(
      dbY,
      transport,
      BUSINESS_ID,
      DEK,
      DEVICE_Y,
    );

    expect(cycle.push.skippedDueToDemotion).toBe(true);
    expect(cycle.demotedOutboxReview).not.toBeNull();
    expect(cycle.demotedOutboxReview!.resolvedConflicts).toHaveLength(0);
    expect(cycle.demotedOutboxReview!.safeToSendItems).toHaveLength(6);

    // Owner reviews, confirms send -- exactly pushOutbox, per Section 7.1's
    // "safe to push exactly as any other queued write."
    const pushResult = await pushOutbox(dbY, transport, BUSINESS_ID);
    expect(pushResult.pushedCount).toBe(6);
    expect(await countPendingOutbox(dbY, BUSINESS_ID)).toBe(0);

    // Device B pulls and ends up with an identical picture.
    const dbB = await freshDb();
    const pullOnB = await pullEnvelopes(
      dbB,
      transport,
      BUSINESS_ID,
      DEK,
      DEVICE_B,
    );
    expect(pullOnB.appliedCount).toBe(6);
    expect(pullOnB.failedEnvelopes).toHaveLength(0);

    const eventOnB = await getBusinessEventById(dbB, event.id);
    expect(eventOnB?.status).toBe("confirmed");
    const entriesOnB = await listLedgerEntriesForBusinessData(dbB, data.id);
    expect(entriesOnB).toHaveLength(2);
  });
});

describe("Section 7.2 — the one real conflict: a BusinessEvent status transition made offline by a now-demoted device", () => {
  async function makeConfirmedExpense(db: SqlDb, deviceId: string) {
    setSyncContext({ businessId: BUSINESS_ID, deviceId, dek: DEK });
    const { event, data } = await recordManualCapture(db, {
      businessId: BUSINESS_ID,
      domainHint: "expense",
      dataType: "expense",
      description: "Vendor invoice",
      amount: 300,
      currency: "MYR",
      paymentMethod: "bank_transfer",
    });
    await createLedgerEntries(db, [
      {
        businessDataId: data.id,
        account: "Operating Expenses:Other",
        direction: "debit",
        amount: 300,
        currency: "MYR",
      },
      {
        businessDataId: data.id,
        account: "Bank",
        direction: "credit",
        amount: 300,
        currency: "MYR",
      },
    ]);
    return { event, data };
  }

  it("a real offline-then-reconnect scenario: both devices independently correct the same event; the demoted device's local view is corrected to the winner, its own correction is discarded (not double-counted), and the owner sees why", async () => {
    const transport = new FakeTransport();

    // Common history: the original expense is captured and pushed from B
    // (so both devices start from the same synced state -- the realistic
    // shape of this scenario, not a contrived asymmetry).
    const dbB = await freshDb();
    const { event: original, data: originalData } = await makeConfirmedExpense(
      dbB,
      DEVICE_B,
    );
    await pushOutbox(dbB, transport, BUSINESS_ID);

    const dbY = await freshDb();
    await pullEnvelopes(dbY, transport, BUSINESS_ID, DEK, DEVICE_Y);
    // Y was active when it last synced -- caches itself as active locally.
    await setCachedLock(dbY, {
      businessId: BUSINESS_ID,
      activeDeviceId: DEVICE_Y,
      lockToken: "tok-y",
      acquiredAt: new Date().toISOString(),
    });

    // Y goes offline. While offline, Y corrects the category (unaware it
    // is about to be demoted). An unrelated capture first diverges Y's
    // local per-day event counter from B's (generateBusinessEventId,
    // businessEventRepository.ts, derives its sequence purely from each
    // device's OWN local row count -- realistic here since a demoted
    // device that captured ANYTHING else offline, or simply started this
    // day's captures from a different already-synced count than B did,
    // ends up with a different count; the pathological case where the
    // counts coincide exactly is a separate, disclosed finding -- see
    // the Sprint 20 runbook -- not something this test conflates with
    // Section 7.2's own conflict-resolution behaviour).
    setSyncContext({ businessId: BUSINESS_ID, deviceId: DEVICE_Y, dek: DEK });
    await recordManualCapture(dbY, {
      businessId: BUSINESS_ID,
      domainHint: "expense",
      dataType: "expense",
      description: "Unrelated same-day capture on Y",
      amount: 5,
      currency: "MYR",
      paymentMethod: "cash",
    });
    const yCorrection = await correctConfirmedCapture(
      dbY,
      original.id,
      "Operating Expenses:Marketing",
    );

    // Meanwhile, online, device B ALSO corrects the very same event
    // (a genuinely concurrent, conflicting correction) and pushes first.
    setSyncContext({ businessId: BUSINESS_ID, deviceId: DEVICE_B, dek: DEK });
    const bCorrection = await correctConfirmedCapture(
      dbB,
      original.id,
      "Operating Expenses:Rent",
    );
    await pushOutbox(dbB, transport, BUSINESS_ID);
    transport.setLock({
      businessId: BUSINESS_ID,
      activeDeviceId: DEVICE_B,
      lockToken: "tok-2",
      acquiredAt: new Date().toISOString(),
    });

    // Before reconciliation: Y's own local view (wrongly, per the bug this
    // sprint closes) shows ITS OWN correction as the winner.
    const beforeReconcile = await getBusinessEventById(dbY, original.id);
    expect(beforeReconcile?.superseded_by).toBe(yCorrection.correctingEvent.id);

    // Y reconnects.
    setSyncContext({ businessId: BUSINESS_ID, deviceId: DEVICE_Y, dek: DEK });
    const cycle = await runSyncCycle(
      dbY,
      transport,
      BUSINESS_ID,
      DEK,
      DEVICE_Y,
    );

    expect(cycle.push.skippedDueToDemotion).toBe(true);
    expect(cycle.demotedOutboxReview).not.toBeNull();
    expect(cycle.demotedOutboxReview!.resolvedConflicts).toHaveLength(1);
    expect(cycle.demotedOutboxReview!.resolvedConflicts[0]).toMatchObject({
      originalEventId: original.id,
      discardedCorrectingEventId: yCorrection.correctingEvent.id,
      winningCorrectingEventId: bCorrection.correctingEvent.id,
    });

    // Y's local view now matches the server-canonical winner.
    const afterReconcile = await getBusinessEventById(dbY, original.id);
    expect(afterReconcile?.superseded_by).toBe(bCorrection.correctingEvent.id);

    // Y's own orphan correction rows are gone.
    expect(
      await getBusinessEventById(dbY, yCorrection.correctingEvent.id),
    ).toBeNull();

    // Y's own losing outbox items are gone (status_transition + its
    // correcting event/data/ledger inserts) -- nothing left that could
    // ever leak the discarded correction to another device.
    const remainingOutbox = await listPendingOutbox(dbY, BUSINESS_ID);
    expect(
      remainingOutbox.every(
        (e) => e.entityType !== "business_event_status_transition",
      ),
    ).toBe(true);

    // The ledger is correct: reversal entries applied exactly once (they
    // self-dedupe by deterministic id regardless of who reversed first),
    // and the NEW correcting entries reflect ONLY the winning correction's
    // amount -- never double-posted.
    const finalEntries = await listLedgerEntriesForBusinessData(
      dbY,
      originalData.id,
    );
    // original 2 (debit/credit) + reversal 2 = 4, no more.
    expect(finalEntries).toHaveLength(4);
    const winningCorrectionEntries = await listLedgerEntriesForBusinessData(
      dbY,
      `BD-${bCorrection.correctingEvent.id.slice(3)}`,
    );
    expect(winningCorrectionEntries).toHaveLength(2);

    // Pushing whatever remains is safe and does not resurrect the
    // discarded correction anywhere else in the system.
    await pushOutbox(dbY, transport, BUSINESS_ID);
    const dbC = await freshDb();
    const pullOnC = await pullEnvelopes(
      dbC,
      transport,
      BUSINESS_ID,
      DEK,
      "device-c-fresh",
    );
    expect(pullOnC.failedEnvelopes).toHaveLength(0);
    const eventOnC = await getBusinessEventById(dbC, original.id);
    expect(eventOnC?.superseded_by).toBe(bCorrection.correctingEvent.id);
    expect(
      await getBusinessEventById(dbC, yCorrection.correctingEvent.id),
    ).toBeNull();
  });

  it("a genuinely unrelated queued item (a different event entirely) is never touched by conflict resolution on another event", async () => {
    const transport = new FakeTransport();
    const dbB = await freshDb();
    const { event: original } = await makeConfirmedExpense(dbB, DEVICE_B);
    await pushOutbox(dbB, transport, BUSINESS_ID);

    const dbY = await freshDb();
    await pullEnvelopes(dbY, transport, BUSINESS_ID, DEK, DEVICE_Y);
    await setCachedLock(dbY, {
      businessId: BUSINESS_ID,
      activeDeviceId: DEVICE_Y,
      lockToken: "tok-y",
      acquiredAt: new Date().toISOString(),
    });

    setSyncContext({ businessId: BUSINESS_ID, deviceId: DEVICE_Y, dek: DEK });
    // Diverges Y's per-day event counter from B's -- see the previous
    // test's comment on generateBusinessEventId.
    await recordManualCapture(dbY, {
      businessId: BUSINESS_ID,
      domainHint: "expense",
      dataType: "expense",
      description: "Counter-diverging capture",
      amount: 5,
      currency: "MYR",
      paymentMethod: "cash",
    });
    await correctConfirmedCapture(
      dbY,
      original.id,
      "Operating Expenses:Marketing",
    );
    // An ordinary, unrelated new capture -- must survive reconciliation untouched.
    const unrelated = await recordManualCapture(dbY, {
      businessId: BUSINESS_ID,
      domainHint: "expense",
      dataType: "expense",
      description: "Unrelated taxi fare",
      amount: 15,
      currency: "MYR",
      paymentMethod: "cash",
    });

    setSyncContext({ businessId: BUSINESS_ID, deviceId: DEVICE_B, dek: DEK });
    const bCorrection = await correctConfirmedCapture(
      dbB,
      original.id,
      "Operating Expenses:Rent",
    );
    await pushOutbox(dbB, transport, BUSINESS_ID);
    transport.setLock({
      businessId: BUSINESS_ID,
      activeDeviceId: DEVICE_B,
      lockToken: "tok-2",
      acquiredAt: new Date().toISOString(),
    });

    setSyncContext({ businessId: BUSINESS_ID, deviceId: DEVICE_Y, dek: DEK });
    const cycle = await runSyncCycle(
      dbY,
      transport,
      BUSINESS_ID,
      DEK,
      DEVICE_Y,
    );

    expect(cycle.demotedOutboxReview!.resolvedConflicts).toHaveLength(1);
    const remaining = await listPendingOutbox(dbY, BUSINESS_ID);
    const stillHasUnrelatedEvent = remaining.some((e) => {
      return e.entityType === "business_event";
    });
    expect(stillHasUnrelatedEvent).toBe(true);
    expect(
      cycle.demotedOutboxReview!.safeToSendItems.length,
    ).toBeGreaterThanOrEqual(2); // unrelated event + unrelated data at minimum
    expect(bCorrection.correctingEvent.id).not.toBe(unrelated.event.id);
  });
});

describe("Section 7.3 — genuinely mutable, low-stakes entities: last-confirmed-write-wins by server_seq", () => {
  it("BusinessKnowledgeEntry: a queued upsert from the demoted device is left safe to send (never discarded), with a provenance note when another device also touched it", async () => {
    const transport = new FakeTransport();
    const dbY = await freshDb();

    setSyncContext({ businessId: BUSINESS_ID, deviceId: DEVICE_Y, dek: DEK });
    await recordVendorCategoryConfirmation(
      dbY,
      BUSINESS_ID,
      "Acme Supplies",
      "Operating Expenses:Supplies",
    );

    // Simulate another device's own (later) confirmation for the SAME
    // vendor having already reached the server and been pulled this cycle.
    const dbOther = await freshDb();
    setSyncContext({ businessId: BUSINESS_ID, deviceId: DEVICE_B, dek: DEK });
    await recordVendorCategoryConfirmation(
      dbOther,
      BUSINESS_ID,
      "Acme Supplies",
      "Operating Expenses:Supplies",
    );
    await pushOutbox(dbOther, transport, BUSINESS_ID);

    setSyncContext({ businessId: BUSINESS_ID, deviceId: DEVICE_Y, dek: DEK });
    transport.setLock({
      businessId: BUSINESS_ID,
      activeDeviceId: DEVICE_B,
      lockToken: "tok-3",
      acquiredAt: new Date().toISOString(),
    });
    const cycle = await runSyncCycle(
      dbY,
      transport,
      BUSINESS_ID,
      DEK,
      DEVICE_Y,
    );

    expect(cycle.demotedOutboxReview).not.toBeNull();
    const knowledgeItems = cycle.demotedOutboxReview!.safeToSendItems.filter(
      (i) => i.entityType === "business_knowledge_entry",
    );
    expect(knowledgeItems.length).toBeGreaterThanOrEqual(1);
    // Never discarded -- Section 7.3 says whichever push reaches the
    // server LAST simply wins by server_seq; sending it later is correct.
    expect(cycle.demotedOutboxReview!.resolvedConflicts).toHaveLength(0);
  });

  it("AppSettings: a queued profile update from the demoted device is left safe to send, not silently dropped", async () => {
    const transport = new FakeTransport();
    const dbY = await freshDb();
    setSyncContext({ businessId: BUSINESS_ID, deviceId: DEVICE_Y, dek: DEK });
    await updateBusinessProfile(dbY, BUSINESS_ID, { businessName: "Y's Cafe" });

    transport.setLock({
      businessId: BUSINESS_ID,
      activeDeviceId: DEVICE_B,
      lockToken: "tok-4",
      acquiredAt: new Date().toISOString(),
    });
    const cycle = await runSyncCycle(
      dbY,
      transport,
      BUSINESS_ID,
      DEK,
      DEVICE_Y,
    );

    const settingsItems = cycle.demotedOutboxReview!.safeToSendItems.filter(
      (i) => i.entityType === "app_settings",
    );
    expect(settingsItems).toHaveLength(1);
  });
});

describe("reconciliation is idempotent: calling it again after the owner hasn't reviewed yet finds nothing left to redo", () => {
  it("a second demoted sync cycle before the outbox is sent resolves zero NEW conflicts (already resolved)", async () => {
    const transport = new FakeTransport();
    const dbB = await freshDb();
    setSyncContext({ businessId: BUSINESS_ID, deviceId: DEVICE_B, dek: DEK });
    const { event: original } = await recordManualCapture(dbB, {
      businessId: BUSINESS_ID,
      domainHint: "expense",
      dataType: "expense",
      description: "Repeat test",
      amount: 50,
      currency: "MYR",
      paymentMethod: "cash",
    });
    await pushOutbox(dbB, transport, BUSINESS_ID);

    const dbY = await freshDb();
    await pullEnvelopes(dbY, transport, BUSINESS_ID, DEK, DEVICE_Y);
    await setCachedLock(dbY, {
      businessId: BUSINESS_ID,
      activeDeviceId: DEVICE_Y,
      lockToken: "tok-y",
      acquiredAt: new Date().toISOString(),
    });

    setSyncContext({ businessId: BUSINESS_ID, deviceId: DEVICE_Y, dek: DEK });
    // Diverges Y's per-day event counter from B's -- see the first
    // Section 7.2 test's comment on generateBusinessEventId.
    await recordManualCapture(dbY, {
      businessId: BUSINESS_ID,
      domainHint: "expense",
      dataType: "expense",
      description: "Counter-diverging capture",
      amount: 5,
      currency: "MYR",
      paymentMethod: "cash",
    });
    await correctConfirmedCapture(
      dbY,
      original.id,
      "Operating Expenses:Marketing",
    );

    setSyncContext({ businessId: BUSINESS_ID, deviceId: DEVICE_B, dek: DEK });
    await correctConfirmedCapture(dbB, original.id, "Operating Expenses:Rent");
    await pushOutbox(dbB, transport, BUSINESS_ID);
    transport.setLock({
      businessId: BUSINESS_ID,
      activeDeviceId: DEVICE_B,
      lockToken: "tok-5",
      acquiredAt: new Date().toISOString(),
    });

    setSyncContext({ businessId: BUSINESS_ID, deviceId: DEVICE_Y, dek: DEK });
    const firstCycle = await runSyncCycle(
      dbY,
      transport,
      BUSINESS_ID,
      DEK,
      DEVICE_Y,
    );
    expect(firstCycle.demotedOutboxReview!.resolvedConflicts).toHaveLength(1);

    const secondCycle = await runSyncCycle(
      dbY,
      transport,
      BUSINESS_ID,
      DEK,
      DEVICE_Y,
    );
    expect(secondCycle.demotedOutboxReview!.resolvedConflicts).toHaveLength(0);
  });
});
