// Colour helpers for the public site (UI polish Phase 5).
//
// The accent colour is the one style a Client Business owner chooses. It is
// free text from the database, so it is validated here before it reaches a
// CSS variable, and every derived colour (text on the accent, accent used as
// text on white, a light tint) is computed so the page stays readable
// whatever shade the owner picks.

type RGB = [number, number, number];

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
const INK: RGB = [15, 23, 42];
const DEFAULT_ACCENT = "#1a2b3c";

/** Parses #rgb or #rrggbb (leading # optional). Anything else returns null. */
export function parseHex(input: string | null | undefined): RGB | null {
  if (!input) return null;
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
}

function toHex(rgb: RGB): string {
  return (
    "#" +
    rgb
      .map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0"))
      .join("")
  );
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(rgb: RGB): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** WCAG contrast ratio between two colours (1 to 21). */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as RGB;
}

export interface SiteTheme {
  /** The owner's colour (hero background, accents, borders). */
  accent: string;
  /** Text and icon colour that is readable on `accent`. */
  onAccent: string;
  /** `accent` darkened just enough to read as text or a button on white. */
  accentText: string;
  /** Very light wash of `accent` for section backgrounds. */
  accentTint: string;
  /** Solid hero button: background and the text colour readable on it. */
  heroButtonBg: string;
  heroButtonText: string;
}

export function buildTheme(raw: string | null | undefined): SiteTheme {
  const accent = parseHex(raw) ?? (parseHex(DEFAULT_ACCENT) as RGB);

  const onAccentIsWhite = contrastRatio(accent, WHITE) >= contrastRatio(accent, INK);
  const onAccent = onAccentIsWhite ? WHITE : INK;

  let text = accent;
  for (let i = 0; i < 20 && contrastRatio(text, WHITE) < 4.5; i += 1) {
    text = mix(text, BLACK, 0.1);
  }

  return {
    accent: toHex(accent),
    onAccent: toHex(onAccent),
    accentText: toHex(text),
    accentTint: toHex(mix(accent, WHITE, 0.93)),
    heroButtonBg: toHex(onAccent),
    heroButtonText: onAccentIsWhite ? toHex(text) : toHex(WHITE),
  };
}
