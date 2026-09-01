/**
 * Local sync bookkeeping — Sprint 16 (sync_local_state, sync_lock_cache;
 * migrations.ts version 11).
 */
import type { SqlDb } from "../db/types";
import type { ActiveDeviceLockSnapshot } from "./envelope";

export interface LocalSyncState {
  businessId: string;
  deviceId: string;
  nextDeviceSeq: number;
  lastAppliedServerSeq: number;
}

/**
 * Ensures a sync_local_state row exists for this (business, device),
 * creating it with nextDeviceSeq=1/lastAppliedServerSeq=0 if this is the
 * first time sync has ever been set up on this device for this business.
 * Safe to call on every app start (INSERT OR IGNORE — a no-op once the
 * row exists).
 */
export async function ensureLocalSyncState(
  db: SqlDb,
  businessId: string,
  deviceId: string,
): Promise<LocalSyncState> {
  await db.execute(
    `INSERT OR IGNORE INTO sync_local_state (business_id, device_id, next_device_seq, last_applied_server_seq)
     VALUES (?, ?, 1, 0);`,
    [businessId, deviceId],
  );
  const rows = await db.queryAll<{
    business_id: string;
    device_id: string;
    next_device_seq: number;
    last_applied_server_seq: number;
  }>(`SELECT * FROM sync_local_state WHERE business_id = ? LIMIT 1;`, [businessId]);
  const row = rows[0];
  return {
    businessId: row.business_id,
    deviceId: row.device_id,
    nextDeviceSeq: row.next_device_seq,
    lastAppliedServerSeq: row.last_applied_server_seq,
  };
}

/**
 * Atomically claims the next device_seq (Vol 12_1 Section 6.1) and
 * advances the counter. Self-bootstraps the sync_local_state row (INSERT
 * OR IGNORE) if this is the very first envelope ever enqueued for this
 * business on this device -- callers (outbox.ts) must not be required to
 * remember to call ensureLocalSyncState first, since forgetting it would
 * silently make every claim return the same value (the UPDATE below would
 * match zero rows against a nonexistent row), producing colliding
 * envelope_ids.
 */
export async function claimNextDeviceSeq(
  db: SqlDb,
  businessId: string,
  deviceId: string,
): Promise<number> {
  await db.execute(
    `INSERT OR IGNORE INTO sync_local_state (business_id, device_id, next_device_seq, last_applied_server_seq)
     VALUES (?, ?, 1, 0);`,
    [businessId, deviceId],
  );
  const rows = await db.queryAll<{ next_device_seq: number }>(
    `SELECT next_device_seq FROM sync_local_state WHERE business_id = ? LIMIT 1;`,
    [businessId],
  );
  const claimed = rows[0]?.next_device_seq ?? 1;
  await db.execute(
    `UPDATE sync_local_state SET next_device_seq = ? WHERE business_id = ?;`,
    [claimed + 1, businessId],
  );
  return claimed;
}

export async function getLastAppliedServerSeq(
  db: SqlDb,
  businessId: string,
): Promise<number> {
  const rows = await db.queryAll<{ last_applied_server_seq: number }>(
    `SELECT last_applied_server_seq FROM sync_local_state WHERE business_id = ? LIMIT 1;`,
    [businessId],
  );
  return rows[0]?.last_applied_server_seq ?? 0;
}

export async function setLastAppliedServerSeq(
  db: SqlDb,
  businessId: string,
  serverSeq: number,
): Promise<void> {
  await db.execute(
    `UPDATE sync_local_state SET last_applied_server_seq = ? WHERE business_id = ?;`,
    [serverSeq, businessId],
  );
}

/** Refreshes this device's cached view of the active-device lock (Section 6.2 pull step). */
export async function setCachedLock(
  db: SqlDb,
  lock: ActiveDeviceLockSnapshot,
  now: Date = new Date(),
): Promise<void> {
  await db.execute(
    `INSERT INTO sync_lock_cache (business_id, active_device_id, lock_token, acquired_at, cached_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(business_id) DO UPDATE SET
       active_device_id = excluded.active_device_id,
       lock_token = excluded.lock_token,
       acquired_at = excluded.acquired_at,
       cached_at = excluded.cached_at;`,
    [
      lock.businessId,
      lock.activeDeviceId,
      lock.lockToken,
      lock.acquiredAt,
      now.toISOString(),
    ],
  );
}

export async function getCachedLock(
  db: SqlDb,
  businessId: string,
): Promise<ActiveDeviceLockSnapshot | null> {
  const rows = await db.queryAll<{
    business_id: string;
    active_device_id: string;
    lock_token: string;
    acquired_at: string;
  }>(`SELECT * FROM sync_lock_cache WHERE business_id = ? LIMIT 1;`, [businessId]);
  const row = rows[0];
  if (!row) return null;
  return {
    businessId: row.business_id,
    activeDeviceId: row.active_device_id,
    lockToken: row.lock_token,
    acquiredAt: row.acquired_at,
  };
}
