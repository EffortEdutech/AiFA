/**
 * Web sync client wiring — Sprint 19, the web counterpart to
 * app/src/db/syncService.ts. Deliberately built the same way that file
 * was refactored this same sprint: every actual query/RPC shape lives in
 * @aifa/core/sync/supabaseTransport.ts (shared verbatim with mobile,
 * different `supabase` client object underneath), and this file is only
 * the thin, web-specific half — constructing the shared transports
 * against THIS platform's client, and threading `db: SqlDb` through as an
 * explicit parameter rather than a module-level singleton, since web has
 * no equivalent of mobile's `db/client.ts getDb()` (App.tsx holds the one
 * open `SqlDb` in React state and passes it down as a prop instead —
 * see App.tsx's own `db` state and every component under src/components
 * that takes a `db` prop).
 *
 * IMPORTANT — sandbox/build note, same class of limitation as
 * app/src/db/syncService.ts's own header: a real Supabase project and a
 * real browser are both required to exercise this file live. It is
 * code-complete against the documented Supabase client and the same
 * schema/RPCs mobile's equivalent already exercises, but has NOT been run
 * against a live project from this sandbox — verified instead via
 * `verify:sqljs-parity` (Sprint 18) proving the underlying SQL layer, and
 * this sprint's cross-platform consistency script proving the RPC/query
 * shapes are identical to mobile's.
 */
import type { SqlDb } from "@aifa/core/db/types";
import {
  getCachedLock,
  getLastAppliedServerSeq,
  setCachedLock,
} from "@aifa/core/sync/localState";
import {
  createSupabaseDevicesTransport,
  createSupabaseSyncTransport,
  type ActiveDeviceInfo,
  type RegisteredDevice,
} from "@aifa/core/sync/supabaseTransport";
import { runSyncCycle, pullEnvelopes } from "@aifa/core/sync/syncClient";
import { setSyncContext } from "@aifa/core/sync/syncContext";

import { supabase } from "./supabaseClient";

export type { RegisteredDevice, ActiveDeviceInfo };

/** Shared with app/src/db/syncService.ts's own instance — same query/RPC shapes, different `supabase` client object underneath (@aifa/core/sync/supabaseTransport.ts). */
export const supabaseSyncTransport = createSupabaseSyncTransport(supabase);
const devicesTransport = createSupabaseDevicesTransport(supabase);

/**
 * Sets this browser's ambient SyncContext (@aifa/core/sync/syncContext) so
 * every repository write from this point on is gated and queued for sync.
 * Call once per page load, after device registration/DEK derivation
 * exist (App.tsx's `identity` state). Safe to call with the same values
 * more than once.
 */
export function initWebSync(
  businessId: string,
  deviceId: string,
  dek: Uint8Array,
): void {
  setSyncContext({ businessId, deviceId, dek });
}

/** Runs one push+pull cycle against the real Supabase transport, using this browser's real local database. */
export async function runWebSyncCycle(
  db: SqlDb,
  businessId: string,
  deviceId: string,
  dek: Uint8Array,
): Promise<void> {
  await runSyncCycle(db, supabaseSyncTransport, businessId, dek, deviceId);
  // Mirrors mobile syncService.ts's runMobileSyncCycle: piggyback the
  // heartbeat on every sync cycle rather than a separate timer.
  await touchDeviceHeartbeat(db, businessId, deviceId);
}

export class ActivationRejectedError extends Error {}

/** Mirrors app/src/db/syncService.ts's requestActivation — see that file's own doc for the full Vol 12_1 §6a.1-6a.2 reasoning, identical here. */
export async function requestActivation(
  db: SqlDb,
  businessId: string,
  deviceId: string,
  dek: Uint8Array,
): Promise<void> {
  await pullEnvelopes(db, supabaseSyncTransport, businessId, dek, deviceId);

  const expectedLockToken =
    (await getCachedLock(db, businessId))?.lockToken ?? null;
  const lastAppliedServerSeq = await getLastAppliedServerSeq(db, businessId);

  let lock;
  try {
    lock = await devicesTransport.requestActivation(
      deviceId,
      lastAppliedServerSeq,
      expectedLockToken,
    );
  } catch (err) {
    throw new ActivationRejectedError(
      err instanceof Error ? err.message : String(err),
    );
  }

  await setCachedLock(db, lock);
}

/** Mirrors app/src/db/syncService.ts's getWriteAccessState. */
export async function getWriteAccessState(
  db: SqlDb,
  businessId: string,
  deviceId: string,
): Promise<{ isActiveDevice: boolean; activeDeviceId: string | null }> {
  const lock = await getCachedLock(db, businessId);
  if (!lock) return { isActiveDevice: true, activeDeviceId: null };
  return {
    isActiveDevice: lock.activeDeviceId === deviceId,
    activeDeviceId: lock.activeDeviceId,
  };
}

/** Mirrors app/src/db/syncService.ts's requestPrimaryTakeover (Vol 12_1 §6a.5, ADR-004). */
export async function requestPrimaryTakeover(
  db: SqlDb,
  businessId: string,
  deviceId: string,
  dek: Uint8Array,
): Promise<void> {
  await pullEnvelopes(db, supabaseSyncTransport, businessId, dek, deviceId);

  const lastAppliedServerSeq = await getLastAppliedServerSeq(db, businessId);

  let lock;
  try {
    lock = await devicesTransport.requestPrimaryTakeover(
      deviceId,
      lastAppliedServerSeq,
    );
  } catch (err) {
    throw new ActivationRejectedError(
      err instanceof Error ? err.message : String(err),
    );
  }

  await setCachedLock(db, lock);
}

/** Mirrors app/src/db/syncService.ts's setPrimaryDevice. */
export async function setPrimaryDevice(
  newPrimaryDeviceId: string,
): Promise<RegisteredDevice> {
  return devicesTransport.setPrimaryDevice(newPrimaryDeviceId);
}

/** Sprint 19 (Vol 12_1 §8, "Rename" action). */
export async function renameDevice(
  deviceId: string,
  newLabel: string,
): Promise<RegisteredDevice> {
  return devicesTransport.renameDevice(deviceId, newLabel);
}

/** Sprint 19 (Vol 12_1 §8, "Revoke" action) — see revoke_device's own SQL comment and the Sprint 19 runbook for the disclosed session-invalidation gap. */
export async function revokeDevice(
  deviceId: string,
  options?: { newActiveDeviceId?: string; newPrimaryDeviceId?: string },
): Promise<RegisteredDevice> {
  return devicesTransport.revokeDevice(deviceId, options);
}

/** Every non-revoked device, for action-target pickers. */
export async function getRegisteredDevices(
  businessId: string,
): Promise<RegisteredDevice[]> {
  return devicesTransport.getRegisteredDevices(businessId);
}

/** EVERY non-deleted device (including revoked), for the full Devices panel listing. */
export async function getAllDevices(
  businessId: string,
): Promise<RegisteredDevice[]> {
  return devicesTransport.getAllDevices(businessId);
}

/** Mirrors app/src/db/syncService.ts's getActiveDeviceInfo. */
export async function getActiveDeviceInfo(
  businessId: string,
  deviceId: string,
): Promise<ActiveDeviceInfo> {
  return devicesTransport.getActiveDeviceInfo(businessId, deviceId);
}

/** The Devices panel's "Sync state" column basis — cloud side. */
export async function getMaxServerSeq(businessId: string): Promise<number> {
  return devicesTransport.getMaxServerSeq(businessId);
}

/** The Devices panel's "Sync state" column basis — this browser's own local pull checkpoint. */
export async function getLocalSyncCheckpoint(
  db: SqlDb,
  businessId: string,
): Promise<number> {
  return getLastAppliedServerSeq(db, businessId);
}

/** Mirrors app/src/db/syncService.ts's touchDeviceHeartbeat — best-effort, non-blocking. */
export async function touchDeviceHeartbeat(
  db: SqlDb,
  businessId: string,
  deviceId: string,
): Promise<void> {
  try {
    const lastAppliedServerSeq = await getLastAppliedServerSeq(db, businessId);
    await devicesTransport.touchDeviceHeartbeat(deviceId, lastAppliedServerSeq);
  } catch {
    // best-effort -- see doc above
  }
}

/** Mirrors app/src/db/syncService.ts's refreshActiveDeviceLock — a lightweight lock-only refresh for a periodic poll, distinct from a full runWebSyncCycle. */
export async function refreshActiveDeviceLock(
  db: SqlDb,
  businessId: string,
): Promise<void> {
  const lock = await supabaseSyncTransport.fetchActiveDeviceLock(businessId);
  if (lock) await setCachedLock(db, lock);
}
