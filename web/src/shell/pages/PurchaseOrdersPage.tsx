/**
 * Purchase Orders — Sprint 58 follow-on (14 September 2026, "finish
 * Purchases properly"). Mirrors PaymentVouchersPage.tsx's own shape
 * (TabStrip across statuses, card list, status-gated action buttons,
 * "Go to Approvals" link) — this is this schema's established pattern
 * for a draft->approve->lifecycle page, not a new UI convention.
 *
 * WHY THIS PAGE EXISTS: the owner reported that a captured/generated
 * Purchase Order "can only be viewed on the Approvals [page] and there
 * is no Purchase Order at the sidebar" — sidebarConfig.ts's
 * "Purchases & Cash" section previously had no PO item at all. This
 * page is the fix, paired with the new `purchase-orders` sidebar item
 * and `AppShell.tsx` case.
 *
 * ACTIONS NOTE: "Mark stock received" is FULL RECEIPT ONLY (see
 * purchaseOrderTransport.ts's own header) — gated on status==='approved'.
 * "Mark Paid" requires status==='stock_received_full' and needs an
 * expense category (must match an existing expense-type Chart of
 * Accounts entry, exactly like the Payment Vouchers create form) since
 * it creates and immediately pays a real Payment Voucher under the
 * hood — reusing that pipeline rather than inventing a new one.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabasePurchaseOrderTransport } from "@aifa/core/sync/purchaseOrderTransport";
import type { PurchaseOrder, PurchaseOrderStatus } from "@aifa/core/sync/purchaseOrderTransport";
import type { Party } from "@aifa/core/sync/partyAndLedgerTransport";
import type { ChartOfAccount } from "@aifa/core/sync/partyAndLedgerTransport";

import { supabase } from "../../lib/supabaseClient";
import { listParties, listChartOfAccounts } from "../../lib/partiesAndAccounts";
import { listPurchaseOrders } from "../../lib/purchaseOrders";
import { TabStrip } from "../TabStrip";

const purchaseOrderTransport = createSupabasePurchaseOrderTransport(supabase);

type PoTab = "all" | PurchaseOrderStatus;

interface Props {
  businessId: string;
  onGoToApprovals?: () => void;
}

export function PurchaseOrdersPage({ businessId, onGoToApprovals }: Props): JSX.Element {
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<ChartOfAccount[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<PoTab>("all");

  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [payExpenseCategoryById, setPayExpenseCategoryById] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [po, p, accounts] = await Promise.all([
        listPurchaseOrders(businessId),
        listParties(businessId),
        listChartOfAccounts(businessId),
      ]);
      setOrders(po);
      setParties(p);
      setExpenseAccounts(accounts.filter((a) => a.accountType === "expense"));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load purchase orders.");
    }
  }, [businessId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  function partyName(id: string): string {
    return parties.find((p) => p.id === id)?.displayName ?? `Party #${id.slice(0, 8)}`;
  }

  async function handleConfirmReceipt(po: PurchaseOrder): Promise<void> {
    setBusyId(po.id);
    setActionError(null);
    try {
      await purchaseOrderTransport.confirmPurchaseOrderReceipt(po.id);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not confirm stock receipt.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleMarkPaid(po: PurchaseOrder): Promise<void> {
    const expenseCategory = payExpenseCategoryById[po.id];
    if (!expenseCategory) {
      setActionError("Pick an expense category for this purchase order first.");
      return;
    }
    setBusyId(po.id);
    setActionError(null);
    try {
      await purchaseOrderTransport.markPurchaseOrderPaid({ purchaseOrderId: po.id, expenseCategory });
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not mark this purchase order paid.");
    } finally {
      setBusyId(null);
    }
  }

  if (loadError) {
    return (
      <div className="aifa-page">
        <h1>Purchase Orders</h1>
        <p className="error">{loadError}</p>
      </div>
    );
  }

  const filtered = (orders ?? []).filter((po) => tab === "all" || po.status === tab);
  const counts = (status: PurchaseOrderStatus) => (orders ?? []).filter((po) => po.status === status).length;

  return (
    <div className="aifa-page">
      <h1>Purchase Orders</h1>
      <TabStrip
        tabs={[
          { id: "all", label: "All", count: orders?.length },
          { id: "drafted", label: "Drafted", count: counts("drafted") },
          { id: "approved", label: "Approved", count: counts("approved") },
          { id: "stock_received_full", label: "Stock Received", count: counts("stock_received_full") },
          { id: "paid", label: "Paid", count: counts("paid") },
          { id: "rejected", label: "Rejected", count: counts("rejected") },
        ]}
        active={tab}
        onChange={setTab}
      />

      <p className="muted" style={{ margin: "8px 0" }}>
        A new purchase order routes through the Approvals inbox before it can advance.{" "}
        {onGoToApprovals ? (
          <button onClick={onGoToApprovals} style={{ padding: "0 4px" }}>
            Go to Approvals
          </button>
        ) : (
          "See the Approvals sidebar item."
        )}
      </p>

      {actionError && <p className="error">{actionError}</p>}

      {orders === null ? (
        <p className="muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">No purchase orders in this view.</p>
      ) : (
        filtered.map((po) => {
          const busy = busyId === po.id;
          return (
            <div key={po.id} className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>
                  {po.poNo} — {partyName(po.partyId)}
                </strong>
                <span
                  className="muted"
                  style={po.status === "paid" ? { color: "#1b7a3d", fontWeight: 600 } : undefined}
                >
                  {po.status === "stock_received_full" ? "Stock received (full)" : po.status}
                </span>
              </div>
              <p className="muted" style={{ margin: "4px 0" }}>
                {po.currency} {po.grandTotal.toFixed(2)} · issued {po.issueDate}
                {po.expectedDeliveryDate ? ` · expected ${po.expectedDeliveryDate}` : ""}
              </p>
              {po.notes && <p style={{ margin: "4px 0" }}>{po.notes}</p>}

              {po.status === "approved" && (
                <div className="row" style={{ marginTop: 6 }}>
                  <button onClick={() => void handleConfirmReceipt(po)} disabled={busy}>
                    {busy ? "Confirming…" : "Mark stock received (full)"}
                  </button>
                </div>
              )}

              {po.status === "stock_received_full" && (
                <div className="row" style={{ marginTop: 6, flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <select
                    value={payExpenseCategoryById[po.id] ?? ""}
                    onChange={(e) =>
                      setPayExpenseCategoryById((prev) => ({ ...prev, [po.id]: e.target.value }))
                    }
                    style={{ padding: 6, minWidth: 180 }}
                  >
                    <option value="">Select expense category…</option>
                    {expenseAccounts.map((a) => (
                      <option key={a.id} value={a.accountName}>
                        {a.accountName}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => void handleMarkPaid(po)} disabled={busy || !payExpenseCategoryById[po.id]}>
                    {busy ? "Marking paid…" : "Mark Paid"}
                  </button>
                </div>
              )}
              {po.status === "stock_received_full" && expenseAccounts.length === 0 && (
                <p className="muted" style={{ marginTop: 4 }}>
                  No expense-type accounts found in your Chart of Accounts yet — add one there first.
                </p>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
