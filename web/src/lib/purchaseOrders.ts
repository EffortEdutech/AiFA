/**
 * Purchase Order read helper — Sprint 58 follow-on (14 September 2026,
 * "finish Purchases properly").
 *
 * Same reasoning as purchasesAndCash.ts's own header: purchaseOrderTransport.ts
 * exposes create/confirm-receipt/mark-paid, all called directly from that
 * transport, not duplicated here — but no list RPC for PurchaseOrder itself,
 * so this reads directly against the table, exactly mirroring
 * `listPaymentVouchers`'s own shape. RLS already scopes it correctly
 * (`view` on `expense` — see 00000000000004_purchase_order_and_party_resolution.sql).
 */
import { supabase } from "./supabaseClient";
import type { PurchaseOrder, PurchaseOrderRow } from "@aifa/core/sync/purchaseOrderTransport";

function toPurchaseOrder(row: PurchaseOrderRow): PurchaseOrder {
  return {
    id: row.id,
    businessId: row.business_id,
    poNo: row.po_no,
    partyId: row.party_id,
    status: row.status,
    issueDate: row.issue_date,
    expectedDeliveryDate: row.expected_delivery_date,
    currency: row.currency,
    subtotal: row.subtotal,
    taxTotal: row.tax_total,
    grandTotal: row.grand_total,
    notes: row.notes,
    capturedByMembershipId: row.captured_by_membership_id,
    createdAt: row.created_at,
  };
}

export async function listPurchaseOrders(businessId: string): Promise<PurchaseOrder[]> {
  const { data, error } = await supabase
    .from("purchase_order")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as PurchaseOrderRow[]).map(toPurchaseOrder);
}
