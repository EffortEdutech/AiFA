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

/**
 * Sprint 52 bugfix -- this and every other function below used ONE global
 * IndexedDB key for the recovery code, regardless of which business it
 * belonged to (same root-cause class as getOrCreateWebDeviceId's own
 * Sprint 52 fix above): a browser that completes setup for business A and
 * later signs into business B would have B's restoreWebSyncIdentity read
 * back A's recovery code and derive a DEK from (A's code, B's business
 * id) -- neither A's nor B's real Business DEK, silently. Confirmed this
 * was reachable, not theoretical: this sprint's own QA walkthrough set up
 * NHL Global Solution then Art Angkut Enterprise from the same browser.
 * Keyed per business_id now, exactly like device_id and the setup-complete
 * flag -- and, per those two fixes' own doc, deliberately with NO
 * automatic legacy-global migration (that heuristic raced across
 * businesses in this exact sprint's testing). A browser already set up
 * under the old global-key scheme needs its one legacy value copied to
 * its own scoped key by hand.
 */
export async function storeRecoveryCode(businessId: string, recoveryCode: string): Promise<void> {
  const db = await openKeyStoreDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, "readwrite");
    tx.objectStore(KEY_STORE).put(recoveryCode, RECOVERY_CODE_KEY_ID + ":" + businessId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
  });
  db.close();
}

/** Loads the previously-stored recovery code for THIS business. Returns null if nothing is stored (first run for this business, or IndexedDB was cleared). */
export async function loadRecoveryCode(businessId: string): Promise<string | null> {
  const db = await openKeyStoreDb();
  const code = await new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, "readonly");
    const req = tx.objectStore(KEY_STORE).get(RECOVERY_CODE_KEY_ID + ":" + businessId);
    req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed"));
  });
  db.close();
  return code;
}

export async function clearStoredRecoveryCode(businessId: string): Promise<void> {
  const db = await openKeyStoreDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, "readwrite");
    tx.objectStore(KEY_STORE).delete(RECOVERY_CODE_KEY_ID + ":" + businessId);
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

const DEVICE_ID_STORAGE_KEY_PREFIX = "aifa_web_device_id:";
const RECOVERY_SETUP_FLAG_KEY_PREFIX = "aifa_web_sync_bootstrapped:";

/**
 * Sprint 51 -- generates a brand-new recovery code for a business that has
 * never had ANY device registered before (DeviceSetupScreen.tsx's "first
 * device on web" branch). Uses the SAME format mobile's own first-device
 * path already produces (app/src/db/client.ts's randomHex(32) via
 * expo-crypto) -- a 32-byte/64-hex-char random string -- so a mobile app
 * added later can enter this exact code and derive the identical Business
 * DEK, with no format mismatch between platforms.
 */
export function generateRecoveryCode(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Sprint 52 bugfix -- device_id used to live under ONE global localStorage
 * key shared by every business ever signed into from this browser.
 * Confirmed live this sprint: registering NHL Global Solution, then
 * signing in as a different Owner and registering Art Angkut Enterprise
 * from the SAME browser sent the SAME device_id to register_device for a
 * second business -- devices' primary key is device_id alone, so the
 * second call failed with a devices_pkey duplicate-key violation.
 *
 * Scoping the stored id per business_id is the fix, not a devices schema
 * change: business_id on that table already encodes "this device belongs
 * to exactly one business" everywhere downstream (active_device_lock,
 * register_device's own per-membership advisory lock, every other devices
 * RPC) -- the real unit was always (browser, business), not just browser,
 * once a browser can plausibly sign into more than one business over its
 * lifetime (exactly what this sprint's QA walkthrough did).
 *
 * Deliberately NO automatic migration of the old global key: an earlier
 * version of this fix tried migrating it in "for whichever business asks
 * first", but that is genuinely ambiguous once more than one business has
 * ever used this browser -- confirmed live this same sprint, App.tsx's
 * mount-time restoreWebSyncIdentity() call raced this exact migration
 * across two open businesses and handed NHL Global Solution's already-real
 * device_id to Art Angkut Enterprise instead. A browser that already had a
 * device registered under the old single-key scheme needs that one value
 * copied into its OWN scoped key exactly once, by hand (ops/devtools),
 * rather than by a heuristic that cannot tell which business it belongs
 * to. Every business setup from this sprint onward only ever writes and
 * reads its own scoped key.
 */
export function getOrCreateWebDeviceId(businessId: string): string {
  const key = DEVICE_ID_STORAGE_KEY_PREFIX + businessId;
  const existing = localStorage.getItem(key);
  if (existing) return existing;

  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}

export function markLocalSetupComplete(businessId: string): void {
  localStorage.setItem(RECOVERY_SETUP_FLAG_KEY_PREFIX + businessId, "true");
}

/** Sprint 52 bugfix -- scoped per business_id, no automatic legacy-global migration (see getOrCreateWebDeviceId's doc above for why that heuristic was removed: it raced across businesses and mis-attributed state). A browser already set up under the old scheme needs its one legacy "true" copied to its own scoped key by hand. */
export function hasCompletedLocalSetup(businessId: string): boolean {
  return localStorage.getItem(RECOVERY_SETUP_FLAG_KEY_PREFIX + businessId) === "true";
}
