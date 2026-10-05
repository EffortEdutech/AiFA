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
 *
 * UI polish Phase 4: presentation only — shared header, table with status
 * pills / stat tiles, labelled fields. Same calls, gating and copy.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabasePurchaseOrderTransport } from "@aifa/core/sync/purchaseOrderTransport";
import type { PurchaseOrder, PurchaseOrderStatus } from "@aifa/core/sync/purchaseOrderTransport";
import type { Party } from "@aifa/core/sync/partyAndLedgerTransport";
import type { ChartOfAccount } from "@aifa/core/sync/partyAndLedgerTransport";

import { Button, Card, DataTable, PageHeader, StatusPill, formatDate, formatMoney, humanizeStatus, type Column } from "../../ui";
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

  const filtered = (orders ?? []).filter((po) => tab === "all" || po.status === tab);
  const counts = (status: PurchaseOrderStatus) => (orders ?? []).filter((po) => po.status === status).length;

  const columns: Column<PurchaseOrder>[] = [
    {
      key: "po",
      header: "Purchase order",
      render: (po) => (
        <>
          <strong>{po.poNo}</strong>
          <div className="ui-cell-sub">{partyName(po.partyId)}</div>
          {po.notes && <div className="ui-cell-sub">{po.notes}</div>}
        </>
      ),
    },
    { key: "issued", header: "Issued", render: (po) => formatDate(po.issueDate) },
    { key: "exp", header: "Expected", render: (po) => (po.expectedDeliveryDate ? formatDate(po.expectedDeliveryDate) : "—") },
    {
      key: "status",
      header: "Status",
      render: (po) => (
        <StatusPill
          status={po.status}
          label={po.status === "stock_received_full" ? "Stock received (full)" : humanizeStatus(po.status)}
        />
      ),
    },
    {
      key: "total",
      header: "Total",
      numeric: true,
      render: (po) => (po.currency === "MYR" ? formatMoney(po.grandTotal) : `${po.currency} ${po.grandTotal.toFixed(2)}`),
    },
    {
      key: "actions",
      header: "",
      render: (po) => {
        const busy = busyId === po.id;
        if (po.status === "approved") {
          return (
            <Button size="sm" variant="secondary" loading={busy} onClick={() => void handleConfirmReceipt(po)}>
              {busy ? "Confirming…" : "Mark stock received (full)"}
            </Button>
          );
        }
        if (po.status === "stock_received_full") {
          return (
            <span className="ui-inline-actions">
              <select
                className="ui-select"
                aria-label={`Expense category for ${po.poNo}`}
                value={payExpenseCategoryById[po.id] ?? ""}
                onChange={(e) => setPayExpenseCategoryById((prev) => ({ ...prev, [po.id]: e.target.value }))}
                style={{ minWidth: 170 }}
              >
                <option value="">Select expense category…</option>
                {expenseAccounts.map((a) => (
                  <option key={a.id} value={a.accountName}>
                    {a.accountName}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="primary" loading={busy} disabled={!payExpenseCategoryById[po.id]} onClick={() => void handleMarkPaid(po)}>
                {busy ? "Marking paid…" : "Mark Paid"}
              </Button>
            </span>
          );
        }
        return null;
      },
    },
  ];

  const needsCategoryHint = (orders ?? []).some((po) => po.status === "stock_received_full") && expenseAccounts.length === 0;

  return (
    <div className="aifa-page">
      <PageHeader
        title="Purchase Orders"
        description="A new purchase order routes through the Approvals inbox before it can advance."
        actions={
          onGoToApprovals ? (
            <Button variant="secondary" onClick={onGoToApprovals}>
              Go to Approvals
            </Button>
          ) : undefined
        }
      >
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
      </PageHeader>
      {!onGoToApprovals && (
        <p className="ui-muted" style={{ marginTop: 0 }}>
          See the Approvals sidebar item.
        </p>
      )}

      {loadError && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {loadError}
        </p>
      )}
      {actionError && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {actionError}
        </p>
      )}
      {needsCategoryHint && (
        <p className="aifa-alert aifa-alert--warning">
          No expense-type accounts found in your Chart of Accounts yet — add one there first.
        </p>
      )}

      <Card flush>
        <DataTable
          caption="Purchase orders"
          columns={columns}
          rows={loadError ? [] : orders === null ? null : filtered}
          rowKey={(po) => po.id}
          empty={<div className="ui-table-state">No purchase orders in this view.</div>}
        />
      </Card>
    </div>
  );
}
