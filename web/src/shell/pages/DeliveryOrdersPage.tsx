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
 *
 * UI polish Phase 4: presentation only — table with the effective state as a
 * pill, row-select detail for lines, labelled create form. Same calls.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabaseInventoryDeliveryTransport } from "@aifa/core/sync/inventoryDeliveryTransport";
import type { DeliveryOrder, DeliveryOrderLineInput, Warehouse } from "@aifa/core/sync/inventoryDeliveryTransport";
import type { ApprovalTask } from "@aifa/core/sync/approvalEngineTransport";
import type { Invoice } from "@aifa/core/sync/quotationInvoiceTransport";
import type { Product } from "@aifa/core/sync/pricingTransport";

import { Button, Card, DataTable, Field, PageHeader, StatusPill, formatDate, type Column } from "../../ui";
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

  const withState = (orders ?? []).map((o) => ({ order: o, state: effectiveState(o, taskFor(o.id)) }));
  const filtered = withState.filter((x) => tab === "all" || x.state === tab);
  const counts = (state: EffectiveDoState) => withState.filter((x) => x.state === state).length;
  type Row = (typeof withState)[number];
  const expandedOrder = expandedId ? withState.find((x) => x.order.id === expandedId) : undefined;

  const stateTone = (state: EffectiveDoState): "warning" | "info" | "success" | "danger" | "neutral" => {
    switch (state) {
      case "pending_approval":
        return "warning";
      case "approved_awaiting_dispatch":
        return "info";
      case "dispatched":
        return "info";
      case "delivered":
        return "success";
      case "rejected":
        return "danger";
    }
  };

  const columns: Column<Row>[] = [
    {
      key: "do",
      header: "Delivery order",
      render: ({ order }) => (
        <>
          <strong>{order.doNo}</strong>
          <div className="ui-cell-sub">{invoiceLabel(order.invoiceId)}</div>
        </>
      ),
    },
    { key: "wh", header: "Warehouse", render: ({ order }) => warehouseName(order.warehouseId) },
    { key: "issued", header: "Issued", render: ({ order }) => formatDate(order.issueDate) },
    {
      key: "state",
      header: "Status",
      render: ({ state }) => <StatusPill status={state} label={stateLabel(state)} tone={stateTone(state)} />,
    },
    {
      key: "actions",
      header: "",
      render: ({ order, state }) => {
        const busy = busyId === order.id;
        const blockedReason = blockedReasonById[order.id];
        return (
          <span onClick={(e) => e.stopPropagation()}>
            {state === "approved_awaiting_dispatch" && (
              <Button size="sm" variant="primary" loading={busy} onClick={() => void handleDispatch(order)}>
                {busy ? "Dispatching…" : "Dispatch (posts stock now)"}
              </Button>
            )}
            {state === "pending_approval" && (
              <span className="ui-muted">Waiting on approval before this can be dispatched.</span>
            )}
            {state === "dispatched" && (
              <Button size="sm" variant="secondary" loading={busy} onClick={() => void handleMarkDelivered(order)}>
                {busy ? "Marking delivered…" : "Mark Delivered (self-reported)"}
              </Button>
            )}
            {blockedReason && (
              <div className="aifa-alert aifa-alert--danger" role="alert" style={{ marginTop: 6 }}>
                {blockedReason}
              </div>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <div className="aifa-page">
      <PageHeader
        title="Delivery Orders"
        description='A new delivery order routes through the Approvals inbox. Its own status stays "draft" until Dispatch is pressed — this page reads the linked approval task to show the real state.'
        actions={
          <>
            {onGoToApprovals && (
              <Button variant="secondary" onClick={onGoToApprovals}>
                Go to Approvals
              </Button>
            )}
            <Button variant="primary" icon={showCreate ? undefined : "plus"} onClick={() => setShowCreate((s) => !s)}>
              {showCreate ? "Cancel" : "New delivery order"}
            </Button>
          </>
        }
      >
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

      {showCreate && (
        <Card title="New delivery order">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!createBusy && invoiceId && warehouseId) void handleCreate();
            }}
          >
            <div className="ui-form-grid">
              <Field label="Invoice" required>
                {(p) => (
                  <select {...p} className="ui-select" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
                    <option value="">Select invoice…</option>
                    {invoices.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.invoiceNo}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field
                label="Warehouse"
                required
                hint={warehouses.length === 0 ? "No warehouses yet — add one on the Products & Stock page first." : undefined}
              >
                {(p) => (
                  <select {...p} className="ui-select" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                    <option value="">Select warehouse…</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Notes (optional)">
                {(p) => <input {...p} className="ui-input" value={notes} onChange={(e) => setNotes(e.target.value)} />}
              </Field>
            </div>

            <h3 className="ui-section-title">Lines</h3>
            {lines.map((l, idx) => (
              <div key={idx} className="ui-inline-actions" style={{ marginBottom: "var(--aifa-space-2)" }}>
                <select
                  className="ui-select"
                  aria-label={`Line ${idx + 1} product`}
                  value={l.productId}
                  onChange={(e) => updateLine(idx, { productId: e.target.value })}
                  style={{ flex: 1, minWidth: 200 }}
                >
                  <option value="">Select product…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku}){!p.trackInventory ? " — not stock-tracked" : ""}
                    </option>
                  ))}
                </select>
                <input
                  className="ui-input"
                  aria-label={`Line ${idx + 1} quantity`}
                  placeholder="Qty"
                  inputMode="decimal"
                  value={l.quantity}
                  onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                  style={{ width: 90 }}
                />
                {lines.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="x"
                    aria-label={`Remove line ${idx + 1}`}
                    onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                  />
                )}
              </div>
            ))}
            <Button size="sm" variant="secondary" icon="plus" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
              Add line
            </Button>
            <p className="ui-note">
              Lines for a non-stock-tracked product are recorded but silently skipped when stock is actually posted at dispatch.
            </p>

            <div className="ui-form-actions">
              <Button type="submit" variant="primary" loading={createBusy} disabled={!invoiceId || !warehouseId}>
                {createBusy ? "Creating…" : "Create delivery order"}
              </Button>
            </div>
            {createError && (
              <p className="aifa-alert aifa-alert--danger" role="alert">
                {createError}
              </p>
            )}
          </form>
        </Card>
      )}

      {actionError && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {actionError}
        </p>
      )}

      {expandedOrder && (
        <Card
          title={`${expandedOrder.order.doNo} — lines`}
          description={expandedOrder.order.notes ?? undefined}
          actions={
            <Button size="sm" variant="ghost" onClick={() => setExpandedId(null)}>
              Close
            </Button>
          }
        >
          {(linesById[expandedOrder.order.id] ?? []).length === 0 ? (
            <p className="ui-muted" style={{ margin: 0 }}>
              Loading lines…
            </p>
          ) : (
            <ul className="ui-move-list">
              {linesById[expandedOrder.order.id].map((l) => (
                <li key={l.id}>
                  {l.quantity} × {productLabel(l.productId)}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card flush>
        <DataTable
          caption="Delivery orders"
          columns={columns}
          rows={loadError ? [] : orders === null ? null : filtered}
          rowKey={(x) => x.order.id}
          onRowClick={(x) => void toggleExpand(x.order)}
          selectedKey={expandedId}
          empty={<div className="ui-table-state">No delivery orders in this view.</div>}
        />
      </Card>
    </div>
  );
}
