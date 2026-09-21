/**
 * Warehouse / Stock Level / Delivery Order / Stock Take read helpers —
 * Sprint 42 (Vol 13_0 §7 Module D). Same reasoning as every other
 * lib/*.ts helper this phase: `inventoryDeliveryTransport.ts` exposes
 * only mutating/lifecycle calls (create*, dispatch*, mark*, record*,
 * complete*) — no list RPC for any of the five entities it owns. Reads
 * go directly against the underlying tables; RLS already scopes each
 * one correctly (`view` on `inventory` — app/backend/schema.sql
 * ~lines 6004/6042/6151/6164/6388/6402).
 */
import { supabase } from "./supabaseClient";
import type {
  Warehouse,
  WarehouseRow,
  StockLevel,
  StockLevelRow,
  DeliveryOrder,
  DeliveryOrderRow,
  StockTake,
  StockTakeRow,
  StockTakeLine,
  StockTakeLineRow,
} from "@aifa/core/sync/inventoryDeliveryTransport";

function toWarehouse(row: WarehouseRow): Warehouse {
  return { id: row.id, businessId: row.business_id, name: row.name, createdAt: row.created_at };
}

function toStockLevel(row: StockLevelRow): StockLevel {
  return {
    businessId: row.business_id,
    productId: row.product_id,
    warehouseId: row.warehouse_id,
    quantityOnHand: row.quantity_on_hand,
    lastMovementAt: row.last_movement_at,
  };
}

function toDeliveryOrder(row: DeliveryOrderRow): DeliveryOrder {
  return {
    id: row.id,
    businessId: row.business_id,
    doNo: row.do_no,
    invoiceId: row.invoice_id,
    warehouseId: row.warehouse_id,
    status: row.status,
    issueDate: row.issue_date,
    notes: row.notes,
    capturedByMembershipId: row.captured_by_membership_id,
    createdAt: row.created_at,
  };
}

function toStockTake(row: StockTakeRow): StockTake {
  return {
    id: row.id,
    businessId: row.business_id,
    warehouseId: row.warehouse_id,
    status: row.status,
    countedAt: row.counted_at,
    capturedByMembershipId: row.captured_by_membership_id,
    createdAt: row.created_at,
  };
}

function toStockTakeLine(row: StockTakeLineRow): StockTakeLine {
  return {
    id: row.id,
    stockTakeId: row.stock_take_id,
    productId: row.product_id,
    systemQty: row.system_qty,
    countedQty: row.counted_qty,
    variance: row.variance,
  };
}

export async function listWarehouses(businessId: string): Promise<Warehouse[]> {
  const { data, error } = await supabase.from("warehouses").select("*").eq("business_id", businessId).order("name");
  if (error) throw error;
  return (data as WarehouseRow[]).map(toWarehouse);
}

/** Sprint 59 addition — a minimal stock-tracked-product picker for the Stock Adjustment capture branch (see useCaptureRouterCore.ts). Mirrors this file's own read-only-against-the-table convention; no list RPC exists for products either. */
export interface StockTrackedProduct {
  id: string;
  name: string;
}

export async function listStockTrackedProducts(businessId: string): Promise<StockTrackedProduct[]> {
  const { data, error } = await supabase
    .from("products")
    .select("id, name")
    .eq("business_id", businessId)
    .eq("track_inventory", true)
    .eq("status", "active")
    .order("name");
  if (error) throw error;
  return (data as { id: string; name: string }[]).map((row) => ({ id: row.id, name: row.name }));
}

export async function listStockLevels(businessId: string): Promise<StockLevel[]> {
  const { data, error } = await supabase.from("stock_levels").select("*").eq("business_id", businessId);
  if (error) throw error;
  return (data as StockLevelRow[]).map(toStockLevel);
}

export async function listDeliveryOrders(businessId: string): Promise<DeliveryOrder[]> {
  const { data, error } = await supabase
    .from("delivery_orders")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as DeliveryOrderRow[]).map(toDeliveryOrder);
}

/** public.delivery_order_lines -- not exported by inventoryDeliveryTransport.ts (schema-only, same pattern as quotation_lines/invoice_lines in Sprint 40's salesCycle.ts). */
export interface DeliveryOrderLine {
  id: string;
  lineNo: number;
  productId: string;
  quantity: number;
}

interface DeliveryOrderLineRow {
  id: string;
  line_no: number;
  product_id: string;
  quantity: number;
}

export async function listDeliveryOrderLines(deliveryOrderId: string): Promise<DeliveryOrderLine[]> {
  const { data, error } = await supabase
    .from("delivery_order_lines")
    .select("*")
    .eq("delivery_order_id", deliveryOrderId)
    .order("line_no", { ascending: true });
  if (error) throw error;
  return (data as DeliveryOrderLineRow[]).map((row) => ({
    id: row.id,
    lineNo: row.line_no,
    productId: row.product_id,
    quantity: row.quantity,
  }));
}

export async function listStockTakes(businessId: string): Promise<StockTake[]> {
  const { data, error } = await supabase
    .from("stock_takes")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as StockTakeRow[]).map(toStockTake);
}

export async function listStockTakeLines(stockTakeId: string): Promise<StockTakeLine[]> {
  const { data, error } = await supabase
    .from("stock_take_lines")
    .select("*")
    .eq("stock_take_id", stockTakeId);
  if (error) throw error;
  return (data as StockTakeLineRow[]).map(toStockTakeLine);
}
