/**
 * Parties (Customers/Suppliers) — Sprint 39 (Vol 13_0 §3.1).
 *
 * DISCLOSED GAP: `partyAndLedgerTransport.ts` exposes `createParty`
 * only — no `updateParty` RPC exists despite Sprint 26's own migration
 * comment naming "create_party / update_party" together as a pair (see
 * that comment in app/backend/schema.sql, just above `create_party`'s
 * definition). Only `create_party` was actually implemented. This page
 * therefore supports create + list/detail (read-only fields), not edit
 * — a real, disclosed backend gap this sprint did not invent and is not
 * positioned to silently work around.
 *
 * CREDIT LIMIT OVERRIDE PRECEDENCE (Sprint 47, Vol 13_0 §12.1): when an
 * 'active' Contract with a non-null credit_limit_override exists for a
 * counterparty, it takes precedence over that Party's own creditLimit —
 * the same rule the backend's own `_create_invoice_from_quotation`
 * enforces. This page reflects that by showing the effective (override)
 * figure alongside the Party's own stored figure rather than only the
 * latter.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabasePartyAndLedgerTransport } from "@aifa/core/sync/partyAndLedgerTransport";
import type { Party, PartyType } from "@aifa/core/sync/partyAndLedgerTransport";

import { supabase } from "../../lib/supabaseClient";
import { listParties } from "../../lib/partiesAndAccounts";
import { listContracts, effectiveCreditLimitOverrideByParty } from "../../lib/legalCommercial";
import { TabStrip } from "../TabStrip";

const partyAndLedgerTransport = createSupabasePartyAndLedgerTransport(supabase);

const PARTY_TYPE_OPTIONS: PartyType[] = ["customer", "supplier", "employee", "agent", "dropship_partner"];

type PartyTab = "all" | "customer" | "supplier" | "employee";

interface Props {
  businessId: string;
}

export function PartiesPage({ businessId }: Props): JSX.Element {
  const [parties, setParties] = useState<Party[] | null>(null);
  const [creditLimitOverrideByParty, setCreditLimitOverrideByParty] = useState<Record<string, number>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<PartyTab>("all");

  const [showCreate, setShowCreate] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [partyTypes, setPartyTypes] = useState<PartyType[]>(["customer"]);
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [p, contracts] = await Promise.all([listParties(businessId), listContracts(businessId)]);
      setParties(p);
      setCreditLimitOverrideByParty(effectiveCreditLimitOverrideByParty(contracts));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load parties.");
    }
  }, [businessId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function handleCreate(): Promise<void> {
    if (!displayName.trim() || partyTypes.length === 0) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      await partyAndLedgerTransport.createParty({
        businessId,
        displayName: displayName.trim(),
        partyTypes,
        contactEmail: contactEmail.trim() || null,
        contactPhone: contactPhone.trim() || null,
        creditLimit: creditLimit.trim() ? Number(creditLimit) : null,
      });
      setDisplayName("");
      setContactEmail("");
      setContactPhone("");
      setCreditLimit("");
      setShowCreate(false);
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create party.");
    } finally {
      setCreateBusy(false);
    }
  }

  function toggleType(t: PartyType): void {
    setPartyTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  if (loadError) {
    return (
      <div className="aifa-page">
        <h1>Parties</h1>
        <p className="error">{loadError}</p>
      </div>
    );
  }

  const filtered = (parties ?? []).filter((p) => tab === "all" || p.partyTypes.includes(tab));

  return (
    <div className="aifa-page">
      <h1>Parties</h1>
      <TabStrip
        tabs={[
          { id: "all", label: "All", count: parties?.length },
          { id: "customer", label: "Customers" },
          { id: "supplier", label: "Suppliers" },
          { id: "employee", label: "Employees" },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="row" style={{ margin: "12px 0" }}>
        <button onClick={() => setShowCreate((s) => !s)}>{showCreate ? "Cancel" : "New party"}</button>
      </div>

      {showCreate && (
        <div className="card">
          <h2 style={{ fontSize: 16, marginTop: 0 }}>New party</h2>
          <div className="row">
            <input
              placeholder="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              style={{ padding: 6, flex: 1, minWidth: 200 }}
            />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            {PARTY_TYPE_OPTIONS.map((t) => (
              <label key={t} className="muted" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input type="checkbox" checked={partyTypes.includes(t)} onChange={() => toggleType(t)} />
                {t}
              </label>
            ))}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <input
              placeholder="Contact email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              style={{ padding: 6 }}
            />
            <input
              placeholder="Contact phone"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              style={{ padding: 6 }}
            />
            <input
              placeholder="Credit limit (RM)"
              value={creditLimit}
              onChange={(e) => setCreditLimit(e.target.value)}
              style={{ padding: 6, width: 140 }}
            />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={() => void handleCreate()} disabled={createBusy || !displayName.trim()}>
              {createBusy ? "Creating…" : "Create party"}
            </button>
          </div>
          {createError && <p className="error">{createError}</p>}
        </div>
      )}

      {parties === null ? (
        <p className="muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">No parties yet.</p>
      ) : (
        filtered.map((p) => (
          <div key={p.id} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{p.displayName}</strong>
              <span className="muted">{p.partyNo}</span>
            </div>
            <p className="muted" style={{ margin: "4px 0" }}>
              {p.partyTypes.join(", ")} · {p.status}
              {p.creditLimit != null && ` · Credit limit RM${p.creditLimit.toFixed(2)}`}
              {creditLimitOverrideByParty[p.id] != null && (
                <> · <strong>Effective credit limit RM{creditLimitOverrideByParty[p.id].toFixed(2)} (active Contract override takes precedence)</strong></>
              )}
            </p>
            {(p.contactEmail || p.contactPhone) && (
              <p className="muted" style={{ margin: "4px 0" }}>
                {[p.contactEmail, p.contactPhone].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        ))
      )}
    </div>
  );
}
