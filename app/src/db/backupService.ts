/**
 * Backup encryption + Supabase upload/restore — Sprint 9 (Vol 8_4, Vol
 * 4_4 §4, Vol 11_0 §5). This is the native/network-dependent counterpart
 * to backupRepository.ts's pure snapshot/restore logic.
 *
 * IMPORTANT — sandbox/build note, same class of limitation as
 * AnthropicExpenseProvider's real API calls (untested since Sprint 3) and
 * PhotoCapture's camera UI (untested since Sprint 5): op-sqlite is a
 * native module and Supabase Storage needs a real project + real network
 * access, none of which exist in this sandbox. This file is code-complete
 * against the documented op-sqlite/Supabase APIs but has NOT been
 * exercised on a real device. Verify on your own machine before relying
 * on it — see README.md.
 *
 * IMPORTANT — auth gap: uploading/restoring both require a signed-in
 * Supabase user (the `backups` table's RLS policies are keyed on
 * `auth.uid()`). Sign-up/sign-in screens do not exist yet (carried since
 * Sprint 2, scheduled for Sprint 10's Settings/Identity work) — both
 * functions below throw a clear `BackupNotAvailableError` rather than
 * silently failing or fabricating a user id if no session exists.
 *
 * Encryption approach: rather than adding a new crypto dependency (gated
 * by AGENTS.md's "no new production dependencies without approval"), the
 * backup blob is itself a tiny SQLCipher-encrypted SQLite database (one
 * table, one row: the JSON snapshot from backupRepository.ts), opened with
 * op-sqlite using the SAME encryption key as the main local database
 * (`getDeviceEncryptionKey`, db/client.ts). SQLCipher is already this
 * project's one approved, vetted encryption mechanism (Vol 11_0 §3) --
 * reusing it here means zero new crypto surface to get wrong. See that
 * function's own comment for why this key doubles as the owner's backup
 * "recovery code".
 */

import { recordBackupCompleted } from "@aifa/core/db/appSettingsRepository";
import {
  createLocalSnapshot,
  restoreFromSnapshot,
  type BackupSnapshot,
} from "@aifa/core/db/backupRepository";
import { runMigrations } from "@aifa/core/db/migrations";
import type { SqlDb } from "@aifa/core/db/types";
import { open } from "@op-engineering/op-sqlite";
import * as FileSystem from "expo-file-system";

import { getDeviceEncryptionKey } from "./client";

import { supabase } from "@/lib/supabaseClient";

const BACKUP_BUCKET = "backups";

export class BackupNotAvailableError extends Error {}

async function requireAuthenticatedUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new BackupNotAvailableError(
      "Backing up requires a signed-in account, which isn't built yet " +
        "(Sprint 10). The backup mechanism itself is ready -- see " +
        "backupService.ts.",
    );
  }
  return data.user.id;
}

/** Minimal, dependency-free base64 <-> bytes conversion (a standard encoding transform, not a security-sensitive operation) -- avoids pulling in a helper package like `base64-arraybuffer` for two small functions. */
const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const value = BASE64_CHARS.indexOf(char);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

/**
 * Writes the current local snapshot into a fresh, SQLCipher-encrypted
 * temp SQLite file (encrypted with this device's own key) and returns its
 * path. Caller is responsible for deleting the temp file once uploaded.
 */
async function createEncryptedBackupFile(
  db: SqlDb,
): Promise<{ filePath: string; fileName: string }> {
  const snapshot = await createLocalSnapshot(db);
  const json = JSON.stringify(snapshot);

  const key = await getDeviceEncryptionKey();
  const fileName = `aifa-backup-${Date.now()}.db`;
  const tempDb = open({ name: fileName, encryptionKey: key });
  try {
    await tempDb.execute(
      `CREATE TABLE backup_payload (id INTEGER PRIMARY KEY, json TEXT NOT NULL);`,
    );
    await tempDb.execute(
      `INSERT INTO backup_payload (id, json) VALUES (1, ?);`,
      [json],
    );
    const filePath = tempDb.getDbPath();
    return { filePath, fileName };
  } finally {
    tempDb.close();
  }
}

/**
 * Encrypts the current local data and uploads it to Supabase Storage,
 * then records the upload in `public.backups` (Vol 8_4 §2). Phase 1:
 * upload-only, one full snapshot per call, no incremental deltas (Vol 4_4
 * §4) -- "on app background, or periodically" scheduling (Sprint 9's own
 * "Safe to Carry Over" note) is a caller concern, not this function's.
 */
export async function uploadBackup(
  db: SqlDb,
  businessId: string,
): Promise<{ storagePath: string }> {
  const userId = await requireAuthenticatedUserId();
  const { filePath, fileName } = await createEncryptedBackupFile(db);

  try {
    const base64 = await FileSystem.readAsStringAsync(filePath, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const bytes = base64ToUint8Array(base64);

    const storagePath = `${userId}/${fileName}`;
    const { error: uploadError } = await supabase.storage
      .from(BACKUP_BUCKET)
      .upload(storagePath, bytes, {
        contentType: "application/octet-stream",
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const { error: insertError } = await supabase
      .from("backups")
      .insert({ user_id: userId, storage_path: storagePath });
    if (insertError) throw insertError;

    // Sprint 11 (Vol 8_6 Section 4) -- the diagnostics view's "last backup
    // time" needs a LOCAL record of success; the remote `backups` row
    // above answers "does a backup exist" but not "can THIS device show
    // that quickly, offline, in Settings" without a round-trip.
    await recordBackupCompleted(db, businessId);

    return { storagePath };
  } finally {
    await FileSystem.deleteAsync(filePath, { idempotent: true });
  }
}

export interface BackupListItem {
  storagePath: string;
  createdAt: string;
}

/** Lists this owner's backups, most recent first (Vol 8_4 §2 — "enough metadata to find the latest one"). */
export async function listBackups(): Promise<BackupListItem[]> {
  const userId = await requireAuthenticatedUserId();
  const { data, error } = await supabase
    .from("backups")
    .select("storage_path, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    storagePath: row.storage_path as string,
    createdAt: row.created_at as string,
  }));
}

/**
 * Restores the most recent backup into `db`. `recoveryCode` must be the
 * SAME key the backup was encrypted with (see getDeviceEncryptionKey's
 * comment) -- on the ORIGINAL device this is fetched automatically; on a
 * genuinely new device, the owner must supply it themselves (no
 * Settings-screen reveal/enter UI yet, Sprint 10). `db` must already have
 * `runMigrations` applied (getDb() in db/client.ts does this) so every
 * destination table exists before restoreFromSnapshot inserts into it.
 */
export async function restoreLatestBackup(
  db: SqlDb,
  recoveryCode: string,
): Promise<void> {
  const backups = await listBackups();
  const latest = backups[0];
  if (!latest) {
    throw new BackupNotAvailableError("No backup found for this account.");
  }

  const { data: blob, error: downloadError } = await supabase.storage
    .from(BACKUP_BUCKET)
    .download(latest.storagePath);
  if (downloadError || !blob) {
    throw downloadError ?? new Error("Backup download returned no data.");
  }

  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader failed"));
    reader.onloadend = () => {
      const result = reader.result as string; // "data:...;base64,XXXX"
      resolve(result.split(",")[1] ?? "");
    };
    reader.readAsDataURL(blob);
  });

  const tempName = `aifa-restore-${Date.now()}.db`;
  // Open once purely to ask op-sqlite where it WOULD place this file (its
  // location convention is platform-specific -- IOS_DOCUMENT_PATH /
  // ANDROID_DATABASE_PATH -- so getDbPath is the one reliable way to learn
  // it), then close immediately: writing the downloaded bytes over the
  // file must happen with no SQLite handle open against it, and reading
  // it back afterwards means opening fresh rather than reusing this
  // throwaway handle.
  const placeholderDb = open({ name: tempName, encryptionKey: recoveryCode });
  const filePath = placeholderDb.getDbPath();
  placeholderDb.close();

  try {
    await FileSystem.writeAsStringAsync(filePath, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const reopened = open({ name: tempName, encryptionKey: recoveryCode });
    try {
      const rows = await reopened.execute(
        `SELECT json FROM backup_payload WHERE id = 1;`,
      );
      const json = rows.rows[0]?.json as string | undefined;
      if (!json) {
        throw new Error(
          "Backup file did not contain the expected payload -- wrong recovery code, or a corrupted backup.",
        );
      }
      const snapshot: BackupSnapshot = JSON.parse(json);
      await runMigrations(db);
      await restoreFromSnapshot(db, snapshot);
    } finally {
      reopened.close();
    }
  } finally {
    await FileSystem.deleteAsync(filePath, { idempotent: true });
  }
}
