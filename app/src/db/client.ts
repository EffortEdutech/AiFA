import { runMigrations } from "@aifa/core/db/migrations";
import type { SqlDb } from "@aifa/core/db/types";
import { open, type DB } from "@op-engineering/op-sqlite";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import { toSqlDb } from "./opSqliteAdapter";

/**
 * Local encrypted database client — Vol 4_4 §3, Vol 11_0 §3.
 *
 * Uses op-sqlite with SQLCipher so local storage is encrypted at rest per
 * Vol 8_2 §2, satisfying the non-negotiable boundary in Vol_0_0 §4 point 2
 * (data ownership stays local and protected).
 *
 * IMPORTANT — sandbox/build note: op-sqlite's SQLCipher support is a native
 * module. It will NOT run inside Expo Go. This project must be run through
 * `npx expo prebuild` + a custom dev client (or an EAS development build)
 * before the database layer can be exercised on a device or simulator.
 * See README.md "Running this project" for the exact steps.
 */

const DB_NAME = "aifa.db";
let dbInstance: SqlDb | null = null;
let dbReadyPromise: Promise<SqlDb> | null = null;

async function randomHex(byteLength: number): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(byteLength);
  const value = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  if (value.length !== byteLength * 2) {
    throw new Error("Secure random-byte generation returned an invalid value");
  }
  return value;
}

async function getOrCreateEncryptionKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync("aifa_db_key");
  if (existing) return existing;

  // Sprint 1 scope: generate and store a random key in the platform keychain
  // (SecureStore wraps iOS Keychain / Android Keystore). Key rotation is
  // still not handled (Sprint 10+); recovery-on-restore (Sprint 9) is
  // handled by treating this SAME key as the backup's "recovery code" --
  // see getDeviceEncryptionKey below.
  const key = await randomHex(32);
  await SecureStore.setItemAsync("aifa_db_key", key);
  return key;
}

/**
 * Sprint 9 — exposes this device's SQLCipher key so `backupService.ts` can
 * reuse it to encrypt a backup blob (rather than adding a separate crypto
 * dependency to hand-roll a second cipher — SQLCipher is already the
 * project's one approved encryption mechanism, Vol 11_0 §3). This SAME
 * value is also, deliberately, the owner's backup "recovery code": Phase 1
 * has no passphrase/auth-derived key-wrapping scheme, so restoring onto a
 * genuinely NEW device (where SecureStore has no key yet) requires the
 * owner to supply this value themselves. There is no Settings-screen UI to
 * reveal/save it yet (Sprint 10, Vol 7_7) — this function exists so that
 * screen has something real to call, and so backupService.ts is not
 * blocked waiting for it.
 */
export async function getDeviceEncryptionKey(): Promise<string> {
  return getOrCreateEncryptionKey();
}

/**
 * Returns a stable local business identifier for this device.
 *
 * Phase 1 is single-user, single-business (Vol 8_1 §4 — team roles are
 * Phase 2), so a locally-generated, keychain-stored id is sufficient; this
 * is reconciled with real account identity when auth screens are built
 * (Sprint 10). Kept in db/client.ts rather than a separate module for now,
 * since it is only needed alongside the database.
 */
export async function getLocalBusinessId(): Promise<string> {
  const existing = await SecureStore.getItemAsync("aifa_local_business_id");
  if (existing) return existing;

  const id = await randomHex(16);
  await SecureStore.setItemAsync("aifa_local_business_id", id);
  return id;
}

/**
 * Sprint 12 (Vol 7_1 Section 4, Sprint 12's "first-run onboarding flow"
 * task) — a simple one-time device flag, same SecureStore-backed pattern
 * as `getLocalBusinessId`/`getDeviceEncryptionKey` above. Deliberately a
 * device flag, not a row in the SQL database: "has this device's owner
 * seen onboarding" is not business data and has no business_id to key on
 * yet the very first time the app opens.
 */
export async function getHasCompletedOnboarding(): Promise<boolean> {
  const value = await SecureStore.getItemAsync("aifa_onboarding_complete");
  return value === "true";
}

export async function setOnboardingCompleted(): Promise<void> {
  await SecureStore.setItemAsync("aifa_onboarding_complete", "true");
}

/**
 * Sprint 17 (closing the gap flagged in that sprint's own runbook §6):
 * device registration/DEK-bootstrap never existed anywhere in the
 * Sprint 13-20 breakdown, which meant Sprint 16/17's sync UI was built
 * and unit-tested but never actually reachable in the running app --
 * nothing ever called `initMobileSync`. These four functions are the
 * missing local-identity half of that gap (`db/syncBootstrap.ts` is the
 * orchestration half) -- same SecureStore-backed pattern as
 * `getLocalBusinessId`/`getDeviceEncryptionKey` above, kept in this file
 * for the same reason those are: only needed alongside the database.
 *
 * `aifa_sync_device_id` is THIS device's stable id for Sprint 15's device
 * registry -- separate from `aifa_local_business_id` above (which is a
 * pre-cloud, single-device concept Sprint 14's `reconcileLocalBusinessId`
 * exists to retire) and separate from `aifa_db_key` (which stays this
 * device's own SQLCipher key regardless of whether it's also currently
 * serving as the sync recovery code -- see `getDeviceEncryptionKey`'s doc).
 */
export async function getOrCreateSyncDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync("aifa_sync_device_id");
  if (existing) return existing;

  const id = await randomHex(16);
  await SecureStore.setItemAsync("aifa_sync_device_id", id);
  return id;
}

/**
 * The recovery code THIS device used to derive the Business DEK (Vol
 * 12_1 Section 5/Section 9) -- for the first device on a business this is
 * that device's own `getDeviceEncryptionKey()` value; for every
 * subsequent device it is whatever the owner typed in from the first
 * device's "reveal recovery code" control (Sprint 10, `SettingsScreen`).
 * Persisted so the DEK can be re-derived on every app launch
 * (`syncBootstrap.ts`'s `restoreSyncContextIfBootstrapped`) without ever
 * storing the derived key itself.
 */
export async function getStoredSyncRecoveryCode(): Promise<string | null> {
  return SecureStore.getItemAsync("aifa_sync_recovery_code");
}

export async function storeSyncRecoveryCode(code: string): Promise<void> {
  await SecureStore.setItemAsync("aifa_sync_recovery_code", code);
}

/** True once this device has completed the one-time sync bootstrap (device id claimed, recovery code known). */
export async function hasCompletedSyncBootstrap(): Promise<boolean> {
  const code = await getStoredSyncRecoveryCode();
  return code !== null;
}

export async function getDb(): Promise<SqlDb> {
  if (dbInstance) return dbInstance;
  if (dbReadyPromise) return dbReadyPromise;

  dbReadyPromise = (async () => {
    const encryptionKey = await getOrCreateEncryptionKey();
    const rawDb: DB = open({ name: DB_NAME, encryptionKey });
    const sqlDb = toSqlDb(rawDb);
    await runMigrations(sqlDb);
    dbInstance = sqlDb;
    return sqlDb;
  })();

  return dbReadyPromise;
}
