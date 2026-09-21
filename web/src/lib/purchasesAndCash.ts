/**
 * Payment Voucher read helper — Sprint 41 (Vol 13_0 §6 Module C).
 *
 * Same reasoning as every other lib/*.ts helper this phase:
 * `paymentVouchersReportsTransport.ts` exposes create/attach/mark-paid
 * plus three genuine read RPCs (`cashBookDetail`, `profitAndLossSummary`,
 * `expenseCategoryBreakdown`, all called directly from that transport,
 * not duplicated here) — but no list RPC for PaymentVoucher itself, so
 * this reads directly against the table. RLS already scopes it correctly
 * (`view` on `expense` — app/backend/schema.sql line ~5557).
 */
import { supabase } from "./supabaseClient";
import type { PaymentVoucher, PaymentVoucherRow } from "@aifa/core/sync/paymentVouchersReportsTransport";

function toPaymentVoucher(row: PaymentVoucherRow): PaymentVoucher {
  return {
    id: row.id,
    businessId: row.business_id,
    pvNo: row.pv_no,
    payeePartyId: row.payee_party_id,
    status: row.status,
    expenseCategory: row.expense_category,
    documentIdReceipt: row.document_id_receipt,
    paymentMethod: row.payment_method,
    issueDate: row.issue_date,
    currency: row.currency,
    grandTotal: row.grand_total,
    notes: row.notes,
    capturedByMembershipId: row.captured_by_membership_id,
    createdAt: row.created_at,
  };
}

export async function listPaymentVouchers(businessId: string): Promise<PaymentVoucher[]> {
  const { data, error } = await supabase
    .from("payment_vouchers")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as PaymentVoucherRow[]).map(toPaymentVoucher);
}
