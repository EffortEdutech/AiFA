/**
 * AR Ageing — Sprint 40 (Vol 13_0 §4 Module B). Real bucketed AR
 * ageing via `arAgeingDetail` (Sprint 29), replacing the flat
 * outstanding-list Vol 6_1 §6 flagged as a gap.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabasePaymentsCreditNotesTransport } from "@aifa/core/sync/paymentsCreditNotesTransport";
import type { ArAgeingEntry, AgeingBucket } from "@aifa/core/sync/paymentsCreditNotesTransport";
import type { Party } from "@aifa/core/sync/partyAndLedgerTransport";

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

  if (loadError) {
    return (
      <div className="aifa-page">
        <h1>AR Ageing</h1>
        <p className="error">{loadError}</p>
      </div>
    );
  }

  const filtered = (entries ?? []).filter((e) => tab === "all" || e.ageingBucket === tab);
  const counts = (bucket: AgeingBucket) => (entries ?? []).filter((e) => e.ageingBucket === bucket).length;
  const totalOutstanding = (entries ?? []).reduce((sum, e) => sum + e.outstandingBalance, 0);
  const filteredTotal = filtered.reduce((sum, e) => sum + e.outstandingBalance, 0);

  return (
    <div className="aifa-page">
      <h1>AR Ageing</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Total outstanding across all buckets: RM{totalOutstanding.toFixed(2)}
      </p>
      <TabStrip
        tabs={[
          { id: "all", label: "All", count: entries?.length },
          ...BUCKETS.map((b) => ({ id: b, label: b === "current" ? "Current" : `${b} days`, count: counts(b) })),
        ]}
        active={tab}
        onChange={setTab}
      />

      {entries === null ? (
        <p className="muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">Nothing outstanding in this bucket.</p>
      ) : (
        <>
          <p className="muted" style={{ margin: "8px 0" }}>
            Subtotal for this view: RM{filteredTotal.toFixed(2)}
          </p>
          {filtered
            .slice()
            .sort((a, b) => b.daysOverdue - a.daysOverdue)
            .map((e) => (
              <div key={e.invoiceId} className="card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>
                    {e.invoiceNo} — {partyName(e.partyId)}
                  </strong>
                  <span
                    className="muted"
                    style={e.ageingBucket !== "current" ? { color: "#c0392b", fontWeight: 600 } : undefined}
                  >
                    {e.ageingBucket}
                  </span>
                </div>
                <p className="muted" style={{ margin: "4px 0" }}>
                  RM{e.outstandingBalance.toFixed(2)} outstanding · due {e.dueDate}
                  {e.daysOverdue > 0 && ` · ${e.daysOverdue} days overdue`}
                </p>
              </div>
            ))}
        </>
      )}
    </div>
  );
}
