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
 */
import { useCallback, useEffect, useState } from "react";

import type { ChartOfAccount } from "@aifa/core/sync/partyAndLedgerTransport";

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

  return (
    <div className="aifa-page">
      <h1>Ledger</h1>
      <div className="row" style={{ margin: "12px 0" }}>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={{ padding: 6 }}>
          {accounts?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.accountCode} — {a.accountName}
            </option>
          ))}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ padding: 6 }} />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ padding: 6 }} />
        <button onClick={() => void runQuery()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {rows === null ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">
          No entries in this range. If this account should have real activity, see this page's own note on the
          local-first-vs-server-ledger cutover gap (Sprint 26).
        </p>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--aifa-font-size-table)" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--aifa-border)" }}>
                <th style={{ padding: 6 }}>Date</th>
                <th style={{ padding: 6 }}>Direction</th>
                <th style={{ padding: 6 }}>Amount</th>
                <th style={{ padding: 6 }}>Running balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.entryId} style={{ borderBottom: "1px solid var(--aifa-border)" }}>
                  <td style={{ padding: 6 }}>{new Date(r.postedAt).toLocaleDateString()}</td>
                  <td style={{ padding: 6 }}>{r.direction}</td>
                  <td style={{ padding: 6 }}>RM{r.amount.toFixed(2)}</td>
                  <td style={{ padding: 6 }}>RM{r.runningBalance.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
