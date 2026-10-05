/**
 * Chart of Accounts — Sprint 39 (Vol 13_0 §8).
 *
 * `settings` `configure`-gated custom-account creation (server-side);
 * the auto-seeded Phase 1 system accounts (`isSystem: true`) cannot be
 * created/edited/deleted from here or anywhere — no RPC offers that,
 * by design (Vol 11_1 §4.1).
 *
 * UI polish Phase 4: presentation only — shared header, table and labelled
 * fields. Same calls, gating and copy.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabasePartyAndLedgerTransport } from "@aifa/core/sync/partyAndLedgerTransport";
import type { AccountType, ChartOfAccount } from "@aifa/core/sync/partyAndLedgerTransport";

import { Button, Card, DataTable, Field, PageHeader, StatusPill, type Column } from "../../ui";
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

  const filtered = (accounts ?? []).filter((a) => a.accountType === tab);

  const columns: Column<ChartOfAccount>[] = [
    { key: "code", header: "Code", render: (a) => <strong>{a.accountCode}</strong> },
    { key: "name", header: "Account name", render: (a) => a.accountName },
    { key: "system", header: "", render: (a) => (a.isSystem ? <StatusPill status="neutral" label="System" tone="neutral" /> : null) },
  ];

  return (
    <div className="aifa-page">
      <PageHeader
        title="Chart of Accounts"
        actions={
          <Button variant="primary" icon={showCreate ? undefined : "plus"} onClick={() => setShowCreate((s) => !s)}>
            {showCreate ? "Cancel" : "New custom account"}
          </Button>
        }
      >
        <TabStrip tabs={ACCOUNT_TYPES.map((t) => ({ id: t, label: t[0].toUpperCase() + t.slice(1) }))} active={tab} onChange={setTab} />
      </PageHeader>

      {loadError && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {loadError}
        </p>
      )}

      {showCreate && (
        <Card title="New custom account">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!createBusy && code.trim() && name.trim()) void handleCreate();
            }}
          >
            <div className="ui-form-grid">
              <Field label="Account code" required>
                {(p) => <input {...p} className="ui-input" value={code} onChange={(e) => setCode(e.target.value)} />}
              </Field>
              <Field label="Account name" required>
                {(p) => <input {...p} className="ui-input" value={name} onChange={(e) => setName(e.target.value)} />}
              </Field>
              <Field label="Type">
                {(p) => (
                  <select {...p} className="ui-select" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
                    {ACCOUNT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            <div className="ui-form-actions">
              <Button type="submit" variant="primary" loading={createBusy} disabled={!code.trim() || !name.trim()}>
                {createBusy ? "Creating…" : "Create"}
              </Button>
            </div>
            {createError && (
              <p className="aifa-alert aifa-alert--danger" role="alert">
                {createError}
              </p>
            )}
          </form>
        </Card>
      )}

      <Card flush>
        <DataTable
          caption={`${tab} accounts`}
          columns={columns}
          rows={loadError ? [] : accounts === null ? null : filtered}
          rowKey={(a) => a.id}
          empty={<div className="ui-table-state">No {tab} accounts.</div>}
        />
      </Card>
    </div>
  );
}
