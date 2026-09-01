/**
 * WebCrypto AES-GCM helpers for encrypting the local database file at
 * rest — Sprint 18 (Vol 12_0 §6). Mirrors the mobile app's SQLCipher
 * choice of encrypting the *whole database file*, not per-field (Sprint
 * 5/9's precedent: "reusing whole-database encryption instead of adding a
 * new file-crypto dependency"), applied here to sql.js's exported binary
 * DB image instead of a native SQLCipher file. A fresh random 12-byte IV
 * (matches dek.ts's GCM_NONCE_LENGTH_BYTES / WebCrypto's own default) is
 * generated on every encrypt call — GCM's security depends on never
 * reusing an (key, IV) pair, same requirement as sync/dek.ts's own
 * envelope encryption.
 */
const IV_LENGTH_BYTES = 12;

export interface EncryptedBlob {
  ciphertext: ArrayBuffer;
  iv: Uint8Array;
}

export async function encryptWithCryptoKey(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext as BufferSource,
  );
  return { ciphertext, iv };
}

export async function decryptWithCryptoKey(
  key: CryptoKey,
  ciphertext: ArrayBuffer,
  iv: Uint8Array,
): Promise<Uint8Array> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ciphertext,
  );
  return new Uint8Array(plaintext);
}
