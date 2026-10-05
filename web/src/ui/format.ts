/**
 * Display formatters shared by the ui kit (UI polish Phase 1).
 *
 * Presentation only: these never change a stored value, they only decide
 * how a number, date or status code is shown to the owner.
 */

const moneyFormat = new Intl.NumberFormat("en-MY", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 1234.5 -> "RM1,234.50"; negatives -> "-RM1,234.50"; null/NaN -> "—". */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const sign = value < 0 ? "-" : "";
  return `${sign}RM${moneyFormat.format(Math.abs(value))}`;
}

/** "2026-10-05" or an ISO timestamp -> "05 Oct 2026"; empty -> "—". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  // A bare YYYY-MM-DD is parsed as UTC midnight; format it in UTC so the
  // day never shifts for a viewer west of Greenwich.
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: iso.length === 10 ? "UTC" : undefined,
  });
}

/** "converted_to_invoice" -> "Converted to invoice". */
export function humanizeStatus(status: string): string {
  const spaced = status.replace(/[_-]+/g, " ").trim();
  if (!spaced) return "";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
