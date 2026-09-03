/**
 * Inventory & Delivery Order — Sprint 31 (Vol 13_0 §7 Module D:
 * Penghantaran & Inventori, extends Vol 6_5). Opens Sub-phase 3c.
 *
 * Mirrors quotationInvoiceTransport.ts / paymentVouchersReportsTransport.ts's
 * own shape in this same directory.
 *
 * APPROVAL-STATE NOTE (see the migration's own header note 3):
 * `DeliveryOrder.status` NEVER holds an `'approved'` value — unlike
 * PaymentVoucher (Sprint 30), which genuinely needed a stored
 * "authorized but not yet paid" state, a DO's approval state lives
 * entirely on its linked ApprovalTask. A UI showing "is this DO
 * approved yet" must look at the ApprovalTask for
 * (subject_type='delivery_order', subject_id=<do id>), not at
 * `DeliveryOrder.status` — the same posture Quotation already uses
 * (Sprint 28).
 *
 * DISPATCH NOTE: `dispatchDeliveryOrder` is the one call that actually
 * decrements stock (Vol 13_0 §7's "inventori akan ditolak secara
 * automatik apabila Delivery Order dihantar") — it will throw if the
 * linked ApprovalTask hasn't resolved approved yet, or if any
 * stock-tracked line doesn't have enough quantity_on_hand. A
 * non-stock-tracked product's line (Product.track_inventory = false)
 * is silently skipped for stock posting — see the migration's own
 * header note 5.
 */

/** See supabaseTransport.ts's own header comment for why this exists instead of importing `SupabaseClient` from `@supabase/supabase-js` directly. */
export interface SupabaseClientLike {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export type DeliveryOrderStatus = "draft" | "dispatched" | "delivered" | "rejected";
export type StockMovementType =
  | "opening" | "purchase_receipt" | "delivery_out" | "adjustment_increase" | "adjustment_decrease";
export type StockMovementSourceType = "delivery_order" | "purchase_invoice" | "stock_take" | "manual";
export type StockTakeStatus = "in_progress" | "completed";

/** Row shape of public.warehouses (Sprint 31, Vol 13_0 §7). */
export interface WarehouseRow {
  id: string;
  business_id: string;
  name: string;
  created_at: string;
}

export interface Warehouse {
  id: string;
  businessId: string;
  name: string;
  createdAt: string;
}

function toWarehouse(row: WarehouseRow): Warehouse {
  return { id: row.id, businessId: row.business_id, name: row.name, createdAt: row.created_at };
}

/** Row shape of public.stock_levels' primary-key-less-id result. */
export interface StockLevelRow {
  business_id: string;
  product_id: string;
  warehouse_id: string;
  quantity_on_hand: number;
  last_movement_at: string | null;
}

export interface StockLevel {
  businessId: string;
  productId: string;
  warehouseId: string;
  quantityOnHand: number;
  lastMovementAt: string | null;
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

/** Row shape of public.delivery_orders (Sprint 31, Vol 13_0 §7). */
export interface DeliveryOrderRow {
  id: string;
  business_id: string;
  do_no: string;
  invoice_id: string;
  warehouse_id: string;
  status: DeliveryOrderStatus;
  issue_date: string;
  notes: string | null;
  captured_by_membership_id: string | null;
  created_at: string;
}

export interface DeliveryOrder {
  id: string;
  businessId: string;
  doNo: string;
  invoiceId: string;
  warehouseId: string;
  /** 'draft' until dispatched (see this file's header — approval state is NOT reflected here). 'rejected' if the linked ApprovalTask was rejected. */
  status: DeliveryOrderStatus;
  issueDate: string;
  notes: string | null;
  capturedByMembershipId: string | null;
  createdAt: string;
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

export interface DeliveryOrderLineInput {
  productId: string;
  quantity: number;
}

/** Row shape of public.stock_takes (Sprint 31, Vol 13_0 §7). */
export interface StockTakeRow {
  id: string;
  business_id: string;
  warehouse_id: string;
  status: StockTakeStatus;
  counted_at: string | null;
  captured_by_membership_id: string | null;
  created_at: string;
}

export interface StockTake {
  id: string;
  businessId: string;
  warehouseId: string;
  status: StockTakeStatus;
  countedAt: string | null;
  capturedByMembershipId: string | null;
  createdAt: string;
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

/** Row shape of public.stock_take_lines. */
export interface StockTakeLineRow {
  id: string;
  stock_take_id: string;
  product_id: string;
  system_qty: number;
  counted_qty: number | null;
  variance: number | null;
}

export interface StockTakeLine {
  id: string;
  stockTakeId: string;
  productId: string;
  systemQty: number;
  /** null until record_stock_take_counts has been called for this line. */
  countedQty: number | null;
  /** counted_qty - system_qty; null until counted. */
  variance: number | null;
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

export interface StockTakeCountInput {
  productId: string;
  countedQty: number;
}

export interface SupabaseInventoryDeliveryTransport {
  /**
   * `configure` on `inventory` — a setup-level action; only the Owner
   * holds this among the six system role templates today (see the
   * migration's own header note 4). Day-to-day inventory actions
   * below are gated on `capture` instead.
   */
  createWarehouse(params: { businessId: string; name: string }): Promise<Warehouse>;

  /**
   * `capture` on `inventory`. The one-time initial-balance entry for
   * a (product, warehouse) pair — throws
   * `opening_stock_already_recorded_for_this_product_and_warehouse`
   * on a second call, and `product_is_not_stock_tracked` for a
   * product with `trackInventory = false`.
   */
  recordOpeningStock(params: {
    businessId: string;
    productId: string;
    warehouseId: string;
    quantity: number;
    unitCost?: number | null;
  }): Promise<StockLevel>;

  /**
   * `capture` on `inventory`. Drafts a DeliveryOrder and its lines,
   * links it to the given invoice (throws
   * `invoice_already_has_a_delivery_order` if that invoice already has
   * one — see this file's header on the single-DO-per-invoice
   * limitation), and routes it through the real ApprovalTask engine
   * (domain='inventory'). Stays 'draft' until dispatchDeliveryOrder
   * actually posts stock — see this file's header.
   */
  createDeliveryOrder(params: {
    businessId: string;
    invoiceId: string;
    warehouseId: string;
    lines: DeliveryOrderLineInput[];
    notes?: string | null;
    aiDraftSummary?: string | null;
    autoApproved?: boolean;
  }): Promise<DeliveryOrder>;

  /**
   * `capture` on `inventory`. Requires the linked ApprovalTask to have
   * resolved approved (throws `delivery_order_not_yet_approved`
   * otherwise) and the DO to still be 'draft'. THE call that actually
   * decrements stock — see this file's header (DISPATCH NOTE).
   */
  dispatchDeliveryOrder(deliveryOrderId: string): Promise<DeliveryOrder>;

  /**
   * `capture` on `inventory`. A self-reported external event (the
   * server cannot observe a physical delivery happening) — requires
   * the DO to currently be 'dispatched'.
   */
  markDeliveryOrderDelivered(deliveryOrderId: string): Promise<DeliveryOrder>;

  /**
   * `capture` on `inventory`. Snapshots every currently-stocked
   * product in the warehouse as of right now into new
   * `stock_take_lines` — system_qty is frozen at snapshot time.
   */
  createStockTake(params: { businessId: string; warehouseId: string }): Promise<StockTake>;

  /**
   * `capture` on `inventory`. Sets counted_qty (and the derived
   * variance) for one or more lines of an in-progress stock take. Can
   * be called more than once as counting progresses. Throws if any
   * given product wasn't on this stock take's original snapshot.
   */
  recordStockTakeCounts(params: {
    stockTakeId: string;
    counts: StockTakeCountInput[];
  }): Promise<StockTakeLine[]>;

  /**
   * `capture` on `inventory`. Generates one adjustment_increase/
   * decrease StockMovement per counted line with a nonzero variance
   * and updates stock_levels accordingly — a line never counted is
   * left untouched, not assumed zero. Marks the stock take
   * 'completed'; throws on a second call.
   */
  completeStockTake(stockTakeId: string): Promise<StockTake>;
}

export function createSupabaseInventoryDeliveryTransport(
  client: SupabaseClientLike,
): SupabaseInventoryDeliveryTransport {
  return {
    async createWarehouse(params) {
      const { data, error } = await client.rpc("create_warehouse", {
        p_business_id: params.businessId,
        p_name: params.name,
      });
      if (error) throw error;
      return toWarehouse(data as WarehouseRow);
    },

    async recordOpeningStock(params) {
      const { data, error } = await client.rpc("record_opening_stock", {
        p_business_id: params.businessId,
        p_product_id: params.productId,
        p_warehouse_id: params.warehouseId,
        p_quantity: params.quantity,
        p_unit_cost: params.unitCost ?? null,
      });
      if (error) throw error;
      return toStockLevel(data as StockLevelRow);
    },

    async createDeliveryOrder(params) {
      const { data, error } = await client.rpc("create_delivery_order", {
        p_business_id: params.businessId,
        p_invoice_id: params.invoiceId,
        p_warehouse_id: params.warehouseId,
        p_lines: params.lines.map((l) => ({ product_id: l.productId, quantity: l.quantity })),
        p_notes: params.notes ?? null,
        p_ai_draft_summary: params.aiDraftSummary ?? null,
        p_auto_approved: params.autoApproved ?? false,
      });
      if (error) throw error;
      return toDeliveryOrder(data as DeliveryOrderRow);
    },

    async dispatchDeliveryOrder(deliveryOrderId) {
      const { data, error } = await client.rpc("dispatch_delivery_order", {
        p_delivery_order_id: deliveryOrderId,
      });
      if (error) throw error;
      return toDeliveryOrder(data as DeliveryOrderRow);
    },

    async markDeliveryOrderDelivered(deliveryOrderId) {
      const { data, error } = await client.rpc("mark_delivery_order_delivered", {
        p_delivery_order_id: deliveryOrderId,
      });
      if (error) throw error;
      return toDeliveryOrder(data as DeliveryOrderRow);
    },

    async createStockTake(params) {
      const { data, error } = await client.rpc("create_stock_take", {
        p_business_id: params.businessId,
        p_warehouse_id: params.warehouseId,
      });
      if (error) throw error;
      return toStockTake(data as StockTakeRow);
    },

    async recordStockTakeCounts(params) {
      const { data, error } = await client.rpc("record_stock_take_counts", {
        p_stock_take_id: params.stockTakeId,
        p_counts: params.counts.map((c) => ({ product_id: c.productId, counted_qty: c.countedQty })),
      });
      if (error) throw error;
      return (data as StockTakeLineRow[]).map(toStockTakeLine);
    },

    async completeStockTake(stockTakeId) {
      const { data, error } = await client.rpc("complete_stock_take", {
        p_stock_take_id: stockTakeId,
      });
      if (error) throw error;
      return toStockTake(data as StockTakeRow);
    },
  };
}
