/**
 * Cash Book / P&L — Sprint 41 (Vol 13_0 §8, pulled forward for this
 * module's own reporting needs). Read-only, per this sprint's own scope.
 *
 * UI polish Phase 4: presentation only — shared header, table with status
 * pills / stat tiles, labelled fields. Same calls, gating and copy.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabasePaymentVouchersReportsTransport } from "@aifa/core/sync/paymentVouchersReportsTransport";
import type {
  CashBookEntry,
  ProfitAndLossSummary,
  ExpenseCategoryBreakdownEntry,
} from "@aifa/core/sync/paymentVouchersReportsTransport";
import type { BankAccount } from "@aifa/core/sync/partyAndLedgerTransport";

import { Button, Card, DataTable, Field, PageHeader, StatGrid, StatTile, formatDate, formatMoney, humanizeStatus, type Column } from "../../ui";
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

  const cashColumns: Column<CashBookEntry>[] = [
    { key: "date", header: "Date", render: (r) => formatDate(r.postedAt) },
    { key: "dir", header: "Direction", render: (r) => humanizeStatus(r.direction) },
    { key: "amt", header: "Amount", numeric: true, render: (r) => formatMoney(r.amount) },
    { key: "bal", header: "Running balance", numeric: true, render: (r) => formatMoney(r.runningBalance) },
  ];
  const catColumns: Column<ExpenseCategoryBreakdownEntry>[] = [
    { key: "name", header: "Category", render: (b) => b.accountName },
    { key: "pct", header: "% of expense", numeric: true, render: (b) => `${b.pctOfTotalExpense.toFixed(1)}%` },
    { key: "amt", header: "Amount", numeric: true, render: (b) => formatMoney(b.amount) },
  ];

  return (
    <div className="aifa-page">
      <PageHeader title="Cash Book / P&L" description="Read-only reports from the posted ledger.">
        <TabStrip
          tabs={[
            { id: "cash-book", label: "Cash Book" },
            { id: "profit-and-loss", label: "Profit & Loss" },
          ]}
          active={tab}
          onChange={setTab}
        />
      </PageHeader>

      <Card>
        <div className="ui-inline-actions" style={{ alignItems: "flex-end" }}>
          {tab === "cash-book" && (
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
          )}
          <Field label="From">
            {(p) => <input {...p} className="ui-input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />}
          </Field>
          <Field label="To">
            {(p) => <input {...p} className="ui-input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />}
          </Field>
          <Button variant="secondary" loading={busy} onClick={() => void (tab === "cash-book" ? loadCashBook() : loadPl())}>
            {busy ? "Loading…" : "Refresh"}
          </Button>
        </div>
      </Card>

      {loadError && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {loadError}
        </p>
      )}

      {tab === "cash-book" && (
        <Card flush>
          {bankAccounts.length === 0 ? (
            <div className="ui-table-state">Add a bank account (Chart of Accounts page) to see its cash book here.</div>
          ) : (
            <DataTable
              caption="Cash book movements"
              columns={cashColumns}
              rows={loadError ? [] : cashBookRows}
              rowKey={(r) => r.entryId}
              empty={<div className="ui-table-state">No movement in this date range.</div>}
            />
          )}
        </Card>
      )}

      {tab === "profit-and-loss" && (
        <>
          <StatGrid>
            <StatTile label="Total revenue" value={pl ? formatMoney(pl.totalRevenue) : null} />
            <StatTile label="Total expense" value={pl ? formatMoney(pl.totalExpense) : null} />
            <StatTile
              label="Net profit"
              value={pl ? formatMoney(pl.netProfit) : null}
              tone={pl ? (pl.netProfit >= 0 ? "success" : "danger") : "neutral"}
            />
          </StatGrid>
          <Card title="Expense breakdown by category" flush>
            <DataTable
              caption="Expense breakdown by category"
              columns={catColumns}
              rows={loadError ? [] : breakdown}
              rowKey={(b) => b.accountCode}
              empty={<div className="ui-table-state">No expense posted in this date range.</div>}
            />
          </Card>
        </>
      )}
    </div>
  );
}
