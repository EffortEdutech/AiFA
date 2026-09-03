/**
 * Pricing & Product Catalog — Sprint 27 (Vol 13_0 §5 Harga & Kos
 * Jualan; §7's ProductImportBatch pulled forward per this sprint's
 * own plan for minimal Excel staging).
 *
 * Mirrors partyAndLedgerTransport.ts's own shape in this same
 * directory.
 *
 * PRICE-001 NOTE: `resolvePrice` calls the server-side
 * `public.resolve_price` function, which is the deterministic
 * implementation of Finance PKA rule PRICE-001 (see
 * packages/core/pka/accounting_rules.json). It is not run through the
 * AI classification pipeline — the rule entry exists for governance
 * and audit provenance, following BANK-001's own precedent.
 *
 * IMPORT SCOPE NOTE (disclosed, Sprint 27): `createProductImportBatch`
 * takes already-parsed rows (see productImportParser.ts for the
 * client-side Excel parsing step, itself disclosed there as
 * provisional/unvalidated against a real owner file per this sprint's
 * own risk note — a real sample file from the owner is still needed).
 * The server only stages and validates row shape; it never guesses a
 * bad row into a product — a row stays `parse_status = 'error'` until
 * a human corrects and re-submits it.
 */

/** See supabaseTransport.ts's own header comment for why this exists instead of importing `SupabaseClient` from `@supabase/supabase-js` directly. */
export interface SupabaseClientLike {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export type CostSource = "manual" | "auto_from_purchase";
export type ProductStatus = "active" | "inactive";
export type ImportBatchStatus = "parsed" | "applied" | "failed";
export type ImportRowParseStatus = "ok" | "error";

/** Row shape of public.price_types (Sprint 27, Vol 13_0 §5). */
export interface PriceTypeRow {
  id: string;
  business_id: string;
  name: string;
  is_default: boolean;
  created_at: string;
}

export interface PriceType {
  id: string;
  businessId: string;
  name: string;
  /** True for exactly one price type per business at any time — the fallback target when a party has no price type of its own, or its own type has no entry for a given product (PRICE-001). */
  isDefault: boolean;
  createdAt: string;
}

function toPriceType(row: PriceTypeRow): PriceType {
  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    isDefault: row.is_default,
    createdAt: row.created_at,
  };
}

/** Row shape of public.products (Sprint 27, Vol 13_0 §5). */
export interface ProductRow {
  id: string;
  business_id: string;
  sku: string | null;
  name: string;
  unit_of_measure: string;
  default_cost: number | null;
  cost_source: CostSource;
  track_inventory: boolean;
  status: ProductStatus;
  created_by_membership_id: string | null;
  created_at: string;
}

export interface Product {
  id: string;
  businessId: string;
  sku: string | null;
  name: string;
  unitOfMeasure: string;
  defaultCost: number | null;
  /**
   * 'auto_from_purchase' is stubbed only — the server rejects it at
   * create time until the Purchase module addendum ships (Vol 13_0
   * §5). Hide that option in the UI entirely per this sprint's own
   * risk mitigation rather than let a user pick it and hit a
   * rejection.
   */
  costSource: CostSource;
  trackInventory: boolean;
  status: ProductStatus;
  createdByMembershipId: string | null;
  createdAt: string;
}

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    businessId: row.business_id,
    sku: row.sku,
    name: row.name,
    unitOfMeasure: row.unit_of_measure,
    defaultCost: row.default_cost,
    costSource: row.cost_source,
    trackInventory: row.track_inventory,
    status: row.status,
    createdByMembershipId: row.created_by_membership_id,
    createdAt: row.created_at,
  };
}

/** Row shape of public.price_list_entries (Sprint 27, Vol 13_0 §5). */
export interface PriceListEntryRow {
  id: string;
  product_id: string;
  price_type_id: string;
  unit_price: number;
  effective_from: string;
  effective_to: string | null;
  promo_note: string | null;
  created_at: string;
}

export interface PriceListEntry {
  id: string;
  productId: string;
  priceTypeId: string;
  unitPrice: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** Bare text field this sprint — carried over as-is per the sprint plan's own "Safe to Carry Over" note; not yet a structured promo mechanism. */
  promoNote: string | null;
  createdAt: string;
}

function toPriceListEntry(row: PriceListEntryRow): PriceListEntry {
  return {
    id: row.id,
    productId: row.product_id,
    priceTypeId: row.price_type_id,
    unitPrice: row.unit_price,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    promoNote: row.promo_note,
    createdAt: row.created_at,
  };
}

/** Result shape of public.resolve_price (PRICE-001). */
export interface ResolvedPriceRow {
  unit_price: number;
  price_type_id: string;
  price_list_entry_id: string;
  used_business_default: boolean;
}

export interface ResolvedPrice {
  unitPrice: number;
  priceTypeId: string;
  priceListEntryId: string;
  /** True when the party's own price type either wasn't set or had no effective entry for this product, and the business's default price type's entry was used instead (PRICE-001's full fallback chain, including the disclosed extra fallback step). */
  usedBusinessDefault: boolean;
}

function toResolvedPrice(row: ResolvedPriceRow): ResolvedPrice {
  return {
    unitPrice: row.unit_price,
    priceTypeId: row.price_type_id,
    priceListEntryId: row.price_list_entry_id,
    usedBusinessDefault: row.used_business_default,
  };
}

/** Row shape of public.product_import_batches (Sprint 27, Vol 13_0 §7 pulled forward). */
export interface ProductImportBatchRow {
  id: string;
  business_id: string;
  source_file_ref: string;
  status: ImportBatchStatus;
  row_count: number;
  error_count: number;
  created_by_membership_id: string | null;
  created_at: string;
}

export interface ProductImportBatch {
  id: string;
  businessId: string;
  sourceFileRef: string;
  status: ImportBatchStatus;
  rowCount: number;
  errorCount: number;
  createdByMembershipId: string | null;
  createdAt: string;
}

function toProductImportBatch(row: ProductImportBatchRow): ProductImportBatch {
  return {
    id: row.id,
    businessId: row.business_id,
    sourceFileRef: row.source_file_ref,
    status: row.status,
    rowCount: row.row_count,
    errorCount: row.error_count,
    createdByMembershipId: row.created_by_membership_id,
    createdAt: row.created_at,
  };
}

/** One already-parsed input row for createProductImportBatch — see productImportParser.ts for how a raw Excel row becomes this shape. */
export interface ProductImportRowInput {
  rawData: Record<string, unknown>;
  sku?: string | null;
  name?: string | null;
  unitOfMeasure?: string | null;
  defaultCost?: string | null;
  parseStatus: ImportRowParseStatus;
  errorMessage?: string | null;
}

export interface SupabasePricingTransport {
  /** `capture` on `pricing`. The first price type ever created for a business auto-becomes its default; every one after that does not (call setDefaultPriceType explicitly to change it). */
  createPriceType(businessId: string, name: string): Promise<PriceType>;

  /** `capture` on `pricing`. Atomically clears the previous default and sets this one. */
  setDefaultPriceType(businessId: string, priceTypeId: string): Promise<PriceType>;

  /** `capture` on `pricing`. Assigns (or clears, with `priceTypeId: null`) a party's own price type — the first link PRICE-001's resolution order consults. */
  setPartyPriceType(partyId: string, priceTypeId: string | null): Promise<void>;

  /**
   * `capture` on `pricing`. `costSource: 'auto_from_purchase'` is
   * rejected server-side this sprint (Purchase module addendum has
   * not shipped) — do not offer it in the UI; see this file's header.
   */
  createProduct(params: {
    businessId: string;
    sku?: string | null;
    name: string;
    unitOfMeasure: string;
    defaultCost?: number | null;
    costSource?: CostSource;
    trackInventory?: boolean;
  }): Promise<Product>;

  /** `capture` on `pricing`. Rejects a priceTypeId that doesn't belong to the same business as the product. */
  createPriceListEntry(params: {
    productId: string;
    priceTypeId: string;
    unitPrice: number;
    effectiveFrom?: string;
    effectiveTo?: string | null;
    promoNote?: string | null;
  }): Promise<PriceListEntry>;

  /**
   * PRICE-001: resolves the price for `productId` as seen by
   * `partyId` (pass `partyId: null` to resolve using only the
   * business default, e.g. for a walk-in sale with no party record).
   * Throws if nothing is resolvable (no effective entry under the
   * party's price type or the business default) — never returns a
   * silent null/zero price.
   */
  resolvePrice(businessId: string, productId: string, partyId: string | null): Promise<ResolvedPrice>;

  /**
   * `capture` on `pricing`. Stages rows for owner review — never
   * creates a product directly. A row with `parseStatus: 'error'` is
   * stored and counted but never silently turned into a product.
   */
  createProductImportBatch(
    businessId: string,
    sourceFileRef: string,
    rows: ProductImportRowInput[],
  ): Promise<ProductImportBatch>;

  /**
   * `capture` on `pricing`. Commits only the batch's 'ok' rows that
   * don't already have a created product (idempotent — re-applying an
   * already-applied batch creates nothing new).
   */
  applyProductImportBatch(batchId: string): Promise<ProductImportBatch>;
}

export function createSupabasePricingTransport(
  client: SupabaseClientLike,
): SupabasePricingTransport {
  return {
    async createPriceType(businessId, name) {
      const { data, error } = await client.rpc("create_price_type", {
        p_business_id: businessId,
        p_name: name,
      });
      if (error) throw error;
      return toPriceType(data as PriceTypeRow);
    },

    async setDefaultPriceType(businessId, priceTypeId) {
      const { data, error } = await client.rpc("set_default_price_type", {
        p_business_id: businessId,
        p_price_type_id: priceTypeId,
      });
      if (error) throw error;
      return toPriceType(data as PriceTypeRow);
    },

    async setPartyPriceType(partyId, priceTypeId) {
      const { error } = await client.rpc("set_party_price_type", {
        p_party_id: partyId,
        p_price_type_id: priceTypeId,
      });
      if (error) throw error;
    },

    async createProduct(params) {
      const { data, error } = await client.rpc("create_product", {
        p_business_id: params.businessId,
        p_sku: params.sku ?? null,
        p_name: params.name,
        p_unit_of_measure: params.unitOfMeasure,
        p_default_cost: params.defaultCost ?? null,
        p_cost_source: params.costSource ?? "manual",
        p_track_inventory: params.trackInventory ?? false,
      });
      if (error) throw error;
      return toProduct(data as ProductRow);
    },

    async createPriceListEntry(params) {
      const { data, error } = await client.rpc("create_price_list_entry", {
        p_product_id: params.productId,
        p_price_type_id: params.priceTypeId,
        p_unit_price: params.unitPrice,
        p_effective_from: params.effectiveFrom ?? null,
        p_effective_to: params.effectiveTo ?? null,
        p_promo_note: params.promoNote ?? null,
      });
      if (error) throw error;
      return toPriceListEntry(data as PriceListEntryRow);
    },

    async resolvePrice(businessId, productId, partyId) {
      const { data, error } = await client.rpc("resolve_price", {
        p_business_id: businessId,
        p_product_id: productId,
        p_party_id: partyId,
      });
      if (error) throw error;
      const rows = data as ResolvedPriceRow[];
      return toResolvedPrice(rows[0]);
    },

    async createProductImportBatch(businessId, sourceFileRef, rows) {
      const { data, error } = await client.rpc("create_product_import_batch", {
        p_business_id: businessId,
        p_source_file_ref: sourceFileRef,
        p_rows: rows.map((r) => ({
          raw_data: r.rawData,
          sku: r.sku ?? null,
          name: r.name ?? null,
          unit_of_measure: r.unitOfMeasure ?? null,
          default_cost: r.defaultCost ?? null,
          parse_status: r.parseStatus,
          error_message: r.errorMessage ?? null,
        })),
      });
      if (error) throw error;
      return toProductImportBatch(data as ProductImportBatchRow);
    },

    async applyProductImportBatch(batchId) {
      const { data, error } = await client.rpc("apply_product_import_batch", {
        p_batch_id: batchId,
      });
      if (error) throw error;
      return toProductImportBatch(data as ProductImportBatchRow);
    },
  };
}
