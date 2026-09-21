/**
 * Chart of Accounts — Sprint 39 (Vol 13_0 §8).
 *
 * `settings` `configure`-gated custom-account creation (server-side);
 * the auto-seeded Phase 1 system accounts (`isSystem: true`) cannot be
 * created/edited/deleted from here or anywhere — no RPC offers that,
 * by design (Vol 11_1 §4.1).
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabasePartyAndLedgerTransport } from "@aifa/core/sync/partyAndLedgerTransport";
import type { AccountType, ChartOfAccount } from "@aifa/core/sync/partyAndLedgerTransport";

import { supabase } from "../../lib/supabaseClient";
import { listChartOfAccounts } from "../../lib/partiesAndAccounts";
import { TabStrip } from "../TabStrip";

const partyAndLedgerTransport = createSupabasePartyAndLedgerTransport(supabase);

const ACCOUNT_TYPES: AccountType[] = ["asset", "liability", "equity", "revenue", "expense"];

interface Props {
  businessId: string;
}

export function ChartOfAccountsPage({ businessId }: Props): JSX.Element {
  const [accounts, setAccounts] = useState<ChartOfAccount[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<AccountType>("asset");

  const [showCreate, setShowCreate] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("expense");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      setAccounts(await listChartOfAccounts(businessId));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load the chart of accounts.");
    }
  }, [businessId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function handleCreate(): Promise<void> {
    if (!code.trim() || !name.trim()) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      await partyAndLedgerTransport.createChartOfAccount({
        businessId,
        accountCode: code.trim(),
        accountName: name.trim(),
        accountType: type,
      });
      setCode("");
      setName("");
      setShowCreate(false);
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create the account.");
    } finally {
      setCreateBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="aifa-page">
        <h1>Chart of Accounts</h1>
        <p className="error">{loadError}</p>
      </div>
    );
  }

  const filtered = (accounts ?? []).filter((a) => a.accountType === tab);

  return (
    <div className="aifa-page">
      <h1>Chart of Accounts</h1>
      <TabStrip tabs={ACCOUNT_TYPES.map((t) => ({ id: t, label: t[0].toUpperCase() + t.slice(1) }))} active={tab} onChange={setTab} />

      <div className="row" style={{ margin: "12px 0" }}>
        <button onClick={() => setShowCreate((s) => !s)}>{showCreate ? "Cancel" : "New custom account"}</button>
      </div>

      {showCreate && (
        <div className="card">
          <h2 style={{ fontSize: 16, marginTop: 0 }}>New custom account</h2>
          <div className="row">
            <input placeholder="Account code" value={code} onChange={(e) => setCode(e.target.value)} style={{ padding: 6, width: 140 }} />
            <input placeholder="Account name" value={name} onChange={(e) => setName(e.target.value)} style={{ padding: 6, flex: 1 }} />
            <select value={type} onChange={(e) => setType(e.target.value as AccountType)} style={{ padding: 6 }}>
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button onClick={() => void handleCreate()} disabled={createBusy || !code.trim() || !name.trim()}>
              {createBusy ? "Creating…" : "Create"}
            </button>
          </div>
          {createError && <p className="error">{createError}</p>}
        </div>
      )}

      {accounts === null ? (
        <p className="muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">No {tab} accounts.</p>
      ) : (
        filtered.map((a) => (
          <div key={a.id} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>
                {a.accountCode} — {a.accountName}
              </strong>
              {a.isSystem && <span className="muted">System</span>}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
