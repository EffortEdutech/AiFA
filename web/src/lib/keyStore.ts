/**
 * Web key storage — Sprint 18 (Vol 12_0 §6 "WebCrypto... held as a
 * non-extractable CryptoKey for the browser session").
 *
 * The browser has no OS keychain (Vol 12_0 §6's documented, explicitly
 * weaker-than-mobile posture), so this module makes the least-bad choice
 * available: the Business DEK's raw bytes (derived once from the owner's
 * recovery code via @aifa/core's deriveBusinessDek) are immediately
 * imported into a *non-extractable* WebCrypto CryptoKey and the raw bytes
 * are discarded — never held in a JS-readable variable again, never
 * written to localStorage/sessionStorage in any form. The CryptoKey
 * *object itself* (not its bytes — those are opaque to JS once
 * non-extractable) is what gets persisted, via IndexedDB's structured-
 * clone support for CryptoKey, so the owner isn't asked to re-type their
 * recovery code on every page reload. If IndexedDB is cleared (private
 * browsing, storage eviction — the exact scenario this sprint's DoD names)
 * the stored key is gone and setup must run again; that is the correct,
 * safe failure mode, not a bug to work around.
 *
 * Device id and business id are NOT secret (Vol 12_1 §5a's registry is
 * plaintext by design) so they're kept in plain localStorage, not this
 * IndexedDB store.
 */
const DB_NAME = "aifa_web_keystore";
const DB_VERSION = 1;
const KEY_STORE = "keys";
const DEK_KEY_ID = "business_dek";

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

/** Imports raw DEK bytes as a non-extractable AES-GCM CryptoKey and stores the CryptoKey object itself (never the raw bytes) in IndexedDB. */
export async function storeBusinessDekAsCryptoKey(dekBytes: Uint8Array): Promise<CryptoKey> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    dekBytes as BufferSource,
    { name: "AES-GCM" },
    false, // non-extractable — raw bytes can never be read back out, by this code or any other
    ["encrypt", "decrypt"],
  );
  const db = await openKeyStoreDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, "readwrite");
    tx.objectStore(KEY_STORE).put(cryptoKey, DEK_KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
  });
  db.close();
  return cryptoKey;
}

/** Loads the previously-stored non-extractable CryptoKey, or null if none is stored (first run, or IndexedDB was cleared). */
export async function loadBusinessDekCryptoKey(): Promise<CryptoKey | null> {
  const db = await openKeyStoreDb();
  const key = await new Promise<CryptoKey | null>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, "readonly");
    const req = tx.objectStore(KEY_STORE).get(DEK_KEY_ID);
    req.onsuccess = () => resolve((req.result as CryptoKey | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed"));
  });
  db.close();
  return key;
}

export async function clearBusinessDekCryptoKey(): Promise<void> {
  const db = await openKeyStoreDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, "readwrite");
    tx.objectStore(KEY_STORE).delete(DEK_KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"));
  });
  db.close();
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
