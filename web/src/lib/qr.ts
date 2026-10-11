/**
 * QR code helpers (Sprint 68a). Wraps the vendored encoder in ./vendor/qrcode.js
 * (MIT, Kazuhiko Arase) so the rest of the app never touches it directly.
 * Everything runs in the browser; the address being encoded never leaves it.
 */
import { qrcode } from "./vendor/qrcode.js";

const QUIET_ZONE = 4; // modules of white border the QR standard asks for

export interface QrMatrix {
  size: number;
  dark: (row: number, col: number) => boolean;
}

export function qrMatrix(text: string): QrMatrix {
  const qr = qrcode(0, "M"); // type 0 = smallest version that fits; M = ~15% damage tolerance
  qr.addData(text);
  qr.make();
  return { size: qr.getModuleCount(), dark: (r, c) => qr.isDark(r, c) };
}

/** A self-contained SVG string (white background, black modules). */
export function qrSvg(text: string, pixels = 320): string {
  const m = qrMatrix(text);
  const total = m.size + QUIET_ZONE * 2;
  let path = "";
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (m.dark(r, c)) path += `M${c + QUIET_ZONE} ${r + QUIET_ZONE}h1v1h-1z`;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${pixels}" height="${pixels}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="#ffffff"/><path d="${path}" fill="#000000"/></svg>`
  );
}

/** A crisp PNG: whole-pixel modules so the edges stay sharp when printed. */
export function qrPngBlob(text: string, targetPixels = 1024): Promise<Blob> {
  const m = qrMatrix(text);
  const total = m.size + QUIET_ZONE * 2;
  const scale = Math.max(1, Math.floor(targetPixels / total));
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = total * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Canvas is not available in this browser."));
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (m.dark(r, c)) ctx.fillRect((c + QUIET_ZONE) * scale, (r + QUIET_ZONE) * scale, scale, scale);
    }
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not create the image."))), "image/png"),
  );
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);

/** Opens a print-ready A5 poster (business name, QR, address) in a new tab. */
export function printQrPoster(opts: { text: string; businessName: string; headline: string; subline: string }): void {
  const w = window.open("", "_blank");
  if (!w) throw new Error("Your browser blocked the print window. Allow pop-ups for this site and try again.");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(opts.businessName)} QR</title>
<style>
@page { size: A5; margin: 0 }
body { margin: 0; font-family: system-ui, sans-serif; text-align: center; color: #0f172a }
.sheet { width: 148mm; height: 210mm; box-sizing: border-box; padding: 14mm 12mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6mm }
h1 { font-size: 26pt; margin: 0 }
h2 { font-size: 18pt; margin: 0; font-weight: 600 }
p { font-size: 11pt; margin: 0; color: #475569; word-break: break-all }
svg { width: 100mm; height: 100mm }
</style></head><body><div class="sheet">
<h1>${escapeHtml(opts.businessName)}</h1>
<h2>${escapeHtml(opts.headline)}</h2>
${qrSvg(opts.text, 400)}
<p>${escapeHtml(opts.subline)}</p>
<p>${escapeHtml(opts.text)}</p>
</div><script>window.onload=function(){setTimeout(function(){window.print()},200)}${"</"}script></body></html>`);
  w.document.close();
}
