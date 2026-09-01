/**
 * Mobile sync client wiring — Sprint 16 (Vol 12_1 Section 6), extended
 * Sprint 17 (handoff/primary UX glue) and Sprint 19 (Devices panel
 * actions, and the SyncTransport/devices-registry query logic itself
 * moved into @aifa/core/sync/supabaseTransport.ts so web/'s equivalent
 * file isn't a parallel reimplementation — see that file's own header
 * comment for the full reasoning). This file is now the thin, mobile-
 * specific half only: constructing the shared transports against THIS
 * platform's `supabase` client, `@aifa/core`'s ambient SyncContext glue,
 * and op-sqlite's `SqlDb` — every actual query/RPC shape lives in
 * @aifa/core, shared verbatim with web/src/lib/syncService.ts.
 *
 * IMPORTANT — sandbox/build note, same class of limitation as
 * backupService.ts and auth.ts (Sprint 9/10): a real Supabase project and
 * a real device/simulator are both required to exercise this file. It is
 * code-complete against the documented Supabase client and Sprint
 * 14/15/19 schema/RPCs, but has NOT been exercised against a live
 * project. Verify on your own machine before relying on it.
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

import { getDb } from "./client";

import { supabase } from "@/lib/supabaseClient";

export type { RegisteredDevice, ActiveDeviceInfo };

/** Shared with web/src/lib/syncService.ts's own instance — same query/RPC shapes, different `supabase` client object underneath (@aifa/core/sync/supabaseTransport.ts). */
export const supabaseSyncTransport = createSupabaseSyncTransport(supabase);
const devicesTransport = createSupabaseDevicesTransport(supabase);

/**
 * Sets this device's ambient SyncContext (@aifa/core/sync/syncContext) so
 * every repository write from this point on is gated and queued for sync.
 * Call once at app startup, after device registration/DEK derivation
 * exist. Safe to call with the same values more than once.
 */
export function initMobileSync(
  businessId: string,
  deviceId: string,
  dek: Uint8Array,
): void {
  setSyncContext({ businessId, deviceId, dek });
}

/** Runs one push+pull cycle against the real Supabase transport, using this device's real local database. */
export async function runMobileSyncCycle(
  businessId: string,
  deviceId: string,
  dek: Uint8Array,
): Promise<void> {
  const db: SqlDb = await getDb();
  await runSyncCycle(db, supabaseSyncTransport, businessId, dek, deviceId);
  // Sprint 17: piggyback the heartbeat on every sync cycle rather than a
  // separate timer -- a cycle already means this device is online and
  // active-ish, exactly the cadence touch_device_heartbeat's own doc
  // calls "genuinely active enough."
  await touchDeviceHeartbeat(businessId, deviceId);
}

export class ActivationRejectedError extends Error {}

/**
 * Sprint 16 (Vol 12_1 Section 6a.1-6a.2, minimal wiring). Requests that
 * THIS device become the active device — a device can only ever request
 * activation for itself (never "push" another device active, per Section
 * 6a.1). Always pulls to catch-up first ("switching requires sync" is
 * enforced server-side too, Section 6a.2, but pulling first here avoids a
 * doomed request when this device is simply behind).
 */
export async function requestActivation(
  businessId: string,
  deviceId: string,
  dek: Uint8Array,
): Promise<void> {
  const db: SqlDb = await getDb();
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

/** Convenience read for the read-only banner (ReadOnlyBanner.tsx): is this device currently the active device, and who is, if not. */
export async function getWriteAccessState(
  businessId: string,
  deviceId: string,
): Promise<{ isActiveDevice: boolean; activeDeviceId: string | null }> {
  const db: SqlDb = await getDb();
  const lock = await getCachedLock(db, businessId);
  if (!lock) return { isActiveDevice: true, activeDeviceId: null }; // no lock ever seen -- see writeGate.ts's own doc for why this defaults open
  return {
    isActiveDevice: lock.activeDeviceId === deviceId,
    activeDeviceId: lock.activeDeviceId,
  };
}

/**
 * Sprint 17 (Vol 12_1 Section 6a.5, ADR-004) -- the primary-device forced
 * takeover. Mirrors requestActivation's pull-then-RPC shape, but calls
 * request_primary_takeover (Sprint 15) instead: no expected_lock_token
 * compare-and-swap (the primary always wins, unconditionally), but the
 * SAME sync-before-write precondition still runs server-side.
 */
export async function requestPrimaryTakeover(
  businessId: string,
  deviceId: string,
  dek: Uint8Array,
): Promise<void> {
  const db: SqlDb = await getDb();
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

/** Sprint 17 (Vol 12_1 Section 5a.4/6a.5) -- reassigns which device is primary. Does not touch the active-device lock; a primary reassignment and an active-device handoff are orthogonal. */
export async function setPrimaryDevice(
  newPrimaryDeviceId: string,
): Promise<RegisteredDevice> {
  return devicesTransport.setPrimaryDevice(newPrimaryDeviceId);
}

/**
 * Sprint 17 (closing the device-registration gap) -- wraps Sprint 15's
 * register_device RPC. Called exactly once per device, from
 * `syncBootstrap.ts`'s `bootstrapSyncOnThisDevice`, never from anywhere
 * else -- calling it twice for the same device_id would fail on
 * `devices`' primary key, which is deliberately not swallowed here.
 */
export async function registerDevice(
  deviceId: string,
  platform: "ios" | "android" | "web",
  deviceLabel: string,
): Promise<RegisteredDevice> {
  return devicesTransport.registerDevice(deviceId, platform, deviceLabel);
}

/** Sprint 19 (Vol 12_1 Section 8, "Rename" action) -- owner-renameable device label, from the full Devices panel. */
export async function renameDevice(
  deviceId: string,
  newLabel: string,
): Promise<RegisteredDevice> {
  return devicesTransport.renameDevice(deviceId, newLabel);
}

/**
 * Sprint 19 (Vol 12_1 Section 8, "Revoke" action) -- see
 * revoke_device's own SQL comment (app/backend/schema.sql) and the
 * Sprint 19 runbook for the full reasoning on what this does and does
 * not guarantee (no per-device Supabase session invalidation -- a real,
 * disclosed gap, not silently assumed away). `options` mirrors the RPC's
 * own optional replacement-device parameters, required by the backend
 * when the device being revoked is currently active and/or primary.
 */
export async function revokeDevice(
  deviceId: string,
  options?: { newActiveDeviceId?: string; newPrimaryDeviceId?: string },
): Promise<RegisteredDevice> {
  return devicesTransport.revokeDevice(deviceId, options);
}

/** Every non-revoked device registered for this business, for the Devices panel. */
export async function getRegisteredDevices(
  businessId: string,
): Promise<RegisteredDevice[]> {
  return devicesTransport.getRegisteredDevices(businessId);
}

/** Sprint 19 -- EVERY non-deleted device (including revoked), for the full Devices panel listing (Vol 12_1 §8). Action-target pickers (set-primary, activate, revoke's replacement args) use getRegisteredDevices() above instead, which stays revoked-filtered. */
export async function getAllDevices(
  businessId: string,
): Promise<RegisteredDevice[]> {
  return devicesTransport.getAllDevices(businessId);
}

/**
 * Sprint 17 -- the one live read the handoff UI needs before it can even
 * decide which confirmation prompt to show (@aifa/core/sync/handoff.ts's
 * resolveActivationConfirmation) or what the read-only banner should say
 * (describeReadOnlyReason). Deliberately a live Supabase read, not the
 * local sync_lock_cache -- this only runs when the owner is actively
 * about to request activation or is looking at the read-only banner
 * on-screen, both already-online interactions.
 */
export async function getActiveDeviceInfo(
  businessId: string,
  deviceId: string,
): Promise<ActiveDeviceInfo> {
  return devicesTransport.getActiveDeviceInfo(businessId, deviceId);
}

/**
 * Sprint 19 -- the Devices panel's "Sync state" column basis (Vol 12_1
 * §8: "N changes behind" / "Up to date"). Exposed here as a thin
 * pass-through so DevicesPanel.tsx doesn't need to import
 * @aifa/core/sync/supabaseTransport directly.
 */
export async function getMaxServerSeq(businessId: string): Promise<number> {
  return devicesTransport.getMaxServerSeq(businessId);
}

/**
 * Sprint 19 -- the OTHER half of the Devices panel's "Sync state" basis:
 * THIS device's own local pull checkpoint (getMaxServerSeq above is the
 * cloud side). Only meaningful for the row representing the device the
 * owner is currently looking at the panel from -- every other row uses
 * its own last-reported `lastSyncedServerSeq` instead (RegisteredDevice
 * field), per Vol 12_1 §8's own column description.
 */
export async function getLocalSyncCheckpoint(
  businessId: string,
): Promise<number> {
  const db: SqlDb = await getDb();
  return getLastAppliedServerSeq(db, businessId);
}

/**
 * Sprint 17 (Vol 12_1 Section 6a.1's last_seen_at signal) -- keeps this
 * device's heartbeat current. Best-effort and non-blocking: a failed
 * heartbeat write must never fail the sync cycle it rides along with.
 */
export async function touchDeviceHeartbeat(
  businessId: string,
  deviceId: string,
): Promise<void> {
  try {
    const db: SqlDb = await getDb();
    const lastAppliedServerSeq = await getLastAppliedServerSeq(db, businessId);
    await devicesTransport.touchDeviceHeartbeat(deviceId, lastAppliedServerSeq);
  } catch {
    // best-effort -- see doc above
  }
}

/**
 * Sprint 17 -- a lightweight lock-only refresh for the periodic demotion
 * poll (useDemotionPoll.ts), distinct from a full runMobileSyncCycle: cheap
 * enough to run on a short interval without the overhead a full cycle
 * would add.
 */
export async function refreshActiveDeviceLock(
  businessId: string,
): Promise<void> {
  const db: SqlDb = await getDb();
  const lock = await supabaseSyncTransport.fetchActiveDeviceLock(businessId);
  if (lock) await setCachedLock(db, lock);
}
