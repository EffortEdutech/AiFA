/**
 * Business Data Encryption Key (DEK) — Sprint 14, Vol 12_1 §5.
 *
 * Cross-device sync needs one symmetric key every authorised device for a
 * business can hold, distinct from any single device's own local SQLCipher
 * key (Vol 8_2, `db/client.ts`'s `getOrCreateEncryptionKey`) — that key
 * "never leaves one device by design" (Vol 12_1 §5), so it cannot double
 * as the cross-device DEK itself.
 *
 * Design decision made here (not fully specified in Vol 12_1 §5's prose,
 * which says only "reuse the recovery-code mechanism" and "the DEK is
 * never transmitted to or stored by the server, in any form, at any
 * point"): since the DEK can never cross the network in ANY form — not
 * even wrapped/encrypted — the only way a second device can arrive at the
 * identical key is to DERIVE it, deterministically, from material every
 * authorised device already has: the existing recovery code (Sprint 10's
 * `getDeviceEncryptionKey`, a 32-byte value already written down by the
 * owner) plus the business's own id (public/knowable once signed in, not
 * secret). HKDF-SHA256 (RFC 5869) is the standard tool for exactly this —
 * turning one piece of high-entropy keying material into a
 * purpose-specific key without ever needing a second channel.
 *
 * `businessId` is folded in as the HKDF salt so a device that (through
 * some future bug) held recovery codes for two different businesses could
 * never derive the same DEK for both from the same code.
 *
 * No key rotation is implemented here — Vol 12_1 §12 names that as the
 * top open item, unchanged by this sprint.
 */
import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes as randomCipherBytes } from "@noble/ciphers/utils.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

/** AES-256 key length. */
export const DEK_LENGTH_BYTES = 32;

/** Standard AES-GCM nonce length (96 bits) — matches WebCrypto's default. */
export const GCM_NONCE_LENGTH_BYTES = 12;

const HKDF_INFO = "aifa/business-dek/v1";

/**
 * Derives the Business DEK from the owner's existing recovery code and the
 * business's id. Pure and deterministic: any device that has both inputs
 * (recovery code entered by the owner, business id known once signed in)
 * arrives at the identical 32-byte key without anything ever crossing the
 * network — satisfying Vol 12_1 §5's "never transmitted... in any form"
 * requirement by construction, not by an encrypted-transport promise.
 */
export function deriveBusinessDek(recoveryCode: string, businessId: string): Uint8Array {
  if (!recoveryCode) throw new Error("deriveBusinessDek: recoveryCode is required");
  if (!businessId) throw new Error("deriveBusinessDek: businessId is required");

  return hkdf(
    sha256,
    utf8ToBytes(recoveryCode),
    utf8ToBytes(businessId),
    utf8ToBytes(HKDF_INFO),
    DEK_LENGTH_BYTES,
  );
}

export interface EncryptedEnvelopePayload {
  ciphertext: Uint8Array;
  /** WebCrypto/SQLCipher-compatible IV for this envelope (Vol 12_1 §3). */
  iv: Uint8Array;
}

/**
 * Encrypts one envelope payload with the Business DEK (AES-256-GCM). A
 * fresh random IV is generated per call — GCM's security depends on never
 * reusing an (key, IV) pair, and each envelope is encrypted independently.
 */
export function encryptEnvelopePayload(dek: Uint8Array, plaintext: Uint8Array): EncryptedEnvelopePayload {
  if (dek.length !== DEK_LENGTH_BYTES) {
    throw new Error(`encryptEnvelopePayload: dek must be ${DEK_LENGTH_BYTES} bytes, got ${dek.length}`);
  }
  const iv = randomCipherBytes(GCM_NONCE_LENGTH_BYTES);
  const ciphertext = gcm(dek, iv).encrypt(plaintext);
  return { ciphertext, iv };
}

/**
 * Decrypts one envelope payload. GCM's authentication tag means a wrong
 * DEK (or tampered ciphertext) throws here rather than silently returning
 * garbage — callers should treat any thrown error as "this device cannot
 * read this envelope," not attempt to recover partial content.
 */
export function decryptEnvelopePayload(dek: Uint8Array, ciphertext: Uint8Array, iv: Uint8Array): Uint8Array {
  if (dek.length !== DEK_LENGTH_BYTES) {
    throw new Error(`decryptEnvelopePayload: dek must be ${DEK_LENGTH_BYTES} bytes, got ${dek.length}`);
  }
  return gcm(dek, iv).decrypt(ciphertext);
}
