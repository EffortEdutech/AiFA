/**
 * Pricing & Catalog — Sprint 39 (Vol 13_0 §5, §7 pulled forward).
 *
 * DISCLOSED SCOPE: the Product Import tab supports CSV only, not
 * .xlsx — `web/package.json` has no spreadsheet-reading library
 * (`productImportParser.ts` is deliberately library-agnostic and
 * expects the caller to supply already-extracted rows), and adding one
 * is a real dependency decision this sprint did not make unilaterally.
 * A plain CSV with a header row exercises the exact same
 * `parseProductImportRows`/staging/review/apply pipeline an .xlsx
 * would — Excel support is a small, scoped follow-on (swap in a
 * client-side .xlsx reader) once the owner confirms it's needed over
 * CSV export from whatever they currently use.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabasePricingTransport } from "@aifa/core/sync/pricingTransport";
import type { CostSource, PriceType, Product, PriceListEntry, ProductImportBatch, ResolvedPrice } from "@aifa/core/sync/pricingTransport";
import { detectColumns, parseProductImportRows, type ParsedSheetRow } from "@aifa/core/catalog/productImportParser";

import { supabase } from "../../lib/supabaseClient";
import { listProducts, listPriceTypes, listPriceListEntries, listProductImportBatches } from "../../lib/productsAndPricing";
import { listParties } from "../../lib/partiesAndAccounts";
import type { Party } from "@aifa/core/sync/partyAndLedgerTransport";
import { TabStrip } from "../TabStrip";

const pricingTransport = createSupabasePricingTransport(supabase);

type CatalogTab = "products" | "price-types" | "import";

interface Props {
  businessId: string;
}

function parseCsv(text: string): ParsedSheetRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row: ParsedSheetRow = {};
    headers.forEach((h, i) => {
      row[h] = cells[i]?.trim() ?? "";
    });
    return row;
  });
}

export function PricingCatalogPage({ businessId }: Props): JSX.Element {
  const [tab, setTab] = useState<CatalogTab>("products");
  const [products, setProducts] = useState<Product[] | null>(null);
  const [priceTypes, setPriceTypes] = useState<PriceType[] | null>(null);
  const [parties, setParties] = useState<Party[] | null>(null);
  const [batches, setBatches] = useState<ProductImportBatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
  const [priceEntries, setPriceEntries] = useState<Record<string, PriceListEntry[]>>({});

  const [showCreateProduct, setShowCreateProduct] = useState(false);
  const [productName, setProductName] = useState("");
  const [productSku, setProductSku] = useState("");
  const [productUnit, setProductUnit] = useState("unit");
  const [productCost, setProductCost] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  const [newPriceTypeName, setNewPriceTypeName] = useState("");

  const [resolveProductId, setResolveProductId] = useState("");
  const [resolvePartyId, setResolvePartyId] = useState("");
  const [resolveResult, setResolveResult] = useState<ResolvedPrice | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ReturnType<typeof parseProductImportRows> | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [p, pt, parties_, b] = await Promise.all([
        listProducts(businessId),
        listPriceTypes(businessId),
        listParties(businessId),
        listProductImportBatches(businessId),
      ]);
      setProducts(p);
      setPriceTypes(pt);
      setParties(parties_);
      setBatches(b);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the catalog.");
    }
  }, [businessId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function toggleExpand(productId: string): Promise<void> {
    if (expandedProductId === productId) {
      setExpandedProductId(null);
      return;
    }
    setExpandedProductId(productId);
    if (!priceEntries[productId]) {
      const entries = await listPriceListEntries(productId);
      setPriceEntries((prev) => ({ ...prev, [productId]: entries }));
    }
  }

  async function handleCreateProduct(): Promise<void> {
    if (!productName.trim()) return;
    setCreateBusy(true);
    try {
      const costSource: CostSource = "manual"; // 'auto_from_purchase' is stubbed server-side -- never offered here, see pricingTransport.ts's own note.
      await pricingTransport.createProduct({
        businessId,
        name: productName.trim(),
        sku: productSku.trim() || null,
        unitOfMeasure: productUnit.trim() || "unit",
        defaultCost: productCost.trim() ? Number(productCost) : null,
        costSource,
      });
      setProductName("");
      setProductSku("");
      setProductCost("");
      setShowCreateProduct(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create product.");
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleCreatePriceType(): Promise<void> {
    if (!newPriceTypeName.trim()) return;
    try {
      await pricingTransport.createPriceType(businessId, newPriceTypeName.trim());
      setNewPriceTypeName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create price type.");
    }
  }

  async function handleSetDefault(priceTypeId: string): Promise<void> {
    try {
      await pricingTransport.setDefaultPriceType(businessId, priceTypeId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set default price type.");
    }
  }

  async function handleResolvePrice(): Promise<void> {
    if (!resolveProductId) return;
    setResolveError(null);
    setResolveResult(null);
    try {
      setResolveResult(await pricingTransport.resolvePrice(businessId, resolveProductId, resolvePartyId || null));
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : "Could not resolve a price for this combination.");
    }
  }

  async function handleFileChosen(file: File): Promise<void> {
    setImportFile(file);
    const text = await file.text();
    const rows = parseCsv(text);
    const headers = Object.keys(rows[0] ?? {});
    const columns = detectColumns(headers);
    setImportPreview(parseProductImportRows(rows, columns));
  }

  async function handleStageImport(): Promise<void> {
    if (!importFile || !importPreview) return;
    setImportBusy(true);
    try {
      await pricingTransport.createProductImportBatch(businessId, importFile.name, importPreview);
      setImportFile(null);
      setImportPreview(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not stage the import batch.");
    } finally {
      setImportBusy(false);
    }
  }

  async function handleApplyBatch(batchId: string): Promise<void> {
    try {
      await pricingTransport.applyProductImportBatch(batchId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply the batch.");
    }
  }

  return (
    <div className="aifa-page">
      <h1>Pricing & Catalog</h1>
      <TabStrip
        tabs={[
          { id: "products", label: "Products", count: products?.length },
          { id: "price-types", label: "Price Types", count: priceTypes?.length },
          { id: "import", label: "Import Batches", count: batches?.length },
        ]}
        active={tab}
        onChange={setTab}
      />
      {error && <p className="error">{error}</p>}

      {tab === "products" && (
        <>
          <div className="card">
            <h2 style={{ fontSize: 14, marginTop: 0 }}>Resolve price (PRICE-001)</h2>
            <div className="row">
              <select value={resolveProductId} onChange={(e) => setResolveProductId(e.target.value)} style={{ padding: 6 }}>
                <option value="">Choose a product…</option>
                {products?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select value={resolvePartyId} onChange={(e) => setResolvePartyId(e.target.value)} style={{ padding: 6 }}>
                <option value="">Business default (no party)</option>
                {parties?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
              <button onClick={() => void handleResolvePrice()} disabled={!resolveProductId}>
                Resolve
              </button>
            </div>
            {resolveError && <p className="error">{resolveError}</p>}
            {resolveResult && (
              <p className="muted" style={{ margin: "4px 0" }}>
                RM{resolveResult.unitPrice.toFixed(2)}
                {resolveResult.usedBusinessDefault ? " (business default price type used)" : ""}
              </p>
            )}
          </div>

          <div className="row" style={{ margin: "12px 0" }}>
            <button onClick={() => setShowCreateProduct((s) => !s)}>{showCreateProduct ? "Cancel" : "New product"}</button>
          </div>
          {showCreateProduct && (
            <div className="card">
              <div className="row">
                <input placeholder="Name" value={productName} onChange={(e) => setProductName(e.target.value)} style={{ padding: 6, flex: 1 }} />
                <input placeholder="SKU" value={productSku} onChange={(e) => setProductSku(e.target.value)} style={{ padding: 6, width: 120 }} />
                <input placeholder="Unit" value={productUnit} onChange={(e) => setProductUnit(e.target.value)} style={{ padding: 6, width: 100 }} />
                <input placeholder="Default cost (RM)" value={productCost} onChange={(e) => setProductCost(e.target.value)} style={{ padding: 6, width: 140 }} />
                <button onClick={() => void handleCreateProduct()} disabled={createBusy || !productName.trim()}>
                  {createBusy ? "Creating…" : "Create"}
                </button>
              </div>
            </div>
          )}

          {products === null ? (
            <p className="muted">Loading…</p>
          ) : (
            products.map((p) => (
              <div key={p.id} className="card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>
                    {p.name}
                    {p.sku ? ` (${p.sku})` : ""}
                  </strong>
                  <button onClick={() => void toggleExpand(p.id)}>{expandedProductId === p.id ? "Hide prices" : "Show prices"}</button>
                </div>
                <p className="muted" style={{ margin: "4px 0" }}>
                  {p.unitOfMeasure}
                  {p.defaultCost != null && ` · Cost RM${p.defaultCost.toFixed(2)}`} · {p.status}
                  {p.trackInventory ? " · Stock-tracked" : ""}
                </p>
                {expandedProductId === p.id && (
                  <AddPriceEntry
                    productId={p.id}
                    priceTypes={priceTypes ?? []}
                    entries={priceEntries[p.id] ?? []}
                    onAdded={async () => {
                      const entries = await listPriceListEntries(p.id);
                      setPriceEntries((prev) => ({ ...prev, [p.id]: entries }));
                    }}
                  />
                )}
              </div>
            ))
          )}
        </>
      )}

      {tab === "price-types" && (
        <>
          <div className="card">
            <div className="row">
              <input
                placeholder="New price type name"
                value={newPriceTypeName}
                onChange={(e) => setNewPriceTypeName(e.target.value)}
                style={{ padding: 6, flex: 1 }}
              />
              <button onClick={() => void handleCreatePriceType()} disabled={!newPriceTypeName.trim()}>
                Create
              </button>
            </div>
          </div>
          {priceTypes?.map((pt) => (
            <div key={pt.id} className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>
                  {pt.name}
                  {pt.isDefault ? " (default)" : ""}
                </strong>
                {!pt.isDefault && <button onClick={() => void handleSetDefault(pt.id)}>Set as default</button>}
              </div>
            </div>
          ))}
        </>
      )}

      {tab === "import" && (
        <>
          <div className="card">
            <h2 style={{ fontSize: 14, marginTop: 0 }}>Stage a CSV import</h2>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFileChosen(f);
              }}
            />
            {importPreview && (
              <>
                <p className="muted" style={{ margin: "8px 0" }}>
                  {importPreview.length} rows parsed — {importPreview.filter((r) => r.parseStatus === "error").length} with errors.
                </p>
                <button onClick={() => void handleStageImport()} disabled={importBusy}>
                  {importBusy ? "Staging…" : "Stage this batch"}
                </button>
              </>
            )}
          </div>
          {batches?.map((b) => (
            <div key={b.id} className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{b.sourceFileRef}</strong>
                <span className="muted">{b.status}</span>
              </div>
              <p className="muted" style={{ margin: "4px 0" }}>
                {b.rowCount} rows · {b.errorCount} errors
              </p>
              {b.status === "parsed" && b.errorCount === 0 && (
                <button onClick={() => void handleApplyBatch(b.id)}>Apply batch</button>
              )}
              {b.status === "parsed" && b.errorCount > 0 && (
                <p className="muted">Fix the error rows in a new file and re-stage — this batch stays unapplied.</p>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function AddPriceEntry({
  productId,
  priceTypes,
  entries,
  onAdded,
}: {
  productId: string;
  priceTypes: PriceType[];
  entries: PriceListEntry[];
  onAdded: () => Promise<void>;
}): JSX.Element {
  const [priceTypeId, setPriceTypeId] = useState(priceTypes[0]?.id ?? "");
  const [unitPrice, setUnitPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleAdd(): Promise<void> {
    if (!priceTypeId || !unitPrice.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await pricingTransport.createPriceListEntry({ productId, priceTypeId, unitPrice: Number(unitPrice) });
      setUnitPrice("");
      await onAdded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add price.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ borderTop: "1px solid var(--aifa-border)", marginTop: 8, paddingTop: 8 }}>
      {entries.map((e) => (
        <p key={e.id} className="muted" style={{ margin: "2px 0" }}>
          {priceTypes.find((pt) => pt.id === e.priceTypeId)?.name ?? e.priceTypeId} — RM{e.unitPrice.toFixed(2)}
        </p>
      ))}
      <div className="row" style={{ marginTop: 6 }}>
        <select value={priceTypeId} onChange={(ev) => setPriceTypeId(ev.target.value)} style={{ padding: 6 }}>
          {priceTypes.map((pt) => (
            <option key={pt.id} value={pt.id}>
              {pt.name}
            </option>
          ))}
        </select>
        <input placeholder="Unit price (RM)" value={unitPrice} onChange={(ev) => setUnitPrice(ev.target.value)} style={{ padding: 6, width: 140 }} />
        <button onClick={() => void handleAdd()} disabled={busy || !unitPrice.trim()}>
          {busy ? "Adding…" : "Add price"}
        </button>
      </div>
      {err && <p className="error">{err}</p>}
    </div>
  );
}
