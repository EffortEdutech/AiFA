/**
 * Ledger — Sprint 39 (Vol 13_0 §8), reading the NEW server-side
 * `public.ledger_entries` table via `general_ledger_detail` (Sprint 32).
 *
 * SCOPE NOTE (carried from partyAndLedgerTransport.ts's own Sprint 26
 * header, restated here so this page's emptiness for most real
 * businesses today isn't mistaken for a bug): this table is populated
 * only by the NEW `postLedgerEntries` path. The existing local-first
 * ledger pipeline every capture flow has used since Phase 1
 * (`packages/core/src/db/ledgerRepository.ts`) is unchanged and does
 * not post here — so this page can legitimately show nothing for a
 * business whose only activity has gone through the old pipeline. This
 * is not a query bug; it's the disclosed cutover gap that sprint
 * already named.
 *
 * UI polish Phase 4: presentation only — shared header, table and labelled
 * fields. Same calls, gating and copy.
 */
import { useCallback, useEffect, useState } from "react";

import type { ChartOfAccount } from "@aifa/core/sync/partyAndLedgerTransport";

import { Button, Card, DataTable, Field, PageHeader, formatDate, formatMoney, humanizeStatus, type Column } from "../../ui";
import { listChartOfAccounts, generalLedgerDetail, type GeneralLedgerRow } from "../../lib/partiesAndAccounts";

interface Props {
  businessId: string;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function LedgerPage({ businessId }: Props): JSX.Element {
  const [accounts, setAccounts] = useState<ChartOfAccount[] | null>(null);
  const [accountId, setAccountId] = useState("");
  const [dateFrom, setDateFrom] = useState(() => isoDate(new Date(Date.now() - 30 * 24 * 3600 * 1000)));
  const [dateTo, setDateTo] = useState(() => isoDate(new Date()));
  const [rows, setRows] = useState<GeneralLedgerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    listChartOfAccounts(businessId)
      .then((accts) => {
        setAccounts(accts);
        if (accts.length > 0) setAccountId(accts[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load accounts."));
  }, [businessId]);

  const runQuery = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await generalLedgerDetail(businessId, accountId, dateFrom, dateTo));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load ledger entries.");
    } finally {
      setLoading(false);
    }
  }, [businessId, accountId, dateFrom, dateTo]);

  useEffect(() => {
    if (accountId) void runQuery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const columns: Column<GeneralLedgerRow>[] = [
    { key: "date", header: "Date", render: (r) => formatDate(r.postedAt) },
    { key: "dir", header: "Direction", render: (r) => humanizeStatus(r.direction) },
    { key: "amt", header: "Amount", numeric: true, render: (r) => formatMoney(r.amount) },
    { key: "bal", header: "Running balance", numeric: true, render: (r) => formatMoney(r.runningBalance) },
  ];

  return (
    <div className="aifa-page">
      <PageHeader title="Ledger" description="Posted entries for one account, with a running balance." />

      <Card>
        <div className="ui-inline-actions" style={{ alignItems: "flex-end" }}>
          <Field label="Account">
            {(p) => (
              <select {...p} className="ui-select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.accountCode} — {a.accountName}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="From">
            {(p) => <input {...p} className="ui-input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />}
          </Field>
          <Field label="To">
            {(p) => <input {...p} className="ui-input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />}
          </Field>
          <Button variant="secondary" loading={loading} onClick={() => void runQuery()}>
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>
      </Card>

      {error && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {error}
        </p>
      )}

      <Card flush>
        <DataTable
          caption="Ledger entries"
          columns={columns}
          rows={error ? [] : rows}
          rowKey={(r) => r.entryId}
          empty={
            <div className="ui-table-state">
              No entries in this range. If this account should have real activity, see this page's own note on the
              local-first-vs-server-ledger cutover gap (Sprint 26).
            </div>
          }
        />
      </Card>
    </div>
  );
}
