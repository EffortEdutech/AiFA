/**
 * Cash Book / P&L — Sprint 41 (Vol 13_0 §8, pulled forward for this
 * module's own reporting needs). Read-only, per this sprint's own scope.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabasePaymentVouchersReportsTransport } from "@aifa/core/sync/paymentVouchersReportsTransport";
import type {
  CashBookEntry,
  ProfitAndLossSummary,
  ExpenseCategoryBreakdownEntry,
} from "@aifa/core/sync/paymentVouchersReportsTransport";
import type { BankAccount } from "@aifa/core/sync/partyAndLedgerTransport";

import { supabase } from "../../lib/supabaseClient";
import { listBankAccounts } from "../../lib/partiesAndAccounts";
import { TabStrip } from "../TabStrip";

const paymentVouchersReportsTransport = createSupabasePaymentVouchersReportsTransport(supabase);

type ReportTab = "cash-book" | "profit-and-loss";

interface Props {
  businessId: string;
}

function defaultDateFrom(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function defaultDateTo(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CashBookPlPage({ businessId }: Props): JSX.Element {
  const [tab, setTab] = useState<ReportTab>("cash-book");
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [bankAccountId, setBankAccountId] = useState("");
  const [dateFrom, setDateFrom] = useState(defaultDateFrom());
  const [dateTo, setDateTo] = useState(defaultDateTo());

  const [cashBookRows, setCashBookRows] = useState<CashBookEntry[] | null>(null);
  const [pl, setPl] = useState<ProfitAndLossSummary | null>(null);
  const [breakdown, setBreakdown] = useState<ExpenseCategoryBreakdownEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listBankAccounts(businessId)
      .then((accounts) => {
        setBankAccounts(accounts);
        if (accounts.length > 0) setBankAccountId((prev) => prev || accounts[0].id);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Could not load bank accounts."));
  }, [businessId]);

  const loadCashBook = useCallback(async () => {
    if (!bankAccountId) return;
    setBusy(true);
    setLoadError(null);
    try {
      const rows = await paymentVouchersReportsTransport.cashBookDetail({
        businessId,
        bankAccountId,
        dateFrom,
        dateTo,
      });
      setCashBookRows(rows);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load the cash book.");
    } finally {
      setBusy(false);
    }
  }, [businessId, bankAccountId, dateFrom, dateTo]);

  const loadPl = useCallback(async () => {
    setBusy(true);
    setLoadError(null);
    try {
      const [summary, cats] = await Promise.all([
        paymentVouchersReportsTransport.profitAndLossSummary({ businessId, dateFrom, dateTo }),
        paymentVouchersReportsTransport.expenseCategoryBreakdown({ businessId, dateFrom, dateTo }),
      ]);
      setPl(summary);
      setBreakdown(cats);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load profit and loss.");
    } finally {
      setBusy(false);
    }
  }, [businessId, dateFrom, dateTo]);

  useEffect(() => {
    if (tab === "cash-book") loadCashBook().catch(() => {});
    else loadPl().catch(() => {});
  }, [tab, loadCashBook, loadPl]);

  return (
    <div className="aifa-page">
      <h1>Cash Book / P&amp;L</h1>
      <TabStrip
        tabs={[
          { id: "cash-book", label: "Cash Book" },
          { id: "profit-and-loss", label: "Profit & Loss" },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="row" style={{ margin: "12px 0" }}>
        {tab === "cash-book" && (
          <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} style={{ padding: 6, minWidth: 200 }}>
            {bankAccounts.length === 0 && <option value="">No bank accounts yet</option>}
            {bankAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.accountName}
              </option>
            ))}
          </select>
        )}
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ padding: 6 }} />
        <span className="muted">to</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ padding: 6 }} />
        <button onClick={() => void (tab === "cash-book" ? loadCashBook() : loadPl())} disabled={busy}>
          {busy ? "Loading…" : "Refresh"}
        </button>
      </div>

      {loadError && <p className="error">{loadError}</p>}

      {tab === "cash-book" && (
        <>
          {bankAccounts.length === 0 ? (
            <p className="muted">Add a bank account (Chart of Accounts page) to see its cash book here.</p>
          ) : cashBookRows === null ? (
            <p className="muted">Loading…</p>
          ) : cashBookRows.length === 0 ? (
            <p className="muted">No movement in this date range.</p>
          ) : (
            <div className="card" style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left" }}>
                    <th style={{ padding: 6 }}>Date</th>
                    <th style={{ padding: 6 }}>Direction</th>
                    <th style={{ padding: 6 }}>Amount</th>
                    <th style={{ padding: 6 }}>Running balance</th>
                  </tr>
                </thead>
                <tbody>
                  {cashBookRows.map((r) => (
                    <tr key={r.entryId} style={{ borderTop: "1px solid var(--aifa-border, #e2e2e2)" }}>
                      <td style={{ padding: 6 }}>{r.postedAt}</td>
                      <td style={{ padding: 6 }}>{r.direction}</td>
                      <td style={{ padding: 6 }}>RM{r.amount.toFixed(2)}</td>
                      <td style={{ padding: 6 }}>RM{r.runningBalance.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "profit-and-loss" && (
        <>
          {pl === null ? (
            <p className="muted">Loading…</p>
          ) : (
            <div className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span>Total revenue</span>
                <strong>RM{pl.totalRevenue.toFixed(2)}</strong>
              </div>
              <div className="row" style={{ justifyContent: "space-between", marginTop: 4 }}>
                <span>Total expense</span>
                <strong>RM{pl.totalExpense.toFixed(2)}</strong>
              </div>
              <div
                className="row"
                style={{ justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--aifa-border, #e2e2e2)" }}
              >
                <span>Net profit</span>
                <strong style={{ color: pl.netProfit >= 0 ? "#1b7a3d" : "#c0392b" }}>RM{pl.netProfit.toFixed(2)}</strong>
              </div>
            </div>
          )}

          <h2 style={{ fontSize: 14, marginTop: 16 }}>Expense breakdown by category</h2>
          {breakdown === null ? (
            <p className="muted">Loading…</p>
          ) : breakdown.length === 0 ? (
            <p className="muted">No expense posted in this date range.</p>
          ) : (
            breakdown.map((b) => (
              <div key={b.accountCode} className="card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{b.accountName}</strong>
                  <span className="muted">{b.pctOfTotalExpense.toFixed(1)}%</span>
                </div>
                <p className="muted" style={{ margin: "4px 0" }}>
                  RM{b.amount.toFixed(2)}
                </p>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}
