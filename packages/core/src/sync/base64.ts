/**
 * Minimal, dependency-free base64 <-> Uint8Array conversion — Sprint 16.
 *
 * Same rationale as backupService.ts's own hand-rolled version (Sprint 9):
 * a small, self-contained encoding transform doesn't justify a new
 * production dependency (AGENTS.md). Not reused directly from
 * backupService.ts because that file is app/-only (imports React
 * Native/Expo modules elsewhere in the same module graph) and this needs
 * to be callable from @aifa/core, which must stay platform-agnostic
 * (Sprint 13).
 */
const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array): string {
  let result = "";
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    result +=
      BASE64_CHARS[(chunk >> 18) & 0x3f] +
      BASE64_CHARS[(chunk >> 12) & 0x3f] +
      BASE64_CHARS[(chunk >> 6) & 0x3f] +
      BASE64_CHARS[chunk & 0x3f];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const chunk = bytes[i] << 16;
    result +=
      BASE64_CHARS[(chunk >> 18) & 0x3f] + BASE64_CHARS[(chunk >> 12) & 0x3f] + "==";
  } else if (remaining === 2) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8);
    result +=
      BASE64_CHARS[(chunk >> 18) & 0x3f] +
      BASE64_CHARS[(chunk >> 12) & 0x3f] +
      BASE64_CHARS[(chunk >> 6) & 0x3f] +
      "=";
  }
  return result;
}

export function base64ToBytes(base64: string): Uint8Array {
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
