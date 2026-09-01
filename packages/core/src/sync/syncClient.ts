/**
 * Sync orchestration — push (Vol 12_1 Section 6.1), pull (Section 6.2),
 * and the lock-cache refresh (Section 6a.3) that goes with it. Sprint 16.
 *
 * Deliberately transport-agnostic (SyncTransport, envelope.ts) — this is
 * the piece Sprint 13's DataAdapter discipline exists for: everything
 * here is pure/testable against a fake transport (see
 * __tests__/syncEngine.test.ts), and app/src/db/syncService.ts supplies
 * the real Supabase-backed one.
 *
 * Push/pull transport is plain request/response polling in this sprint,
 * per Sprint 16's own "Safe to Carry Over" — Realtime is a later
 * optimisation, not a correctness requirement this sprint depends on.
 */
import type { SqlDb } from "../db/types";
import { applyPulledEnvelope } from "./applyEnvelope";
import type { ActiveDeviceLockSnapshot, OutboxEnvelope, SyncTransport, WireEnvelope } from "./envelope";
import {
  ensureLocalSyncState,
  getLastAppliedServerSeq,
  setCachedLock,
  setLastAppliedServerSeq,
} from "./localState";
import { countPendingOutbox, listPendingOutbox, removeOutboxEnvelope } from "./outbox";

export interface PushResult {
  pushedCount: number;
  /** envelope_ids that failed to push and remain queued — push stops at the first failure to preserve device_seq ordering. */
  remainingCount: number;
  /**
   * Sprint 17 (Vol 12_1 Section 6a.4, "offline edge case" detection half).
   * True when push was skipped entirely, not because of a transport
   * failure, but because this cycle's own pull just learned that this
   * device is no longer the active one -- runSyncCycle's demotion guard,
   * not pushOutbox's own concern (pushOutbox stays an unconditional
   * primitive; callers with a known lock state decide whether to call
   * it). Left true/queued rather than silently pushed, per Section
   * 6a.4's "surfaces them to the owner for review" requirement -- the
   * review UI itself is Sprint 20's job, this flag is the plumbing it
   * will need.
   */
  skippedDueToDemotion: boolean;
}

/**
 * Pushes every pending outbox envelope, oldest (lowest device_seq) first —
 * order matters because a later envelope for the same entity can depend
 * on an earlier one having already been ingested server-side (e.g. a
 * status_transition envelope logically following its business_event
 * insert). Stops at the first failure rather than skipping ahead, so a
 * transient failure never reorders what reaches the server.
 */
export async function pushOutbox(
  db: SqlDb,
  transport: SyncTransport,
  businessId: string,
): Promise<PushResult> {
  const pending = await listPendingOutbox(db, businessId);
  let pushedCount = 0;

  for (const envelope of pending) {
    try {
      await transport.pushEnvelope(envelope);
    } catch (err) {
      return {
        pushedCount,
        remainingCount: pending.length - pushedCount,
        skippedDueToDemotion: false,
      };
    }
    await removeOutboxEnvelope(db, envelope.envelopeId);
    pushedCount += 1;
  }

  return { pushedCount, remainingCount: 0, skippedDueToDemotion: false };
}

export interface PullResult {
  appliedCount: number;
  newCheckpoint: number;
  /**
   * The active-device lock as refreshed by this pull, or null if the
   * transport reports none yet (Sprint 15's first-device auto-active case
   * or sync never having run). Sprint 17: runSyncCycle reads this to
   * decide whether push should even attempt to run this cycle (Section
   * 6a.4's detection half) -- exposed on the result rather than requiring
   * a second read of the cache, since this pull just learned it fresh.
   */
  lockSnapshot: ActiveDeviceLockSnapshot | null;
}

/**
 * Pulls every envelope with server_seq greater than this device's
 * checkpoint, applies each in ascending server_seq order (required for
 * Section 7.3's last-write-wins semantics to mean anything), advances the
 * checkpoint after each successful apply (not just once at the end — an
 * app kill mid-pull resumes from the last envelope actually applied, not
 * from the start of the whole batch), and refreshes the cached
 * active-device lock (Section 6.2's "On receipt of an
 * active_device_lock change").
 *
 * A single envelope that fails to apply (e.g. Section 7.2's rejected
 * losing status_transition) is treated as an expected, already-resolved
 * outcome, not a fatal sync error: its checkpoint still advances (its
 * server_seq has been durably observed, even though applying it was
 * correctly a no-op) and the pull continues with the next envelope.
 */
export async function pullEnvelopes(
  db: SqlDb,
  transport: SyncTransport,
  businessId: string,
  dek: Uint8Array,
  deviceId: string,
): Promise<PullResult> {
  // Bootstraps sync_local_state if this device's very first sync cycle
  // ever is a pull rather than a push (the ordinary case for any device
  // other than the very first one on a business) -- without this, a
  // fresh secondary device's checkpoint would never persist (see
  // claimNextDeviceSeq's equivalent self-bootstrap for the same reasoning
  // on the push side).
  await ensureLocalSyncState(db, businessId, deviceId);
  const checkpoint = await getLastAppliedServerSeq(db, businessId);
  const envelopes = await transport.pullEnvelopesSince(businessId, checkpoint);
  const sorted = [...envelopes].sort(
    (a, b) => (a.serverSeq ?? 0) - (b.serverSeq ?? 0),
  );

  let appliedCount = 0;
  let newCheckpoint = checkpoint;

  for (const envelope of sorted) {
    if (envelope.serverSeq == null) continue;
    try {
      await applyPulledEnvelope(db, envelope, dek);
      appliedCount += 1;
    } catch {
      // Vol 12_1 Section 7.2 -- a losing status_transition is a correct,
      // expected rejection (the migration-4 trigger enforcing "only one
      // supersede wins"), not a sync failure. Any other apply failure is
      // logged by the caller's own error handling (app/src) but must not
      // block the rest of this pull batch or leave the checkpoint stuck
      // behind a single bad envelope.
    }
    newCheckpoint = envelope.serverSeq;
    await setLastAppliedServerSeq(db, businessId, newCheckpoint);
  }

  const lock = await transport.fetchActiveDeviceLock(businessId);
  if (lock) await setCachedLock(db, lock);

  return { appliedCount, newCheckpoint, lockSnapshot: lock };
}

export interface SyncCycleResult {
  push: PushResult;
  pull: PullResult;
}

/**
 * One full sync cycle: pull first (so this device's write-gate cache is
 * current before it attempts to push anything new — Section 6a.3), then
 * push. Mirrors useAutoResume.ts's (Sprint 9) "call on mount + on
 * offline->online transition" trigger pattern; app/src wires the actual
 * trigger (see the Sprint 16 runbook for what's built there vs. deferred).
 *
 * Sprint 17 (Vol 12_1 Section 6a.4): if this cycle's pull just learned
 * that this device is no longer the active one, push is skipped entirely
 * rather than blindly flushing the outbox -- those envelopes were written
 * "on this device before it was deactivated" (Section 6a.4's own phrase)
 * and belong in the owner's review list (Sprint 20), not silently sent as
 * if nothing happened. A device that IS active, or that has never seen a
 * lock at all (no lock ever broadcast -- same permissive default
 * writeGate.ts documents), pushes normally.
 */
export async function runSyncCycle(
  db: SqlDb,
  transport: SyncTransport,
  businessId: string,
  dek: Uint8Array,
  deviceId: string,
): Promise<SyncCycleResult> {
  const pull = await pullEnvelopes(db, transport, businessId, dek, deviceId);

  const isDemoted =
    pull.lockSnapshot !== null && pull.lockSnapshot.activeDeviceId !== deviceId;

  if (isDemoted) {
    const remainingCount = await countPendingOutbox(db, businessId);
    return {
      pull,
      push: { pushedCount: 0, remainingCount, skippedDueToDemotion: true },
    };
  }

  const push = await pushOutbox(db, transport, businessId);
  return { push, pull };
}

export type { ActiveDeviceLockSnapshot, OutboxEnvelope, WireEnvelope, SyncTransport };
