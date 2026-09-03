/**
 * Client-side product Excel/CSV import parsing — Sprint 27 (Vol 13_0
 * §7's ProductImportBatch, pulled forward per this sprint's own plan
 * for a minimal staging flow: parse -> validate -> owner review ->
 * commit).
 *
 * DISCLOSED, PROVISIONAL (Sprint 27): this sprint's own risk note
 * flags that the assumed column layout might not match the owner's
 * real product lists, and its mitigation is "get a real sample file
 * from the owner during this sprint, not synthetic." No such sample
 * was available while writing this parser, so the header-name
 * matching below is a reasonable, conventional guess (common
 * SKU/Name/Unit/Cost header spellings), not something validated
 * against the owner's actual file. Treat this as a first pass to be
 * corrected once a real file is seen — do not assume it is final.
 *
 * This module only produces `ProductImportRowInput[]` (see
 * pricingTransport.ts) — it never calls the server itself. A
 * deliberately unrecognizable or invalid row is returned with
 * `parseStatus: 'error'` and a human-readable `errorMessage`, never
 * silently dropped or guessed into a product.
 */

import type { ProductImportRowInput } from "../sync/pricingTransport";

/** Conventional header spellings this first-pass parser recognizes, per column. Extend this list once a real owner sample file is seen. */
const HEADER_ALIASES: Record<"sku" | "name" | "unit" | "cost", string[]> = {
  sku: ["sku", "product code", "code", "item code", "item no", "item number"],
  name: ["name", "product name", "description", "item name", "item description"],
  unit: ["unit", "uom", "unit of measure", "unit of measurement"],
  cost: ["cost", "unit cost", "default cost", "cost price", "purchase price"],
};

export interface ParsedSheetRow {
  /** Raw cell values keyed by the original header text, exactly as read from the file — preserved for audit and for a human reviewer to see what was actually in the row. */
  [header: string]: string | number | null | undefined;
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase();
}

function findColumn(headers: string[], aliases: string[]): string | null {
  const normalized = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const idx = normalized.indexOf(alias);
    if (idx !== -1) return headers[idx];
  }
  return null;
}

/**
 * Maps a sheet's header row to the columns this parser understands.
 * Returns null for any column it can't confidently find — callers
 * should surface that to the user rather than guess further.
 */
export function detectColumns(headers: string[]): {
  skuColumn: string | null;
  nameColumn: string | null;
  unitColumn: string | null;
  costColumn: string | null;
} {
  return {
    skuColumn: findColumn(headers, HEADER_ALIASES.sku),
    nameColumn: findColumn(headers, HEADER_ALIASES.name),
    unitColumn: findColumn(headers, HEADER_ALIASES.unit),
    costColumn: findColumn(headers, HEADER_ALIASES.cost),
  };
}

/**
 * Parses already-extracted sheet rows (the caller is responsible for
 * reading the actual .xlsx/.csv file into `ParsedSheetRow[]` — this
 * function is deliberately library-agnostic so it can be paired with
 * whichever sheet-reading library the app already uses) into
 * `ProductImportRowInput[]` ready for `createProductImportBatch`.
 *
 * A row is `parseStatus: 'error'` when the name is missing/blank
 * (the one field this sprint treats as always required — Vol 13_0 §5
 * doesn't require a SKU) or when a supplied cost value doesn't parse
 * as a non-negative number. Every row's original cell values are kept
 * in `rawData` regardless of parse outcome, so a reviewer can see and
 * correct exactly what was in the file.
 */
export function parseProductImportRows(
  rows: ParsedSheetRow[],
  columns: { skuColumn: string | null; nameColumn: string | null; unitColumn: string | null; costColumn: string | null },
): ProductImportRowInput[] {
  return rows.map((row): ProductImportRowInput => {
    const rawData: Record<string, unknown> = { ...row };

    const name = columns.nameColumn ? String(row[columns.nameColumn] ?? "").trim() : "";
    const sku = columns.skuColumn ? String(row[columns.skuColumn] ?? "").trim() : "";
    const unitOfMeasure = columns.unitColumn ? String(row[columns.unitColumn] ?? "").trim() : "";
    const rawCost = columns.costColumn ? row[columns.costColumn] : undefined;

    if (!name) {
      return {
        rawData,
        sku: sku || null,
        name: null,
        unitOfMeasure: unitOfMeasure || null,
        defaultCost: null,
        parseStatus: "error",
        errorMessage: columns.nameColumn
          ? "Product name is blank in this row."
          : "Could not find a Name/Description column in this file's header row.",
      };
    }

    let defaultCost: string | null = null;
    if (rawCost !== undefined && rawCost !== null && String(rawCost).trim() !== "") {
      const parsedCost = Number(String(rawCost).replace(/[^0-9.\-]/g, ""));
      if (!Number.isFinite(parsedCost) || parsedCost < 0) {
        return {
          rawData,
          sku: sku || null,
          name,
          unitOfMeasure: unitOfMeasure || null,
          defaultCost: null,
          parseStatus: "error",
          errorMessage: `Cost value "${String(rawCost)}" is not a valid non-negative number.`,
        };
      }
      defaultCost = parsedCost.toFixed(2);
    }

    return {
      rawData,
      sku: sku || null,
      name,
      unitOfMeasure: unitOfMeasure || null,
      defaultCost,
      parseStatus: "ok",
      errorMessage: null,
    };
  });
}
