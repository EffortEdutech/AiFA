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
 */
import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";

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
import { TabStrip } from "../TabStrip";

const eInvoiceSstTransport = createSupabaseEInvoiceSstTransport(supabase);
const myInvoisClient = new StubMyInvoisClient();

type ComplianceTab = "e-invoice" | "sst";

interface Props {
  businessId: string;
}

const STUB_BANNER_STYLE: CSSProperties = {
  padding: "8px 12px",
  marginBottom: 12,
  borderRadius: 6,
  background: "#7a1f1f",
  color: "#fff",
  fontWeight: 700,
  textAlign: "center",
};

function invoiceLabel(invoices: Invoice[], id: string | null): string {
  if (!id) return "(consolidated batch)";
  const inv = invoices.find((i) => i.id === id);
  return inv ? inv.invoiceNo : `Invoice #${id.slice(0, 8)}`;
}

function statusColor(status: EInvoiceSubmission["status"]): string {
  switch (status) {
    case "validated":
      return "#1b7a3d";
    case "rejected":
      return "#c0392b";
    case "cancelled":
      return "#8a6d00";
    default:
      return "inherit";
  }
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

  return (
    <div className="aifa-page">
      <h1>e-Invoice &amp; SST Compliance</h1>

      <div style={STUB_BANNER_STYLE}>
        ⚠ SIMULATED — NOT CONNECTED TO LHDN MyInvois. Every result on this page (uuid, QR code, IRB response) is
        fabricated by a local stub, not a real government submission.
      </div>
      <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>{TAX_ADVICE_BOUNDARY_STATEMENT}</p>

      <TabStrip
        tabs={[
          { id: "e-invoice", label: "e-Invoice" },
          { id: "sst", label: "SST" },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div style={STUB_BANNER_STYLE}>
        ⚠ SIMULATED — NOT CONNECTED TO LHDN MyInvois.
      </div>

      {loadError && <p className="error">{loadError}</p>}

      {tab === "e-invoice" && (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 14, marginTop: 0 }}>New submission (single invoice)</h2>
            <div className="row">
              <select value={createInvoiceId} onChange={(e) => setCreateInvoiceId(e.target.value)} style={{ padding: 6, minWidth: 220 }}>
                <option value="">Select invoice…</option>
                {eligibleInvoices.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.invoiceNo}
                  </option>
                ))}
              </select>
              <button onClick={() => void handleCreateSubmission()} disabled={createBusy || !createInvoiceId}>
                {createBusy ? "Creating…" : "Create draft submission"}
              </button>
            </div>
            {eligibleInvoices.length === 0 && <p className="muted" style={{ marginTop: 4 }}>Every invoice already has an active submission.</p>}
            {createError && <p className="error">{createError}</p>}
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 14, marginTop: 0 }}>New consolidated batch</h2>
            <div className="row">
              <input
                placeholder="Period (e.g. 2026-08)"
                value={consolidatedPeriod}
                onChange={(e) => setConsolidatedPeriod(e.target.value)}
                style={{ padding: 6, width: 160 }}
              />
              <button onClick={() => void handleGenerateConsolidated()} disabled={consolidatedBusy || !consolidatedPeriod.trim()}>
                {consolidatedBusy ? "Generating…" : "Generate batch"}
              </button>
            </div>
            <p className="muted" style={{ marginTop: 4 }}>
              Bundles all eligible (non-B2B) invoices in this period into one draft submission. Throws if a batch
              already exists for the period, or no eligible invoices are found.
            </p>
            {consolidatedError && <p className="error">{consolidatedError}</p>}
          </div>

          {actionError && <p className="error">{actionError}</p>}

          {submissions === null ? (
            <p className="muted">Loading…</p>
          ) : submissions.length === 0 ? (
            <p className="muted">No e-Invoice submissions yet.</p>
          ) : (
            submissions.map((s) => {
              const busy = busyId === s.id;
              const rejection = s.status === "rejected" ? parseIrbResponse(s.irbResponseRef) : null;
              const success = s.status === "validated" ? parseIrbResponse(s.irbResponseRef) : null;
              return (
                <div key={s.id} className="card">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <strong>
                      {s.submissionType === "consolidated"
                        ? `Consolidated — ${s.consolidatedPeriod}`
                        : invoiceLabel(invoices, s.invoiceId)}
                    </strong>
                    <span style={{ color: statusColor(s.status), fontWeight: 600 }}>{s.status}</span>
                  </div>
                  {s.submissionType === "consolidated" && (
                    <div style={{ marginTop: 4 }}>
                      <button onClick={() => void loadSubmissionLines(s.id)} style={{ padding: "0 4px" }}>
                        {submissionLinesById[s.id] ? `${submissionLinesById[s.id].length} invoice(s) in this batch` : "Show invoices in batch"}
                      </button>
                    </div>
                  )}
                  {s.lhdnUuid && (
                    <p className="muted" style={{ margin: "4px 0" }}>
                      Simulated LHDN UUID: <code>{s.lhdnUuid}</code> · Simulated QR ref: <code>{s.qrCodeRef}</code>
                    </p>
                  )}
                  {success && (
                    <p className="muted" style={{ margin: "4px 0" }}>
                      Simulated IRB response: {success.code ?? "OK"}
                    </p>
                  )}
                  {rejection && (
                    <p className="error" style={{ margin: "4px 0" }}>
                      Simulated rejection — {rejection.code ?? "no code"}: {rejection.message ?? "no message"}
                    </p>
                  )}

                  {s.status === "draft" && (
                    <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
                      <button onClick={() => void handleSubmitToStub(s)} disabled={busy}>
                        {busy ? "Submitting (simulated)…" : "Submit (simulated — succeed)"}
                      </button>
                      <button onClick={() => setSimulateRejectFor(simulateRejectFor === s.id ? null : s.id)} disabled={busy}>
                        {simulateRejectFor === s.id ? "Cancel" : "Submit (simulated — test rejection)"}
                      </button>
                    </div>
                  )}
                  {simulateRejectFor === s.id && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--aifa-border, #e2e2e2)" }}>
                      <div className="row">
                        <input placeholder="IRB response code" value={rejectCode} onChange={(e) => setRejectCode(e.target.value)} style={{ padding: 6, width: 220 }} />
                      </div>
                      <div className="row" style={{ marginTop: 6 }}>
                        <input placeholder="IRB response message" value={rejectMessage} onChange={(e) => setRejectMessage(e.target.value)} style={{ padding: 6, flex: 1 }} />
                      </div>
                      <div className="row" style={{ marginTop: 6 }}>
                        <button
                          onClick={() => void handleSubmitToStub(s, { irbResponseCode: rejectCode, irbResponseMessage: rejectMessage })}
                          disabled={busy || !rejectCode.trim() || !rejectMessage.trim()}
                        >
                          {busy ? "Submitting (simulated)…" : "Confirm simulated rejection"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </>
      )}

      {tab === "sst" && (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 14, marginTop: 0 }}>SST rate catalog</h2>
            {sstRates.map((r) => (
              <div key={r.sstCode} className="row" style={{ justifyContent: "space-between", marginTop: 4 }}>
                <span>
                  <strong>{r.sstCode}</strong> <span className="muted">({r.taxType})</span>
                </span>
                <span className="muted">
                  {(r.rate * 100).toFixed(0)}% — {r.description}
                </span>
              </div>
            ))}
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 14, marginTop: 0 }}>Compute SST for an invoice</h2>
            <div className="row">
              <select value={computeInvoiceId} onChange={(e) => setComputeInvoiceId(e.target.value)} style={{ padding: 6, minWidth: 220 }}>
                <option value="">Select invoice…</option>
                {invoices.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.invoiceNo}
                  </option>
                ))}
              </select>
              <button onClick={() => void handleComputeSst()} disabled={computeBusy || !computeInvoiceId}>
                {computeBusy ? "Computing…" : "Compute SST"}
              </button>
            </div>
            <p className="muted" style={{ marginTop: 4 }}>
              Only lines carrying a recognised tax code (set at quotation/invoice line entry) are taxed; lines with
              no tax code are silently skipped — not an error. Throws if SST was already computed for this invoice.
            </p>
            <p className="muted" style={{ marginTop: 4 }}>
              Payment Voucher SST computation isn't reachable from this page — see this page's own header comment
              for the disclosed reason (no way to set a Payment Voucher's SST code from any existing RPC).
            </p>
            {computeError && <p className="error">{computeError}</p>}
          </div>

          <h2 style={{ fontSize: 14, marginTop: 16 }}>SST transactions</h2>
          {sstTransactions === null ? (
            <p className="muted">Loading…</p>
          ) : sstTransactions.length === 0 ? (
            <p className="muted">No SST computed yet.</p>
          ) : (
            <div className="card" style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left" }}>
                    <th style={{ padding: 6 }}>Source</th>
                    <th style={{ padding: 6 }}>SST code</th>
                    <th style={{ padding: 6 }}>Rate</th>
                    <th style={{ padding: 6 }}>Taxable amount</th>
                    <th style={{ padding: 6 }}>SST amount</th>
                  </tr>
                </thead>
                <tbody>
                  {sstTransactions.map((t) => (
                    <tr key={t.id} style={{ borderTop: "1px solid var(--aifa-border, #e2e2e2)" }}>
                      <td style={{ padding: 6 }}>{t.invoiceId ? invoiceLabel(invoices, t.invoiceId) : `PV #${(t.paymentVoucherId ?? "").slice(0, 8)}`}</td>
                      <td style={{ padding: 6 }}>{t.sstCode}</td>
                      <td style={{ padding: 6 }}>{(t.rate * 100).toFixed(0)}%</td>
                      <td style={{ padding: 6 }}>RM{t.taxableAmount.toFixed(2)}</td>
                      <td style={{ padding: 6 }}>RM{t.sstAmount.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="card" style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: 14, marginTop: 0 }}>New SST return</h2>
            <div className="row">
              <input placeholder="Period (e.g. 2026-08)" value={returnPeriod} onChange={(e) => setReturnPeriod(e.target.value)} style={{ padding: 6, width: 160 }} />
              <button onClick={() => void handleCreateReturn()} disabled={returnBusy || !returnPeriod.trim()}>
                {returnBusy ? "Creating…" : "Create return"}
              </button>
            </div>
            <p className="muted" style={{ marginTop: 4 }}>
              Aggregates all SST transactions in the period. "Submit" here is a status flip only — not a real Kastam
              API integration (per the transport's own note).
            </p>
            {returnError && <p className="error">{returnError}</p>}
          </div>

          <h2 style={{ fontSize: 14, marginTop: 16 }}>SST returns</h2>
          {sstReturns === null ? (
            <p className="muted">Loading…</p>
          ) : sstReturns.length === 0 ? (
            <p className="muted">No SST returns yet.</p>
          ) : (
            sstReturns.map((r) => {
              const busy = busyId === r.id;
              return (
                <div key={r.id} className="card">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <strong>{r.period}</strong>
                    <span className="muted">{r.status}</span>
                  </div>
                  <p className="muted" style={{ margin: "4px 0" }}>Total output tax: RM{r.totalOutputTax.toFixed(2)}</p>
                  {r.status === "draft" && (
                    <div className="row" style={{ marginTop: 6 }}>
                      <button onClick={() => void handleSubmitReturn(r)} disabled={busy}>
                        {busy ? "Submitting…" : "Submit (status only — not a real Kastam filing)"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </>
      )}
    </div>
  );
}
