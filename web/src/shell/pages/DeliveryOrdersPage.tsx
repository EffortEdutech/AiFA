/**
 * Delivery Orders — Sprint 42 (Vol 13_0 §7 Module D).
 *
 * APPROVAL-STATE NOTE (this sprint's own DoD, and
 * inventoryDeliveryTransport.ts's own header): `DeliveryOrder.status`
 * NEVER holds `'approved'` — it stays `'draft'` both while the linked
 * ApprovalTask is still pending AND after that task resolves approved
 * but before Dispatch is actually pressed. Showing `do.status` alone
 * would read as "draft" in both of those very different situations
 * (one blocked, one ready-to-dispatch) — so this page cross-references
 * `listApprovalTasks` (subjectType === "delivery_order") to compute a
 * real effective state per DO, the same posture QuotationsPage already
 * disclosed for Quotation (Sprint 40) but made explicit here per this
 * sprint's own DoD item.
 *
 * DISPATCH NOTE: `dispatchDeliveryOrder` is the only call that moves
 * stock. It throws `delivery_order_not_yet_approved` if the linked
 * task hasn't resolved approved, and an insufficient-stock error if
 * any stock-tracked line doesn't have enough quantity_on_hand — this
 * page surfaces both as a clear, specific blocked-reason rather than a
 * generic failure message.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabaseInventoryDeliveryTransport } from "@aifa/core/sync/inventoryDeliveryTransport";
import type { DeliveryOrder, DeliveryOrderLineInput, Warehouse } from "@aifa/core/sync/inventoryDeliveryTransport";
import type { ApprovalTask } from "@aifa/core/sync/approvalEngineTransport";
import type { Invoice } from "@aifa/core/sync/quotationInvoiceTransport";
import type { Product } from "@aifa/core/sync/pricingTransport";

import { supabase } from "../../lib/supabaseClient";
import { listApprovalTasks } from "../../lib/approvals";
import { listInvoices } from "../../lib/salesCycle";
import { listProducts } from "../../lib/productsAndPricing";
import { listWarehouses, listDeliveryOrders, listDeliveryOrderLines } from "../../lib/inventoryAndDelivery";
import type { DeliveryOrderLine } from "../../lib/inventoryAndDelivery";
import { TabStrip } from "../TabStrip";

const inventoryDeliveryTransport = createSupabaseInventoryDeliveryTransport(supabase);

/** Effective state computed from status + the linked ApprovalTask — see this file's own header note. */
type EffectiveDoState =
  | "pending_approval"
  | "approved_awaiting_dispatch"
  | "dispatched"
  | "delivered"
  | "rejected";

type DoTab = "all" | EffectiveDoState;

interface Props {
  businessId: string;
  onGoToApprovals?: () => void;
}

interface DraftLine {
  productId: string;
  quantity: string;
}

function emptyLine(): DraftLine {
  return { productId: "", quantity: "1" };
}

function effectiveState(order: DeliveryOrder, task: ApprovalTask | undefined): EffectiveDoState {
  if (order.status === "dispatched") return "dispatched";
  if (order.status === "delivered") return "delivered";
  if (order.status === "rejected") return "rejected";
  // order.status === "draft" from here — disambiguate using the linked task.
  if (task?.status === "approved" || task?.status === "auto_approved") return "approved_awaiting_dispatch";
  if (task?.status === "rejected") return "rejected";
  return "pending_approval";
}

function stateLabel(state: EffectiveDoState): string {
  switch (state) {
    case "pending_approval":
      return "Pending approval";
    case "approved_awaiting_dispatch":
      return "Approved — awaiting dispatch";
    case "dispatched":
      return "Dispatched";
    case "delivered":
      return "Delivered";
    case "rejected":
      return "Rejected";
  }
}

export function DeliveryOrdersPage({ businessId, onGoToApprovals }: Props): JSX.Element {
  const [orders, setOrders] = useState<DeliveryOrder[] | null>(null);
  const [tasks, setTasks] = useState<ApprovalTask[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<DoTab>("all");

  const [showCreate, setShowCreate] = useState(false);
  const [invoiceId, setInvoiceId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [linesById, setLinesById] = useState<Record<string, DeliveryOrderLine[]>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [blockedReasonById, setBlockedReasonById] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [o, t, inv, w, p] = await Promise.all([
        listDeliveryOrders(businessId),
        listApprovalTasks(businessId),
        listInvoices(businessId),
        listWarehouses(businessId),
        listProducts(businessId),
      ]);
      setOrders(o);
      setTasks(t.filter((task) => task.subjectType === "delivery_order"));
      setInvoices(inv);
      setWarehouses(w);
      setProducts(p);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load delivery orders.");
    }
  }, [businessId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  function taskFor(orderId: string): ApprovalTask | undefined {
    // A DO's task, if more than one somehow exists (shouldn't per the RPC), take the latest by createdAt.
    return tasks
      .filter((t) => t.subjectId === orderId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  }

  function invoiceLabel(id: string): string {
    const inv = invoices.find((i) => i.id === id);
    return inv ? inv.invoiceNo : `Invoice #${id.slice(0, 8)}`;
  }

  function warehouseName(id: string): string {
    return warehouses.find((w) => w.id === id)?.name ?? `Warehouse #${id.slice(0, 8)}`;
  }

  function productLabel(id: string): string {
    const p = products.find((pr) => pr.id === id);
    return p ? `${p.name} (${p.sku})` : `Product #${id.slice(0, 8)}`;
  }

  function updateLine(idx: number, patch: Partial<DraftLine>): void {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function handleCreate(): Promise<void> {
    if (!invoiceId || !warehouseId) return;
    const parsedLines: DeliveryOrderLineInput[] = [];
    for (const l of lines) {
      if (!l.productId) continue;
      parsedLines.push({ productId: l.productId, quantity: Number(l.quantity) || 1 });
    }
    if (parsedLines.length === 0) {
      setCreateError("Add at least one line.");
      return;
    }
    setCreateBusy(true);
    setCreateError(null);
    try {
      await inventoryDeliveryTransport.createDeliveryOrder({
        businessId,
        invoiceId,
        warehouseId,
        lines: parsedLines,
        notes: notes.trim() || null,
      });
      setInvoiceId("");
      setWarehouseId("");
      setNotes("");
      setLines([emptyLine()]);
      setShowCreate(false);
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create this delivery order.";
      setCreateError(
        message.includes("invoice_already_has_a_delivery_order")
          ? "This invoice already has a delivery order — each invoice can only have one."
          : message,
      );
    } finally {
      setCreateBusy(false);
    }
  }

  async function toggleExpand(order: DeliveryOrder): Promise<void> {
    if (expandedId === order.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(order.id);
    if (!linesById[order.id]) {
      try {
        const l = await listDeliveryOrderLines(order.id);
        setLinesById((prev) => ({ ...prev, [order.id]: l }));
      } catch {
        // line detail is a nice-to-have on expand; leave silently empty on failure
      }
    }
  }

  async function handleDispatch(order: DeliveryOrder): Promise<void> {
    setBusyId(order.id);
    setActionError(null);
    setBlockedReasonById((prev) => ({ ...prev, [order.id]: "" }));
    try {
      await inventoryDeliveryTransport.dispatchDeliveryOrder(order.id);
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not dispatch this delivery order.";
      let reason = message;
      if (message.includes("delivery_order_not_yet_approved")) {
        reason = "Blocked: this delivery order hasn't been approved yet — check the Approvals inbox.";
      } else if (message.toLowerCase().includes("stock") || message.toLowerCase().includes("insufficient")) {
        reason = "Blocked: not enough stock on hand at this warehouse for one or more lines.";
      }
      setBlockedReasonById((prev) => ({ ...prev, [order.id]: reason }));
    } finally {
      setBusyId(null);
    }
  }

  async function handleMarkDelivered(order: DeliveryOrder): Promise<void> {
    setBusyId(order.id);
    setActionError(null);
    try {
      await inventoryDeliveryTransport.markDeliveryOrderDelivered(order.id);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not mark this delivery order delivered.");
    } finally {
      setBusyId(null);
    }
  }

  if (loadError) {
    return (
      <div className="aifa-page">
        <h1>Delivery Orders</h1>
        <p className="error">{loadError}</p>
      </div>
    );
  }

  const withState = (orders ?? []).map((o) => ({ order: o, state: effectiveState(o, taskFor(o.id)) }));
  const filtered = withState.filter((x) => tab === "all" || x.state === tab);
  const counts = (state: EffectiveDoState) => withState.filter((x) => x.state === state).length;

  return (
    <div className="aifa-page">
      <h1>Delivery Orders</h1>
      <TabStrip
        tabs={[
          { id: "all", label: "All", count: withState.length },
          { id: "pending_approval", label: "Pending approval", count: counts("pending_approval") },
          { id: "approved_awaiting_dispatch", label: "Approved — awaiting dispatch", count: counts("approved_awaiting_dispatch") },
          { id: "dispatched", label: "Dispatched", count: counts("dispatched") },
          { id: "delivered", label: "Delivered", count: counts("delivered") },
          { id: "rejected", label: "Rejected", count: counts("rejected") },
        ]}
        active={tab}
        onChange={setTab}
      />

      <p className="muted" style={{ margin: "8px 0" }}>
        A new delivery order routes through the Approvals inbox. Its own status stays "draft" until Dispatch is
        pressed — this page reads the linked approval task to show the real state.{" "}
        {onGoToApprovals ? (
          <button onClick={onGoToApprovals} style={{ padding: "0 4px" }}>
            Go to Approvals
          </button>
        ) : (
          "See the Approvals sidebar item."
        )}
      </p>

      <div className="row" style={{ margin: "12px 0" }}>
        <button onClick={() => setShowCreate((s) => !s)}>{showCreate ? "Cancel" : "New delivery order"}</button>
      </div>

      {showCreate && (
        <div className="card">
          <h2 style={{ fontSize: 16, marginTop: 0 }}>New delivery order</h2>
          <div className="row">
            <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} style={{ padding: 6, minWidth: 220 }}>
              <option value="">Select invoice…</option>
              {invoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.invoiceNo}
                </option>
              ))}
            </select>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} style={{ padding: 6, minWidth: 180 }}>
              <option value="">Select warehouse…</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          {warehouses.length === 0 && (
            <p className="muted" style={{ marginTop: 4 }}>
              No warehouses yet — add one on the Products &amp; Stock page first.
            </p>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ padding: 6, flex: 1 }} />
          </div>

          <h3 style={{ fontSize: 14, marginTop: 12, marginBottom: 4 }}>Lines</h3>
          {lines.map((l, idx) => (
            <div key={idx} className="row" style={{ marginTop: 4 }}>
              <select value={l.productId} onChange={(e) => updateLine(idx, { productId: e.target.value })} style={{ padding: 6, minWidth: 220 }}>
                <option value="">Select product…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.sku}){!p.trackInventory ? " — not stock-tracked" : ""}
                  </option>
                ))}
              </select>
              <input placeholder="Qty" value={l.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} style={{ padding: 6, width: 70 }} />
              {lines.length > 1 && (
                <button onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))} style={{ padding: "0 6px" }}>
                  ✕
                </button>
              )}
            </div>
          ))}
          <div className="row" style={{ marginTop: 6 }}>
            <button onClick={() => setLines((prev) => [...prev, emptyLine()])}>Add line</button>
          </div>
          <p className="muted" style={{ marginTop: 4 }}>
            Lines for a non-stock-tracked product are recorded but silently skipped when stock is actually posted at dispatch.
          </p>

          <div className="row" style={{ marginTop: 10 }}>
            <button onClick={() => void handleCreate()} disabled={createBusy || !invoiceId || !warehouseId}>
              {createBusy ? "Creating…" : "Create delivery order"}
            </button>
          </div>
          {createError && <p className="error">{createError}</p>}
        </div>
      )}

      {actionError && <p className="error">{actionError}</p>}

      {orders === null ? (
        <p className="muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">No delivery orders in this view.</p>
      ) : (
        filtered.map(({ order, state }) => {
          const busy = busyId === order.id;
          const expanded = expandedId === order.id;
          const blockedReason = blockedReasonById[order.id];
          return (
            <div key={order.id} className="card">
              <div className="row" style={{ justifyContent: "space-between", cursor: "pointer" }} onClick={() => void toggleExpand(order)}>
                <strong>
                  {order.doNo} — {invoiceLabel(order.invoiceId)}
                </strong>
                <span className="muted">{stateLabel(state)}</span>
              </div>
              <p className="muted" style={{ margin: "4px 0" }}>
                {warehouseName(order.warehouseId)} · issued {order.issueDate}
              </p>
              {order.notes && <p style={{ margin: "4px 0" }}>{order.notes}</p>}
              {expanded && (
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--aifa-border, #e2e2e2)" }}>
                  {(linesById[order.id] ?? []).length === 0 ? (
                    <p className="muted">Loading lines…</p>
                  ) : (
                    linesById[order.id].map((l) => (
                      <p key={l.id} className="muted" style={{ margin: "2px 0" }}>
                        {l.quantity} × {productLabel(l.productId)}
                      </p>
                    ))
                  )}
                </div>
              )}

              <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
                {state === "approved_awaiting_dispatch" && (
                  <button onClick={() => void handleDispatch(order)} disabled={busy}>
                    {busy ? "Dispatching…" : "Dispatch (posts stock now)"}
                  </button>
                )}
                {state === "pending_approval" && (
                  <span className="muted">Waiting on approval before this can be dispatched.</span>
                )}
                {state === "dispatched" && (
                  <button onClick={() => void handleMarkDelivered(order)} disabled={busy}>
                    {busy ? "Marking delivered…" : "Mark Delivered (self-reported)"}
                  </button>
                )}
              </div>
              {blockedReason && <p className="error" style={{ marginTop: 6 }}>{blockedReason}</p>}
            </div>
          );
        })
      )}
    </div>
  );
}
