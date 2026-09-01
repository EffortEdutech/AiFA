/**
 * Sync bootstrap — Sprint 17 (Vol 12_1 Section 5/Section 9), closing the
 * gap this sprint's own runbook flagged: nothing anywhere in the Sprint
 * 13-20 breakdown ever called `initMobileSync`, so every piece of sync UI
 * built in Sprint 16/17 was code-complete and unit-tested but never
 * actually reachable in the running app. This module is the missing
 * piece: it derives the Business DEK, reconciles this device's
 * pre-cloud local `business_id` (Sprint 14's own carried-forward gap) to
 * the signed-in owner's real account id, registers this device (Sprint
 * 15), and sets the ambient SyncContext (Sprint 16) so every gated
 * repository write and the handoff UI (Sprint 17) start working for real.
 *
 * Deliberately NOT a gate on the rest of the app, same posture as
 * `lib/auth.ts` itself (Vol 4_4 Section 2, local-first): an owner who
 * never signs in, or signs in but never completes this one-time step,
 * keeps using every Phase 1 feature exactly as before -- sync simply
 * stays inactive (the same fully-permissive "no context set" state
 * `syncContext.ts` was always designed around).
 */
import { reconcileLocalBusinessId } from "@aifa/core/sync/businessIdentity";
import { deriveBusinessDek } from "@aifa/core/sync/dek";
import { Platform } from "react-native";

import {
  getDb,
  getDeviceEncryptionKey,
  getLocalBusinessId,
  getOrCreateSyncDeviceId,
  getStoredSyncRecoveryCode,
  hasCompletedSyncBootstrap,
  storeSyncRecoveryCode,
} from "./client";
import { initMobileSync, registerDevice } from "./syncService";

export { hasCompletedSyncBootstrap };

function currentPlatform(): "ios" | "android" | "web" {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return "web"; // Expo also targets web; Sprint 15's devices.platform check allows it even though this app doesn't ship there yet.
}

export interface BootstrapSyncInput {
  /** The signed-in owner's Supabase user id (auth.uid()) -- the canonical business_id for cloud sync purposes (Sprint 14). */
  businessId: string;
  deviceLabel: string;
  /**
   * Omit for the FIRST device ever set up for this business -- it uses
   * its own local SQLCipher key (`getDeviceEncryptionKey`) as the
   * recovery code, the same value Sprint 10's Settings screen already
   * reveals. Pass the code the owner typed in (copied from that reveal
   * screen on their first device) when setting up a SECOND or later
   * device -- every device must derive the IDENTICAL DEK, which only
   * happens when they share the same recovery code.
   */
  recoveryCode?: string;
}

export interface BootstrapSyncResult {
  deviceId: string;
}

/**
 * Runs once, the first time an owner (already signed in) completes sync
 * setup on this device. Safe to call again only in the sense that
 * `reconcileLocalBusinessId` itself is idempotent -- `registerDevice`
 * is NOT (see its own doc), so callers must gate this behind
 * `hasCompletedSyncBootstrap()` returning false, exactly as
 * `SyncSetupCard.tsx` does.
 */
export async function bootstrapSyncOnThisDevice(
  input: BootstrapSyncInput,
): Promise<BootstrapSyncResult> {
  const deviceId = await getOrCreateSyncDeviceId();
  const recoveryCode = input.recoveryCode ?? (await getDeviceEncryptionKey());
  const dek = deriveBusinessDek(recoveryCode, input.businessId);

  const db = await getDb();
  const oldBusinessId = await getLocalBusinessId();
  await reconcileLocalBusinessId(db, oldBusinessId, input.businessId);

  await registerDevice(deviceId, currentPlatform(), input.deviceLabel);

  await storeSyncRecoveryCode(recoveryCode);
  initMobileSync(input.businessId, deviceId, dek);

  return { deviceId };
}

export interface RestoredSyncContext {
  deviceId: string;
  dek: Uint8Array;
}

/**
 * Called on every app launch (App.tsx) once the owner's auth session is
 * known: if this device already completed `bootstrapSyncOnThisDevice` at
 * some point in the past, re-derives the DEK from the stored recovery
 * code (never persisted itself) and re-establishes the ambient
 * SyncContext -- deriving fresh each launch instead of persisting the raw
 * key keeps exactly one long-lived secret in SecureStore (the recovery
 * code, already protected the same way `aifa_db_key` is), not two.
 * Returns null when this device hasn't bootstrapped yet, or when there is
 * no signed-in owner (businessId null) -- both are normal, non-error
 * states callers should treat as "sync inactive," not a failure.
 */
export async function restoreSyncContextIfBootstrapped(
  businessId: string | null,
): Promise<RestoredSyncContext | null> {
  if (!businessId) return null;

  const recoveryCode = await getStoredSyncRecoveryCode();
  if (!recoveryCode) return null;

  const deviceId = await getOrCreateSyncDeviceId();
  const dek = deriveBusinessDek(recoveryCode, businessId);
  initMobileSync(businessId, deviceId, dek);

  return { deviceId, dek };
}
