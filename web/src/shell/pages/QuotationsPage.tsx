/**
 * Quotations — Sprint 40 (Vol 13_0 §4 Module A, Vol 12_2 §5.2's worked
 * example: tabbed by lifecycle state, pending-approval items link into
 * Sprint 38's shared Approvals inbox rather than reimplementing a
 * mini-list here).
 *
 * WHATSAPP SEND NOTE (see quotationInvoiceTransport.ts's own header):
 * "Send" here only opens a wa.me link with the message pre-filled —
 * the owner still taps Send themselves inside WhatsApp. "Mark Sent" is
 * a separate, deliberate self-reported confirmation call; it is not
 * automatic just because the link was opened. Sprint 40's own "Safe to
 * Carry Over" note flagged the exact message template as something the
 * owner might want to review before this is considered final — Sprint
 * 48 closes that out by making the pre-filled message text editable
 * before the link is opened: `buildWhatsAppQuotationLink` still builds
 * the server's own default text (and phone number) as the starting
 * point, but the actual `wa.me` link opened is rebuilt client-side from
 * whatever text the owner leaves in the box, via plain
 * `encodeURIComponent` — no new RPC needed, `messageText`/`phoneE164`
 * were already returned alongside the pre-built link.
 *
 * CREDIT LIMIT OVERRIDE NOTE (Sprint 47, Vol 13_0 §12.1): completes
 * this page's own Sprint 40 stub. The override action is gated in the
 * UI on `configure` on `settings` (`getGrantedCapabilitiesForDomain`,
 * the same pattern Sprint 45's Payroll page established) even though
 * the RPC itself already enforces this server-side — never a silent
 * success, always shows the `credit_limit_override_log` row it wrote
 * back to the user afterward.
 *
 * UI polish Phase 4: presentation only — a quotations table; selecting a row
 * opens its detail card, which now holds the lines and every action (WhatsApp,
 * lifecycle, credit-limit override). Same calls, same gating, same copy.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabaseQuotationInvoiceTransport } from "@aifa/core/sync/quotationInvoiceTransport";
import type { Quotation, QuotationLineInput, QuotationStatus } from "@aifa/core/sync/quotationInvoiceTransport";
import { createSupabaseLegalCommercialTransport } from "@aifa/core/sync/legalCommercialTransport";
import type { Party } from "@aifa/core/sync/partyAndLedgerTransport";
import type { Product } from "@aifa/core/sync/pricingTransport";

import { Button, Card, DataTable, Field, PageHeader, StatusPill, formatDate, formatMoney, humanizeStatus, type Column } from "../../ui";
import { supabase } from "../../lib/supabaseClient";
import { listParties } from "../../lib/partiesAndAccounts";
import { listProducts } from "../../lib/productsAndPricing";
import { listQuotations, listQuotationLines } from "../../lib/salesCycle";
import type { SalesLine } from "../../lib/salesCycle";
import { listCreditLimitOverrideLogForInvoice } from "../../lib/legalCommercial";
import { getGrantedCapabilitiesForDomain } from "../../lib/membership";
import { useAccess } from "../AccessContext";
import { TabStrip } from "../TabStrip";

const quotationInvoiceTransport = createSupabaseQuotationInvoiceTransport(supabase);
const legalCommercialTransport = createSupabaseLegalCommercialTransport(supabase);

type QuotationTab = "all" | QuotationStatus;

interface Props {
  businessId: string;
  onGoToApprovals?: () => void;
}

interface DraftLine {
  productId: string;
  description: string;
  quantity: string;
  unitPriceOverride: string;
}

function emptyLine(): DraftLine {
  return { productId: "", description: "", quantity: "1", unitPriceOverride: "" };
}

export function QuotationsPage({ businessId, onGoToApprovals }: Props): JSX.Element {
  const { myMembership, accessModel } = useAccess();
  const [canOverrideCreditLimit, setCanOverrideCreditLimit] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (accessModel === "solo" || myMembership === null) {
      setCanOverrideCreditLimit(true);
      return;
    }
    getGrantedCapabilitiesForDomain(myMembership.roleId, "settings")
      .then((caps) => {
        if (!cancelled) setCanOverrideCreditLimit(caps.has("configure"));
      })
      .catch(() => {
        if (!cancelled) setCanOverrideCreditLimit(false); // fail closed
      });
    return () => {
      cancelled = true;
    };
  }, [accessModel, myMembership]);

  const [quotations, setQuotations] = useState<Quotation[] | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<QuotationTab>("all");

  const [showCreate, setShowCreate] = useState(false);
  const [partyId, setPartyId] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [linesById, setLinesById] = useState<Record<string, SalesLine[]>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [waMessageById, setWaMessageById] = useState<Record<string, { phoneE164: string; messageText: string }>>({});
  /** Sprint 40's own deferred scope: this sprint shows the block clearly;
   * the actual override action is Sprint 47's (`convertQuotationToInvoiceWithCreditOverride`). */
  const [creditBlockedId, setCreditBlockedId] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideBusyId, setOverrideBusyId] = useState<string | null>(null);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [overrideResultById, setOverrideResultById] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [q, p, pr] = await Promise.all([listQuotations(businessId), listParties(businessId), listProducts(businessId)]);
      setQuotations(q);
      setParties(p);
      setProducts(pr);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load quotations.");
    }
  }, [businessId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  function partyName(id: string): string {
    return parties.find((p) => p.id === id)?.displayName ?? `Party #${id.slice(0, 8)}`;
  }

  function updateLine(idx: number, patch: Partial<DraftLine>): void {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function handleCreate(): Promise<void> {
    if (!partyId) return;
    const parsedLines: QuotationLineInput[] = [];
    for (const l of lines) {
      if (!l.description.trim() && !l.productId) continue;
      const product = products.find((p) => p.id === l.productId);
      parsedLines.push({
        productId: l.productId || null,
        description: l.description.trim() || product?.name || "Line item",
        quantity: Number(l.quantity) || 1,
        unitPrice: l.unitPriceOverride.trim() ? Number(l.unitPriceOverride) : undefined,
      });
    }
    if (parsedLines.length === 0) {
      setCreateError("Add at least one line.");
      return;
    }
    setCreateBusy(true);
    setCreateError(null);
    try {
      await quotationInvoiceTransport.createQuotation({
        businessId,
        partyId,
        validUntil: validUntil || null,
        notes: notes.trim() || null,
        lines: parsedLines,
      });
      setPartyId("");
      setValidUntil("");
      setNotes("");
      setLines([emptyLine()]);
      setShowCreate(false);
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create quotation.");
    } finally {
      setCreateBusy(false);
    }
  }

  async function toggleExpand(q: Quotation): Promise<void> {
    if (expandedId === q.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(q.id);
    if (!linesById[q.id]) {
      try {
        const l = await listQuotationLines(q.id);
        setLinesById((prev) => ({ ...prev, [q.id]: l }));
      } catch {
        // line detail is a nice-to-have on expand; leave silently empty on failure
      }
    }
  }

  async function handleBuildLink(q: Quotation): Promise<void> {
    setBusyId(q.id);
    setActionError(null);
    try {
      const link = await quotationInvoiceTransport.buildWhatsAppQuotationLink(q.id);
      setWaMessageById((prev) => ({ ...prev, [q.id]: { phoneE164: link.phoneE164, messageText: link.messageText } }));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not build the WhatsApp link.");
    } finally {
      setBusyId(null);
    }
  }

  /** Rebuilds the wa.me link from whatever the owner has edited the message text to — see this file's own header (WHATSAPP SEND NOTE). */
  function waLinkFor(q: Quotation): string | null {
    const m = waMessageById[q.id];
    if (!m) return null;
    return `https://wa.me/${m.phoneE164}?text=${encodeURIComponent(m.messageText)}`;
  }

  async function handleLifecycle(q: Quotation, action: "sent" | "accepted" | "rejected" | "convert"): Promise<void> {
    setBusyId(q.id);
    setActionError(null);
    setCreditBlockedId(null);
    try {
      if (action === "sent") await quotationInvoiceTransport.markQuotationSent(q.id);
      else if (action === "accepted") await quotationInvoiceTransport.markQuotationAccepted(q.id);
      else if (action === "rejected") await quotationInvoiceTransport.markQuotationRejected(q.id);
      else await quotationInvoiceTransport.convertQuotationToInvoice(q.id);
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "That action could not be completed.";
      if (action === "convert" && message.includes("credit_limit_exceeded")) {
        setCreditBlockedId(q.id);
      } else {
        setActionError(message);
      }
    } finally {
      setBusyId(null);
    }
  }

  /** Sprint 47's own explicit, separate, never-auto-retried override path — see this file's own header. */
  async function handleCreditOverride(q: Quotation): Promise<void> {
    setOverrideBusyId(q.id);
    setOverrideError(null);
    try {
      const invoice = await legalCommercialTransport.convertQuotationToInvoiceWithCreditOverride(
        q.id,
        overrideReason.trim() || null,
      );
      const logEntries = await listCreditLimitOverrideLogForInvoice(invoice.id);
      const entry = logEntries[0];
      const summary = entry
        ? `Overridden: requested RM${entry.requestedAmount.toFixed(2)} against effective limit RM${entry.effectiveCreditLimit.toFixed(2)} (outstanding before: RM${entry.outstandingBalanceBefore.toFixed(2)}). Reason: ${entry.reason ?? "(none given)"}.`
        : "Override succeeded but the log entry could not be read back — check the Credit Limit Override Log with an Owner/Bookkeeper account.";
      setOverrideResultById((prev) => ({ ...prev, [q.id]: summary }));
      setCreditBlockedId(null);
      setOverrideReason("");
      await load();
    } catch (err) {
      setOverrideError(err instanceof Error ? err.message : "Could not override the credit limit for this quotation.");
    } finally {
      setOverrideBusyId(null);
    }
  }

  const filtered = (quotations ?? []).filter((q) => tab === "all" || q.status === tab);
  const counts = (status: QuotationStatus) => (quotations ?? []).filter((q) => q.status === status).length;
  const selected = expandedId ? (quotations ?? []).find((q) => q.id === expandedId) : undefined;

  const money = (currency: string, n: number) => (currency === "MYR" ? formatMoney(n) : `${currency} ${n.toFixed(2)}`);

  const columns: Column<Quotation>[] = [
    {
      key: "q",
      header: "Quotation",
      render: (q) => (
        <>
          <strong>{q.quotationNo}</strong>
          <div className="ui-cell-sub">{partyName(q.partyId)}</div>
        </>
      ),
    },
    { key: "status", header: "Status", render: (q) => <StatusPill status={q.status} label={humanizeStatus(q.status)} /> },
    { key: "issued", header: "Issued", render: (q) => formatDate(q.issueDate) },
    { key: "valid", header: "Valid until", render: (q) => (q.validUntil ? formatDate(q.validUntil) : "—") },
    { key: "total", header: "Total", numeric: true, render: (q) => money(q.currency, q.grandTotal) },
  ];

  function renderDetail(q: Quotation): JSX.Element {
    const busy = busyId === q.id;
    const qLines = linesById[q.id] ?? [];
    const lineColumns: Column<SalesLine>[] = [
      { key: "desc", header: "Description", render: (l) => l.description },
      { key: "qty", header: "Qty", numeric: true, render: (l) => l.quantity },
      { key: "price", header: "Unit price", numeric: true, render: (l) => formatMoney(l.unitPrice) },
      { key: "total", header: "Line total", numeric: true, render: (l) => formatMoney(l.lineTotal) },
    ];
    return (
      <Card
        title={`${q.quotationNo} — ${partyName(q.partyId)}`}
        description={`${money(q.currency, q.grandTotal)} · issued ${formatDate(q.issueDate)}${q.validUntil ? ` · valid until ${formatDate(q.validUntil)}` : ""}`}
        actions={
          <Button size="sm" variant="ghost" onClick={() => setExpandedId(null)}>
            Close
          </Button>
        }
      >
        <DataTable
          caption="Quotation lines"
          columns={lineColumns}
          rows={linesById[q.id] ? qLines : null}
          rowKey={(l) => l.id}
          skeletonRows={2}
          empty={<div className="ui-table-state">No lines.</div>}
        />

        <div className="ui-inline-actions" style={{ marginTop: "var(--aifa-space-4)" }}>
          {q.status === "draft" && (
            <Button variant="secondary" icon="send" loading={busy} onClick={() => void handleBuildLink(q)}>
              Get WhatsApp link
            </Button>
          )}
          {q.status === "draft" && (
            <Button variant="secondary" disabled={busy} onClick={() => void handleLifecycle(q, "sent")}>
              Mark Sent (I tapped Send in WhatsApp)
            </Button>
          )}
          {q.status === "sent" && (
            <>
              <Button variant="primary" disabled={busy} onClick={() => void handleLifecycle(q, "accepted")}>
                Mark Accepted
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void handleLifecycle(q, "rejected")}>
                Mark Rejected
              </Button>
            </>
          )}
          {q.status === "accepted" && (
            <Button variant="primary" loading={busy} onClick={() => void handleLifecycle(q, "convert")}>
              {busy ? "Converting…" : "Convert to Invoice"}
            </Button>
          )}
          {q.status === "converted_to_invoice" && q.convertedInvoiceId && (
            <span className="ui-muted">→ Invoice #{q.convertedInvoiceId.slice(0, 8)}</span>
          )}
        </div>

        {waMessageById[q.id] && (
          <div className="ui-panel">
            <Field label="WhatsApp message (edit before opening)">
              {(p) => (
                <textarea
                  {...p}
                  className="ui-textarea"
                  value={waMessageById[q.id].messageText}
                  onChange={(e) =>
                    setWaMessageById((prev) => ({ ...prev, [q.id]: { ...prev[q.id], messageText: e.target.value } }))
                  }
                  rows={3}
                />
              )}
            </Field>
            <p className="ui-note">
              Review/edit the message above before opening WhatsApp — it will not be sent until you tap Send there
              yourself.
            </p>
            <div className="ui-inline-actions" style={{ marginTop: "var(--aifa-space-2)" }}>
              <a
                className="ui-btn ui-btn--primary ui-btn--sm"
                href={waLinkFor(q) ?? "#"}
                target="_blank"
                rel="noreferrer"
              >
                Open WhatsApp
              </a>
            </div>
          </div>
        )}

        {creditBlockedId === q.id && (
          <div style={{ marginTop: "var(--aifa-space-3)" }}>
            <p className="aifa-alert aifa-alert--danger" role="alert">
              Blocked: converting this quotation would exceed the party's credit limit.
              {canOverrideCreditLimit
                ? " You can override this below — it will be logged with your reason."
                : " An Owner or Bookkeeper with settings-configure access can review and override this — contact one of them if this needs to proceed today."}
            </p>
            {canOverrideCreditLimit && (
              <div className="ui-inline-actions" style={{ alignItems: "flex-end" }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <Field label="Override reason (recorded in the log)">
                    {(p) => (
                      <input {...p} className="ui-input" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
                    )}
                  </Field>
                </div>
                <Button variant="danger" loading={overrideBusyId === q.id} onClick={() => void handleCreditOverride(q)}>
                  {overrideBusyId === q.id ? "Overriding…" : "Override & Convert to Invoice"}
                </Button>
              </div>
            )}
            {overrideError && (
              <p className="aifa-alert aifa-alert--danger" role="alert">
                {overrideError}
              </p>
            )}
          </div>
        )}
        {overrideResultById[q.id] && (
          <p className="aifa-alert aifa-alert--info" role="status">
            {overrideResultById[q.id]}
          </p>
        )}
      </Card>
    );
  }

  return (
    <div className="aifa-page">
      <PageHeader
        title="Quotations"
        description="A newly created quotation routes through the Approvals inbox before it can be sent."
        actions={
          <>
            {onGoToApprovals && (
              <Button variant="secondary" onClick={onGoToApprovals}>
                Go to Approvals
              </Button>
            )}
            <Button variant="primary" icon={showCreate ? undefined : "plus"} onClick={() => setShowCreate((s) => !s)}>
              {showCreate ? "Cancel" : "New quotation"}
            </Button>
          </>
        }
      >
        <TabStrip
          tabs={[
            { id: "all", label: "All", count: quotations?.length },
            { id: "draft", label: "Draft", count: counts("draft") },
            { id: "sent", label: "Sent", count: counts("sent") },
            { id: "accepted", label: "Accepted", count: counts("accepted") },
            { id: "rejected", label: "Rejected", count: counts("rejected") },
            { id: "expired", label: "Expired", count: counts("expired") },
            { id: "converted_to_invoice", label: "Converted", count: counts("converted_to_invoice") },
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
        <Card title="New quotation">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!createBusy && partyId) void handleCreate();
            }}
          >
            <div className="ui-form-grid">
              <Field label="Party" required>
                {(p) => (
                  <select {...p} className="ui-select" value={partyId} onChange={(e) => setPartyId(e.target.value)}>
                    <option value="">Select party…</option>
                    {parties.map((pt) => (
                      <option key={pt.id} value={pt.id}>
                        {pt.displayName}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Valid until">
                {(p) => <input {...p} className="ui-input" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />}
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
                  style={{ minWidth: 180 }}
                >
                  <option value="">Non-catalog line…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
                <input
                  className="ui-input"
                  aria-label={`Line ${idx + 1} description`}
                  placeholder="Description"
                  value={l.description}
                  onChange={(e) => updateLine(idx, { description: e.target.value })}
                  style={{ flex: 1, minWidth: 140 }}
                />
                <input
                  className="ui-input"
                  aria-label={`Line ${idx + 1} quantity`}
                  placeholder="Qty"
                  inputMode="decimal"
                  value={l.quantity}
                  onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                  style={{ width: 80 }}
                />
                <input
                  className="ui-input"
                  aria-label={`Line ${idx + 1} price override`}
                  placeholder="Price override"
                  inputMode="decimal"
                  value={l.unitPriceOverride}
                  onChange={(e) => updateLine(idx, { unitPriceOverride: e.target.value })}
                  style={{ width: 130 }}
                  title="Leave blank to resolve via PRICE-001 against this party (requires selecting a product)."
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

            <div className="ui-form-actions">
              <Button type="submit" variant="primary" loading={createBusy} disabled={!partyId}>
                {createBusy ? "Creating…" : "Create quotation"}
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

      {selected && renderDetail(selected)}

      <Card flush>
        <DataTable
          caption="Quotations"
          columns={columns}
          rows={loadError ? [] : quotations === null ? null : filtered}
          rowKey={(q) => q.id}
          onRowClick={(q) => void toggleExpand(q)}
          selectedKey={expandedId}
          empty={<div className="ui-table-state">No quotations in this view.</div>}
        />
      </Card>
    </div>
  );
}
