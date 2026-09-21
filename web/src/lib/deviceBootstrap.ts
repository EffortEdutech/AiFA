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
  generateRecoveryCode,
  getOrCreateWebDeviceId,
  hasCompletedLocalSetup,
  importNonExtractableDbKey,
  loadRecoveryCode,
  markLocalSetupComplete,
  storeRecoveryCode,
} from "./keyStore";
import { supabase } from "./supabaseClient";
import { describeThrown, getAllDevices } from "./syncService";

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
  // Sprint 52 bugfix -- re-throw as a real Error with the RPC's actual
  // message (see syncService.ts's describeThrown doc): the raw PostgREST
  // error object is not an Error instance, so DeviceSetupScreen.tsx's
  // `err instanceof Error ? err.message : "Setup failed."` catch used to
  // fall through to the generic string for every register_device failure
  // (confirmed live this sprint against a real 409 devices_pkey conflict).
  if (error) throw new Error(describeThrown(error));
  return data as DeviceRow;
}

/**
 * Sprint 52 bugfix -- true if this exact device_id already has a (possibly
 * revoked) row for this business. `register_device`'s INSERT has no
 * ON CONFLICT handling and device_id is devices' sole primary key, so
 * calling it again for an already-registered device_id always 409s --
 * confirmed live this sprint: a browser that already completed setup for
 * a business, then lost its locally-stored recovery code (IndexedDB
 * cleared) but kept its localStorage device_id, would hit exactly this on
 * re-submitting the existing-code form, which unconditionally called
 * registerWebDevice again. Callers use this to skip the RPC call entirely
 * when this device_id is already registered -- recovery, not
 * re-registration, is what that flow actually needs.
 */
async function isDeviceAlreadyRegistered(
  businessId: string,
  deviceId: string,
): Promise<boolean> {
  const devices = await getAllDevices(businessId);
  return devices.some((d) => d.deviceId === deviceId);
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
  const deviceId = getOrCreateWebDeviceId(businessId);
  if (!(await isDeviceAlreadyRegistered(businessId, deviceId))) {
    await registerWebDevice(deviceId, deviceLabel);
  }
  const dek = deriveBusinessDek(recoveryCode, businessId);
  const dbKey = await importNonExtractableDbKey(dek);
  await storeRecoveryCode(businessId, recoveryCode);
  markLocalSetupComplete(businessId);
  return { deviceId, businessId, dek, dbKey };
}

export interface WebSyncIdentityWithRecoveryCode extends WebSyncIdentity {
  /**
   * The freshly generated recovery code -- shown to the owner ONCE by
   * DeviceSetupScreen.tsx so they can save it (web has no "reveal recovery
   * code" screen yet, the gap mobile's own Settings reveal already fills
   * for that platform -- Vol 7_7). Only this bootstrap path ever returns
   * it; every other path (bootstrapWebSyncIdentity, restoreWebSyncIdentity)
   * works from a code the owner already has or already stored, and never
   * surfaces it again.
   */
  recoveryCode: string;
}

/**
 * Sprint 51 bugfix -- first-device-ever bootstrap for a business that was
 * created on web and has NEVER had a mobile (or any other) device
 * registered. Closes a real gap found live this sprint: every other web
 * bootstrap path (bootstrapWebSyncIdentity above) requires entering a
 * recovery code that, for a web-only business, never existed anywhere --
 * Sprint 18's design assumed mobile setup had always already happened
 * first and minted one (Vol 12_0 SS6a's "DEK-reuse" item), which is false
 * for an Owner who signs up and creates their business on web only.
 *
 * Generates a brand-new code in the SAME format mobile's own first-device
 * path already produces (see keyStore.ts's generateRecoveryCode) -- DEK
 * derivation and the register_device RPC call are otherwise identical to
 * bootstrapWebSyncIdentity above; only where the code comes from differs.
 *
 * SAFETY: callers MUST first confirm via getAllDevices(businessId)
 * (@aifa/core's devicesTransport, re-exported as this file's sibling
 * syncService.ts's own getAllDevices) that NO device has ever been
 * registered for this business. Calling this when a recovery code already
 * exists elsewhere would mint a second, incompatible DEK that no other
 * device's already-synced data could ever decrypt. DeviceSetupScreen.tsx
 * is the only caller and enforces this before offering this path at all.
 */
export async function bootstrapWebSyncIdentityAsFirstDevice(
  businessId: string,
  deviceLabel: string,
): Promise<WebSyncIdentityWithRecoveryCode> {
  const deviceId = getOrCreateWebDeviceId(businessId);
  await registerWebDevice(deviceId, deviceLabel);
  const recoveryCode = generateRecoveryCode();
  const dek = deriveBusinessDek(recoveryCode, businessId);
  const dbKey = await importNonExtractableDbKey(dek);
  await storeRecoveryCode(businessId, recoveryCode);
  markLocalSetupComplete(businessId);
  return { deviceId, businessId, dek, dbKey, recoveryCode };
}

/**
 * DEV-ONLY, no-backend bootstrap — added so the app is reachable for
 * local UI testing without a working Supabase connection at all (no
 * sign-in, no register_device RPC, no real recovery code). Auto-generates
 * and persists a throwaway recovery code the same way the real flow
 * persists a real one (storeRecoveryCode), so `restoreWebSyncIdentity`
 * keeps working across reloads exactly as it would for a real setup.
 * Never call this in a production build -- gated by import.meta.env.DEV
 * at the only call site (DeviceSetupScreen.tsx). Skips registerWebDevice
 * entirely, so this browser is never added to public.devices and will
 * never be able to sync -- purely for exercising the local-first features
 * (capture, dashboard, ledger, Workspace Q&A, settings) offline.
 */
export async function bootstrapWebSyncIdentityLocalOnlyDevBypass(
  businessId: string,
): Promise<WebSyncIdentity> {
  const deviceId = getOrCreateWebDeviceId(businessId);
  const recoveryCode = crypto.randomUUID();
  const dek = deriveBusinessDek(recoveryCode, businessId);
  const dbKey = await importNonExtractableDbKey(dek);
  await storeRecoveryCode(businessId, recoveryCode);
  markLocalSetupComplete(businessId);
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
  if (!hasCompletedLocalSetup(businessId)) return null;
  const recoveryCode = await loadRecoveryCode(businessId);
  if (!recoveryCode) return null;
  const dek = deriveBusinessDek(recoveryCode, businessId);
  const dbKey = await importNonExtractableDbKey(dek);
  const deviceId = getOrCreateWebDeviceId(businessId);
  return { deviceId, businessId, dek, dbKey };
}
