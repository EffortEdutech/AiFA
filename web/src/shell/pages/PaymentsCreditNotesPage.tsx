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
 *
 * UI polish Phase 4: presentation only — header with actions, labelled forms
 * in cards, tables for the two lists. Same calls and gating.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabasePaymentsCreditNotesTransport } from "@aifa/core/sync/paymentsCreditNotesTransport";
import type { PaymentMethod } from "@aifa/core/sync/paymentsCreditNotesTransport";
import type { Invoice } from "@aifa/core/sync/quotationInvoiceTransport";
import type { Party } from "@aifa/core/sync/partyAndLedgerTransport";

import { Button, Card, DataTable, Field, PageHeader, StatusPill, formatDate, formatMoney, humanizeStatus, type Column } from "../../ui";
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

  const openInvoices = invoices.filter((i) => i.outstandingBalance > 0);

  const invoiceSelect = (value: string, onChange: (v: string) => void) => (p: Parameters<Parameters<typeof Field>[0]["children"]>[0]) => (
    <select {...p} className="ui-select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select invoice…</option>
      {openInvoices.map((i) => (
        <option key={i.id} value={i.id}>
          {invoiceLabel(i.id)}
        </option>
      ))}
    </select>
  );

  const paymentColumns: Column<PaymentRecord>[] = [
    { key: "inv", header: "Invoice", render: (pmt) => invoiceLabel(pmt.invoiceId) },
    { key: "when", header: "Received", render: (pmt) => formatDate(pmt.receivedAt) },
    { key: "method", header: "Method", render: (pmt) => humanizeStatus(pmt.method) },
    { key: "ref", header: "Reference", render: (pmt) => pmt.reference ?? "—" },
    { key: "amt", header: "Amount", numeric: true, render: (pmt) => formatMoney(pmt.amount) },
  ];

  const creditColumns: Column<CreditNoteRecord>[] = [
    {
      key: "cn",
      header: "Credit note",
      render: (cn) => (
        <>
          <strong>{cn.creditNoteNo}</strong>
          <div className="ui-cell-sub">{invoiceLabel(cn.sourceInvoiceId)}</div>
        </>
      ),
    },
    { key: "status", header: "Status", render: (cn) => <StatusPill status={cn.status} /> },
    { key: "issued", header: "Issued", render: (cn) => formatDate(cn.issueDate) },
    { key: "reason", header: "Reason", render: (cn) => cn.reason ?? "—" },
    { key: "amt", header: "Amount", numeric: true, render: (cn) => formatMoney(cn.grandTotal) },
  ];

  return (
    <div className="aifa-page">
      <PageHeader
        title="Payments & Credit Notes"
        actions={
          tab === "payments" ? (
            <Button variant="primary" icon={showPaymentForm ? undefined : "plus"} onClick={() => setShowPaymentForm((s) => !s)}>
              {showPaymentForm ? "Cancel" : "Record payment"}
            </Button>
          ) : (
            <Button variant="primary" icon={showCreditForm ? undefined : "plus"} onClick={() => setShowCreditForm((s) => !s)}>
              {showCreditForm ? "Cancel" : "New credit note"}
            </Button>
          )
        }
      >
        <TabStrip
          tabs={[
            { id: "payments", label: "Payments", count: payments?.length },
            { id: "credit-notes", label: "Credit Notes", count: creditNotes?.length },
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

      {tab === "payments" && (
        <>
          {showPaymentForm && (
            <Card title="Record payment">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!pBusy && pInvoiceId && pAmount.trim()) void handleRecordPayment();
                }}
              >
                <div className="ui-form-grid">
                  <Field label="Invoice" required>
                    {invoiceSelect(pInvoiceId, setPInvoiceId)}
                  </Field>
                  <Field label="Amount (RM)" required>
                    {(p) => <input {...p} className="ui-input" inputMode="decimal" value={pAmount} onChange={(e) => setPAmount(e.target.value)} />}
                  </Field>
                  <Field label="Method">
                    {(p) => (
                      <select {...p} className="ui-select" value={pMethod} onChange={(e) => setPMethod(e.target.value as PaymentMethod)}>
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <Field label="Reference (optional)">
                    {(p) => <input {...p} className="ui-input" value={pReference} onChange={(e) => setPReference(e.target.value)} />}
                  </Field>
                </div>
                <div className="ui-form-actions">
                  <Button type="submit" variant="primary" loading={pBusy} disabled={!pInvoiceId || !pAmount.trim()}>
                    {pBusy ? "Recording…" : "Record payment"}
                  </Button>
                </div>
                {pError && (
                  <p className="aifa-alert aifa-alert--danger" role="alert">
                    {pError}
                  </p>
                )}
              </form>
            </Card>
          )}
          <Card flush>
            <DataTable
              caption="Recorded payments"
              columns={paymentColumns}
              rows={loadError ? [] : payments}
              rowKey={(pmt) => pmt.id}
              empty={<div className="ui-table-state">No payments recorded yet.</div>}
            />
          </Card>
        </>
      )}

      {tab === "credit-notes" && (
        <>
          {showCreditForm && (
            <Card
              title="New credit note"
              description="Routes through the Approvals inbox — stays draft, and the invoice balance is untouched, until that task resolves."
            >
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!cBusy && cInvoiceId && cAmount.trim()) void handleCreateCreditNote();
                }}
              >
                <div className="ui-form-grid">
                  <Field label="Invoice" required>
                    {invoiceSelect(cInvoiceId, setCInvoiceId)}
                  </Field>
                  <Field label="Amount (RM)" required>
                    {(p) => <input {...p} className="ui-input" inputMode="decimal" value={cAmount} onChange={(e) => setCAmount(e.target.value)} />}
                  </Field>
                  <Field label="Reason (optional)">
                    {(p) => <input {...p} className="ui-input" value={cReason} onChange={(e) => setCReason(e.target.value)} />}
                  </Field>
                </div>
                <div className="ui-form-actions">
                  <Button type="submit" variant="primary" loading={cBusy} disabled={!cInvoiceId || !cAmount.trim()}>
                    {cBusy ? "Creating…" : "Create credit note"}
                  </Button>
                </div>
                {cError && (
                  <p className="aifa-alert aifa-alert--danger" role="alert">
                    {cError}
                  </p>
                )}
              </form>
            </Card>
          )}
          <Card flush>
            <DataTable
              caption="Credit notes"
              columns={creditColumns}
              rows={loadError ? [] : creditNotes}
              rowKey={(cn) => cn.id}
              empty={<div className="ui-table-state">No credit notes yet.</div>}
            />
          </Card>
        </>
      )}
    </div>
  );
}
