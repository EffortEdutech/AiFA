/**
 * Requests -- Sprint 68b/68c. The inbox for what customers send from the
 * public site (a QR scan or a link): enquiries and quote requests.
 *
 * Deliberately NOT an Approval Task: approvals are staff sign-off items, and a
 * solo owner has nobody to sign off for. This is a plain inbox -- read it,
 * answer it, close it -- with a timeline the customer also sees (the public
 * parts) on their private tracking page.
 *
 * Replying: "Post reply" shows the answer on the customer's tracking page.
 * There is no email service yet, so the owner then taps "Open WhatsApp" to
 * send the same words to the customer's phone; nothing is sent automatically.
 *
 * A quote request can be turned into a quotation draft (68c): pick or create
 * the customer, fill in prices, and the quotation goes through the normal
 * Quotations flow (including its approval step). The request then shows as
 * Quoted and links to it.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabaseQuotationInvoiceTransport } from "@aifa/core/sync/quotationInvoiceTransport";
import type { QuotationLineInput } from "@aifa/core/sync/quotationInvoiceTransport";
import { createSupabasePartyAndLedgerTransport } from "@aifa/core/sync/partyAndLedgerTransport";
import type { Party } from "@aifa/core/sync/partyAndLedgerTransport";

import { Button, Card, DataTable, Field, PageHeader, StatusPill, formatDate, type Column, type StatusTone } from "../../ui";
import { supabase } from "../../lib/supabaseClient";
import { publicTrackingUrl } from "../../lib/businessSlug";
import { listParties } from "../../lib/partiesAndAccounts";
import {
  addRequestNote,
  linkRequestQuotation,
  listRequestEvents,
  listRequests,
  markRequestSeen,
  replyToRequest,
  requestErrorMessage,
  setRequestStatus,
  type CustomerRequest,
  type RequestEvent,
  type RequestStatus,
} from "../../lib/requests";
import { TabStrip } from "../TabStrip";

const quotationTransport = createSupabaseQuotationInvoiceTransport(supabase);
const partyTransport = createSupabasePartyAndLedgerTransport(supabase);

type Tab = "all" | RequestStatus;

interface Props {
  businessId: string;
  /** Called after any change so the sidebar count can refresh. */
  onChanged?: () => void;
  onGoToQuotations?: () => void;
}

const STATUS_TONE: Record<RequestStatus, StatusTone> = {
  new: "warning",
  seen: "info",
  replied: "neutral",
  quoted: "success",
  closed: "neutral",
  spam: "danger",
};
const STATUS_LABEL: Record<RequestStatus, string> = {
  new: "New",
  seen: "Seen",
  replied: "Replied",
  quoted: "Quoted",
  closed: "Closed",
  spam: "Spam",
};

const typeLabel = (r: CustomerRequest) => (r.requestType === "rfq" ? "Quote request" : r.requestType === "po" ? "Order" : "Enquiry");
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const when = (iso: string) => new Date(iso).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" });

interface QuoteLine {
  description: string;
  quantity: string;
  price: string;
}

function eventLabel(e: RequestEvent): string {
  switch (e.kind) {
    case "received":
      return "Request received";
    case "seen":
      return "Seen";
    case "reply":
      return "Your reply";
    case "note":
      return "Private note";
    case "quotation":
      return "Quotation prepared";
    default:
      return `Status: ${STATUS_LABEL[(e.status ?? "new") as RequestStatus] ?? e.status}`;
  }
}

export function RequestsPage({ businessId, onChanged, onGoToQuotations }: Props): JSX.Element {
  const [requests, setRequests] = useState<CustomerRequest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<RequestEvent[] | null>(null);

  const [replyText, setReplyText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [waText, setWaText] = useState<string | null>(null);

  const [showQuote, setShowQuote] = useState(false);
  const [parties, setParties] = useState<Party[]>([]);
  const [partyChoice, setPartyChoice] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [quoteNotes, setQuoteNotes] = useState("");
  const [quoteLines, setQuoteLines] = useState<QuoteLine[]>([]);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      setRequests(await listRequests(businessId));
    } catch (err) {
      setLoadError(requestErrorMessage(err, "Could not load requests."));
    }
  }, [businessId]);

  useEffect(() => {
    load().catch(() => {});
    const refresh = () => {
      if (document.visibilityState === "visible") load().catch(() => {});
    };
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  }, [load]);

  const selected = requests?.find((r) => r.id === selectedId) ?? null;

  const loadEvents = useCallback(async (id: string) => {
    try {
      setEvents(await listRequestEvents(id));
    } catch {
      setEvents([]);
    }
  }, []);

  async function afterChange(id: string): Promise<void> {
    await Promise.all([load(), loadEvents(id)]);
    onChanged?.();
  }

  async function openRequest(r: CustomerRequest): Promise<void> {
    setSelectedId(r.id);
    setEvents(null);
    setReplyText("");
    setNoteText("");
    setWaText(null);
    setActionError(null);
    setShowQuote(false);
    await loadEvents(r.id);
    if (r.status === "new") {
      try {
        await markRequestSeen(r.id); // opening it is reading it
        await load();
        await loadEvents(r.id);
        onChanged?.();
      } catch {
        // a member who can only view cannot mark seen; the request still opens
      }
    }
  }

  async function run(action: () => Promise<void>, id: string, fallback: string): Promise<boolean> {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      await afterChange(id);
      return true;
    } catch (err) {
      setActionError(requestErrorMessage(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleReply(r: CustomerRequest): Promise<void> {
    const text = replyText.trim();
    if (!text) return;
    const ok = await run(() => replyToRequest(r.id, text), r.id, "Could not post the reply.");
    if (ok) {
      setWaText(`Hi ${r.customerName}, ${text}\n\nYou can follow this request here: ${publicTrackingUrl(r.trackingToken)}`);
      setReplyText("");
    }
  }

  async function handleNote(r: CustomerRequest): Promise<void> {
    const text = noteText.trim();
    if (!text) return;
    const ok = await run(() => addRequestNote(r.id, text), r.id, "Could not save the note.");
    if (ok) setNoteText("");
  }

  async function openQuoteForm(r: CustomerRequest): Promise<void> {
    setShowQuote(true);
    setQuoteError(null);
    setValidUntil("");
    setQuoteNotes(`From request ${r.referenceCode}`);
    setQuoteLines(
      r.items.length > 0
        ? r.items.map((i) => ({ description: i.description, quantity: String(parseFloat(i.quantity) || 1), price: "" }))
        : [{ description: "", quantity: "1", price: "" }],
    );
    try {
      const list = await listParties(businessId);
      setParties(list);
      const tail = digits(r.customerPhone).slice(-9);
      const match = tail ? list.find((p) => digits(p.contactPhone).endsWith(tail)) : undefined;
      setPartyChoice(match ? match.id : "__new__");
    } catch {
      setParties([]);
      setPartyChoice("__new__");
    }
  }

  async function handleCreateQuotation(r: CustomerRequest): Promise<void> {
    const lines: QuotationLineInput[] = [];
    for (const l of quoteLines) {
      if (!l.description.trim()) continue;
      const price = Number(l.price);
      if (l.price.trim() === "" || Number.isNaN(price) || price < 0) {
        setQuoteError("Enter a price for every line (0 if it is free).");
        return;
      }
      lines.push({ productId: null, description: l.description.trim(), quantity: Number(l.quantity) || 1, unitPrice: price });
    }
    if (lines.length === 0) {
      setQuoteError("Add at least one line.");
      return;
    }
    if (!partyChoice) {
      setQuoteError("Choose the customer.");
      return;
    }
    setQuoteBusy(true);
    setQuoteError(null);
    try {
      let partyId = partyChoice;
      if (partyChoice === "__new__") {
        const created = await partyTransport.createParty({
          businessId,
          displayName: r.customerName,
          partyTypes: ["customer"],
          contactPhone: r.customerPhone ? `+${digits(r.customerPhone)}` : null,
          contactEmail: r.customerEmail,
        });
        partyId = created.id;
      }
      const quotation = await quotationTransport.createQuotation({
        businessId,
        partyId,
        validUntil: validUntil || null,
        notes: quoteNotes.trim() || null,
        lines,
      });
      await linkRequestQuotation(r.id, quotation.id);
      setShowQuote(false);
      await afterChange(r.id);
    } catch (err) {
      setQuoteError(requestErrorMessage(err, "Could not create the quotation."));
    } finally {
      setQuoteBusy(false);
    }
  }

  const visible = (requests ?? []).filter((r) => (tab === "all" ? r.status !== "spam" : r.status === tab));
  const count = (s: RequestStatus) => (requests ?? []).filter((r) => r.status === s).length;

  const columns: Column<CustomerRequest>[] = [
    {
      key: "req",
      header: "Request",
      render: (r) => (
        <>
          <strong>{r.customerName}</strong>
          <div className="ui-cell-sub">
            {r.referenceCode} · {typeLabel(r)}
          </div>
        </>
      ),
    },
    { key: "status", header: "Status", render: (r) => <StatusPill status={r.status} tone={STATUS_TONE[r.status]} label={STATUS_LABEL[r.status]} /> },
    { key: "source", header: "From", render: (r) => r.source ?? "—" },
    { key: "received", header: "Received", render: (r) => formatDate(r.createdAt) },
  ];

  function renderDetail(r: CustomerRequest): JSX.Element {
    const phone = digits(r.customerPhone);
    const closedOrSpam = r.status === "closed" || r.status === "spam";
    return (
      <Card
        title={`${r.referenceCode} — ${r.customerName}`}
        description={`${typeLabel(r)} · received ${when(r.createdAt)}${r.source ? ` · via ${r.source}` : ""}`}
        actions={
          <Button size="sm" variant="ghost" onClick={() => setSelectedId(null)}>
            Close
          </Button>
        }
      >
        <div className="ui-inline-actions">
          {phone && (
            <>
              <a className="ui-btn ui-btn--secondary ui-btn--sm" href={`tel:+${phone}`}>
                Call +{phone}
              </a>
              <a className="ui-btn ui-btn--secondary ui-btn--sm" href={`https://wa.me/${phone}`} target="_blank" rel="noreferrer">
                WhatsApp
              </a>
            </>
          )}
          {r.customerEmail && (
            <a className="ui-btn ui-btn--secondary ui-btn--sm" href={`mailto:${r.customerEmail}`}>
              {r.customerEmail}
            </a>
          )}
        </div>

        {r.items.length > 0 && (
          <>
            <h3 className="ui-section-title">Wants</h3>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {r.items.map((i, idx) => (
                <li key={idx}>
                  {i.description}
                  {i.quantity ? ` × ${i.quantity}` : ""}
                </li>
              ))}
            </ul>
            {(r.neededBy || r.deliveryArea) && (
              <p className="ui-muted">
                {r.neededBy ? `Needed by ${formatDate(r.neededBy)}` : ""}
                {r.neededBy && r.deliveryArea ? " · " : ""}
                {r.deliveryArea ? `Delivery area: ${r.deliveryArea}` : ""}
              </p>
            )}
          </>
        )}
        {r.message && (
          <>
            <h3 className="ui-section-title">Message</h3>
            <p style={{ whiteSpace: "pre-wrap", marginTop: 0 }}>{r.message}</p>
          </>
        )}

        <h3 className="ui-section-title">Timeline</h3>
        {events === null ? (
          <p className="ui-muted">Loading…</p>
        ) : (
          <ol className="req-timeline" aria-label="Request timeline">
            {events.map((e) => (
              <li key={e.id} className="req-timeline__item">
                <div className="req-timeline__head">
                  <strong>{eventLabel(e)}</strong>
                  <span className="ui-muted">
                    {when(e.createdAt)}
                    {!e.isPublic && e.kind !== "received" ? " · only you" : ""}
                  </span>
                </div>
                {e.body && <p className="req-timeline__body">{e.body}</p>}
              </li>
            ))}
          </ol>
        )}

        {r.status !== "spam" && (
          <>
            <h3 className="ui-section-title">Reply</h3>
            <Field label="Your reply" hint="Shown on the customer's private status page">
              {(p) => (
                <textarea {...p} className="ui-textarea" rows={3} maxLength={2000} value={replyText} onChange={(e) => setReplyText(e.target.value)} />
              )}
            </Field>
            <div className="ui-form-actions">
              <Button variant="primary" loading={busy} disabled={!replyText.trim()} onClick={() => void handleReply(r)}>
                Post reply
              </Button>
            </div>
            {waText !== null && (
              <div className="ui-panel">
                <Field label="Also send it on WhatsApp (edit before opening)">
                  {(p) => <textarea {...p} className="ui-textarea" rows={4} value={waText} onChange={(e) => setWaText(e.target.value)} />}
                </Field>
                <p className="ui-note">Nothing is sent until you tap Send in WhatsApp yourself.</p>
                {phone ? (
                  <a
                    className="ui-btn ui-btn--primary ui-btn--sm"
                    href={`https://wa.me/${phone}?text=${encodeURIComponent(waText)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open WhatsApp
                  </a>
                ) : (
                  <p className="ui-muted">This customer left no phone number.</p>
                )}
              </div>
            )}
          </>
        )}

        <h3 className="ui-section-title">Private note</h3>
        <div className="ui-inline-actions" style={{ alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <Field label="Note for yourself" hint="The customer never sees this">
              {(p) => <input {...p} className="ui-input" maxLength={2000} value={noteText} onChange={(e) => setNoteText(e.target.value)} />}
            </Field>
          </div>
          <Button variant="secondary" disabled={busy || !noteText.trim()} onClick={() => void handleNote(r)}>
            Add note
          </Button>
        </div>

        <div className="ui-inline-actions" style={{ marginTop: "var(--aifa-space-4)" }}>
          {r.status !== "spam" && !r.quotationId && !showQuote && (
            <Button variant="primary" onClick={() => void openQuoteForm(r)}>
              Prepare quotation
            </Button>
          )}
          {r.quotationId && onGoToQuotations && (
            <Button variant="secondary" onClick={onGoToQuotations}>
              Quotation prepared: open Quotations
            </Button>
          )}
          {!closedOrSpam && (
            <Button variant="secondary" disabled={busy} onClick={() => void run(() => setRequestStatus(r.id, "closed"), r.id, "Could not close the request.")}>
              Close request
            </Button>
          )}
          {closedOrSpam && (
            <Button variant="secondary" disabled={busy} onClick={() => void run(() => setRequestStatus(r.id, "seen"), r.id, "Could not reopen the request.")}>
              Reopen
            </Button>
          )}
          {r.status !== "spam" && (
            <Button variant="danger" disabled={busy} onClick={() => void run(() => setRequestStatus(r.id, "spam"), r.id, "Could not mark as spam.")}>
              Mark as spam
            </Button>
          )}
        </div>
        {actionError && (
          <p className="aifa-alert aifa-alert--danger" role="alert">
            {actionError}
          </p>
        )}

        {showQuote && (
          <div className="ui-panel">
            <h3 className="ui-section-title" style={{ marginTop: 0 }}>
              Prepare quotation
            </h3>
            <p className="ui-muted" style={{ marginTop: 0 }}>
              This creates a normal quotation draft. It follows the usual Quotations steps, including approval, before it can be sent.
            </p>
            <div className="ui-form-grid">
              <Field label="Customer" required>
                {(p) => (
                  <select {...p} className="ui-select" value={partyChoice} onChange={(e) => setPartyChoice(e.target.value)}>
                    <option value="__new__">New customer: {r.customerName}</option>
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
              <Field label="Notes">
                {(p) => <input {...p} className="ui-input" value={quoteNotes} onChange={(e) => setQuoteNotes(e.target.value)} />}
              </Field>
            </div>
            <h3 className="ui-section-title">Lines</h3>
            {quoteLines.map((l, idx) => (
              <div key={idx} className="ui-inline-actions" style={{ marginBottom: "var(--aifa-space-2)" }}>
                <input
                  className="ui-input"
                  aria-label={`Line ${idx + 1} description`}
                  placeholder="Description"
                  value={l.description}
                  onChange={(e) => setQuoteLines((prev) => prev.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))}
                  style={{ flex: 1, minWidth: 160 }}
                />
                <input
                  className="ui-input"
                  aria-label={`Line ${idx + 1} quantity`}
                  placeholder="Qty"
                  inputMode="decimal"
                  value={l.quantity}
                  onChange={(e) => setQuoteLines((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)))}
                  style={{ width: 80 }}
                />
                <input
                  className="ui-input"
                  aria-label={`Line ${idx + 1} unit price`}
                  placeholder="Unit price (RM)"
                  inputMode="decimal"
                  value={l.price}
                  onChange={(e) => setQuoteLines((prev) => prev.map((x, i) => (i === idx ? { ...x, price: e.target.value } : x)))}
                  style={{ width: 140 }}
                />
                {quoteLines.length > 1 && (
                  <Button size="sm" variant="ghost" icon="x" aria-label={`Remove line ${idx + 1}`} onClick={() => setQuoteLines((prev) => prev.filter((_, i) => i !== idx))} />
                )}
              </div>
            ))}
            <Button size="sm" variant="secondary" icon="plus" onClick={() => setQuoteLines((prev) => [...prev, { description: "", quantity: "1", price: "" }])}>
              Add line
            </Button>
            <div className="ui-form-actions">
              <Button variant="primary" loading={quoteBusy} onClick={() => void handleCreateQuotation(r)}>
                {quoteBusy ? "Creating…" : "Create quotation"}
              </Button>
              <Button variant="secondary" disabled={quoteBusy} onClick={() => setShowQuote(false)}>
                Cancel
              </Button>
            </div>
            {quoteError && (
              <p className="aifa-alert aifa-alert--danger" role="alert">
                {quoteError}
              </p>
            )}
          </div>
        )}
      </Card>
    );
  }

  return (
    <div className="aifa-page">
      <PageHeader
        title="Requests"
        description="Questions and quote requests your customers send from your QR code or public link."
        actions={
          <Button variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
        }
      >
        <TabStrip
          tabs={[
            { id: "all", label: "All", count: requests ? requests.filter((r) => r.status !== "spam").length : undefined },
            { id: "new", label: "New", count: count("new") },
            { id: "seen", label: "Seen", count: count("seen") },
            { id: "replied", label: "Replied", count: count("replied") },
            { id: "quoted", label: "Quoted", count: count("quoted") },
            { id: "closed", label: "Closed", count: count("closed") },
            { id: "spam", label: "Spam", count: count("spam") },
          ]}
          active={tab}
          onChange={setTab}
        />
      </PageHeader>

      {loadError && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {loadError}
        </p>
      )}

      {selected && renderDetail(selected)}

      <Card flush>
        <DataTable
          caption="Customer requests"
          columns={columns}
          rows={loadError ? [] : requests === null ? null : visible}
          rowKey={(r) => r.id}
          onRowClick={(r) => void openRequest(r)}
          selectedKey={selectedId}
          empty={
            <div className="ui-table-state">
              {tab === "all"
                ? "No requests yet. Share your QR code from Business Settings so customers can reach you."
                : "No requests in this view."}
            </div>
          }
        />
      </Card>
    </div>
  );
}
