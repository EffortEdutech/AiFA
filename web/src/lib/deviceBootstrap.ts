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
 *
 * Sprint 19 revision: WebSyncIdentity.dek is now raw Uint8Array bytes
 * (was a non-extractable CryptoKey in Sprint 18) — see keyStore.ts's own
 * header comment for the full reasoning (the shared @aifa/core sync
 * envelope crypto needs raw bytes, the same as mobile's syncService.ts
 * already passes it). `dbKey` is new: a non-extractable CryptoKey
 * imported fresh from those same in-memory bytes, for sqlJsAdapter.ts's
 * separate whole-DB-image encryption only — never persisted itself.
 */
import { deriveBusinessDek } from "@aifa/core/sync/dek";

import {
  getOrCreateWebDeviceId,
  hasCompletedLocalSetup,
  importNonExtractableDbKey,
  loadRecoveryCode,
  markLocalSetupComplete,
  storeRecoveryCode,
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
  /** Raw Business DEK bytes — passed directly to @aifa/core's sync client (dek.ts), same shape mobile's syncService.ts already uses. Held only in memory for this session, never itself persisted (see keyStore.ts). */
  dek: Uint8Array;
  /** Non-extractable CryptoKey imported from the SAME bytes as `dek`, for sqlJsAdapter.ts's local whole-DB-image encryption only. Re-derived every session; never persisted. */
  dbKey: CryptoKey;
}

/**
 * First-time setup on this browser: registers the device, derives the
 * Business DEK, and persists the RECOVERY CODE (not the DEK itself --
 * see keyStore.ts's header comment) so later visits can re-derive it.
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
  const dek = deriveBusinessDek(recoveryCode, businessId);
  const dbKey = await importNonExtractableDbKey(dek);
  await storeRecoveryCode(recoveryCode);
  markLocalSetupComplete();
  return { deviceId, businessId, dek, dbKey };
}

/**
 * Re-establishes the sync identity on a later visit, without asking the
 * owner to re-enter anything — the recovery code persists in IndexedDB
 * (Sprint 19 revision; Sprint 18 originally persisted a CryptoKey object
 * instead, see keyStore.ts) until that storage is cleared. Returns null
 * if this browser has never completed setup, or if IndexedDB no longer
 * has the code (cleared storage) — either way the caller routes back to
 * the setup screen.
 */
export async function restoreWebSyncIdentity(
  businessId: string,
): Promise<WebSyncIdentity | null> {
  if (!hasCompletedLocalSetup()) return null;
  const recoveryCode = await loadRecoveryCode();
  if (!recoveryCode) return null;
  const dek = deriveBusinessDek(recoveryCode, businessId);
  const dbKey = await importNonExtractableDbKey(dek);
  const deviceId = getOrCreateWebDeviceId();
  return { deviceId, businessId, dek, dbKey };
}
