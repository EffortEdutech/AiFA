/**
 * AR Ageing — Sprint 40 (Vol 13_0 §4 Module B). Real bucketed AR
 * ageing via `arAgeingDetail` (Sprint 29), replacing the flat
 * outstanding-list Vol 6_1 §6 flagged as a gap.
 *
 * UI polish Phase 4: presentation only — stat tiles, a sortable-by-overdue
 * table and shared states; same read and same bucketing.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabasePaymentsCreditNotesTransport } from "@aifa/core/sync/paymentsCreditNotesTransport";
import type { ArAgeingEntry, AgeingBucket } from "@aifa/core/sync/paymentsCreditNotesTransport";
import type { Party } from "@aifa/core/sync/partyAndLedgerTransport";

import { DataTable, PageHeader, StatGrid, StatTile, StatusPill, formatDate, formatMoney, type Column } from "../../ui";
import { supabase } from "../../lib/supabaseClient";
import { listParties } from "../../lib/partiesAndAccounts";
import { TabStrip } from "../TabStrip";

const paymentsCreditNotesTransport = createSupabasePaymentsCreditNotesTransport(supabase);

const BUCKETS: AgeingBucket[] = ["current", "1-30", "31-60", "61-90", "90+"];

type BucketTab = "all" | AgeingBucket;

interface Props {
  businessId: string;
}

export function ArAgeingPage({ businessId }: Props): JSX.Element {
  const [entries, setEntries] = useState<ArAgeingEntry[] | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<BucketTab>("all");

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [e, p] = await Promise.all([paymentsCreditNotesTransport.arAgeingDetail(businessId), listParties(businessId)]);
      setEntries(e);
      setParties(p);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load AR ageing.");
    }
  }, [businessId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  function partyName(id: string): string {
    return parties.find((p) => p.id === id)?.displayName ?? `Party #${id.slice(0, 8)}`;
  }

  const filtered = (entries ?? []).filter((e) => tab === "all" || e.ageingBucket === tab);
  const counts = (bucket: AgeingBucket) => (entries ?? []).filter((e) => e.ageingBucket === bucket).length;
  const totalOutstanding = (entries ?? []).reduce((sum, e) => sum + e.outstandingBalance, 0);
  const filteredTotal = filtered.reduce((sum, e) => sum + e.outstandingBalance, 0);
  const rows = entries === null ? null : filtered.slice().sort((a, b) => b.daysOverdue - a.daysOverdue);

  const columns: Column<ArAgeingEntry>[] = [
    {
      key: "invoice",
      header: "Invoice",
      render: (e) => (
        <>
          <strong>{e.invoiceNo}</strong>
          <div className="ui-cell-sub">{partyName(e.partyId)}</div>
        </>
      ),
    },
    {
      key: "bucket",
      header: "Bucket",
      render: (e) => (
        <StatusPill
          status={e.ageingBucket}
          label={e.ageingBucket === "current" ? "Current" : `${e.ageingBucket} days`}
          tone={e.ageingBucket === "current" ? "neutral" : e.ageingBucket === "1-30" ? "warning" : "danger"}
        />
      ),
    },
    { key: "due", header: "Due", render: (e) => formatDate(e.dueDate) },
    {
      key: "over",
      header: "Days overdue",
      numeric: true,
      render: (e) => (e.daysOverdue > 0 ? e.daysOverdue : "—"),
    },
    { key: "out", header: "Outstanding", numeric: true, render: (e) => formatMoney(e.outstandingBalance) },
  ];

  return (
    <div className="aifa-page">
      <PageHeader title="AR Ageing" description="What customers owe, grouped by how overdue it is.">
        <TabStrip
          tabs={[
            { id: "all", label: "All", count: entries?.length },
            ...BUCKETS.map((b) => ({ id: b, label: b === "current" ? "Current" : `${b} days`, count: counts(b) })),
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

      <StatGrid>
        <StatTile label="Total outstanding (all buckets)" value={entries === null && !loadError ? null : formatMoney(totalOutstanding)} />
        <StatTile label="Subtotal for this view" value={entries === null && !loadError ? null : formatMoney(filteredTotal)} />
      </StatGrid>

      <DataTable
        caption="Outstanding invoices by ageing bucket"
        columns={columns}
        rows={loadError ? [] : rows}
        rowKey={(e) => e.invoiceId}
        empty={<div className="ui-table-state">Nothing outstanding in this bucket.</div>}
      />
    </div>
  );
}
