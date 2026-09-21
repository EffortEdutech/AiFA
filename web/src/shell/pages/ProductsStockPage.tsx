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
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabaseInventoryDeliveryTransport } from "@aifa/core/sync/inventoryDeliveryTransport";
import type { Warehouse, StockLevel } from "@aifa/core/sync/inventoryDeliveryTransport";
import type { Product } from "@aifa/core/sync/pricingTransport";

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

  if (loadError) {
    return (
      <div className="aifa-page">
        <h1>Products &amp; Stock</h1>
        <p className="error">{loadError}</p>
      </div>
    );
  }

  const trackedProducts = (products ?? []).filter((p) => p.trackInventory);

  return (
    <div className="aifa-page">
      <h1>Products &amp; Stock</h1>

      <h2 style={{ fontSize: 14, marginTop: 0 }}>Warehouses</h2>
      <div className="row" style={{ flexWrap: "wrap", marginBottom: 8 }}>
        {warehouses.map((w) => (
          <span key={w.id} className="muted" style={{ padding: "2px 8px", border: "1px solid var(--aifa-border, #e2e2e2)", borderRadius: 4 }}>
            {w.name}
          </span>
        ))}
        <button onClick={() => setShowAddWarehouse((s) => !s)} style={{ padding: "2px 8px" }}>
          {showAddWarehouse ? "Cancel" : "+ Warehouse"}
        </button>
      </div>
      {showAddWarehouse && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="row">
            <input placeholder="Warehouse name" value={warehouseName} onChange={(e) => setWarehouseName(e.target.value)} style={{ padding: 6, flex: 1 }} />
            <button onClick={() => void handleAddWarehouse()} disabled={warehouseBusy || !warehouseName.trim()}>
              {warehouseBusy ? "Creating…" : "Create"}
            </button>
          </div>
          <p className="muted" style={{ marginTop: 4 }}>
            Creating a warehouse requires `configure` on `inventory` — only the Owner role holds that by default; the server will reject this otherwise.
          </p>
          {warehouseError && <p className="error">{warehouseError}</p>}
        </div>
      )}

      {warehouses.length === 0 ? (
        <p className="muted">Add a warehouse above before recording stock.</p>
      ) : products === null ? (
        <p className="muted">Loading…</p>
      ) : trackedProducts.length === 0 ? (
        <p className="muted">No stock-tracked products yet — add one on the Pricing &amp; Catalog page and enable "track inventory."</p>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: 6 }}>Product</th>
                {warehouses.map((w) => (
                  <th key={w.id} style={{ padding: 6 }}>
                    {w.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trackedProducts.map((p) => (
                <tr key={p.id} style={{ borderTop: "1px solid var(--aifa-border, #e2e2e2)" }}>
                  <td style={{ padding: 6 }}>
                    {p.name} <span className="muted">({p.sku})</span>
                  </td>
                  {warehouses.map((w) => {
                    const level = levelFor(p.id, w.id);
                    const isOpeningTarget = openingFor?.productId === p.id && openingFor?.warehouseId === w.id;
                    return (
                      <td key={w.id} style={{ padding: 6 }}>
                        {level ? (
                          <span>{level.quantityOnHand}</span>
                        ) : isOpeningTarget ? (
                          <span className="row">
                            <input
                              placeholder="Qty"
                              value={openingQty}
                              onChange={(e) => setOpeningQty(e.target.value)}
                              style={{ padding: 4, width: 70 }}
                            />
                            <button onClick={() => void handleRecordOpening()} disabled={openingBusy || !openingQty.trim()} style={{ padding: "2px 6px" }}>
                              {openingBusy ? "…" : "Save"}
                            </button>
                          </span>
                        ) : (
                          <button onClick={() => setOpeningFor({ productId: p.id, warehouseId: w.id })} style={{ padding: "2px 6px" }}>
                            Set opening stock
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {openingError && <p className="error">{openingError}</p>}
    </div>
  );
}
