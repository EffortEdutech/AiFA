import {
  DEK_LENGTH_BYTES,
  decryptEnvelopePayload,
  deriveBusinessDek,
  encryptEnvelopePayload,
} from "@aifa/core/sync/dek";
import { utf8ToBytes } from "@noble/hashes/utils.js";

describe("deriveBusinessDek", () => {
  it("is deterministic — the same recovery code + business id always derives the same DEK", () => {
    const a = deriveBusinessDek("recovery-code-abc123", "business-1");
    const b = deriveBusinessDek("recovery-code-abc123", "business-1");
    expect(a).toEqual(b);
    expect(a.length).toBe(DEK_LENGTH_BYTES);
  });

  it("derives a different DEK for a different business id (same recovery code)", () => {
    const a = deriveBusinessDek("recovery-code-abc123", "business-1");
    const b = deriveBusinessDek("recovery-code-abc123", "business-2");
    expect(a).not.toEqual(b);
  });

  it("derives a different DEK for a different recovery code (same business id)", () => {
    const a = deriveBusinessDek("recovery-code-abc123", "business-1");
    const b = deriveBusinessDek("recovery-code-xyz789", "business-1");
    expect(a).not.toEqual(b);
  });

  it("rejects an empty recovery code or business id", () => {
    expect(() => deriveBusinessDek("", "business-1")).toThrow();
    expect(() => deriveBusinessDek("recovery-code-abc123", "")).toThrow();
  });
});

describe("envelope payload encryption round-trip", () => {
  it("encrypts on one simulated device and decrypts on a second simulated device sharing the same DEK, byte-identical", () => {
    // Two "devices" independently deriving the DEK from the same recovery
    // code + business id, per Vol 12_1 §5 — never anything transmitted
    // between them.
    const deviceOneDek = deriveBusinessDek("owner-recovery-code", "biz-42");
    const deviceTwoDek = deriveBusinessDek("owner-recovery-code", "biz-42");

    const plaintext = utf8ToBytes(
      JSON.stringify({
        entity_type: "business_event",
        amount: 1234.56,
        note: "office supplies",
      }),
    );

    const { ciphertext, iv } = encryptEnvelopePayload(deviceOneDek, plaintext);
    const decrypted = decryptEnvelopePayload(deviceTwoDek, ciphertext, iv);

    expect(decrypted).toEqual(plaintext);
  });

  it("produces a different ciphertext each time (fresh random IV per call)", () => {
    const dek = deriveBusinessDek("owner-recovery-code", "biz-42");
    const plaintext = utf8ToBytes("same content every time");

    const first = encryptEnvelopePayload(dek, plaintext);
    const second = encryptEnvelopePayload(dek, plaintext);

    expect(first.iv).not.toEqual(second.iv);
    expect(first.ciphertext).not.toEqual(second.ciphertext);
  });

  it("refuses to decrypt with the wrong DEK — a device without the DEK cannot read the payload", () => {
    const correctDek = deriveBusinessDek("owner-recovery-code", "biz-42");
    const wrongDek = deriveBusinessDek("a-different-recovery-code", "biz-42");
    const plaintext = utf8ToBytes("confidential business data");

    const { ciphertext, iv } = encryptEnvelopePayload(correctDek, plaintext);

    expect(() => decryptEnvelopePayload(wrongDek, ciphertext, iv)).toThrow();
  });

  it("refuses to decrypt tampered ciphertext even with the correct DEK", () => {
    const dek = deriveBusinessDek("owner-recovery-code", "biz-42");
    const plaintext = utf8ToBytes("confidential business data");
    const { ciphertext, iv } = encryptEnvelopePayload(dek, plaintext);

    const tampered = new Uint8Array(ciphertext);
    tampered[0] ^= 0xff;

    expect(() => decryptEnvelopePayload(dek, tampered, iv)).toThrow();
  });
});
