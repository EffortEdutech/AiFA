/**
 * Product / price-type / price-list read helpers — Sprint 39 (Vol 13_0
 * §5). Same reasoning as partiesAndAccounts.ts: `pricingTransport.ts`
 * has no list RPC for any of these; reads go directly against the
 * underlying tables, each RLS-scoped to `view` on `pricing`.
 */
import { supabase } from "./supabaseClient";
import type {
  Product,
  ProductRow,
  PriceType,
  PriceTypeRow,
  PriceListEntry,
  PriceListEntryRow,
  ProductImportBatch,
  ProductImportBatchRow,
} from "@aifa/core/sync/pricingTransport";

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

function toPriceType(row: PriceTypeRow): PriceType {
  return { id: row.id, businessId: row.business_id, name: row.name, isDefault: row.is_default, createdAt: row.created_at };
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

export async function listProducts(businessId: string): Promise<Product[]> {
  const { data, error } = await supabase.from("products").select("*").eq("business_id", businessId).order("name");
  if (error) throw error;
  return (data as ProductRow[]).map(toProduct);
}

export async function listPriceTypes(businessId: string): Promise<PriceType[]> {
  const { data, error } = await supabase.from("price_types").select("*").eq("business_id", businessId).order("name");
  if (error) throw error;
  return (data as PriceTypeRow[]).map(toPriceType);
}

export async function listPriceListEntries(productId: string): Promise<PriceListEntry[]> {
  const { data, error } = await supabase
    .from("price_list_entries")
    .select("*")
    .eq("product_id", productId)
    .order("effective_from", { ascending: false });
  if (error) throw error;
  return (data as PriceListEntryRow[]).map(toPriceListEntry);
}

export async function listProductImportBatches(businessId: string): Promise<ProductImportBatch[]> {
  const { data, error } = await supabase
    .from("product_import_batches")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as ProductImportBatchRow[]).map(toProductImportBatch);
}
