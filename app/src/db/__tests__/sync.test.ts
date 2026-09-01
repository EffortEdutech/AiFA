/**
 * Sprint 16 — Mobile Sync Client & Read-Only Enforcement (Vol 12_1 Section
 * 3, Section 6, Section 6a.3). Exercises the sync engine end to end
 * against a real SQLite adapter (node:sqlite, same discipline as every
 * other repository test in this suite) and a fake in-memory
 * SyncTransport standing in for Supabase — see envelope.ts's SyncTransport
 * doc for why that seam exists.
 */
import {
  updateBusinessProfile,
  getAppSettings,
} from "@aifa/core/db/appSettingsRepository";
import {
  recordManualCapture,
  getActivityItemByEventId,
} from "@aifa/core/db/businessEventRepository";
import { createLedgerEntries } from "@aifa/core/db/ledgerRepository";
import { runMigrations } from "@aifa/core/db/migrations";
import type { SqlDb } from "@aifa/core/db/types";
import { applyPulledEnvelope } from "@aifa/core/sync/applyEnvelope";
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
  pushOutbox,
  pullEnvelopes,
  runSyncCycle,
} from "@aifa/core/sync/syncClient";
import { setSyncContext, getSyncContext } from "@aifa/core/sync/syncContext";
import { WriteGateError, assertWriteAllowed } from "@aifa/core/sync/writeGate";
import { createTestDb } from "@aifa/core/testing/testAdapter";

const BUSINESS_ID = "biz-sync-test";
const DEVICE_A = "device-a";
const DEVICE_B = "device-b";
const RECOVERY_CODE = "test-recovery-code";
const DEK = deriveBusinessDek(RECOVERY_CODE, BUSINESS_ID);

/** In-memory stand-in for the Supabase-backed transport — server_seq assigned in push order, per-business. */
class FakeTransport implements SyncTransport {
  private serverSeqCounter = 0;
  private stored: WireEnvelope[] = [];
  private lock: ActiveDeviceLockSnapshot | null = null;
  public pushCallCount = 0;

  async pushEnvelope(envelope: OutboxEnvelope): Promise<{ serverSeq: number }> {
    this.pushCallCount += 1;
    const existing = this.stored.find(
      (e) => e.envelopeId === envelope.envelopeId,
    );
    if (existing) return { serverSeq: existing.serverSeq as number }; // Section 6.3 — re-push is a safe no-op
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

  /** Test helper: re-deliver every currently-stored envelope again (simulates a duplicate pull). */
  allStored(): WireEnvelope[] {
    return [...this.stored];
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

describe("push: local mutation -> outbox -> transport (Vol 12_1 Section 6.1)", () => {
  it("queues an envelope for a manual capture and removes it once pushed", async () => {
    const db = await freshDb();
    setSyncContext({ businessId: BUSINESS_ID, deviceId: DEVICE_A, dek: DEK });

    await recordManualCapture(db, {
      businessId: BUSINESS_ID,
      domainHint: "banking",
      dataType: "bank_transaction",
      description: "Deposit",
      amount: 500,
      currency: "MYR",
      paymentMethod: "bank_transfer",
    });

    // recordManualCapture inserts BOTH a business_event and a business_data row.
    expect(await countPendingOutbox(db, BUSINESS_ID)).toBe(2);

    const transport = new FakeTransport();
    const result = await pushOutbox(db, transport, BUSINESS_ID);

    expect(result.pushedCount).toBe(2);
    expect(result.remainingCount).toBe(0);
    expect(await countPendingOutbox(db, BUSINESS_ID)).toBe(0);
  });

  it("does nothing (no gate, no outbox) when no sync context has been set", async () => {
    const db = await freshDb();
    expect(getSyncContext()).toBeNull();

    await expect(
      recordManualCapture(db, {
        businessId: BUSINESS_ID,
        domainHint: "banking",
        dataType: "bank_transaction",
        description: "Deposit",
        amount: 100,
        currency: "MYR",
        paymentMethod: "cash",
      }),
    ).resolves.toBeDefined();

    expect(await countPendingOutbox(db, BUSINESS_ID)).toBe(0);
  });
});

describe("pull: applying a pulled envelope reproduces identical local state (Vol 12_1 Section 6.2)", () => {
  it("a business_event/business_data pair captured on device A is applied on device B via the same repository construction logic", async () => {
    const dbA = await freshDb();
    const dbB = await freshDb();
    const transport = new FakeTransport();

    setSyncContext({ businessId: BUSINESS_ID, deviceId: DEVICE_A, dek: DEK });
    const { event } = await recordManualCapture(dbA, {
      businessId: BUSINESS_ID,
      domainHint: "sale",
      dataType: "sale",
      description: "Sold 3 chairs",
      counterpartyName: "Ali",
      amount: 250,
      currency: "MYR",
      paymentMethod: "cash",
    });
    await pushOutbox(dbA, transport, BUSINESS_ID);
    setSyncContext(null);

    const pullResult = await pullEnvelopes(
      dbB,
      transport,
      BUSINESS_ID,
      DEK,
      DEVICE_B,
    );
    expect(pullResult.appliedCount).toBe(2); // event insert + data insert

    const appliedItem = await getActivityItemByEventId(dbB, event.id);
    expect(appliedItem).not.toBeNull();
    expect(appliedItem?.data.amount).toBe(250);
    expect(appliedItem?.data.counterparty_name).toBe("Ali");
    expect(appliedItem?.event.domain_hint).toBe("sale");
  });

  it("out-of-order arrival: envelopes are applied in ascending server_seq order regardless of array order from the transport", async () => {
    const dbA = await freshDb();
    const dbB = await freshDb();
    const transport = new FakeTransport();

    setSyncContext({ businessId: BUSINESS_ID, deviceId: DEVICE_A, dek: DEK });
    await updateBusinessProfile(dbA, BUSINESS_ID, {
      businessName: "First Name",
    });
    await pushOutbox(dbA, transport, BUSINESS_ID);
    await updateBusinessProfile(dbA, BUSINESS_ID, {
      businessName: "Second Name",
    });
    await pushOutbox(dbA, transport, BUSINESS_ID);
    setSyncContext(null);

    // Simulate the transport handing back envelopes in reverse order --
    // pullEnvelopes must still sort by server_seq before applying.
    const stored = [...transport.allStored()].reverse();
    jest.spyOn(transport, "pullEnvelopesSince").mockResolvedValueOnce(stored);

    await pullEnvelopes(dbB, transport, BUSINESS_ID, DEK, DEVICE_B);

    const settings = await getAppSettings(dbB, BUSINESS_ID);
    expect(settings.business_name).toBe("Second Name"); // last write (by server_seq) wins, Section 7.3
  });
});

describe("idempotency: replaying the same envelope twice produces zero duplicates (Vol 12_1 Section 6.3)", () => {
  it("push retry: pushing an already-acknowledged envelope again is a safe no-op", async () => {
    const db = await freshDb();
    const transport = new FakeTransport();
    setSyncContext({ businessId: BUSINESS_ID, deviceId: DEVICE_A, dek: DEK });

    await recordManualCapture(db, {
      businessId: BUSINESS_ID,
      domainHint: "expense",
      dataType: "expense",
      description: "Fuel",
      amount: 50,
      currency: "MYR",
      paymentMethod: "cash",
    });
    const [envelope] = await listPendingOutbox(db, BUSINESS_ID);

    await transport.pushEnvelope(envelope);
    await transport.pushEnvelope(envelope); // simulated retry of the same envelope_id

    expect(transport.pushCallCount).toBe(2);
    expect(
      transport.allStored().filter((e) => e.envelopeId === envelope.envelopeId),
    ).toHaveLength(1);
  });

  it("pull replay: applying the same envelope twice inserts the row only once, with no double-counted ledger entry", async () => {
    const dbA = await freshDb();
    const dbB = await freshDb();
    const transport = new FakeTransport();

    setSyncContext({ businessId: BUSINESS_ID, deviceId: DEVICE_A, dek: DEK });
    await recordManualCapture(dbA, {
      businessId: BUSINESS_ID,
      domainHint: "sale",
      dataType: "sale",
      description: "Sold a table",
      amount: 300,
      currency: "MYR",
      paymentMethod: "cash",
    });
    setSyncContext(null);
    await pushOutbox(dbA, transport, BUSINESS_ID);

    const [envelope] = transport.allStored();

    // Apply it twice on device B -- simulates a duplicate pull delivery
    // (e.g. checkpoint advance racing an app kill).
    await applyPulledEnvelope(dbB, envelope, DEK);
    await applyPulledEnvelope(dbB, envelope, DEK);

    const rows = await dbB.queryAll<{ count: number }>(
      `SELECT COUNT(*) as count FROM business_events WHERE business_id = ?;`,
      [BUSINESS_ID],
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("ledger_entry envelopes: applying twice never double-posts", async () => {
    const dbA = await freshDb();
    const dbB = await freshDb();
    const transport = new FakeTransport();

    setSyncContext({ businessId: BUSINESS_ID, deviceId: DEVICE_A, dek: DEK });
    const { data } = await recordManualCapture(dbA, {
      businessId: BUSINESS_ID,
      domainHint: "sale",
      dataType: "sale",
      description: "Sold inventory",
      amount: 400,
      currency: "MYR",
      paymentMethod: "cash",
    });
    await createLedgerEntries(dbA, [
      {
        businessDataId: data.id,
        account: "Cash",
        direction: "debit",
        amount: 400,
        currency: "MYR",
      },
      {
        businessDataId: data.id,
        account: "Sales Revenue",
        direction: "credit",
        amount: 400,
        currency: "MYR",
      },
    ]);
    setSyncContext(null);
    await pushOutbox(dbA, transport, BUSINESS_ID);

    // Apply every envelope (business_event + business_data first, so the
    // ledger_entry rows' FK to business_data is satisfiable), each twice.
    for (const envelope of transport.allStored()) {
      await applyPulledEnvelope(dbB, envelope, DEK);
      await applyPulledEnvelope(dbB, envelope, DEK); // replay
    }

    const rows = await dbB.queryAll<{ count: number }>(
      `SELECT COUNT(*) as count FROM ledger_entries WHERE business_data_id = ?;`,
      [data.id],
    );
    expect(rows[0]?.count).toBe(2); // exactly the debit + credit pair, not 4
  });
});

describe("write gate: a demoted device's write path is blocked at the code level (Vol 12_1 Section 6a.3)", () => {
  it("assertWriteAllowed throws when the cached lock names a different active device", async () => {
    const db = await freshDb();
    await setCachedLock(db, {
      businessId: BUSINESS_ID,
      activeDeviceId: DEVICE_B,
      lockToken: "token-1",
      acquiredAt: new Date().toISOString(),
    });

    await expect(
      assertWriteAllowed(db, BUSINESS_ID, DEVICE_A),
    ).rejects.toBeInstanceOf(WriteGateError);
  });

  it("assertWriteAllowed resolves when this device IS the cached active device", async () => {
    const db = await freshDb();
    await setCachedLock(db, {
      businessId: BUSINESS_ID,
      activeDeviceId: DEVICE_A,
      lockToken: "token-1",
      acquiredAt: new Date().toISOString(),
    });

    await expect(
      assertWriteAllowed(db, BUSINESS_ID, DEVICE_A),
    ).resolves.toBeUndefined();
  });

  it("a demoted device's repository write function itself rejects the write -- not a UI-level check", async () => {
    const db = await freshDb();
    await setCachedLock(db, {
      businessId: BUSINESS_ID,
      activeDeviceId: DEVICE_B,
      lockToken: "token-1",
      acquiredAt: new Date().toISOString(),
    });
    setSyncContext({ businessId: BUSINESS_ID, deviceId: DEVICE_A, dek: DEK });

    // This calls the SAME function the Capture screen calls -- no UI
    // layer involved at all, satisfying the DoD's explicit "attempt a
    // write directly against the adapter, not just via UI" requirement.
    await expect(
      recordManualCapture(db, {
        businessId: BUSINESS_ID,
        domainHint: "expense",
        dataType: "expense",
        description: "Should be blocked",
        amount: 10,
        currency: "MYR",
        paymentMethod: "cash",
      }),
    ).rejects.toBeInstanceOf(WriteGateError);

    // And nothing was written -- a rejected write leaves no partial state.
    const rows = await db.queryAll<{ count: number }>(
      `SELECT COUNT(*) as count FROM business_events WHERE business_id = ?;`,
      [BUSINESS_ID],
    );
    expect(rows[0]?.count).toBe(0);
  });

  it("the same device, once reactivated (cache refreshed to name it active), can write again", async () => {
    const db = await freshDb();
    await setCachedLock(db, {
      businessId: BUSINESS_ID,
      activeDeviceId: DEVICE_A,
      lockToken: "token-2",
      acquiredAt: new Date().toISOString(),
    });
    setSyncContext({ businessId: BUSINESS_ID, deviceId: DEVICE_A, dek: DEK });

    await expect(
      recordManualCapture(db, {
        businessId: BUSINESS_ID,
        domainHint: "expense",
        dataType: "expense",
        description: "Should succeed",
        amount: 10,
        currency: "MYR",
        paymentMethod: "cash",
      }),
    ).resolves.toBeDefined();
  });

  it("a pulled envelope still applies on a read-only (demoted) device -- pulling is never gated, only local writes are (Section 6a.3: a read-only device 'keeps pulling normally')", async () => {
    const dbA = await freshDb();
    const dbB = await freshDb();
    const transport = new FakeTransport();

    setSyncContext({ businessId: BUSINESS_ID, deviceId: DEVICE_A, dek: DEK });
    await recordManualCapture(dbA, {
      businessId: BUSINESS_ID,
      domainHint: "sale",
      dataType: "sale",
      description: "From the active device",
      amount: 75,
      currency: "MYR",
      paymentMethod: "cash",
    });
    await pushOutbox(dbA, transport, BUSINESS_ID);
    setSyncContext(null);

    // dbB believes ITSELF (device A) is demoted -- but pull must still work.
    await setCachedLock(dbB, {
      businessId: BUSINESS_ID,
      activeDeviceId: DEVICE_B,
      lockToken: "token-3",
      acquiredAt: new Date().toISOString(),
    });
    const result = await pullEnvelopes(
      dbB,
      transport,
      BUSINESS_ID,
      DEK,
      DEVICE_B,
    );
    expect(result.appliedCount).toBe(2);
  });
});

describe("runSyncCycle: demotion detection skips push instead of leaking stale writes (Vol 12_1 Section 6a.4, Sprint 17 groundwork)", () => {
  it("pushes normally when this device IS the active device per the freshest pull", async () => {
    const db = await freshDb();
    const transport = new FakeTransport();
    transport.setLock({
      businessId: BUSINESS_ID,
      activeDeviceId: DEVICE_A,
      lockToken: "token-active",
      acquiredAt: new Date().toISOString(),
    });

    setSyncContext({ businessId: BUSINESS_ID, deviceId: DEVICE_A, dek: DEK });
    await recordManualCapture(db, {
      businessId: BUSINESS_ID,
      domainHint: "expense",
      dataType: "expense",
      description: "Written while active",
      amount: 5,
      currency: "MYR",
      paymentMethod: "cash",
    });
    setSyncContext(null);

    const result = await runSyncCycle(
      db,
      transport,
      BUSINESS_ID,
      DEK,
      DEVICE_A,
    );

    expect(result.push.skippedDueToDemotion).toBe(false);
    expect(result.push.pushedCount).toBe(2);
    expect(await countPendingOutbox(db, BUSINESS_ID)).toBe(0);
  });

  it("skips push and leaves the outbox queued when this cycle's pull learns this device was demoted", async () => {
    const db = await freshDb();
    const transport = new FakeTransport();

    // This device wrote something while it (believed it) was active...
    setSyncContext({ businessId: BUSINESS_ID, deviceId: DEVICE_A, dek: DEK });
    await recordManualCapture(db, {
      businessId: BUSINESS_ID,
      domainHint: "expense",
      dataType: "expense",
      description: "Written before deactivation",
      amount: 20,
      currency: "MYR",
      paymentMethod: "cash",
    });
    setSyncContext(null);
    // recordManualCapture inserts BOTH a business_event and a business_data row.
    expect(await countPendingOutbox(db, BUSINESS_ID)).toBe(2);

    // ...but by the time it syncs, device B has taken over.
    transport.setLock({
      businessId: BUSINESS_ID,
      activeDeviceId: DEVICE_B,
      lockToken: "token-b",
      acquiredAt: new Date().toISOString(),
    });

    const result = await runSyncCycle(
      db,
      transport,
      BUSINESS_ID,
      DEK,
      DEVICE_A,
    );

    expect(result.pull.lockSnapshot?.activeDeviceId).toBe(DEVICE_B);
    expect(result.push.skippedDueToDemotion).toBe(true);
    expect(result.push.pushedCount).toBe(0);
    expect(result.push.remainingCount).toBe(2);
    // The write was NOT silently sent to the server -- Section 6a.4 requires
    // it surface for owner review (Sprint 20), not vanish either direction.
    expect(await countPendingOutbox(db, BUSINESS_ID)).toBe(2);
    expect(transport.allStored().length).toBe(0);
  });

  it("pushes normally when no lock has ever been broadcast -- matches writeGate.ts's own permissive default", async () => {
    const db = await freshDb();
    const transport = new FakeTransport(); // no setLock call -- fetchActiveDeviceLock returns null

    setSyncContext({ businessId: BUSINESS_ID, deviceId: DEVICE_A, dek: DEK });
    await recordManualCapture(db, {
      businessId: BUSINESS_ID,
      domainHint: "expense",
      dataType: "expense",
      description: "No lock ever seen",
      amount: 8,
      currency: "MYR",
      paymentMethod: "cash",
    });
    setSyncContext(null);

    const result = await runSyncCycle(
      db,
      transport,
      BUSINESS_ID,
      DEK,
      DEVICE_A,
    );

    expect(result.pull.lockSnapshot).toBeNull();
    expect(result.push.skippedDueToDemotion).toBe(false);
    expect(result.push.pushedCount).toBe(2);
  });
});
