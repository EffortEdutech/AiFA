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
 *
 * UI polish Phase 4: presentation only — resolve-price and create forms in
 * cards, tables for products / price types / batches, row-select price detail.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabasePricingTransport } from "@aifa/core/sync/pricingTransport";
import type { CostSource, PriceType, Product, PriceListEntry, ProductImportBatch, ResolvedPrice } from "@aifa/core/sync/pricingTransport";
import { detectColumns, parseProductImportRows, type ParsedSheetRow } from "@aifa/core/catalog/productImportParser";

import { Button, Card, DataTable, Field, PageHeader, StatusPill, formatMoney, humanizeStatus, type Column } from "../../ui";
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

  const selectedProduct = expandedProductId ? (products ?? []).find((p) => p.id === expandedProductId) : undefined;

  const productColumns: Column<Product>[] = [
    {
      key: "p",
      header: "Product",
      render: (p) => (
        <>
          <strong>{p.name}</strong>
          {p.sku && <div className="ui-cell-sub">{p.sku}</div>}
        </>
      ),
    },
    { key: "unit", header: "Unit", render: (p) => p.unitOfMeasure },
    { key: "cost", header: "Default cost", numeric: true, render: (p) => (p.defaultCost != null ? formatMoney(p.defaultCost) : "—") },
    { key: "status", header: "Status", render: (p) => <StatusPill status={p.status} label={humanizeStatus(p.status)} /> },
    { key: "stock", header: "Stock", render: (p) => (p.trackInventory ? "Stock-tracked" : "—") },
  ];

  const priceTypeColumns: Column<PriceType>[] = [
    { key: "name", header: "Price type", render: (pt) => <strong>{pt.name}</strong> },
    { key: "default", header: "Default", render: (pt) => (pt.isDefault ? <StatusPill status="active" label="Default" /> : "—") },
    {
      key: "actions",
      header: "",
      render: (pt) =>
        pt.isDefault ? null : (
          <Button size="sm" variant="secondary" onClick={() => void handleSetDefault(pt.id)}>
            Set as default
          </Button>
        ),
    },
  ];

  const batchColumns: Column<ProductImportBatch>[] = [
    { key: "file", header: "File", render: (b) => <strong>{b.sourceFileRef}</strong> },
    { key: "status", header: "Status", render: (b) => <StatusPill status={b.status} label={humanizeStatus(b.status)} /> },
    { key: "rows", header: "Rows", numeric: true, render: (b) => b.rowCount },
    { key: "errors", header: "Errors", numeric: true, render: (b) => b.errorCount },
    {
      key: "actions",
      header: "",
      render: (b) => {
        if (b.status === "parsed" && b.errorCount === 0) {
          return (
            <Button size="sm" variant="primary" onClick={() => void handleApplyBatch(b.id)}>
              Apply batch
            </Button>
          );
        }
        if (b.status === "parsed" && b.errorCount > 0) {
          return <span className="ui-muted">Fix the error rows in a new file and re-stage — this batch stays unapplied.</span>;
        }
        return null;
      },
    },
  ];

  return (
    <div className="aifa-page">
      <PageHeader
        title="Pricing & Catalog"
        actions={
          tab === "products" ? (
            <Button variant="primary" icon={showCreateProduct ? undefined : "plus"} onClick={() => setShowCreateProduct((s) => !s)}>
              {showCreateProduct ? "Cancel" : "New product"}
            </Button>
          ) : undefined
        }
      >
        <TabStrip
          tabs={[
            { id: "products", label: "Products", count: products?.length },
            { id: "price-types", label: "Price Types", count: priceTypes?.length },
            { id: "import", label: "Import Batches", count: batches?.length },
          ]}
          active={tab}
          onChange={setTab}
        />
      </PageHeader>
      {error && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {error}
        </p>
      )}

      {tab === "products" && (
        <>
          <Card title="Resolve price (PRICE-001)">
            <div className="ui-inline-actions" style={{ alignItems: "flex-end" }}>
              <Field label="Product">
                {(p) => (
                  <select {...p} className="ui-select" value={resolveProductId} onChange={(e) => setResolveProductId(e.target.value)}>
                    <option value="">Choose a product…</option>
                    {products?.map((pr) => (
                      <option key={pr.id} value={pr.id}>
                        {pr.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Party">
                {(p) => (
                  <select {...p} className="ui-select" value={resolvePartyId} onChange={(e) => setResolvePartyId(e.target.value)}>
                    <option value="">Business default (no party)</option>
                    {parties?.map((pt) => (
                      <option key={pt.id} value={pt.id}>
                        {pt.displayName}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Button variant="secondary" disabled={!resolveProductId} onClick={() => void handleResolvePrice()}>
                Resolve
              </Button>
            </div>
            {resolveError && (
              <p className="aifa-alert aifa-alert--danger" role="alert">
                {resolveError}
              </p>
            )}
            {resolveResult && (
              <p className="aifa-alert aifa-alert--info" role="status">
                {formatMoney(resolveResult.unitPrice)}
                {resolveResult.usedBusinessDefault ? " (business default price type used)" : ""}
              </p>
            )}
          </Card>

          {showCreateProduct && (
            <Card title="New product">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!createBusy && productName.trim()) void handleCreateProduct();
                }}
              >
                <div className="ui-form-grid">
                  <Field label="Name" required>
                    {(p) => <input {...p} className="ui-input" value={productName} onChange={(e) => setProductName(e.target.value)} />}
                  </Field>
                  <Field label="SKU">
                    {(p) => <input {...p} className="ui-input" value={productSku} onChange={(e) => setProductSku(e.target.value)} />}
                  </Field>
                  <Field label="Unit">
                    {(p) => <input {...p} className="ui-input" value={productUnit} onChange={(e) => setProductUnit(e.target.value)} />}
                  </Field>
                  <Field label="Default cost (RM)">
                    {(p) => <input {...p} className="ui-input" inputMode="decimal" value={productCost} onChange={(e) => setProductCost(e.target.value)} />}
                  </Field>
                </div>
                <div className="ui-form-actions">
                  <Button type="submit" variant="primary" loading={createBusy} disabled={!productName.trim()}>
                    {createBusy ? "Creating…" : "Create"}
                  </Button>
                </div>
              </form>
            </Card>
          )}

          {selectedProduct && (
            <Card
              title={`${selectedProduct.name}${selectedProduct.sku ? ` (${selectedProduct.sku})` : ""} — prices`}
              actions={
                <Button size="sm" variant="ghost" onClick={() => setExpandedProductId(null)}>
                  Close
                </Button>
              }
            >
              <AddPriceEntry
                productId={selectedProduct.id}
                priceTypes={priceTypes ?? []}
                entries={priceEntries[selectedProduct.id] ?? []}
                onAdded={async () => {
                  const entries = await listPriceListEntries(selectedProduct.id);
                  setPriceEntries((prev) => ({ ...prev, [selectedProduct.id]: entries }));
                }}
              />
            </Card>
          )}

          <Card flush>
            <DataTable
              caption="Products"
              columns={productColumns}
              rows={products}
              rowKey={(p) => p.id}
              onRowClick={(p) => void toggleExpand(p.id)}
              selectedKey={expandedProductId}
              empty={<div className="ui-table-state">No products yet.</div>}
            />
          </Card>
        </>
      )}

      {tab === "price-types" && (
        <>
          <Card title="New price type">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newPriceTypeName.trim()) void handleCreatePriceType();
              }}
            >
              <div className="ui-inline-actions" style={{ alignItems: "flex-end" }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <Field label="Price type name">
                    {(p) => <input {...p} className="ui-input" value={newPriceTypeName} onChange={(e) => setNewPriceTypeName(e.target.value)} />}
                  </Field>
                </div>
                <Button type="submit" variant="primary" disabled={!newPriceTypeName.trim()}>
                  Create
                </Button>
              </div>
            </form>
          </Card>
          <Card flush>
            <DataTable
              caption="Price types"
              columns={priceTypeColumns}
              rows={priceTypes}
              rowKey={(pt) => pt.id}
              empty={<div className="ui-table-state">No price types yet.</div>}
            />
          </Card>
        </>
      )}

      {tab === "import" && (
        <>
          <Card title="Stage a CSV import">
            <Field label="CSV file" hint="CSV with a header row. Excel (.xlsx) isn't supported yet.">
              {(p) => (
                <input
                  {...p}
                  className="ui-input"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFileChosen(f);
                  }}
                />
              )}
            </Field>
            {importPreview && (
              <>
                <p className="ui-note">
                  {importPreview.length} rows parsed — {importPreview.filter((r) => r.parseStatus === "error").length} with errors.
                </p>
                <div className="ui-form-actions">
                  <Button variant="primary" loading={importBusy} onClick={() => void handleStageImport()}>
                    {importBusy ? "Staging…" : "Stage this batch"}
                  </Button>
                </div>
              </>
            )}
          </Card>
          <Card flush>
            <DataTable
              caption="Import batches"
              columns={batchColumns}
              rows={batches}
              rowKey={(b) => b.id}
              empty={<div className="ui-table-state">No import batches yet.</div>}
            />
          </Card>
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

  const columns: Column<PriceListEntry>[] = [
    { key: "type", header: "Price type", render: (e) => priceTypes.find((pt) => pt.id === e.priceTypeId)?.name ?? e.priceTypeId },
    { key: "price", header: "Unit price", numeric: true, render: (e) => formatMoney(e.unitPrice) },
  ];

  return (
    <>
      <DataTable
        caption="Price list entries"
        columns={columns}
        rows={entries}
        rowKey={(e) => e.id}
        empty={<div className="ui-table-state">No prices set for this product yet.</div>}
      />
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!busy && priceTypeId && unitPrice.trim()) void handleAdd();
        }}
        style={{ marginTop: "var(--aifa-space-4)" }}
      >
        <div className="ui-inline-actions" style={{ alignItems: "flex-end" }}>
          <Field label="Price type">
            {(p) => (
              <select {...p} className="ui-select" value={priceTypeId} onChange={(ev) => setPriceTypeId(ev.target.value)}>
                {priceTypes.map((pt) => (
                  <option key={pt.id} value={pt.id}>
                    {pt.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Unit price (RM)">
            {(p) => <input {...p} className="ui-input" inputMode="decimal" value={unitPrice} onChange={(ev) => setUnitPrice(ev.target.value)} />}
          </Field>
          <Button type="submit" variant="primary" loading={busy} disabled={!unitPrice.trim()}>
            {busy ? "Adding…" : "Add price"}
          </Button>
        </div>
        {err && (
          <p className="aifa-alert aifa-alert--danger" role="alert">
            {err}
          </p>
        )}
      </form>
    </>
  );
}
