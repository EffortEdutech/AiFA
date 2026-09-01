/**
 * Write gate — Vol 12_1 Section 6a.3, Sprint 16.
 *
 * "The write-permission check is not a one-time flag read at app launch —
 * it is re-checked against the cached lock_token... immediately before
 * any write action." This module IS that re-check. It is called from
 * inside the repository write functions themselves (db/syncHooks.ts),
 * not from UI code, so there is no code path that reaches a syncable
 * write without passing through it once a sync context is set
 * (syncContext.ts).
 *
 * Deliberately conservative when there is no cached lock at all
 * (`getCachedLock` returns null): a device that has never received a
 * lock broadcast either hasn't set up sync yet, or is the very first
 * device on a business (auto-active per Vol 12_1 Section 5a.3, with
 * nothing to have demoted it) — allowing the write in that case matches
 * both. The dangerous case this gate exists to prevent — a device that
 * WAS active and has since been superseded — always has a cached lock
 * naming a different device, which this function does catch.
 */
import type { SqlDb } from "../db/types";
import { getCachedLock } from "./localState";

export class WriteGateError extends Error {
  constructor(
    public readonly businessId: string,
    public readonly requestingDeviceId: string,
    public readonly activeDeviceId: string,
  ) {
    super(
      `Write rejected: device ${requestingDeviceId} is not the active device for business ${businessId} (active device is ${activeDeviceId}). ` +
        `This device is read-only — request activation before writing again.`,
    );
    this.name = "WriteGateError";
  }
}

/**
 * Throws WriteGateError if this device is registered as read-only per the
 * last-known lock state. Resolves silently (no return value) when the
 * write may proceed.
 */
export async function assertWriteAllowed(
  db: SqlDb,
  businessId: string,
  deviceId: string,
): Promise<void> {
  const cachedLock = await getCachedLock(db, businessId);
  if (!cachedLock) return; // no lock broadcast ever seen -- see module doc above
  if (cachedLock.activeDeviceId !== deviceId) {
    throw new WriteGateError(businessId, deviceId, cachedLock.activeDeviceId);
  }
}
