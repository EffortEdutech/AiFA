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
 *
 * UI polish Phase 3 (pilot page): presentation only — one table instead
 * of a card per invoice, and the invoice's detail opens in a panel above
 * the table instead of expanding in place. Same reads, same effective
 * status logic, same detail contents.
 */
import { useCallback, useEffect, useRef, useState } from "react";

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
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  SkeletonLines,
  StatusPill,
  formatDate,
  formatMoney,
  humanizeStatus,
  type Column,
} from "../../ui";
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

/** Money in the invoice's own currency; MYR uses the console's RM format. */
function money(currency: string, amount: number): string {
  return currency === "MYR" || currency === "RM" ? formatMoney(amount) : `${currency} ${amount.toFixed(2)}`;
}

export function InvoicesPage({ businessId }: Props): JSX.Element {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [effectiveById, setEffectiveById] = useState<Record<string, InvoiceEffectiveStatus>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<InvoiceTab>("all");

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailById, setDetailById] = useState<Record<string, DetailState>>({});
  const [detailError, setDetailError] = useState<string | null>(null);
  const [agentByInvoiceId, setAgentByInvoiceId] = useState<Record<string, string | null>>({});
  const [commissionByInvoiceId, setCommissionByInvoiceId] = useState<Record<string, CommissionCalculation>>({});
  const detailRef = useRef<HTMLDivElement>(null);

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

  // Bring the detail panel into view when it opens, even from far down a long list.
  useEffect(() => {
    if (expandedId) detailRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [expandedId]);

  function partyName(id: string): string {
    return parties.find((p) => p.id === id)?.displayName ?? `Party #${id.slice(0, 8)}`;
  }

  async function toggleExpand(inv: Invoice): Promise<void> {
    if (expandedId === inv.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(inv.id);
    setDetailError(null);
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
        setDetailError("Could not load this invoice's detail. Select it again to retry.");
      }
    }
  }

  const effectiveOf = (inv: Invoice): InvoiceEffectiveStatus => effectiveById[inv.id] ?? inv.status;
  const filtered = invoices === null ? null : invoices.filter((i) => tab === "all" || effectiveOf(i) === tab);
  const counts = (status: InvoiceEffectiveStatus) => (invoices ?? []).filter((i) => effectiveOf(i) === status).length;

  const columns: Column<Invoice>[] = [
    {
      key: "no",
      header: "Invoice",
      render: (i) => (
        <>
          <strong>{i.invoiceNo}</strong>
          <span className="ui-cell-sub">{partyName(i.partyId)}</span>
        </>
      ),
    },
    { key: "status", header: "Status", render: (i) => <StatusPill status={effectiveOf(i)} /> },
    { key: "total", header: "Total", numeric: true, render: (i) => money(i.currency, i.grandTotal) },
    { key: "due", header: "Due", render: (i) => formatDate(i.dueDate) },
    { key: "outstanding", header: "Outstanding", numeric: true, render: (i) => money(i.currency, i.outstandingBalance) },
    {
      key: "einvoice",
      header: "e-Invoice",
      render: (i) => (i.eInvoiceStatus !== "not_applicable" ? <StatusPill status={i.eInvoiceStatus} /> : "—"),
    },
  ];

  const expandedInvoice = expandedId ? (invoices ?? []).find((i) => i.id === expandedId) ?? null : null;
  const detail = expandedInvoice ? detailById[expandedInvoice.id] : undefined;

  return (
    <div className="ui-page">
      <PageHeader title="Invoices" description="Invoices issued to customers, with their payments and credit notes.">
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
      </PageHeader>

      {expandedInvoice && (
        <div ref={detailRef}>
          <Card
            title={`${expandedInvoice.invoiceNo} — ${partyName(expandedInvoice.partyId)}`}
            description="Invoice detail"
            actions={
              <Button size="sm" variant="secondary" icon="x" onClick={() => setExpandedId(null)}>
                Close
              </Button>
            }
          >
            {detailError ? (
              <p className="aifa-alert aifa-alert--danger" role="alert">
                {detailError}
              </p>
            ) : !detail ? (
              <SkeletonLines lines={4} />
            ) : (
              <>
                <h3 className="ui-section-title">Lines</h3>
                <DataTable
                  caption="Invoice lines"
                  rows={detail.lines}
                  rowKey={(l) => l.id}
                  empty={<div className="ui-table-state">No lines.</div>}
                  columns={[
                    { key: "qty", header: "Qty", numeric: true, width: 70, render: (l) => l.quantity },
                    { key: "desc", header: "Description", render: (l) => l.description },
                    { key: "price", header: "Unit price", numeric: true, render: (l) => formatMoney(l.unitPrice) },
                    { key: "total", header: "Line total", numeric: true, render: (l) => formatMoney(l.lineTotal) },
                  ]}
                />

                <h3 className="ui-section-title">Payments</h3>
                <DataTable
                  caption="Payments received"
                  rows={detail.payments}
                  rowKey={(p) => p.id}
                  empty={<div className="ui-table-state">No payments recorded yet.</div>}
                  columns={[
                    { key: "date", header: "Received", render: (p) => formatDate(p.receivedAt) },
                    { key: "method", header: "Method", render: (p) => humanizeStatus(p.method) },
                    { key: "ref", header: "Reference", render: (p) => p.reference ?? "—" },
                    { key: "amount", header: "Amount", numeric: true, render: (p) => formatMoney(p.amount) },
                  ]}
                />

                <h3 className="ui-section-title">Credit notes</h3>
                <DataTable
                  caption="Credit notes"
                  rows={detail.creditNotes}
                  rowKey={(c) => c.id}
                  empty={<div className="ui-table-state">None.</div>}
                  columns={[
                    { key: "no", header: "Credit note", render: (c) => c.creditNoteNo },
                    { key: "status", header: "Status", render: (c) => <StatusPill status={c.status} /> },
                    { key: "reason", header: "Reason", render: (c) => c.reason ?? "—" },
                    { key: "total", header: "Total", numeric: true, render: (c) => formatMoney(c.grandTotal) },
                  ]}
                />

                <h3 className="ui-section-title">Agent &amp; commission</h3>
                <p style={{ margin: 0 }}>
                  {detail.agentPartyId ? `Agent #${detail.agentPartyId.slice(0, 8)}` : "No agent assigned"}
                  {detail.commission && ` · commission ${formatMoney(detail.commission.amount)} (${humanizeStatus(detail.commission.status)})`}
                </p>
                <p className="ui-note">Assign an agent or compute commission from the Commission page.</p>
              </>
            )}
          </Card>
        </div>
      )}

      <Card flush>
        <DataTable
          caption="Invoices"
          columns={columns}
          rows={filtered}
          rowKey={(i) => i.id}
          error={loadError}
          selectedKey={expandedId}
          onRowClick={(inv) => void toggleExpand(inv)}
          empty={
            <EmptyState
              icon="receipt"
              title={tab === "all" ? "No invoices yet" : "No invoices in this view"}
              description={
                tab === "all"
                  ? "Invoices you issue will appear here."
                  : "Try another status tab."
              }
            />
          }
        />
      </Card>
    </div>
  );
}
