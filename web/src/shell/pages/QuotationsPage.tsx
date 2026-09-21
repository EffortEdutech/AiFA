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
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabaseQuotationInvoiceTransport } from "@aifa/core/sync/quotationInvoiceTransport";
import type { Quotation, QuotationLineInput, QuotationStatus } from "@aifa/core/sync/quotationInvoiceTransport";
import { createSupabaseLegalCommercialTransport } from "@aifa/core/sync/legalCommercialTransport";
import type { Party } from "@aifa/core/sync/partyAndLedgerTransport";
import type { Product } from "@aifa/core/sync/pricingTransport";

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

  if (loadError) {
    return (
      <div className="aifa-page">
        <h1>Quotations</h1>
        <p className="error">{loadError}</p>
      </div>
    );
  }

  const filtered = (quotations ?? []).filter((q) => tab === "all" || q.status === tab);
  const counts = (status: QuotationStatus) => (quotations ?? []).filter((q) => q.status === status).length;

  return (
    <div className="aifa-page">
      <h1>Quotations</h1>
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

      <p className="muted" style={{ margin: "8px 0" }}>
        A newly created quotation routes through the Approvals inbox before it can be sent.{" "}
        {onGoToApprovals ? (
          <button onClick={onGoToApprovals} style={{ padding: "0 4px" }}>
            Go to Approvals
          </button>
        ) : (
          "See the Approvals sidebar item."
        )}
      </p>

      <div className="row" style={{ margin: "12px 0" }}>
        <button onClick={() => setShowCreate((s) => !s)}>{showCreate ? "Cancel" : "New quotation"}</button>
      </div>

      {showCreate && (
        <div className="card">
          <h2 style={{ fontSize: 16, marginTop: 0 }}>New quotation</h2>
          <div className="row">
            <select value={partyId} onChange={(e) => setPartyId(e.target.value)} style={{ padding: 6, minWidth: 220 }}>
              <option value="">Select party…</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
            <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} style={{ padding: 6 }} />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <input
              placeholder="Notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{ padding: 6, flex: 1 }}
            />
          </div>

          <h3 style={{ fontSize: 14, marginTop: 12, marginBottom: 4 }}>Lines</h3>
          {lines.map((l, idx) => (
            <div key={idx} className="row" style={{ marginTop: 4 }}>
              <select
                value={l.productId}
                onChange={(e) => updateLine(idx, { productId: e.target.value })}
                style={{ padding: 6, minWidth: 180 }}
              >
                <option value="">Non-catalog line…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.sku})
                  </option>
                ))}
              </select>
              <input
                placeholder="Description"
                value={l.description}
                onChange={(e) => updateLine(idx, { description: e.target.value })}
                style={{ padding: 6, flex: 1, minWidth: 140 }}
              />
              <input
                placeholder="Qty"
                value={l.quantity}
                onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                style={{ padding: 6, width: 70 }}
              />
              <input
                placeholder="Price override"
                value={l.unitPriceOverride}
                onChange={(e) => updateLine(idx, { unitPriceOverride: e.target.value })}
                style={{ padding: 6, width: 120 }}
                title="Leave blank to resolve via PRICE-001 against this party (requires selecting a product)."
              />
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

          <div className="row" style={{ marginTop: 10 }}>
            <button onClick={() => void handleCreate()} disabled={createBusy || !partyId}>
              {createBusy ? "Creating…" : "Create quotation"}
            </button>
          </div>
          {createError && <p className="error">{createError}</p>}
        </div>
      )}

      {actionError && <p className="error">{actionError}</p>}

      {quotations === null ? (
        <p className="muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">No quotations in this view.</p>
      ) : (
        filtered.map((q) => {
          const busy = busyId === q.id;
          const expanded = expandedId === q.id;
          return (
            <div key={q.id} className="card">
              <div className="row" style={{ justifyContent: "space-between", cursor: "pointer" }} onClick={() => void toggleExpand(q)}>
                <strong>
                  {q.quotationNo} — {partyName(q.partyId)}
                </strong>
                <span className="muted">{q.status}</span>
              </div>
              <p className="muted" style={{ margin: "4px 0" }}>
                {q.currency} {q.grandTotal.toFixed(2)} · issued {q.issueDate}
                {q.validUntil && ` · valid until ${q.validUntil}`}
              </p>
              {expanded && (
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--aifa-border, #e2e2e2)" }}>
                  {(linesById[q.id] ?? []).length === 0 ? (
                    <p className="muted">Loading lines…</p>
                  ) : (
                    linesById[q.id].map((l) => (
                      <p key={l.id} className="muted" style={{ margin: "2px 0" }}>
                        {l.quantity} × {l.description} @ RM{l.unitPrice.toFixed(2)} = RM{l.lineTotal.toFixed(2)}
                      </p>
                    ))
                  )}
                </div>
              )}

              <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
                {q.status === "draft" && (
                  <button onClick={() => void handleBuildLink(q)} disabled={busy}>
                    {busy ? "…" : "Get WhatsApp link"}
                  </button>
                )}
                {waMessageById[q.id] && (
                  <>
                    <textarea
                      value={waMessageById[q.id].messageText}
                      onChange={(e) =>
                        setWaMessageById((prev) => ({ ...prev, [q.id]: { ...prev[q.id], messageText: e.target.value } }))
                      }
                      rows={3}
                      style={{ width: "100%", padding: 6, marginTop: 6 }}
                    />
                    <p className="muted" style={{ margin: "4px 0" }}>
                      Review/edit the message above before opening WhatsApp — it will not be sent until you tap Send
                      there yourself.
                    </p>
                    <a href={waLinkFor(q) ?? "#"} target="_blank" rel="noreferrer">
                      Open WhatsApp
                    </a>
                  </>
                )}
                {q.status === "draft" && (
                  <button onClick={() => void handleLifecycle(q, "sent")} disabled={busy}>
                    Mark Sent (I tapped Send in WhatsApp)
                  </button>
                )}
                {q.status === "sent" && (
                  <>
                    <button onClick={() => void handleLifecycle(q, "accepted")} disabled={busy}>
                      Mark Accepted
                    </button>
                    <button onClick={() => void handleLifecycle(q, "rejected")} disabled={busy} style={{ color: "#c0392b", borderColor: "#c0392b" }}>
                      Mark Rejected
                    </button>
                  </>
                )}
                {q.status === "accepted" && (
                  <button onClick={() => void handleLifecycle(q, "convert")} disabled={busy}>
                    {busy ? "Converting…" : "Convert to Invoice"}
                  </button>
                )}
                {q.status === "converted_to_invoice" && q.convertedInvoiceId && (
                  <span className="muted">→ Invoice #{q.convertedInvoiceId.slice(0, 8)}</span>
                )}
              </div>
              {creditBlockedId === q.id && (
                <div style={{ marginTop: 6 }}>
                  <p className="error">
                    Blocked: converting this quotation would exceed the party's credit limit.
                    {canOverrideCreditLimit
                      ? " You can override this below — it will be logged with your reason."
                      : " An Owner or Bookkeeper with settings-configure access can review and override this — contact one of them if this needs to proceed today."}
                  </p>
                  {canOverrideCreditLimit && (
                    <div className="row" style={{ gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                      <input
                        placeholder="Override reason (recorded in the log)"
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value)}
                        style={{ padding: 6, minWidth: 260 }}
                      />
                      <button onClick={() => void handleCreditOverride(q)} disabled={overrideBusyId === q.id}>
                        {overrideBusyId === q.id ? "Overriding…" : "Override & Convert to Invoice"}
                      </button>
                    </div>
                  )}
                  {overrideError && <p className="error" style={{ marginTop: 4 }}>{overrideError}</p>}
                </div>
              )}
              {overrideResultById[q.id] && (
                <p className="muted" style={{ marginTop: 6 }}>{overrideResultById[q.id]}</p>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
