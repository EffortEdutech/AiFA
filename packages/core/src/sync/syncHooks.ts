/**
 * The two calls repository write functions make to participate in sync —
 * Sprint 16. Split into two steps, called at two different points in each
 * write function, and this split matters: `assertSyncGateOk` MUST run
 * before any SQL executes (a write rejected by the gate must never touch
 * the database at all — Vol 12_1 Section 6a.3's "not a UI-only gate"
 * requirement means the actual row is never written, not written-then-
 * regretted), while `enqueueSyncableWrite` naturally runs after, once the
 * written row's final shape is known to become the envelope payload.
 *
 * See syncContext.ts for why this is ambient-context-based rather than a
 * threaded parameter, and writeGate.ts / outbox.ts for what each half
 * actually does. Both are no-ops when no SyncContext is set, or while a
 * pulled envelope is being applied (syncContext.ts) — see that module's
 * doc for why both cases are deliberate.
 */
import type { SqlDb } from "../db/types";
import { getSyncContext, isApplyingPulledEnvelopeNow } from "./syncContext";
import { assertWriteAllowed } from "./writeGate";
import { enqueueOutboxEnvelope } from "./outbox";
import type { SyncEntityType, SyncOp } from "./envelope";

/** Call FIRST, before any db.execute for a syncable write — throws WriteGateError if this device is read-only. */
export async function assertSyncGateOk(db: SqlDb): Promise<void> {
  const ctx = getSyncContext();
  if (!ctx || isApplyingPulledEnvelopeNow()) return;
  await assertWriteAllowed(db, ctx.businessId, ctx.deviceId);
}

/** Call AFTER the write has happened, with the row(s) it produced — queues the envelope for push. */
export async function enqueueSyncableWrite(
  db: SqlDb,
  entityType: SyncEntityType,
  op: SyncOp,
  payload: unknown,
): Promise<void> {
  const ctx = getSyncContext();
  if (!ctx || isApplyingPulledEnvelopeNow()) return;
  await enqueueOutboxEnvelope(db, {
    businessId: ctx.businessId,
    deviceId: ctx.deviceId,
    dek: ctx.dek,
    entityType,
    op,
    payload,
  });
}
