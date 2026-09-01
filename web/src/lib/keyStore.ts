/**
 * Web key storage — Sprint 18 (Vol 12_0 §6 "WebCrypto... held as a
 * non-extractable CryptoKey for the browser session"), REVISED Sprint 19.
 *
 * Sprint 18 originally persisted the imported non-extractable CryptoKey
 * itself (via IndexedDB structured-clone) and discarded the raw DEK bytes
 * immediately after import. Sprint 19's sync client broke that design: the
 * shared @aifa/core sync/envelope crypto (dek.ts) is built on @noble/ciphers,
 * which -- unlike WebCrypto -- has no concept of a CryptoKey and requires a
 * plain `Uint8Array` DEK for every push/pull cycle. That's not a web-only
 * detail to route around; it's the SAME shared code mobile's syncService.ts
 * already calls with a raw `Uint8Array` dek, and changing @aifa/core's
 * envelope crypto to accept CryptoKey would mean reworking shared,
 * already-shipped, already-tested sync code for one platform's storage
 * preference -- a much bigger and riskier change than revising web's own
 * key-persistence choice.
 *
 * So this module now persists the owner's RECOVERY CODE instead of a
 * CryptoKey (still IndexedDB, still never localStorage/sessionStorage) --
 * exactly mirroring mobile's own pattern (app/src/db/client.ts's
 * storeSyncRecoveryCode/getStoredSyncRecoveryCode via Expo SecureStore):
 * the raw DEK is re-derived fresh each session from the persisted code via
 * @aifa/core's deriveBusinessDek, held only in memory for that session, and
 * NEVER itself written to any browser storage. deviceBootstrap.ts derives a
 * non-extractable CryptoKey from those same in-memory bytes, each session,
 * for sqlJsAdapter.ts's separate whole-DB-image encryption -- that CryptoKey
 * is deliberately never persisted at all any more (Sprint 18's IndexedDB
 * structured-clone trick is retired), so what actually differs from Sprint
 * 18's stated design is only WHICH secret sits in browser storage: the
 * recovery code (this module), not raw key bytes, not a passable-around key
 * object. Vol 12_0 §6's own text ("no OS keychain... explicitly
 * weaker-than-mobile") already frames browser storage as the least-bad
 * option available on this platform -- a recovery code sitting in IndexedDB
 * is that same already-accepted risk class, not a new, worse one: it is the
 * SAME value the owner already typed into this exact screen, and the SAME
 * value mobile's SecureStore already treats as storable (just with a
 * stronger OS-level guarantee mobile gets and web structurally cannot).
 * This is disclosed, not silently absorbed -- see the Sprint 19 runbook.
 *
 * Device id and business id are NOT secret (Vol 12_1 §5a's registry is
 * plaintext by design) so they're kept in plain localStorage, not this
 * IndexedDB store.
 */
const DB_NAME = "aifa_web_keystore";
const DB_VERSION = 1;
const KEY_STORE = "keys";
const RECOVERY_CODE_KEY_ID = "recovery_code";

function openKeyStoreDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KEY_STORE)) {
        db.createObjectStore(KEY_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

/** Sprint 19 -- persists the owner's recovery code (see this module's own header comment for why this replaced Sprint 18's CryptoKey-object persistence). */
export async function storeRecoveryCode(recoveryCode: string): Promise<void> {
  const db = await openKeyStoreDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, "readwrite");
    tx.objectStore(KEY_STORE).put(recoveryCode, RECOVERY_CODE_KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
  });
  db.close();
}

/** Loads the previously-stored recovery code, or null if none is stored (first run, or IndexedDB was cleared). */
export async function loadRecoveryCode(): Promise<string | null> {
  const db = await openKeyStoreDb();
  const code = await new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, "readonly");
    const req = tx.objectStore(KEY_STORE).get(RECOVERY_CODE_KEY_ID);
    req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed"));
  });
  db.close();
  return code;
}

export async function clearStoredRecoveryCode(): Promise<void> {
  const db = await openKeyStoreDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, "readwrite");
    tx.objectStore(KEY_STORE).delete(RECOVERY_CODE_KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"));
  });
  db.close();
}

/** Sprint 19 -- imports raw DEK bytes as a non-extractable AES-GCM CryptoKey for sqlJsAdapter.ts's whole-DB-image encryption ONLY. Deliberately never persisted itself (unlike Sprint 18's original design) -- re-imported fresh each session from the in-memory raw bytes deriveBusinessDek just produced. */
export async function importNonExtractableDbKey(dekBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    dekBytes as BufferSource,
    { name: "AES-GCM" },
    false, // non-extractable -- raw bytes can never be read back out of THIS key object, by this code or any other
    ["encrypt", "decrypt"],
  );
}

const DEVICE_ID_STORAGE_KEY = "aifa_web_device_id";
const RECOVERY_SETUP_FLAG_KEY = "aifa_web_sync_bootstrapped";

export function getOrCreateWebDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_STORAGE_KEY, id);
  return id;
}

export function markLocalSetupComplete(): void {
  localStorage.setItem(RECOVERY_SETUP_FLAG_KEY, "true");
}

export function hasCompletedLocalSetup(): boolean {
  return localStorage.getItem(RECOVERY_SETUP_FLAG_KEY) === "true";
}
