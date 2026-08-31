/**
 * Data export — file-write layer (Sprint 10, Vol 7_7 Data & Privacy). The
 * native/untestable-in-sandbox counterpart to exportRepository.ts's pure
 * string-building, same split as backupRepository.ts/backupService.ts
 * (Sprint 9). Unlike backup, export needs NO Supabase auth and NO network
 * — it is a purely local operation (Vol 4_4 §7: viewing/managing local
 * data never requires connectivity), consistent with this sprint's own
 * risk register concern about deletion/export never being blocked by lack
 * of a cloud account.
 *
 * IMPORTANT — sandbox/build note, same class of limitation as
 * backupService.ts: expo-file-system's document directory is a native
 * filesystem path that doesn't exist in this sandbox. Code-complete
 * against the documented expo-file-system API, verified by tsc/eslint
 * only — exercise on a real device/build before relying on it.
 */

import { buildExportBundle } from "@aifa/core/db/exportRepository";
import type { SqlDb } from "@aifa/core/db/types";
import * as FileSystem from "expo-file-system";

export interface ExportFileResult {
  jsonFilePath: string;
  csvFilePath: string;
  generatedAt: string;
}

/**
 * Writes both export artifacts to the app's document directory (no
 * expo-sharing dependency — a new-dependency decision explicitly deferred
 * per AGENTS.md; the Settings screen displays the resulting paths so the
 * owner can locate the files themselves via their device's file manager,
 * or a Share-sheet integration can be added later as the "export format
 * polish" this sprint's own doc allows to carry over).
 */
export async function writeExportFiles(
  db: SqlDb,
  businessId: string,
): Promise<ExportFileResult> {
  const bundle = await buildExportBundle(db, businessId);
  const stamp = bundle.generatedAt.replace(/[:.]/g, "-");

  const dir = FileSystem.documentDirectory ?? "";
  const jsonFilePath = `${dir}aifa-export-${stamp}.json`;
  const csvFilePath = `${dir}aifa-export-${stamp}.csv`;

  await FileSystem.writeAsStringAsync(jsonFilePath, bundle.snapshotJson, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  await FileSystem.writeAsStringAsync(csvFilePath, bundle.activityCsv, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  return { jsonFilePath, csvFilePath, generatedAt: bundle.generatedAt };
}
