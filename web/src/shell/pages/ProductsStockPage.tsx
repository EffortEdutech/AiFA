/**
 * Products & Stock — Sprint 42 (Vol 13_0 §7 Module D).
 *
 * DISCLOSED IA RESOLUTION: this sprint's own doc suggests stock-on-hand
 * should be "a tab [on] Sprint 39's Product detail page, not a separate
 * top-level page." But `sidebarConfig.ts` (Sprint 37's own single
 * source of truth for the sidebar) already commits "Products & Stock" as
 * its own top-level item under the Inventory *section*, gated on the
 * `inventory` domain — distinct from Sprint 39's "Pricing & Catalog"
 * item, gated on `pricing`. That distinction is not cosmetic: per the
 * seed role templates (schema.sql's Section 5), Warehouse Staff holds
 * `view`/`capture` on `inventory` but has NO grant on `pricing` at all
 * — embedding stock into the Pricing & Catalog page would make it
 * invisible to the one role whose whole job is inventory. This page
 * therefore stays a real top-level sidebar item, gated correctly, and
 * simply reuses Sprint 39's `listProducts` for the product list rather
 * than duplicating product CRUD.
 *
 * UI polish Phase 4: presentation only — warehouse chips, a stock matrix
 * table and a labelled warehouse form. Same calls.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabaseInventoryDeliveryTransport } from "@aifa/core/sync/inventoryDeliveryTransport";
import type { Warehouse, StockLevel } from "@aifa/core/sync/inventoryDeliveryTransport";
import type { Product } from "@aifa/core/sync/pricingTransport";

import { Button, Card, DataTable, EmptyState, Field, PageHeader, type Column } from "../../ui";
import { supabase } from "../../lib/supabaseClient";
import { listProducts } from "../../lib/productsAndPricing";
import { listWarehouses, listStockLevels } from "../../lib/inventoryAndDelivery";

const inventoryDeliveryTransport = createSupabaseInventoryDeliveryTransport(supabase);

interface Props {
  businessId: string;
}

export function ProductsStockPage({ businessId }: Props): JSX.Element {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [stockLevels, setStockLevels] = useState<StockLevel[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showAddWarehouse, setShowAddWarehouse] = useState(false);
  const [warehouseName, setWarehouseName] = useState("");
  const [warehouseBusy, setWarehouseBusy] = useState(false);
  const [warehouseError, setWarehouseError] = useState<string | null>(null);

  const [openingFor, setOpeningFor] = useState<{ productId: string; warehouseId: string } | null>(null);
  const [openingQty, setOpeningQty] = useState("");
  const [openingBusy, setOpeningBusy] = useState(false);
  const [openingError, setOpeningError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [p, w, s] = await Promise.all([
        listProducts(businessId),
        listWarehouses(businessId),
        listStockLevels(businessId),
      ]);
      setProducts(p);
      setWarehouses(w);
      setStockLevels(s);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load products/stock.");
    }
  }, [businessId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function handleAddWarehouse(): Promise<void> {
    if (!warehouseName.trim()) return;
    setWarehouseBusy(true);
    setWarehouseError(null);
    try {
      await inventoryDeliveryTransport.createWarehouse({ businessId, name: warehouseName.trim() });
      setWarehouseName("");
      setShowAddWarehouse(false);
      await load();
    } catch (err) {
      setWarehouseError(err instanceof Error ? err.message : "Could not create warehouse.");
    } finally {
      setWarehouseBusy(false);
    }
  }

  async function handleRecordOpening(): Promise<void> {
    if (!openingFor || !openingQty.trim()) return;
    setOpeningBusy(true);
    setOpeningError(null);
    try {
      await inventoryDeliveryTransport.recordOpeningStock({
        businessId,
        productId: openingFor.productId,
        warehouseId: openingFor.warehouseId,
        quantity: Number(openingQty),
      });
      setOpeningFor(null);
      setOpeningQty("");
      await load();
    } catch (err) {
      setOpeningError(err instanceof Error ? err.message : "Could not record opening stock.");
    } finally {
      setOpeningBusy(false);
    }
  }

  function levelFor(productId: string, warehouseId: string): StockLevel | undefined {
    return stockLevels.find((s) => s.productId === productId && s.warehouseId === warehouseId);
  }

  const trackedProducts = (products ?? []).filter((p) => p.trackInventory);

  const columns: Column<Product>[] = [
    {
      key: "product",
      header: "Product",
      render: (p) => (
        <>
          <strong>{p.name}</strong>
          <div className="ui-cell-sub">{p.sku}</div>
        </>
      ),
    },
    ...warehouses.map(
      (w): Column<Product> => ({
        key: w.id,
        header: w.name,
        numeric: true,
        render: (p) => {
          const level = levelFor(p.id, w.id);
          const isOpeningTarget = openingFor?.productId === p.id && openingFor?.warehouseId === w.id;
          if (level) return level.quantityOnHand;
          if (isOpeningTarget) {
            return (
              <span className="ui-inline-actions" style={{ justifyContent: "flex-end" }}>
                <input
                  className="ui-input"
                  aria-label={`Opening quantity for ${p.name} in ${w.name}`}
                  placeholder="Qty"
                  inputMode="decimal"
                  value={openingQty}
                  onChange={(e) => setOpeningQty(e.target.value)}
                  style={{ width: 80 }}
                />
                <Button size="sm" variant="primary" loading={openingBusy} disabled={!openingQty.trim()} onClick={() => void handleRecordOpening()}>
                  Save
                </Button>
              </span>
            );
          }
          return (
            <Button size="sm" variant="secondary" onClick={() => setOpeningFor({ productId: p.id, warehouseId: w.id })}>
              Set opening stock
            </Button>
          );
        },
      }),
    ),
  ];

  return (
    <div className="aifa-page">
      <PageHeader
        title="Products & Stock"
        description="Stock on hand per product and warehouse."
        actions={
          <Button variant="primary" icon={showAddWarehouse ? undefined : "plus"} onClick={() => setShowAddWarehouse((s) => !s)}>
            {showAddWarehouse ? "Cancel" : "Warehouse"}
          </Button>
        }
      />

      {loadError && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {loadError}
        </p>
      )}

      {showAddWarehouse && (
        <Card title="New warehouse">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!warehouseBusy && warehouseName.trim()) void handleAddWarehouse();
            }}
          >
            <Field
              label="Warehouse name"
              required
              hint="Creating a warehouse requires `configure` on `inventory` — only the Owner role holds that by default; the server will reject this otherwise."
              error={warehouseError}
            >
              {(p) => <input {...p} className="ui-input" value={warehouseName} onChange={(e) => setWarehouseName(e.target.value)} />}
            </Field>
            <div className="ui-form-actions">
              <Button type="submit" variant="primary" loading={warehouseBusy} disabled={!warehouseName.trim()}>
                {warehouseBusy ? "Creating…" : "Create"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {warehouses.length > 0 && (
        <p className="ui-inline-actions" style={{ marginTop: 0 }}>
          <span className="ui-muted">Warehouses:</span>
          {warehouses.map((w) => (
            <span key={w.id} className="ui-chip">
              {w.name}
            </span>
          ))}
        </p>
      )}

      {openingError && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {openingError}
        </p>
      )}

      {warehouses.length === 0 ? (
        <Card>
          <EmptyState title="No warehouses yet" description="Add a warehouse above before recording stock." />
        </Card>
      ) : (
        <Card flush>
          <DataTable
            caption="Stock on hand by product and warehouse"
            columns={columns}
            rows={loadError ? [] : products === null ? null : trackedProducts}
            rowKey={(p) => p.id}
            empty={
              <EmptyState
                title="No stock-tracked products yet"
                description='Add one on the Pricing & Catalog page and enable "track inventory."'
              />
            }
          />
        </Card>
      )}
    </div>
  );
}
