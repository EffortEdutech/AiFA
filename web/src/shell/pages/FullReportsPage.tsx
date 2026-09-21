/**
 * Full Reports & Bank Reconciliation — Sprint 43 (Vol 13_0 §8 Module E,
 * Vol 12_2 §4.3's "reports are tabs of the Accounting module, not
 * separate sidebar items").
 *
 * BALANCE SHEET CAVEAT (see fullAccountingReportsTransport.ts's own
 * header, BALANCE SHEET NOTE): assets = liabilities + equity is NOT
 * guaranteed here — there is no period-closing/retained-earnings
 * mechanism anywhere in this schema that rolls net profit into Equity.
 * Per this sprint's own DoD, that caveat must be visibly present, not
 * buried in a tooltip — it renders as a permanent banner above the
 * three totals, not a hover hint, and stays up even when the numbers
 * happen to balance.
 *
 * TAX REPORT NOTE: `taxReportPlaceholder`'s figures are null, not
 * zero, until SST/e-Invoice data is wired (a later sprint). This tab
 * never renders `outputTaxSst`/`inputTaxSst` as "0.00" — a null
 * renders as "Not available yet", and the RPC's own `note` field is
 * shown as the tab's headline, not fine print.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabaseFullAccountingReportsTransport } from "@aifa/core/sync/fullAccountingReportsTransport";
import type {
  TrialBalanceEntry,
  BalanceSheetSummary,
  TaxReportPlaceholder,
  GeneralLedgerEntry,
  BankStatementLine,
} from "@aifa/core/sync/fullAccountingReportsTransport";
import type { BankAccount } from "@aifa/core/sync/partyAndLedgerTransport";

import { supabase } from "../../lib/supabaseClient";
import { listBankAccounts } from "../../lib/partiesAndAccounts";
import { listBankStatementLines } from "../../lib/fullAccountingReports";
import { TabStrip } from "../TabStrip";

const fullAccountingReportsTransport = createSupabaseFullAccountingReportsTransport(supabase);

type ReportTab = "trial-balance" | "balance-sheet" | "tax-report" | "bank-reconciliation";

interface Props {
  businessId: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultDateFrom(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

const BALANCE_SHEET_CAVEAT =
  "This Balance Sheet's three totals are NOT guaranteed to satisfy assets = liabilities + equity. " +
  "There is no period-closing step in this system yet that rolls net profit/loss into Equity, so any " +
  "business with posted revenue or expense activity will normally see a gap here. Use Trial Balance " +
  "for a figure that is guaranteed to balance.";

export function FullReportsPage({ businessId }: Props): JSX.Element {
  const [tab, setTab] = useState<ReportTab>("trial-balance");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Trial Balance
  const [tbAsOfDate, setTbAsOfDate] = useState(today());
  const [tbRows, setTbRows] = useState<TrialBalanceEntry[] | null>(null);

  // Balance Sheet
  const [bsAsOfDate, setBsAsOfDate] = useState(today());
  const [bsSummary, setBsSummary] = useState<BalanceSheetSummary | null>(null);

  // Tax Report Placeholder
  const [taxDateFrom, setTaxDateFrom] = useState(defaultDateFrom());
  const [taxDateTo, setTaxDateTo] = useState(today());
  const [taxReport, setTaxReport] = useState<TaxReportPlaceholder | null>(null);

  // Bank Reconciliation
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [bankAccountId, setBankAccountId] = useState("");
  const [statementLines, setStatementLines] = useState<BankStatementLine[] | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<GeneralLedgerEntry[]>([]);
  const [reconDateFrom, setReconDateFrom] = useState(defaultDateFrom());
  const [reconDateTo, setReconDateTo] = useState(today());
  const [importDate, setImportDate] = useState(today());
  const [importDescription, setImportDescription] = useState("");
  const [importAmount, setImportAmount] = useState("");
  const [matchingLineId, setMatchingLineId] = useState<string | null>(null);
  const [reconError, setReconError] = useState<string | null>(null);

  useEffect(() => {
    listBankAccounts(businessId)
      .then((accounts) => {
        setBankAccounts(accounts);
        if (accounts.length > 0) setBankAccountId((prev) => prev || accounts[0].id);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Could not load bank accounts."));
  }, [businessId]);

  const loadTrialBalance = useCallback(async () => {
    setBusy(true);
    setLoadError(null);
    try {
      const rows = await fullAccountingReportsTransport.trialBalance({ businessId, asOfDate: tbAsOfDate });
      setTbRows(rows);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load Trial Balance.");
    } finally {
      setBusy(false);
    }
  }, [businessId, tbAsOfDate]);

  const loadBalanceSheet = useCallback(async () => {
    setBusy(true);
    setLoadError(null);
    try {
      const summary = await fullAccountingReportsTransport.balanceSheetSummary({ businessId, asOfDate: bsAsOfDate });
      setBsSummary(summary);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load Balance Sheet.");
    } finally {
      setBusy(false);
    }
  }, [businessId, bsAsOfDate]);

  const loadTaxReport = useCallback(async () => {
    setBusy(true);
    setLoadError(null);
    try {
      const report = await fullAccountingReportsTransport.taxReportPlaceholder({
        businessId,
        dateFrom: taxDateFrom,
        dateTo: taxDateTo,
      });
      setTaxReport(report);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load the tax report.");
    } finally {
      setBusy(false);
    }
  }, [businessId, taxDateFrom, taxDateTo]);

  const loadReconciliation = useCallback(async () => {
    if (!bankAccountId) return;
    setBusy(true);
    setLoadError(null);
    try {
      const account = bankAccounts.find((a) => a.id === bankAccountId);
      const [lines, entries] = await Promise.all([
        listBankStatementLines(bankAccountId),
        account
          ? fullAccountingReportsTransport.generalLedgerDetail({
              businessId,
              accountId: account.ledgerAccountId,
              dateFrom: reconDateFrom,
              dateTo: reconDateTo,
            })
          : Promise.resolve([]),
      ]);
      setStatementLines(lines);
      setLedgerEntries(entries);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load bank reconciliation data.");
    } finally {
      setBusy(false);
    }
  }, [businessId, bankAccountId, bankAccounts, reconDateFrom, reconDateTo]);

  useEffect(() => {
    if (tab === "trial-balance") loadTrialBalance().catch(() => {});
    else if (tab === "balance-sheet") loadBalanceSheet().catch(() => {});
    else if (tab === "tax-report") loadTaxReport().catch(() => {});
    else if (tab === "bank-reconciliation") loadReconciliation().catch(() => {});
  }, [tab, loadTrialBalance, loadBalanceSheet, loadTaxReport, loadReconciliation]);

  async function handleImportLine(): Promise<void> {
    if (!bankAccountId || !importAmount.trim()) return;
    setReconError(null);
    try {
      await fullAccountingReportsTransport.importBankStatementLines({
        bankAccountId,
        lines: [{ statementDate: importDate, description: importDescription.trim() || null, amount: Number(importAmount) }],
      });
      setImportDescription("");
      setImportAmount("");
      await loadReconciliation();
    } catch (err) {
      setReconError(err instanceof Error ? err.message : "Could not import this statement line.");
    }
  }

  async function handleMatch(lineId: string, ledgerEntryId: string): Promise<void> {
    setReconError(null);
    try {
      await fullAccountingReportsTransport.matchBankStatementLine({ statementLineId: lineId, ledgerEntryId });
      setMatchingLineId(null);
      await loadReconciliation();
    } catch (err) {
      setReconError(err instanceof Error ? err.message : "Could not match this line.");
    }
  }

  async function handleIgnore(lineId: string): Promise<void> {
    setReconError(null);
    try {
      await fullAccountingReportsTransport.ignoreBankStatementLine(lineId);
      await loadReconciliation();
    } catch (err) {
      setReconError(err instanceof Error ? err.message : "Could not ignore this line.");
    }
  }

  const tbDebitTotal = (tbRows ?? []).reduce((sum, r) => sum + r.totalDebit, 0);
  const tbCreditTotal = (tbRows ?? []).reduce((sum, r) => sum + r.totalCredit, 0);
  const tbBalanced = tbRows !== null && Math.abs(tbDebitTotal - tbCreditTotal) < 0.005;

  const bsIdentityGap =
    bsSummary !== null ? bsSummary.totalAssets - (bsSummary.totalLiabilities + bsSummary.totalEquity) : null;

  const unmatchedLines = (statementLines ?? []).filter((l) => l.matchStatus === "unmatched");
  const matchedLines = (statementLines ?? []).filter((l) => l.matchStatus === "matched");
  const ignoredLines = (statementLines ?? []).filter((l) => l.matchStatus === "ignored");
  const unclaimedLedgerEntries = ledgerEntries.filter(
    (e) => !(statementLines ?? []).some((l) => l.matchedLedgerEntryId === e.entryId),
  );

  return (
    <div className="aifa-page">
      <h1>Full Reports &amp; Bank Reconciliation</h1>
      <TabStrip
        tabs={[
          { id: "trial-balance", label: "Trial Balance" },
          { id: "balance-sheet", label: "Balance Sheet" },
          { id: "tax-report", label: "Tax Report" },
          { id: "bank-reconciliation", label: "Bank Reconciliation" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {loadError && <p className="error">{loadError}</p>}

      {tab === "trial-balance" && (
        <>
          <div className="row" style={{ margin: "12px 0" }}>
            <label className="muted">As of</label>
            <input type="date" value={tbAsOfDate} onChange={(e) => setTbAsOfDate(e.target.value)} style={{ padding: 6 }} />
            <button onClick={() => void loadTrialBalance()} disabled={busy}>
              {busy ? "Loading…" : "Refresh"}
            </button>
          </div>

          {tbRows !== null && (
            <div className="card" style={{ marginBottom: 12, borderColor: tbBalanced ? "#1b7a3d" : "#c0392b" }}>
              <strong style={{ color: tbBalanced ? "#1b7a3d" : "#c0392b" }}>
                {tbBalanced ? "✓ Balanced" : "✗ Not balanced"}
              </strong>
              <p className="muted" style={{ margin: "4px 0" }}>
                Total debits RM{tbDebitTotal.toFixed(2)} vs. total credits RM{tbCreditTotal.toFixed(2)} — these are
                guaranteed to match by construction (every ledger entry is posted as a balanced pair); a mismatch
                here would indicate a real data problem, not an expected state.
              </p>
            </div>
          )}

          {tbRows === null ? (
            <p className="muted">Loading…</p>
          ) : tbRows.length === 0 ? (
            <p className="muted">No posted ledger activity as of this date.</p>
          ) : (
            <div className="card" style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left" }}>
                    <th style={{ padding: 6 }}>Account</th>
                    <th style={{ padding: 6 }}>Type</th>
                    <th style={{ padding: 6 }}>Debit</th>
                    <th style={{ padding: 6 }}>Credit</th>
                    <th style={{ padding: 6 }}>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {tbRows.map((r) => (
                    <tr key={r.accountCode} style={{ borderTop: "1px solid var(--aifa-border, #e2e2e2)" }}>
                      <td style={{ padding: 6 }}>
                        {r.accountCode} — {r.accountName}
                      </td>
                      <td style={{ padding: 6 }} className="muted">
                        {r.accountType}
                      </td>
                      <td style={{ padding: 6 }}>RM{r.totalDebit.toFixed(2)}</td>
                      <td style={{ padding: 6 }}>RM{r.totalCredit.toFixed(2)}</td>
                      <td style={{ padding: 6 }}>RM{r.balance.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "balance-sheet" && (
        <>
          <div
            className="card"
            style={{ marginBottom: 12, borderColor: "#c0392b", background: "rgba(192,57,43,0.06)" }}
          >
            <strong style={{ color: "#c0392b" }}>⚠ These totals do not necessarily balance</strong>
            <p style={{ margin: "4px 0" }}>{BALANCE_SHEET_CAVEAT}</p>
          </div>

          <div className="row" style={{ margin: "12px 0" }}>
            <label className="muted">As of</label>
            <input type="date" value={bsAsOfDate} onChange={(e) => setBsAsOfDate(e.target.value)} style={{ padding: 6 }} />
            <button onClick={() => void loadBalanceSheet()} disabled={busy}>
              {busy ? "Loading…" : "Refresh"}
            </button>
          </div>

          {bsSummary === null ? (
            <p className="muted">Loading…</p>
          ) : (
            <div className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span>Total assets</span>
                <strong>RM{bsSummary.totalAssets.toFixed(2)}</strong>
              </div>
              <div className="row" style={{ justifyContent: "space-between", marginTop: 4 }}>
                <span>Total liabilities</span>
                <strong>RM{bsSummary.totalLiabilities.toFixed(2)}</strong>
              </div>
              <div className="row" style={{ justifyContent: "space-between", marginTop: 4 }}>
                <span>Total equity</span>
                <strong>RM{bsSummary.totalEquity.toFixed(2)}</strong>
              </div>
              <div
                className="row"
                style={{ justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--aifa-border, #e2e2e2)" }}
              >
                <span className="muted">Assets − (Liabilities + Equity)</span>
                <strong>{bsIdentityGap !== null ? `RM${bsIdentityGap.toFixed(2)}` : "—"}</strong>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "tax-report" && (
        <>
          <div className="row" style={{ margin: "12px 0" }}>
            <input type="date" value={taxDateFrom} onChange={(e) => setTaxDateFrom(e.target.value)} style={{ padding: 6 }} />
            <span className="muted">to</span>
            <input type="date" value={taxDateTo} onChange={(e) => setTaxDateTo(e.target.value)} style={{ padding: 6 }} />
            <button onClick={() => void loadTaxReport()} disabled={busy}>
              {busy ? "Loading…" : "Refresh"}
            </button>
          </div>

          {taxReport === null ? (
            <p className="muted">Loading…</p>
          ) : (
            <div className="card" style={{ borderColor: "#8a6d00", background: "rgba(138,109,0,0.06)" }}>
              <strong style={{ color: "#8a6d00" }}>⚠ Placeholder — not a completed report</strong>
              <p style={{ margin: "8px 0" }}>{taxReport.note}</p>
              <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
                <span>Output tax (SST)</span>
                <strong>{taxReport.outputTaxSst !== null ? `RM${taxReport.outputTaxSst.toFixed(2)}` : "Not available yet"}</strong>
              </div>
              <div className="row" style={{ justifyContent: "space-between", marginTop: 4 }}>
                <span>Input tax (SST)</span>
                <strong>{taxReport.inputTaxSst !== null ? `RM${taxReport.inputTaxSst.toFixed(2)}` : "Not available yet"}</strong>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "bank-reconciliation" && (
        <>
          <div className="row" style={{ margin: "12px 0" }}>
            <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} style={{ padding: 6, minWidth: 200 }}>
              {bankAccounts.length === 0 && <option value="">No bank accounts yet</option>}
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.accountName}
                </option>
              ))}
            </select>
            <input type="date" value={reconDateFrom} onChange={(e) => setReconDateFrom(e.target.value)} style={{ padding: 6 }} />
            <span className="muted">to</span>
            <input type="date" value={reconDateTo} onChange={(e) => setReconDateTo(e.target.value)} style={{ padding: 6 }} />
            <button onClick={() => void loadReconciliation()} disabled={busy || !bankAccountId}>
              {busy ? "Loading…" : "Refresh"}
            </button>
          </div>

          {bankAccounts.length === 0 ? (
            <p className="muted">Add a bank account (Chart of Accounts page) before reconciling.</p>
          ) : (
            <>
              <div className="card" style={{ marginBottom: 12 }}>
                <h2 style={{ fontSize: 14, marginTop: 0 }}>Import a statement line</h2>
                <div className="row">
                  <input type="date" value={importDate} onChange={(e) => setImportDate(e.target.value)} style={{ padding: 6 }} />
                  <input
                    placeholder="Description (optional)"
                    value={importDescription}
                    onChange={(e) => setImportDescription(e.target.value)}
                    style={{ padding: 6, flex: 1 }}
                  />
                  <input
                    placeholder="Amount (RM, negative for a debit)"
                    value={importAmount}
                    onChange={(e) => setImportAmount(e.target.value)}
                    style={{ padding: 6, width: 200 }}
                  />
                  <button onClick={() => void handleImportLine()} disabled={!importAmount.trim()}>
                    Import
                  </button>
                </div>
                <p className="muted" style={{ marginTop: 4 }}>
                  One line at a time — a bulk file-upload importer isn't wired yet; each entry here becomes a real
                  `unmatched` statement line the same as a batch import would produce.
                </p>
              </div>

              {reconError && <p className="error">{reconError}</p>}

              <h2 style={{ fontSize: 14, marginTop: 16 }}>Unmatched ({unmatchedLines.length})</h2>
              {statementLines === null ? (
                <p className="muted">Loading…</p>
              ) : unmatchedLines.length === 0 ? (
                <p className="muted">Nothing unmatched in this account.</p>
              ) : (
                unmatchedLines.map((line) => (
                  <div key={line.id} className="card">
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <strong>
                        {line.statementDate} — {line.description ?? "(no description)"}
                      </strong>
                      <span>RM{line.amount.toFixed(2)}</span>
                    </div>
                    <div className="row" style={{ marginTop: 6, flexWrap: "wrap" }}>
                      <button onClick={() => setMatchingLineId(matchingLineId === line.id ? null : line.id)}>
                        {matchingLineId === line.id ? "Cancel" : "Match to ledger entry"}
                      </button>
                      <button onClick={() => void handleIgnore(line.id)} style={{ color: "#c0392b", borderColor: "#c0392b" }}>
                        Ignore
                      </button>
                    </div>
                    {matchingLineId === line.id && (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--aifa-border, #e2e2e2)" }}>
                        {unclaimedLedgerEntries.length === 0 ? (
                          <p className="muted">
                            No unclaimed ledger entries for this account in {reconDateFrom} – {reconDateTo}. Widen the
                            date range above if the matching entry falls outside it.
                          </p>
                        ) : (
                          unclaimedLedgerEntries.map((entry) => (
                            <div key={entry.entryId} className="row" style={{ justifyContent: "space-between", marginTop: 4 }}>
                              <span className="muted">
                                {entry.postedAt} · {entry.direction} · RM{entry.amount.toFixed(2)}
                              </span>
                              <button onClick={() => void handleMatch(line.id, entry.entryId)} style={{ padding: "2px 8px" }}>
                                Match
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}

              <h2 style={{ fontSize: 14, marginTop: 16 }}>Matched ({matchedLines.length})</h2>
              {matchedLines.length === 0 ? (
                <p className="muted">Nothing matched yet.</p>
              ) : (
                matchedLines.map((line) => (
                  <div key={line.id} className="card">
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span>
                        {line.statementDate} — {line.description ?? "(no description)"}
                      </span>
                      <span style={{ color: "#1b7a3d" }}>RM{line.amount.toFixed(2)} ✓ matched</span>
                    </div>
                  </div>
                ))
              )}

              {ignoredLines.length > 0 && (
                <>
                  <h2 style={{ fontSize: 14, marginTop: 16 }}>Ignored ({ignoredLines.length})</h2>
                  {ignoredLines.map((line) => (
                    <div key={line.id} className="card">
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <span className="muted">
                          {line.statementDate} — {line.description ?? "(no description)"}
                        </span>
                        <span className="muted">RM{line.amount.toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
