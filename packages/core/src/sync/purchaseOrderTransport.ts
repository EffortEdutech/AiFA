/**
 * Purchase Order entity — Sprint 58 (Phase 5, "Draft-and-Approve Bridge I:
 * Sales & Purchases", 14 September 2026).
 *
 * Mirrors quotationInvoiceTransport.ts's own shape in this same directory
 * deliberately — `create_purchase_order` was written as a direct structural
 * copy of `create_quotation` (same approval-task routing, same
 * draft-first-then-approve posture), so this transport file copies that
 * file's own conventions rather than inventing new ones.
 *
 * APPROVAL NOTE: `createPurchaseOrder` routes through the same real
 * ApprovalTask engine every other document-issuing call in this schema
 * uses (domain='expense' — see the migration's own header for why this PO
 * capture is gated on the existing 'expense' capability domain rather than
 * a new 'purchases' domain). There is no separate approval mechanism here.
 *
 * CHAINING NOTE (Vol_5_5 §9, revised 14 September 2026 — see
 * 00000000000005_sales_direct_invoice_and_po_lifecycle.sql's header):
 * the owner reported a real gap testing this sprint's original scope —
 * a created PO had no sidebar page and its status never advanced past
 * `drafted` regardless of approval outcome, because nothing was wired
 * to react to the approval-task decision. Fixed via a new
 * `sync_purchase_order_on_task_decision` trigger (drafted -> approved
 * or rejected). The originally-planned automatic re-entry into the
 * Channel Intake router as a `stock_receipt_pending`/`payment_due`
 * INTAKE is still not implemented — instead, `confirmPurchaseOrderReceipt`
 * and `markPurchaseOrderPaid` below are explicit owner-triggered actions
 * (mirroring `markPaymentVoucherPaid`'s own explicit-button pattern on
 * PaymentVouchersPage.tsx) rather than an automatic chain, which is a
 * simpler, safer first cut given full-receipt-only scope (see next note).
 *
 * STOCK RECEIPT CONFIRMATION: `confirmPurchaseOrderReceipt` (added
 * 14 September 2026) is FULL RECEIPT ONLY, matching this sprint's own
 * "Safe to Carry Over" deferral of partial-line receiving — it sets
 * every line's `quantity_received` to its full `quantity` and advances
 * status straight to `stock_received_full`. Partial receiving remains
 * a future follow-on, not silently done here.
 *
 * MARK PAID: `markPurchaseOrderPaid` (added 14 September 2026)
 * deliberately reuses the existing Payment Voucher pipeline
 * (`create_payment_voucher` + `mark_payment_voucher_paid`) rather than
 * inventing a new Supplier Bill/Accounts-Payable concept — see the
 * migration's own header for the reasoning and for a disclosed,
 * narrowly-scoped workaround it applies for a separate, pre-existing
 * cross-cutting bug in `create_approval_task`'s auto-approve path.
 */

/** See supabaseTransport.ts's own header comment for why this exists instead of importing `SupabaseClient` from `@supabase/supabase-js` directly. */
export interface SupabaseClientLike {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export type PurchaseOrderStatus =
  | "drafted"
  | "approved"
  | "rejected"
  | "stock_received_partial"
  | "stock_received_full"
  | "paid"
  | "closed";

/** Row shape of public.purchase_order (Sprint 58). */
export interface PurchaseOrderRow {
  id: string;
  business_id: string;
  po_no: string;
  party_id: string;
  status: PurchaseOrderStatus;
  issue_date: string;
  expected_delivery_date: string | null;
  currency: string;
  subtotal: number;
  tax_total: number;
  grand_total: number;
  notes: string | null;
  captured_by_membership_id: string | null;
  created_at: string;
}

export interface PurchaseOrder {
  id: string;
  businessId: string;
  poNo: string;
  partyId: string;
  status: PurchaseOrderStatus;
  issueDate: string;
  expectedDeliveryDate: string | null;
  currency: string;
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  notes: string | null;
  capturedByMembershipId: string | null;
  createdAt: string;
}

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

/** One input line for createPurchaseOrder. Unlike a Quotation line, unitCost is always required — there is no PRICE-001 catalog resolution for what a supplier charges (that's their price, not ours). */
export interface PurchaseOrderLineInput {
  productId?: string | null;
  description: string;
  quantity: number;
  unitCost: number;
}

export interface SupabasePurchaseOrderTransport {
  /**
   * `capture` on `expense` (see this file's header for why). Drafts a
   * Purchase Order + lines and creates a real ApprovalTask
   * (domain='expense', subject_type='purchase_order',
   * onApprovalAction='confirm stock receipt') through the existing
   * `create_approval_task` engine — mirrors `createQuotation`'s exact
   * shape. Pass `autoApproved: true` only for the same ≥90%-confidence
   * shortcut every other domain already uses; per Sprint 58's own
   * Dependencies note, a PO's own rule is simpler in practice — "PO
   * always requires approval" — so callers driven by Sprint 57's
   * classifier should pass `autoApproved: false` unconditionally until
   * Sprint 61 generalizes confidence-tiered routing to this domain too.
   */
  createPurchaseOrder(params: {
    businessId: string;
    partyId: string;
    expectedDeliveryDate?: string | null;
    notes?: string | null;
    lines: PurchaseOrderLineInput[];
    aiDraftSummary?: string | null;
    autoApproved?: boolean;
  }): Promise<PurchaseOrder>;

  /**
   * `capture` on `expense`. Full receipt only (see this file's header)
   * — sets every line's quantity_received to its full quantity and
   * advances status from `approved` to `stock_received_full`. Throws
   * `purchase_order_not_approved` if the PO isn't `approved` yet.
   */
  confirmPurchaseOrderReceipt(purchaseOrderId: string): Promise<PurchaseOrder>;

  /**
   * `capture` on `expense`. Requires status `stock_received_full`.
   * Creates and immediately pays a real Payment Voucher for the PO's
   * supplier/amount (reusing the existing Payment Voucher pipeline —
   * see this file's header), then advances the PO to `paid`.
   * `expenseCategory` must match an existing expense-type Chart of
   * Accounts `accountName`, exactly like `createPaymentVoucher` itself
   * requires — this function does not guess one.
   */
  markPurchaseOrderPaid(params: {
    purchaseOrderId: string;
    expenseCategory: string;
    paymentMethod?: "cash" | "bank_transfer" | "cheque";
  }): Promise<PurchaseOrder>;
}

export function createSupabasePurchaseOrderTransport(
  client: SupabaseClientLike,
): SupabasePurchaseOrderTransport {
  return {
    async createPurchaseOrder(params) {
      const { data, error } = await client.rpc("create_purchase_order", {
        p_business_id: params.businessId,
        p_party_id: params.partyId,
        p_expected_delivery_date: params.expectedDeliveryDate ?? null,
        p_notes: params.notes ?? null,
        p_lines: params.lines.map((l) => ({
          product_id: l.productId ?? null,
          description: l.description,
          quantity: l.quantity,
          unit_cost: l.unitCost,
        })),
        p_ai_draft_summary: params.aiDraftSummary ?? null,
        p_auto_approved: params.autoApproved ?? false,
      });
      if (error) throw error;
      return toPurchaseOrder(data as PurchaseOrderRow);
    },

    async confirmPurchaseOrderReceipt(purchaseOrderId) {
      const { data, error } = await client.rpc("confirm_purchase_order_receipt", {
        p_purchase_order_id: purchaseOrderId,
      });
      if (error) throw error;
      return toPurchaseOrder(data as PurchaseOrderRow);
    },

    async markPurchaseOrderPaid(params) {
      const { data, error } = await client.rpc("mark_purchase_order_paid", {
        p_purchase_order_id: params.purchaseOrderId,
        p_expense_category: params.expenseCategory,
        p_payment_method: params.paymentMethod ?? "bank_transfer",
      });
      if (error) throw error;
      return toPurchaseOrder(data as PurchaseOrderRow);
    },
  };
}
