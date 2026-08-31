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
