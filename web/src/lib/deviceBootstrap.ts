/**
 * Web device registration + local setup orchestration — Sprint 18 (Vol
 * 12_0 §6a Auth: "even though sync isn't wired yet this sprint,
 * registration should happen now so Sprint 19 has a real device to sync
 * as"). Thin Supabase RPC glue, deliberately kept web-local rather than
 * added to @aifa/core — same split this project already uses for mobile
 * (app/src/db/syncService.ts's registerDevice is mobile-local glue for
 * the identical RPC).
 *
 * businessId on web is always the signed-in Supabase user's id from the
 * very first write — there is no pre-existing local business_id to
 * reconcile the way mobile's Sprint 14 fix needed (that gap only existed
 * because the mobile app had years — well, sprints — of pre-auth local
 * data with a random id already in it). A brand-new web local database
 * starts empty, so @aifa/core's reconcileLocalBusinessId is correctly
 * unused here.
 */
import { deriveBusinessDek } from "@aifa/core/sync/dek";

import {
  getOrCreateWebDeviceId,
  hasCompletedLocalSetup,
  loadBusinessDekCryptoKey,
  markLocalSetupComplete,
  storeBusinessDekAsCryptoKey,
} from "./keyStore";
import { supabase } from "./supabaseClient";

interface DeviceRow {
  device_id: string;
  business_id: string;
  device_label: string;
  platform: "ios" | "android" | "web";
  registered_at: string;
  last_seen_at: string;
  last_synced_server_seq: number;
  is_primary: boolean;
  revoked_at: string | null;
}

/** Calls Sprint 15's register_device RPC for this browser. Never called more than once per device_id — see syncService.ts's identical precedent on why a double-call is left to fail loudly, not swallowed. */
export async function registerWebDevice(
  deviceId: string,
  deviceLabel: string,
): Promise<DeviceRow> {
  const { data, error } = await supabase.rpc("register_device", {
    p_device_id: deviceId,
    p_platform: "web",
    p_device_label: deviceLabel,
  });
  if (error) throw error;
  return data as DeviceRow;
}

export interface WebSyncIdentity {
  deviceId: string;
  businessId: string;
  dek: CryptoKey;
}

/**
 * First-time setup on this browser: registers the device and derives +
 * stores the Business DEK as a non-extractable CryptoKey (keyStore.ts).
 * `recoveryCode` is the SAME recovery code the owner already has from
 * mobile setup (Sprint 9/14) — reused here exactly as Vol 12_0 §6a's
 * "DEK-reuse" sign-off item specified, never a second/new code.
 */
export async function bootstrapWebSyncIdentity(
  businessId: string,
  deviceLabel: string,
  recoveryCode: string,
): Promise<WebSyncIdentity> {
  const deviceId = getOrCreateWebDeviceId();
  await registerWebDevice(deviceId, deviceLabel);
  const dekBytes = deriveBusinessDek(recoveryCode, businessId);
  const dek = await storeBusinessDekAsCryptoKey(dekBytes);
  markLocalSetupComplete();
  return { deviceId, businessId, dek };
}

/**
 * Re-establishes the sync identity on a later visit, without asking the
 * owner to re-enter anything — the CryptoKey persists in IndexedDB
 * (non-extractable, so its raw bytes were never recoverable even by this
 * code) until that storage is cleared. Returns null if this browser has
 * never completed setup, or if IndexedDB no longer has the key (cleared
 * storage) — either way the caller routes back to the setup screen.
 */
export async function restoreWebSyncIdentity(
  businessId: string,
): Promise<WebSyncIdentity | null> {
  if (!hasCompletedLocalSetup()) return null;
  const dek = await loadBusinessDekCryptoKey();
  if (!dek) return null;
  const deviceId = getOrCreateWebDeviceId();
  return { deviceId, businessId, dek };
}
