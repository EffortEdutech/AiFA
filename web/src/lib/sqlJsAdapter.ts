/**
 * IndexedDbSqlAdapter — Sprint 18's IndexedDBDataAdapter, implementing
 * @aifa/core's `SqlDb` interface (db/types.ts) for the web platform.
 *
 * Design decision, deviating from Vol 12_0 §6's stated "Dexie.js" tech
 * choice (flagged to and approved by the owner before this sprint's
 * implementation began): `SqlDb` is raw-SQL-shaped
 * (execute(sql, params) / queryAll(sql, params)), and every repository in
 * @aifa/core — including migrations.ts's CHECK-constrained tables and
 * rebuild-pattern triggers, and financialSummaryRepository.ts's SUM()
 * aggregate queries — issues real SQL strings against it. Dexie is an
 * object-store API with no SQL layer; implementing this interface over it
 * would mean hand-rolling a SQL parser/query engine, risking exactly the
 * kind of silent logic bugs the @aifa/core extraction (Sprint 13) was
 * built to prevent. sql.js (SQLite compiled to WASM) is genuine SQLite —
 * every migration and repository query in this codebase runs against it
 * completely unmodified, with identical trigger/CHECK-constraint
 * behaviour to op-sqlite on mobile.
 *
 * Persistence strategy, mirroring the mobile app's own choice (Sprint 5/9:
 * "reusing whole-database encryption instead of adding a new file-crypto
 * dependency"): sql.js runs the whole database in memory; after every
 * mutating call this adapter serializes the entire DB image
 * (`db.export()`), encrypts it whole with the session's non-extractable
 * WebCrypto CryptoKey (webCrypto.ts), and stores the single encrypted
 * blob in a second IndexedDB object store — never per-row/per-field
 * encryption, matching SQLCipher's whole-file model in web terms.
 */
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";

import type { SqlDb } from "@aifa/core/db/types";

import { decryptWithCryptoKey, encryptWithCryptoKey } from "./webCrypto";

const DB_FILE_STORE_NAME = "aifa_web_dbfile";
const DB_FILE_STORE_VERSION = 1;
const OBJECT_STORE = "file";
const RECORD_KEY = "current";

interface StoredDbFile {
  ciphertext: ArrayBuffer;
  iv: Uint8Array;
}

function openDbFileStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_FILE_STORE_NAME, DB_FILE_STORE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OBJECT_STORE)) {
        db.createObjectStore(OBJECT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB open failed (db file store)"));
  });
}

async function loadStoredDbFile(): Promise<StoredDbFile | null> {
  const db = await openDbFileStore();
  const record = await new Promise<StoredDbFile | null>((resolve, reject) => {
    const tx = db.transaction(OBJECT_STORE, "readonly");
    const req = tx.objectStore(OBJECT_STORE).get(RECORD_KEY);
    req.onsuccess = () => resolve((req.result as StoredDbFile | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed (db file)"));
  });
  db.close();
  return record;
}

async function saveDbFile(record: StoredDbFile): Promise<void> {
  const db = await openDbFileStore();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OBJECT_STORE, "readwrite");
    tx.objectStore(OBJECT_STORE).put(record, RECORD_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed (db file)"));
  });
  db.close();
}

/** True once this browser has ever successfully created/saved a local DB file — used to distinguish "first run" from "IndexedDB got cleared out from under us" (this sprint's DoD item). */
const EVER_INITIALIZED_KEY = "aifa_web_db_ever_initialized";

export function hasWebDbEverBeenInitialized(): boolean {
  return localStorage.getItem(EVER_INITIALIZED_KEY) === "true";
}

export class LocalDataClearedError extends Error {
  constructor() {
    super(
      "Your local web data was cleared (private browsing, or the browser " +
        "freed storage space). Sign in and complete setup again to " +
        "continue — nothing was lost on your other devices.",
    );
    this.name = "LocalDataClearedError";
  }
}

let sqlJsPromise: Promise<SqlJsStatic> | null = null;
function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({ locateFile: () => sqlWasmUrl });
  }
  return sqlJsPromise;
}

/**
 * Opens (or creates) the encrypted local database for this business,
 * returning a ready-to-use SqlDb. Throws LocalDataClearedError if this
 * browser previously had a database but IndexedDB no longer has it —
 * callers should catch this and route the owner back through setup
 * rather than silently starting from an empty database.
 */
export async function openIndexedDbSqlAdapter(dek: CryptoKey): Promise<SqlDb> {
  const SQL = await getSqlJs();
  const stored = await loadStoredDbFile();

  let sqlite: Database;
  if (stored) {
    const plaintext = await decryptWithCryptoKey(dek, stored.ciphertext, stored.iv);
    sqlite = new SQL.Database(plaintext);
  } else if (hasWebDbEverBeenInitialized()) {
    throw new LocalDataClearedError();
  } else {
    sqlite = new SQL.Database();
  }

  async function persist(): Promise<void> {
    const bytes = sqlite.export();
    const { ciphertext, iv } = await encryptWithCryptoKey(dek, bytes);
    await saveDbFile({ ciphertext, iv });
    localStorage.setItem(EVER_INITIALIZED_KEY, "true");
  }

  // Persist once immediately so a brand-new (empty) database is durable
  // even before the first write — otherwise a reload before any capture
  // would incorrectly look like a "cleared" state on the next open.
  if (!stored) {
    await persist();
  }

  return {
    async execute(sql: string, params: unknown[] = []): Promise<void> {
      sqlite.run(sql, params as never[]);
      await persist();
    },
    async queryAll<T = Record<string, unknown>>(
      sql: string,
      params: unknown[] = [],
    ): Promise<T[]> {
      const stmt = sqlite.prepare(sql);
      try {
        stmt.bind(params as never[]);
        const rows: T[] = [];
        while (stmt.step()) {
          rows.push(stmt.getAsObject() as T);
        }
        return rows;
      } finally {
        stmt.free();
      }
    },
  };
}

/** Wipes the locally-stored encrypted database file (not the CryptoKey) — used when the owner explicitly resets local web data, distinct from clearStoredRecoveryCode in keyStore.ts. */
export async function clearLocalDbFile(): Promise<void> {
  const db = await openDbFileStore();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OBJECT_STORE, "readwrite");
    tx.objectStore(OBJECT_STORE).delete(RECORD_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed (db file)"));
  });
  db.close();
  localStorage.removeItem(EVER_INITIALIZED_KEY);
}
