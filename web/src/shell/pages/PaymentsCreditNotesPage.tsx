/**
 * Payments & Credit Notes — Sprint 40 (Vol 13_0 §4 Module B).
 *
 * GATING NOTE (see paymentsCreditNotesTransport.ts's own header):
 * `recordPayment`/`createCreditNote` are gated server-side on EITHER
 * `capture` on `sales` OR `configure` on `accounting_reports` — this
 * page's forms are shown to any membership with either grant; a
 * membership with neither will see the server reject the call with a
 * clear error rather than the form being silently hidden (Vol 12_2
 * §4.4 gates the sidebar item itself on `sales`, which is the coarser
 * of the two).
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabasePaymentsCreditNotesTransport } from "@aifa/core/sync/paymentsCreditNotesTransport";
import type { PaymentMethod } from "@aifa/core/sync/paymentsCreditNotesTransport";
import type { Invoice } from "@aifa/core/sync/quotationInvoiceTransport";
import type { Party } from "@aifa/core/sync/partyAndLedgerTransport";

import { supabase } from "../../lib/supabaseClient";
import { listParties } from "../../lib/partiesAndAccounts";
import { listInvoices, listPayments, listCreditNotes } from "../../lib/salesCycle";
import type { Payment as PaymentRecord, CreditNote as CreditNoteRecord } from "@aifa/core/sync/paymentsCreditNotesTransport";
import { TabStrip } from "../TabStrip";

const paymentsCreditNotesTransport = createSupabasePaymentsCreditNotesTransport(supabase);

const PAYMENT_METHODS: PaymentMethod[] = ["cash", "bank_transfer", "cheque", "card", "e_wallet"];

type PageTab = "payments" | "credit-notes";

interface Props {
  businessId: string;
}

export function PaymentsCreditNotesPage({ businessId }: Props): JSX.Element {
  const [tab, setTab] = useState<PageTab>("payments");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[] | null>(null);
  const [creditNotes, setCreditNotes] = useState<CreditNoteRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [pInvoiceId, setPInvoiceId] = useState("");
  const [pAmount, setPAmount] = useState("");
  const [pMethod, setPMethod] = useState<PaymentMethod>("cash");
  const [pReference, setPReference] = useState("");
  const [pBusy, setPBusy] = useState(false);
  const [pError, setPError] = useState<string | null>(null);

  const [showCreditForm, setShowCreditForm] = useState(false);
  const [cInvoiceId, setCInvoiceId] = useState("");
  const [cAmount, setCAmount] = useState("");
  const [cReason, setCReason] = useState("");
  const [cBusy, setCBusy] = useState(false);
  const [cError, setCError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [inv, p, pay, cn] = await Promise.all([
        listInvoices(businessId),
        listParties(businessId),
        listPayments(businessId),
        listCreditNotes(businessId),
      ]);
      setInvoices(inv);
      setParties(p);
      setPayments(pay);
      setCreditNotes(cn);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load payments/credit notes.");
    }
  }, [businessId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  function partyName(id: string): string {
    return parties.find((p) => p.id === id)?.displayName ?? `Party #${id.slice(0, 8)}`;
  }

  function invoiceLabel(id: string): string {
    const inv = invoices.find((i) => i.id === id);
    return inv ? `${inv.invoiceNo} — ${partyName(inv.partyId)} (outstanding RM${inv.outstandingBalance.toFixed(2)})` : id.slice(0, 8);
  }

  async function handleRecordPayment(): Promise<void> {
    if (!pInvoiceId || !pAmount.trim()) return;
    setPBusy(true);
    setPError(null);
    try {
      await paymentsCreditNotesTransport.recordPayment({
        businessId,
        invoiceId: pInvoiceId,
        amount: Number(pAmount),
        method: pMethod,
        reference: pReference.trim() || null,
      });
      setPInvoiceId("");
      setPAmount("");
      setPReference("");
      setShowPaymentForm(false);
      await load();
    } catch (err) {
      setPError(err instanceof Error ? err.message : "Could not record payment.");
    } finally {
      setPBusy(false);
    }
  }

  async function handleCreateCreditNote(): Promise<void> {
    if (!cInvoiceId || !cAmount.trim()) return;
    setCBusy(true);
    setCError(null);
    try {
      await paymentsCreditNotesTransport.createCreditNote({
        businessId,
        sourceInvoiceId: cInvoiceId,
        grandTotal: Number(cAmount),
        reason: cReason.trim() || null,
      });
      setCInvoiceId("");
      setCAmount("");
      setCReason("");
      setShowCreditForm(false);
      await load();
    } catch (err) {
      setCError(err instanceof Error ? err.message : "Could not create credit note.");
    } finally {
      setCBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="aifa-page">
        <h1>Payments & Credit Notes</h1>
        <p className="error">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="aifa-page">
      <h1>Payments & Credit Notes</h1>
      <TabStrip
        tabs={[
          { id: "payments", label: "Payments", count: payments?.length },
          { id: "credit-notes", label: "Credit Notes", count: creditNotes?.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "payments" && (
        <>
          <div className="row" style={{ margin: "12px 0" }}>
            <button onClick={() => setShowPaymentForm((s) => !s)}>{showPaymentForm ? "Cancel" : "Record payment"}</button>
          </div>
          {showPaymentForm && (
            <div className="card">
              <h2 style={{ fontSize: 16, marginTop: 0 }}>Record payment</h2>
              <div className="row">
                <select value={pInvoiceId} onChange={(e) => setPInvoiceId(e.target.value)} style={{ padding: 6, minWidth: 280 }}>
                  <option value="">Select invoice…</option>
                  {invoices
                    .filter((i) => i.outstandingBalance > 0)
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {invoiceLabel(i.id)}
                      </option>
                    ))}
                </select>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <input placeholder="Amount (RM)" value={pAmount} onChange={(e) => setPAmount(e.target.value)} style={{ padding: 6, width: 140 }} />
                <select value={pMethod} onChange={(e) => setPMethod(e.target.value as PaymentMethod)} style={{ padding: 6 }}>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <input
                  placeholder="Reference (optional)"
                  value={pReference}
                  onChange={(e) => setPReference(e.target.value)}
                  style={{ padding: 6, flex: 1 }}
                />
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <button onClick={() => void handleRecordPayment()} disabled={pBusy || !pInvoiceId || !pAmount.trim()}>
                  {pBusy ? "Recording…" : "Record payment"}
                </button>
              </div>
              {pError && <p className="error">{pError}</p>}
            </div>
          )}
          {payments === null ? (
            <p className="muted">Loading…</p>
          ) : payments.length === 0 ? (
            <p className="muted">No payments recorded yet.</p>
          ) : (
            payments.map((pmt) => (
              <div key={pmt.id} className="card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{invoiceLabel(pmt.invoiceId)}</strong>
                  <span className="muted">{pmt.receivedAt}</span>
                </div>
                <p className="muted" style={{ margin: "4px 0" }}>
                  RM{pmt.amount.toFixed(2)} via {pmt.method}
                  {pmt.reference && ` — ${pmt.reference}`}
                </p>
              </div>
            ))
          )}
        </>
      )}

      {tab === "credit-notes" && (
        <>
          <div className="row" style={{ margin: "12px 0" }}>
            <button onClick={() => setShowCreditForm((s) => !s)}>{showCreditForm ? "Cancel" : "New credit note"}</button>
          </div>
          {showCreditForm && (
            <div className="card">
              <h2 style={{ fontSize: 16, marginTop: 0 }}>New credit note</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                Routes through the Approvals inbox — stays draft, and the invoice balance is untouched, until that task
                resolves.
              </p>
              <div className="row">
                <select value={cInvoiceId} onChange={(e) => setCInvoiceId(e.target.value)} style={{ padding: 6, minWidth: 280 }}>
                  <option value="">Select invoice…</option>
                  {invoices
                    .filter((i) => i.outstandingBalance > 0)
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {invoiceLabel(i.id)}
                      </option>
                    ))}
                </select>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <input placeholder="Amount (RM)" value={cAmount} onChange={(e) => setCAmount(e.target.value)} style={{ padding: 6, width: 140 }} />
                <input placeholder="Reason (optional)" value={cReason} onChange={(e) => setCReason(e.target.value)} style={{ padding: 6, flex: 1 }} />
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <button onClick={() => void handleCreateCreditNote()} disabled={cBusy || !cInvoiceId || !cAmount.trim()}>
                  {cBusy ? "Creating…" : "Create credit note"}
                </button>
              </div>
              {cError && <p className="error">{cError}</p>}
            </div>
          )}
          {creditNotes === null ? (
            <p className="muted">Loading…</p>
          ) : creditNotes.length === 0 ? (
            <p className="muted">No credit notes yet.</p>
          ) : (
            creditNotes.map((cn) => (
              <div key={cn.id} className="card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{cn.creditNoteNo} — {invoiceLabel(cn.sourceInvoiceId)}</strong>
                  <span className="muted">{cn.status}</span>
                </div>
                <p className="muted" style={{ margin: "4px 0" }}>
                  RM{cn.grandTotal.toFixed(2)} · issued {cn.issueDate}
                  {cn.reason && ` — ${cn.reason}`}
                </p>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}
