// Minimal typings for the vendored qrcode.js (MIT, Kazuhiko Arase).
export interface QRCode {
  addData(data: string, mode?: "Numeric" | "Alphanumeric" | "Byte" | "Kanji"): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
}
export function qrcode(typeNumber: number, errorCorrectionLevel: "L" | "M" | "Q" | "H"): QRCode;
export default qrcode;
