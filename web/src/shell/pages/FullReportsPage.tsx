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
 *
 * UI polish Phase 4: presentation only — shared header, tables, labelled
 * fields. The balance-sheet and tax-report banners stay permanent and visible.
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
import { Button, Card, DataTable, Field, PageHeader, StatusPill, formatDate, formatMoney, type Column } from "../../ui";
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

  const tbColumns: Column<TrialBalanceEntry>[] = [
    { key: "acct", header: "Account", render: (r) => `${r.accountCode} — ${r.accountName}` },
    { key: "type", header: "Type", render: (r) => <span className="ui-muted">{r.accountType}</span> },
    { key: "dr", header: "Debit", numeric: true, render: (r) => formatMoney(r.totalDebit) },
    { key: "cr", header: "Credit", numeric: true, render: (r) => formatMoney(r.totalCredit) },
    { key: "bal", header: "Balance", numeric: true, render: (r) => formatMoney(r.balance) },
  ];

  const unmatchedColumns: Column<BankStatementLine>[] = [
    { key: "date", header: "Date", render: (l) => formatDate(l.statementDate) },
    { key: "desc", header: "Description", render: (l) => l.description ?? "(no description)" },
    { key: "amt", header: "Amount", numeric: true, render: (l) => formatMoney(l.amount) },
    {
      key: "actions",
      header: "",
      render: (l) => (
        <div className="ui-inline-actions">
          <Button size="sm" variant="secondary" onClick={() => setMatchingLineId(matchingLineId === l.id ? null : l.id)}>
            {matchingLineId === l.id ? "Cancel" : "Match to ledger entry"}
          </Button>
          <Button size="sm" variant="danger" onClick={() => void handleIgnore(l.id)}>
            Ignore
          </Button>
        </div>
      ),
    },
  ];

  const settledColumns = (label: string, tone: "success" | "neutral"): Column<BankStatementLine>[] => [
    { key: "date", header: "Date", render: (l) => formatDate(l.statementDate) },
    { key: "desc", header: "Description", render: (l) => l.description ?? "(no description)" },
    { key: "amt", header: "Amount", numeric: true, render: (l) => formatMoney(l.amount) },
    { key: "st", header: "Status", render: () => <StatusPill status={label} label={label} tone={tone} /> },
  ];

  const matchingLine = unmatchedLines.find((l) => l.id === matchingLineId) ?? null;

  const dateRange = (
    from: string,
    setFrom: (v: string) => void,
    to: string,
    setTo: (v: string) => void,
  ): JSX.Element => (
    <>
      <Field label="From">{(p) => <input {...p} className="ui-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
      <Field label="To">{(p) => <input {...p} className="ui-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
    </>
  );

  const asOf = (value: string, set: (v: string) => void): JSX.Element => (
    <Field label="As of">{(p) => <input {...p} className="ui-input" type="date" value={value} onChange={(e) => set(e.target.value)} />}</Field>
  );

  return (
    <div className="aifa-page">
      <PageHeader title="Full Reports & Bank Reconciliation">
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
      </PageHeader>

      {loadError && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {loadError}
        </p>
      )}

      {tab === "trial-balance" && (
        <>
          <Card>
            <div className="ui-inline-actions" style={{ alignItems: "flex-end" }}>
              {asOf(tbAsOfDate, setTbAsOfDate)}
              <Button variant="secondary" loading={busy} onClick={() => void loadTrialBalance()}>
                {busy ? "Loading…" : "Refresh"}
              </Button>
            </div>
          </Card>

          {tbRows !== null && (
            <div className={`aifa-alert ${tbBalanced ? "aifa-alert--success" : "aifa-alert--danger"}`} role="status">
              <strong>{tbBalanced ? "✓ Balanced" : "✗ Not balanced"}</strong>
              <p style={{ margin: "4px 0 0" }}>
                Total debits {formatMoney(tbDebitTotal)} vs. total credits {formatMoney(tbCreditTotal)} — these are
                guaranteed to match by construction (every ledger entry is posted as a balanced pair); a mismatch
                here would indicate a real data problem, not an expected state.
              </p>
            </div>
          )}

          <Card flush>
            <DataTable
              caption="Trial balance"
              columns={tbColumns}
              rows={loadError ? [] : tbRows}
              rowKey={(r) => r.accountCode}
              empty={<div className="ui-table-state">No posted ledger activity as of this date.</div>}
            />
          </Card>
        </>
      )}

      {tab === "balance-sheet" && (
        <>
          <div className="aifa-alert aifa-alert--danger" role="note">
            <strong>⚠ These totals do not necessarily balance</strong>
            <p style={{ margin: "4px 0 0" }}>{BALANCE_SHEET_CAVEAT}</p>
          </div>

          <Card>
            <div className="ui-inline-actions" style={{ alignItems: "flex-end" }}>
              {asOf(bsAsOfDate, setBsAsOfDate)}
              <Button variant="secondary" loading={busy} onClick={() => void loadBalanceSheet()}>
                {busy ? "Loading…" : "Refresh"}
              </Button>
            </div>
          </Card>

          <Card title="Balance sheet totals">
            {bsSummary === null ? (
              <p className="ui-muted">{loadError ? "Not available." : "Loading…"}</p>
            ) : (
              <dl className="ui-panel" style={{ margin: 0 }}>
                <div className="ui-check-row" style={{ justifyContent: "space-between" }}>
                  <dt>Total assets</dt>
                  <dd style={{ margin: 0 }}><strong>{formatMoney(bsSummary.totalAssets)}</strong></dd>
                </div>
                <div className="ui-check-row" style={{ justifyContent: "space-between" }}>
                  <dt>Total liabilities</dt>
                  <dd style={{ margin: 0 }}><strong>{formatMoney(bsSummary.totalLiabilities)}</strong></dd>
                </div>
                <div className="ui-check-row" style={{ justifyContent: "space-between" }}>
                  <dt>Total equity</dt>
                  <dd style={{ margin: 0 }}><strong>{formatMoney(bsSummary.totalEquity)}</strong></dd>
                </div>
                <div className="ui-check-row" style={{ justifyContent: "space-between" }}>
                  <dt className="ui-muted">Assets − (Liabilities + Equity)</dt>
                  <dd style={{ margin: 0 }}><strong>{bsIdentityGap !== null ? formatMoney(bsIdentityGap) : "—"}</strong></dd>
                </div>
              </dl>
            )}
          </Card>
        </>
      )}

      {tab === "tax-report" && (
        <>
          <Card>
            <div className="ui-inline-actions" style={{ alignItems: "flex-end" }}>
              {dateRange(taxDateFrom, setTaxDateFrom, taxDateTo, setTaxDateTo)}
              <Button variant="secondary" loading={busy} onClick={() => void loadTaxReport()}>
                {busy ? "Loading…" : "Refresh"}
              </Button>
            </div>
          </Card>

          {taxReport === null ? (
            <p className="ui-muted">{loadError ? "Not available." : "Loading…"}</p>
          ) : (
            <div className="aifa-alert aifa-alert--warning" role="note">
              <strong>⚠ Placeholder — not a completed report</strong>
              <p style={{ margin: "8px 0" }}>{taxReport.note}</p>
              <div className="ui-check-row" style={{ justifyContent: "space-between" }}>
                <span>Output tax (SST)</span>
                <strong>{taxReport.outputTaxSst !== null ? formatMoney(taxReport.outputTaxSst) : "Not available yet"}</strong>
              </div>
              <div className="ui-check-row" style={{ justifyContent: "space-between" }}>
                <span>Input tax (SST)</span>
                <strong>{taxReport.inputTaxSst !== null ? formatMoney(taxReport.inputTaxSst) : "Not available yet"}</strong>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "bank-reconciliation" && (
        <>
          <Card>
            <div className="ui-inline-actions" style={{ alignItems: "flex-end" }}>
              <Field label="Bank account">
                {(p) => (
                  <select {...p} className="ui-select" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
                    {bankAccounts.length === 0 && <option value="">No bank accounts yet</option>}
                    {bankAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.accountName}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              {dateRange(reconDateFrom, setReconDateFrom, reconDateTo, setReconDateTo)}
              <Button variant="secondary" loading={busy} disabled={!bankAccountId} onClick={() => void loadReconciliation()}>
                {busy ? "Loading…" : "Refresh"}
              </Button>
            </div>
          </Card>

          {bankAccounts.length === 0 ? (
            <p className="ui-muted">Add a bank account (Chart of Accounts page) before reconciling.</p>
          ) : (
            <>
              <Card
                title="Import a statement line"
                description="One line at a time — a bulk file-upload importer isn't wired yet; each entry here becomes a real `unmatched` statement line the same as a batch import would produce."
              >
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (importAmount.trim()) void handleImportLine();
                  }}
                >
                  <div className="ui-form-grid">
                    <Field label="Date">
                      {(p) => <input {...p} className="ui-input" type="date" value={importDate} onChange={(e) => setImportDate(e.target.value)} />}
                    </Field>
                    <Field label="Description (optional)">
                      {(p) => <input {...p} className="ui-input" value={importDescription} onChange={(e) => setImportDescription(e.target.value)} />}
                    </Field>
                    <Field label="Amount (RM, negative for a debit)" required>
                      {(p) => <input {...p} className="ui-input" value={importAmount} onChange={(e) => setImportAmount(e.target.value)} />}
                    </Field>
                  </div>
                  <div className="ui-form-actions">
                    <Button type="submit" variant="primary" disabled={!importAmount.trim()}>
                      Import
                    </Button>
                  </div>
                </form>
              </Card>

              {reconError && (
                <p className="aifa-alert aifa-alert--danger" role="alert">
                  {reconError}
                </p>
              )}

              <Card title={`Unmatched (${unmatchedLines.length})`} flush>
                <DataTable
                  caption="Unmatched statement lines"
                  columns={unmatchedColumns}
                  rows={loadError ? [] : statementLines === null ? null : unmatchedLines}
                  rowKey={(l) => l.id}
                  empty={<div className="ui-table-state">Nothing unmatched in this account.</div>}
                />
              </Card>

              {matchingLine && (
                <Card
                  title="Match to a ledger entry"
                  description={`${formatDate(matchingLine.statementDate)} — ${matchingLine.description ?? "(no description)"} · ${formatMoney(matchingLine.amount)}`}
                >
                  {unclaimedLedgerEntries.length === 0 ? (
                    <p className="ui-muted">
                      No unclaimed ledger entries for this account in {reconDateFrom} – {reconDateTo}. Widen the date
                      range above if the matching entry falls outside it.
                    </p>
                  ) : (
                    <ul className="ui-move-list">
                      {unclaimedLedgerEntries.map((entry) => (
                        <li key={entry.entryId} className="ui-move">
                          <span className="ui-muted">
                            {formatDate(entry.postedAt)} · {entry.direction} · {formatMoney(entry.amount)}
                          </span>
                          <Button size="sm" variant="secondary" onClick={() => void handleMatch(matchingLine.id, entry.entryId)}>
                            Match
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}

              <Card title={`Matched (${matchedLines.length})`} flush>
                <DataTable
                  caption="Matched statement lines"
                  columns={settledColumns("Matched", "success")}
                  rows={loadError ? [] : statementLines === null ? null : matchedLines}
                  rowKey={(l) => l.id}
                  empty={<div className="ui-table-state">Nothing matched yet.</div>}
                />
              </Card>

              {ignoredLines.length > 0 && (
                <Card title={`Ignored (${ignoredLines.length})`} flush>
                  <DataTable
                    caption="Ignored statement lines"
                    columns={settledColumns("Ignored", "neutral")}
                    rows={ignoredLines}
                    rowKey={(l) => l.id}
                  />
                </Card>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
