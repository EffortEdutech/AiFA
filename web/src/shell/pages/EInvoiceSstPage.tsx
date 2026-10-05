/**
 * e-Invoice & SST Compliance — Sprint 44 (Vol 13_0 §9 Module F).
 *
 * ============================================================
 * STUB WARNING — this file's central discipline, per this sprint's
 * own DoD: `eInvoiceSstTransport.ts`'s `StubMyInvoisClient` never
 * makes a real call to LHDN MyInvois. Every "submit" action in this
 * page routes through that stub and produces a FABRICATED uuid/QR
 * reference, or a caller-chosen simulated rejection — never a real
 * IRB response. A persistent, unmissable banner is rendered above
 * BOTH tabs (not just once at the top of one screen) so this can
 * never be mistaken for a live LHDN connection. Do not remove or
 * soften this banner without a real MyInvoisClient implementation
 * replacing StubMyInvoisClient first (see that file's own header).
 * ============================================================
 *
 * PAYMENT VOUCHER SST — DISCLOSED GAP (not built this sprint):
 * `computeSstForPaymentVoucher` is gated on `payment_vouchers.sst_code`
 * being set, but that column was added in this same Sprint 33
 * migration, AFTER Sprint 30's `createPaymentVoucher` RPC was already
 * shipped — no RPC anywhere accepts an `sst_code` value, and
 * `payment_vouchers` has no client-facing UPDATE policy (only RPCs
 * mutate it, by this codebase's own established convention). There is
 * therefore no way to reach `computeSstForPaymentVoucher` successfully
 * from this UI today; building a button for it would just produce a
 * `payment_voucher_has_no_sst_code_set` error on every click. Left
 * unbuilt and disclosed here and in this sprint's Outcomes, rather
 * than shipping a dead button — Invoice-side SST computation (the
 * primary flow) is fully built below.
 *
 * UI polish Phase 4: presentation only. Both SIMULATED banners, the tax-advice
 * boundary statement and every disclosure below are kept, as alerts.
 */
import { useCallback, useEffect, useState } from "react";

import {
  createSupabaseEInvoiceSstTransport,
  StubMyInvoisClient,
  TAX_ADVICE_BOUNDARY_STATEMENT,
} from "@aifa/core/sync/eInvoiceSstTransport";
import type { EInvoiceSubmission, SstRate, SstTransaction, SstReturn } from "@aifa/core/sync/eInvoiceSstTransport";
import type { Invoice } from "@aifa/core/sync/quotationInvoiceTransport";

import { supabase } from "../../lib/supabaseClient";
import { listInvoices } from "../../lib/salesCycle";
import {
  listEInvoiceSubmissions,
  listSstRates,
  listSstTransactions,
  listSstReturns,
  listEInvoiceSubmissionLines,
} from "../../lib/einvoiceSst";
import { Button, Card, DataTable, Field, PageHeader, StatusPill, formatMoney, type Column } from "../../ui";
import { TabStrip } from "../TabStrip";

const eInvoiceSstTransport = createSupabaseEInvoiceSstTransport(supabase);
const myInvoisClient = new StubMyInvoisClient();

type ComplianceTab = "e-invoice" | "sst";

interface Props {
  businessId: string;
}

function invoiceLabel(invoices: Invoice[], id: string | null): string {
  if (!id) return "(consolidated batch)";
  const inv = invoices.find((i) => i.id === id);
  return inv ? inv.invoiceNo : `Invoice #${id.slice(0, 8)}`;
}

function parseIrbResponse(ref: string | null): { code?: string; message?: string; simulated?: boolean } | null {
  if (!ref) return null;
  try {
    const parsed = JSON.parse(ref) as { simulated?: boolean; irbResponseCode?: string; irbResponseMessage?: string };
    return { code: parsed.irbResponseCode, message: parsed.irbResponseMessage, simulated: parsed.simulated };
  } catch {
    return { message: ref };
  }
}

export function EInvoiceSstPage({ businessId }: Props): JSX.Element {
  const [tab, setTab] = useState<ComplianceTab>("e-invoice");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [submissions, setSubmissions] = useState<EInvoiceSubmission[] | null>(null);
  const [submissionLinesById, setSubmissionLinesById] = useState<Record<string, string[]>>({});

  const [createInvoiceId, setCreateInvoiceId] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [consolidatedPeriod, setConsolidatedPeriod] = useState("");
  const [consolidatedBusy, setConsolidatedBusy] = useState(false);
  const [consolidatedError, setConsolidatedError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [simulateRejectFor, setSimulateRejectFor] = useState<string | null>(null);
  const [rejectCode, setRejectCode] = useState("IRB-VALIDATION-ERROR");
  const [rejectMessage, setRejectMessage] = useState("Simulated rejection: mismatched TIN on buyer party.");

  const [sstRates, setSstRates] = useState<SstRate[]>([]);
  const [sstTransactions, setSstTransactions] = useState<SstTransaction[] | null>(null);
  const [sstReturns, setSstReturns] = useState<SstReturn[] | null>(null);

  const [computeInvoiceId, setComputeInvoiceId] = useState("");
  const [computeBusy, setComputeBusy] = useState(false);
  const [computeError, setComputeError] = useState<string | null>(null);

  const [returnPeriod, setReturnPeriod] = useState("");
  const [returnBusy, setReturnBusy] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [inv, subs, rates, txns, returns] = await Promise.all([
        listInvoices(businessId),
        listEInvoiceSubmissions(businessId),
        listSstRates(),
        listSstTransactions(businessId),
        listSstReturns(businessId),
      ]);
      setInvoices(inv);
      setSubmissions(subs);
      setSstRates(rates);
      setSstTransactions(txns);
      setSstReturns(returns);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load e-Invoice / SST data.");
    }
  }, [businessId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function loadSubmissionLines(submissionId: string): Promise<void> {
    if (submissionLinesById[submissionId]) return;
    try {
      const lines = await listEInvoiceSubmissionLines(submissionId);
      setSubmissionLinesById((prev) => ({ ...prev, [submissionId]: lines.map((l) => l.invoiceId) }));
    } catch {
      // batch-line detail is a nice-to-have; leave silently empty on failure
    }
  }

  const activeInvoiceIds = new Set(
    (submissions ?? []).filter((s) => s.invoiceId && s.status !== "rejected" && s.status !== "cancelled").map((s) => s.invoiceId),
  );
  const eligibleInvoices = invoices.filter((i) => !activeInvoiceIds.has(i.id));

  async function handleCreateSubmission(): Promise<void> {
    if (!createInvoiceId) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      await eInvoiceSstTransport.createSubmission({ businessId, invoiceId: createInvoiceId });
      setCreateInvoiceId("");
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create this submission.");
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleGenerateConsolidated(): Promise<void> {
    if (!consolidatedPeriod.trim()) return;
    setConsolidatedBusy(true);
    setConsolidatedError(null);
    try {
      await eInvoiceSstTransport.generateConsolidatedBatch({ businessId, consolidatedPeriod: consolidatedPeriod.trim() });
      setConsolidatedPeriod("");
      await load();
    } catch (err) {
      setConsolidatedError(err instanceof Error ? err.message : "Could not generate this consolidated batch.");
    } finally {
      setConsolidatedBusy(false);
    }
  }

  /** Submit -> stub MyInvois call -> record result, as one action (this UI never leaves a submission stuck in 'submitted' waiting on a real async callback that will never come from the stub). */
  async function handleSubmitToStub(submission: EInvoiceSubmission, rejection?: { irbResponseCode: string; irbResponseMessage: string }): Promise<void> {
    setBusyId(submission.id);
    setActionError(null);
    try {
      await eInvoiceSstTransport.submitEinvoice(submission.id);
      const result = await myInvoisClient.submitForValidation(
        { submissionId: submission.id, payload: null },
        rejection,
      );
      await eInvoiceSstTransport.recordSubmissionResult({
        submissionId: submission.id,
        status: result.status,
        lhdnUuid: result.lhdnUuid,
        qrCodeRef: result.qrCodeRef,
        irbResponseRef: result.irbResponseRef,
      });
      setSimulateRejectFor(null);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not submit this e-Invoice.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleComputeSst(): Promise<void> {
    if (!computeInvoiceId) return;
    setComputeBusy(true);
    setComputeError(null);
    try {
      await eInvoiceSstTransport.computeSstForInvoice(computeInvoiceId);
      setComputeInvoiceId("");
      await load();
    } catch (err) {
      setComputeError(err instanceof Error ? err.message : "Could not compute SST for this invoice.");
    } finally {
      setComputeBusy(false);
    }
  }

  async function handleCreateReturn(): Promise<void> {
    if (!returnPeriod.trim()) return;
    setReturnBusy(true);
    setReturnError(null);
    try {
      await eInvoiceSstTransport.createSstReturn({ businessId, period: returnPeriod.trim() });
      setReturnPeriod("");
      await load();
    } catch (err) {
      setReturnError(err instanceof Error ? err.message : "Could not create this SST return.");
    } finally {
      setReturnBusy(false);
    }
  }

  async function handleSubmitReturn(sstReturn: SstReturn): Promise<void> {
    setBusyId(sstReturn.id);
    setReturnError(null);
    try {
      await eInvoiceSstTransport.submitSstReturn(sstReturn.id);
      await load();
    } catch (err) {
      setReturnError(err instanceof Error ? err.message : "Could not submit this SST return.");
    } finally {
      setBusyId(null);
    }
  }

  const submissionColumns: Column<EInvoiceSubmission>[] = [
    {
      key: "sub",
      header: "Submission",
      render: (s) => (
        <>
          <strong>
            {s.submissionType === "consolidated" ? `Consolidated — ${s.consolidatedPeriod}` : invoiceLabel(invoices, s.invoiceId)}
          </strong>
          {s.submissionType === "consolidated" && (
            <div>
              <button type="button" className="aifa-link-btn" onClick={() => void loadSubmissionLines(s.id)}>
                {submissionLinesById[s.id] ? `${submissionLinesById[s.id].length} invoice(s) in this batch` : "Show invoices in batch"}
              </button>
            </div>
          )}
        </>
      ),
    },
    { key: "status", header: "Status", render: (s) => <StatusPill status={s.status} /> },
    {
      key: "detail",
      header: "Simulated result",
      render: (s) => {
        const rejection = s.status === "rejected" ? parseIrbResponse(s.irbResponseRef) : null;
        const success = s.status === "validated" ? parseIrbResponse(s.irbResponseRef) : null;
        return (
          <>
            {s.lhdnUuid && (
              <div className="ui-cell-sub">
                Simulated LHDN UUID: <code>{s.lhdnUuid}</code> · Simulated QR ref: <code>{s.qrCodeRef}</code>
              </div>
            )}
            {success && <div className="ui-cell-sub">Simulated IRB response: {success.code ?? "OK"}</div>}
            {rejection && (
              <div className="ui-cell-sub" style={{ color: "var(--aifa-danger)" }}>
                Simulated rejection — {rejection.code ?? "no code"}: {rejection.message ?? "no message"}
              </div>
            )}
          </>
        );
      },
    },
    {
      key: "actions",
      header: "",
      render: (s) =>
        s.status === "draft" ? (
          <div className="ui-inline-actions">
            <Button size="sm" variant="primary" loading={busyId === s.id} onClick={() => void handleSubmitToStub(s)}>
              {busyId === s.id ? "Submitting (simulated)…" : "Submit (simulated — succeed)"}
            </Button>
            <Button size="sm" variant="secondary" disabled={busyId === s.id} onClick={() => setSimulateRejectFor(simulateRejectFor === s.id ? null : s.id)}>
              {simulateRejectFor === s.id ? "Cancel" : "Submit (simulated — test rejection)"}
            </Button>
          </div>
        ) : null,
    },
  ];

  const sstTxColumns: Column<SstTransaction>[] = [
    {
      key: "src",
      header: "Source",
      render: (t) => (t.invoiceId ? invoiceLabel(invoices, t.invoiceId) : `PV #${(t.paymentVoucherId ?? "").slice(0, 8)}`),
    },
    { key: "code", header: "SST code", render: (t) => t.sstCode },
    { key: "rate", header: "Rate", numeric: true, render: (t) => `${(t.rate * 100).toFixed(0)}%` },
    { key: "taxable", header: "Taxable amount", numeric: true, render: (t) => formatMoney(t.taxableAmount) },
    { key: "sst", header: "SST amount", numeric: true, render: (t) => formatMoney(t.sstAmount) },
  ];

  const returnColumns: Column<SstReturn>[] = [
    { key: "period", header: "Period", render: (r) => <strong>{r.period}</strong> },
    { key: "status", header: "Status", render: (r) => <StatusPill status={r.status} /> },
    { key: "tax", header: "Total output tax", numeric: true, render: (r) => formatMoney(r.totalOutputTax) },
    {
      key: "actions",
      header: "",
      render: (r) =>
        r.status === "draft" ? (
          <Button size="sm" variant="secondary" loading={busyId === r.id} onClick={() => void handleSubmitReturn(r)}>
            {busyId === r.id ? "Submitting…" : "Submit (status only — not a real Kastam filing)"}
          </Button>
        ) : null,
    },
  ];

  const rejectTarget = submissions?.find((x) => x.id === simulateRejectFor) ?? null;

  return (
    <div className="aifa-page">
      <PageHeader
        title="e-Invoice & SST Compliance"
        description={TAX_ADVICE_BOUNDARY_STATEMENT}
      >
        <TabStrip
          tabs={[
            { id: "e-invoice", label: "e-Invoice" },
            { id: "sst", label: "SST" },
          ]}
          active={tab}
          onChange={setTab}
        />
      </PageHeader>

      <div className="aifa-alert aifa-alert--danger" role="alert" style={{ textAlign: "center", fontWeight: 700 }}>
        ⚠ SIMULATED — NOT CONNECTED TO LHDN MyInvois. Every result on this page (uuid, QR code, IRB response) is
        fabricated by a local stub, not a real government submission.
      </div>

      {loadError && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {loadError}
        </p>
      )}

      {tab === "e-invoice" && (
        <>
          <Card title="New submission (single invoice)">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!createBusy && createInvoiceId) void handleCreateSubmission();
              }}
            >
              <div className="ui-inline-actions" style={{ alignItems: "flex-end" }}>
                <Field label="Invoice">
                  {(p) => (
                    <select {...p} className="ui-select" value={createInvoiceId} onChange={(e) => setCreateInvoiceId(e.target.value)}>
                      <option value="">Select invoice…</option>
                      {eligibleInvoices.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.invoiceNo}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Button type="submit" variant="primary" loading={createBusy} disabled={!createInvoiceId}>
                  {createBusy ? "Creating…" : "Create draft submission"}
                </Button>
              </div>
              {eligibleInvoices.length === 0 && <p className="ui-muted">Every invoice already has an active submission.</p>}
              {createError && (
                <p className="aifa-alert aifa-alert--danger" role="alert">
                  {createError}
                </p>
              )}
            </form>
          </Card>

          <Card
            title="New consolidated batch"
            description="Bundles all eligible (non-B2B) invoices in this period into one draft submission. Throws if a batch already exists for the period, or no eligible invoices are found."
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!consolidatedBusy && consolidatedPeriod.trim()) void handleGenerateConsolidated();
              }}
            >
              <div className="ui-inline-actions" style={{ alignItems: "flex-end" }}>
                <Field label="Period" hint="e.g. 2026-08">
                  {(p) => <input {...p} className="ui-input" value={consolidatedPeriod} onChange={(e) => setConsolidatedPeriod(e.target.value)} />}
                </Field>
                <Button type="submit" variant="primary" loading={consolidatedBusy} disabled={!consolidatedPeriod.trim()}>
                  {consolidatedBusy ? "Generating…" : "Generate batch"}
                </Button>
              </div>
              {consolidatedError && (
                <p className="aifa-alert aifa-alert--danger" role="alert">
                  {consolidatedError}
                </p>
              )}
            </form>
          </Card>

          {actionError && (
            <p className="aifa-alert aifa-alert--danger" role="alert">
              {actionError}
            </p>
          )}

          {rejectTarget && (
            <Card
              title="Simulated rejection"
              description={`For ${rejectTarget.submissionType === "consolidated" ? `consolidated ${rejectTarget.consolidatedPeriod}` : invoiceLabel(invoices, rejectTarget.invoiceId)}`}
            >
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (rejectCode.trim() && rejectMessage.trim())
                    void handleSubmitToStub(rejectTarget, { irbResponseCode: rejectCode, irbResponseMessage: rejectMessage });
                }}
              >
                <div className="ui-form-grid">
                  <Field label="IRB response code">
                    {(p) => <input {...p} className="ui-input" value={rejectCode} onChange={(e) => setRejectCode(e.target.value)} />}
                  </Field>
                  <Field label="IRB response message">
                    {(p) => <input {...p} className="ui-input" value={rejectMessage} onChange={(e) => setRejectMessage(e.target.value)} />}
                  </Field>
                </div>
                <div className="ui-form-actions">
                  <Button
                    type="submit"
                    variant="danger"
                    loading={busyId === rejectTarget.id}
                    disabled={!rejectCode.trim() || !rejectMessage.trim()}
                  >
                    {busyId === rejectTarget.id ? "Submitting (simulated)…" : "Confirm simulated rejection"}
                  </Button>
                </div>
              </form>
            </Card>
          )}

          <Card title="Submissions" flush>
            <DataTable
              caption="e-Invoice submissions"
              columns={submissionColumns}
              rows={loadError ? [] : submissions}
              rowKey={(s) => s.id}
              empty={<div className="ui-table-state">No e-Invoice submissions yet.</div>}
            />
          </Card>
        </>
      )}

      {tab === "sst" && (
        <>
          <Card title="SST rate catalog">
            <ul className="ui-move-list">
              {sstRates.map((r) => (
                <li key={r.sstCode} className="ui-move">
                  <span>
                    <strong>{r.sstCode}</strong> <span className="ui-muted">({r.taxType})</span>
                  </span>
                  <span className="ui-muted">
                    {(r.rate * 100).toFixed(0)}% — {r.description}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card
            title="Compute SST for an invoice"
            description="Only lines carrying a recognised tax code (set at quotation/invoice line entry) are taxed; lines with no tax code are silently skipped — not an error. Throws if SST was already computed for this invoice."
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!computeBusy && computeInvoiceId) void handleComputeSst();
              }}
            >
              <div className="ui-inline-actions" style={{ alignItems: "flex-end" }}>
                <Field label="Invoice">
                  {(p) => (
                    <select {...p} className="ui-select" value={computeInvoiceId} onChange={(e) => setComputeInvoiceId(e.target.value)}>
                      <option value="">Select invoice…</option>
                      {invoices.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.invoiceNo}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Button type="submit" variant="primary" loading={computeBusy} disabled={!computeInvoiceId}>
                  {computeBusy ? "Computing…" : "Compute SST"}
                </Button>
              </div>
              <p className="ui-muted">
                Payment Voucher SST computation isn't reachable from this page — see this page's own header comment
                for the disclosed reason (no way to set a Payment Voucher's SST code from any existing RPC).
              </p>
              {computeError && (
                <p className="aifa-alert aifa-alert--danger" role="alert">
                  {computeError}
                </p>
              )}
            </form>
          </Card>

          <Card title="SST transactions" flush>
            <DataTable
              caption="SST transactions"
              columns={sstTxColumns}
              rows={loadError ? [] : sstTransactions}
              rowKey={(t) => t.id}
              empty={<div className="ui-table-state">No SST computed yet.</div>}
            />
          </Card>

          <Card
            title="New SST return"
            description={`Aggregates all SST transactions in the period. "Submit" here is a status flip only — not a real Kastam API integration (per the transport's own note).`}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!returnBusy && returnPeriod.trim()) void handleCreateReturn();
              }}
            >
              <div className="ui-inline-actions" style={{ alignItems: "flex-end" }}>
                <Field label="Period" hint="e.g. 2026-08">
                  {(p) => <input {...p} className="ui-input" value={returnPeriod} onChange={(e) => setReturnPeriod(e.target.value)} />}
                </Field>
                <Button type="submit" variant="primary" loading={returnBusy} disabled={!returnPeriod.trim()}>
                  {returnBusy ? "Creating…" : "Create return"}
                </Button>
              </div>
              {returnError && (
                <p className="aifa-alert aifa-alert--danger" role="alert">
                  {returnError}
                </p>
              )}
            </form>
          </Card>

          <Card title="SST returns" flush>
            <DataTable
              caption="SST returns"
              columns={returnColumns}
              rows={loadError ? [] : sstReturns}
              rowKey={(r) => r.id}
              empty={<div className="ui-table-state">No SST returns yet.</div>}
            />
          </Card>
        </>
      )}
    </div>
  );
}
