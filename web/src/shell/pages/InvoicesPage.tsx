/**
 * Invoices — Sprint 40 (Vol 13_0 §4 Module A/B), extended Sprint 46
 * (Vol 13_0 §11 Module H) with an on-expand Agent & Commission section.
 *
 * OVERDUE NOTE (see paymentsCreditNotesTransport.ts's own header):
 * `Invoice.status` in the database never stores 'overdue' — this page
 * tabs by `invoiceEffectiveStatus`, computed per invoice at load time,
 * so a genuinely overdue invoice shows as Overdue here rather than
 * whatever its stored status happens to be.
 *
 * AGENT & COMMISSION (Sprint 46): reads `invoices.agent_party_id`
 * (disclosed gap — no transport type exposes this column; see
 * `lib/attendanceLeaveCommission.ts`'s own header) and any computed
 * `CommissionCalculation` for the invoice, on expand only — this page
 * doesn't offer to assign an agent or compute commission itself
 * (that's the Commission page's own job); it only surfaces what's
 * already there, so an invoice's detail view doesn't silently omit
 * commission context that exists elsewhere in the app.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabasePaymentsCreditNotesTransport } from "@aifa/core/sync/paymentsCreditNotesTransport";
import type { InvoiceEffectiveStatus } from "@aifa/core/sync/paymentsCreditNotesTransport";
import type { Invoice } from "@aifa/core/sync/quotationInvoiceTransport";
import type { Party } from "@aifa/core/sync/partyAndLedgerTransport";

import { supabase } from "../../lib/supabaseClient";
import { listParties } from "../../lib/partiesAndAccounts";
import {
  listInvoices,
  listInvoiceLines,
  listPaymentsForInvoice,
  listCreditNotesForInvoice,
} from "../../lib/salesCycle";
import type { SalesLine } from "../../lib/salesCycle";
import type { Payment, CreditNote } from "@aifa/core/sync/paymentsCreditNotesTransport";
import type { CommissionCalculation } from "@aifa/core/sync/attendanceLeaveCommissionTransport";
import { listCommissionCalculations, listInvoiceAgentAssignments } from "../../lib/attendanceLeaveCommission";
import { TabStrip } from "../TabStrip";

const paymentsCreditNotesTransport = createSupabasePaymentsCreditNotesTransport(supabase);

type InvoiceTab = "all" | InvoiceEffectiveStatus;

interface Props {
  businessId: string;
}

interface DetailState {
  lines: SalesLine[];
  payments: Payment[];
  creditNotes: CreditNote[];
  agentPartyId: string | null;
  commission: CommissionCalculation | null;
}

export function InvoicesPage({ businessId }: Props): JSX.Element {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [effectiveById, setEffectiveById] = useState<Record<string, InvoiceEffectiveStatus>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<InvoiceTab>("all");

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailById, setDetailById] = useState<Record<string, DetailState>>({});
  const [agentByInvoiceId, setAgentByInvoiceId] = useState<Record<string, string | null>>({});
  const [commissionByInvoiceId, setCommissionByInvoiceId] = useState<Record<string, CommissionCalculation>>({});

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [inv, p, agentMap, commissions] = await Promise.all([
        listInvoices(businessId),
        listParties(businessId),
        listInvoiceAgentAssignments(businessId),
        listCommissionCalculations(businessId),
      ]);
      setInvoices(inv);
      setParties(p);
      setAgentByInvoiceId(agentMap);
      setCommissionByInvoiceId(Object.fromEntries(commissions.map((c) => [c.invoiceId, c])));
      const entries = await Promise.all(
        inv.map(async (i) => [i.id, await paymentsCreditNotesTransport.invoiceEffectiveStatus(i.id)] as const),
      );
      setEffectiveById(Object.fromEntries(entries));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load invoices.");
    }
  }, [businessId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  function partyName(id: string): string {
    return parties.find((p) => p.id === id)?.displayName ?? `Party #${id.slice(0, 8)}`;
  }

  async function toggleExpand(inv: Invoice): Promise<void> {
    if (expandedId === inv.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(inv.id);
    if (!detailById[inv.id]) {
      try {
        const [lines, payments, creditNotes] = await Promise.all([
          listInvoiceLines(inv.id),
          listPaymentsForInvoice(inv.id),
          listCreditNotesForInvoice(inv.id),
        ]);
        setDetailById((prev) => ({
          ...prev,
          [inv.id]: {
            lines,
            payments,
            creditNotes,
            agentPartyId: agentByInvoiceId[inv.id] ?? null,
            commission: commissionByInvoiceId[inv.id] ?? null,
          },
        }));
      } catch {
        // detail is a nice-to-have on expand; leave silently empty on failure
      }
    }
  }

  if (loadError) {
    return (
      <div className="aifa-page">
        <h1>Invoices</h1>
        <p className="error">{loadError}</p>
      </div>
    );
  }

  const effectiveOf = (inv: Invoice): InvoiceEffectiveStatus => effectiveById[inv.id] ?? inv.status;
  const filtered = (invoices ?? []).filter((i) => tab === "all" || effectiveOf(i) === tab);
  const counts = (status: InvoiceEffectiveStatus) => (invoices ?? []).filter((i) => effectiveOf(i) === status).length;

  return (
    <div className="aifa-page">
      <h1>Invoices</h1>
      <TabStrip
        tabs={[
          { id: "all", label: "All", count: invoices?.length },
          { id: "issued", label: "Issued", count: counts("issued") },
          { id: "sent", label: "Sent", count: counts("sent") },
          { id: "overdue", label: "Overdue", count: counts("overdue") },
          { id: "partially_paid", label: "Partially Paid", count: counts("partially_paid") },
          { id: "paid", label: "Paid", count: counts("paid") },
          { id: "cancelled", label: "Cancelled", count: counts("cancelled") },
        ]}
        active={tab}
        onChange={setTab}
      />

      {invoices === null ? (
        <p className="muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">No invoices in this view.</p>
      ) : (
        filtered.map((inv) => {
          const expanded = expandedId === inv.id;
          const detail = detailById[inv.id];
          const eff = effectiveOf(inv);
          return (
            <div key={inv.id} className="card">
              <div className="row" style={{ justifyContent: "space-between", cursor: "pointer" }} onClick={() => void toggleExpand(inv)}>
                <strong>
                  {inv.invoiceNo} — {partyName(inv.partyId)}
                </strong>
                <span className="muted" style={eff === "overdue" ? { color: "#c0392b", fontWeight: 600 } : undefined}>
                  {eff}
                </span>
              </div>
              <p className="muted" style={{ margin: "4px 0" }}>
                {inv.currency} {inv.grandTotal.toFixed(2)} · due {inv.dueDate} · outstanding {inv.currency}{" "}
                {inv.outstandingBalance.toFixed(2)}
                {inv.eInvoiceStatus !== "not_applicable" && ` · e-Invoice: ${inv.eInvoiceStatus}`}
              </p>
              {expanded && (
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--aifa-border, #e2e2e2)" }}>
                  {!detail ? (
                    <p className="muted">Loading detail…</p>
                  ) : (
                    <>
                      <p style={{ fontWeight: 600, margin: "4px 0" }}>Lines</p>
                      {detail.lines.length === 0 ? (
                        <p className="muted">No lines.</p>
                      ) : (
                        detail.lines.map((l) => (
                          <p key={l.id} className="muted" style={{ margin: "2px 0" }}>
                            {l.quantity} × {l.description} @ RM{l.unitPrice.toFixed(2)} = RM{l.lineTotal.toFixed(2)}
                          </p>
                        ))
                      )}
                      <p style={{ fontWeight: 600, margin: "8px 0 4px" }}>Payments</p>
                      {detail.payments.length === 0 ? (
                        <p className="muted">No payments recorded yet.</p>
                      ) : (
                        detail.payments.map((pmt) => (
                          <p key={pmt.id} className="muted" style={{ margin: "2px 0" }}>
                            RM{pmt.amount.toFixed(2)} via {pmt.method} on {pmt.receivedAt}
                            {pmt.reference && ` (${pmt.reference})`}
                          </p>
                        ))
                      )}
                      <p style={{ fontWeight: 600, margin: "8px 0 4px" }}>Credit Notes</p>
                      {detail.creditNotes.length === 0 ? (
                        <p className="muted">None.</p>
                      ) : (
                        detail.creditNotes.map((cn) => (
                          <p key={cn.id} className="muted" style={{ margin: "2px 0" }}>
                            {cn.creditNoteNo} — RM{cn.grandTotal.toFixed(2)} · {cn.status}
                            {cn.reason && ` — ${cn.reason}`}
                          </p>
                        ))
                      )}
                      <p style={{ fontWeight: 600, margin: "8px 0 4px" }}>Agent &amp; Commission</p>
                      <p className="muted" style={{ margin: "2px 0" }}>
                        {detail.agentPartyId ? `Agent #${detail.agentPartyId.slice(0, 8)}` : "No agent assigned"}
                        {detail.commission && ` · commission RM${detail.commission.amount.toFixed(2)} (${detail.commission.status})`}
                      </p>
                      <p className="muted" style={{ margin: "2px 0" }}>
                        Assign an agent or compute commission from the Commission page.
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
