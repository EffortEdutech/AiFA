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
 *
 * UI polish Phase 3 (pilot page): presentation only — one table instead
 * of a card per party, labelled form fields, shared status pills. The
 * same reads and the same `createParty` call as before.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabasePartyAndLedgerTransport } from "@aifa/core/sync/partyAndLedgerTransport";
import type { Party, PartyType } from "@aifa/core/sync/partyAndLedgerTransport";

import { supabase } from "../../lib/supabaseClient";
import { listParties } from "../../lib/partiesAndAccounts";
import { listContracts, effectiveCreditLimitOverrideByParty } from "../../lib/legalCommercial";
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  PageHeader,
  StatusPill,
  formatMoney,
  humanizeStatus,
  type Column,
} from "../../ui";
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
  const [creditLimitError, setCreditLimitError] = useState<string | null>(null);
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
    const limit = creditLimit.trim() ? Number(creditLimit) : null;
    if (limit !== null && Number.isNaN(limit)) {
      setCreditLimitError("Enter the credit limit as a number, e.g. 5000.");
      return;
    }
    setCreditLimitError(null);
    setCreateBusy(true);
    setCreateError(null);
    try {
      await partyAndLedgerTransport.createParty({
        businessId,
        displayName: displayName.trim(),
        partyTypes,
        contactEmail: contactEmail.trim() || null,
        contactPhone: contactPhone.trim() || null,
        creditLimit: limit,
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

  const filtered = parties === null ? null : parties.filter((p) => tab === "all" || p.partyTypes.includes(tab));

  const columns: Column<Party>[] = [
    {
      key: "name",
      header: "Name",
      render: (p) => (
        <>
          <strong>{p.displayName}</strong>
          <span className="ui-cell-sub">{p.partyNo}</span>
        </>
      ),
    },
    { key: "types", header: "Type", render: (p) => p.partyTypes.map(humanizeStatus).join(", ") },
    { key: "status", header: "Status", render: (p) => <StatusPill status={p.status} /> },
    {
      key: "credit",
      header: "Credit limit",
      numeric: true,
      render: (p) => {
        const override = creditLimitOverrideByParty[p.id];
        return (
          <>
            {p.creditLimit != null ? formatMoney(p.creditLimit) : "—"}
            {override != null && (
              <span className="ui-cell-sub">
                <strong>Effective {formatMoney(override)}</strong> — active Contract override takes precedence
              </span>
            )}
          </>
        );
      },
    },
    {
      key: "contact",
      header: "Contact",
      render: (p) => {
        const parts = [p.contactEmail, p.contactPhone].filter(Boolean);
        return parts.length > 0 ? parts.join(" · ") : "—";
      },
    },
  ];

  return (
    <div className="ui-page">
      <PageHeader
        title="Parties"
        description="Customers, suppliers, employees and agents you do business with."
        actions={
          <Button variant="primary" icon={showCreate ? "x" : "plus"} onClick={() => setShowCreate((s) => !s)}>
            {showCreate ? "Cancel" : "New party"}
          </Button>
        }
      >
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
      </PageHeader>

      {showCreate && (
        <Card title="New party">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!createBusy) void handleCreate();
            }}
            noValidate
          >
            <div className="ui-form-grid">
              <Field label="Display name" required>
                {(p) => (
                  <input {...p} className="ui-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                )}
              </Field>
              <Field label="Contact email">
                {(p) => (
                  <input
                    {...p}
                    className="ui-input"
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Contact phone">
                {(p) => (
                  <input {...p} className="ui-input" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
                )}
              </Field>
              <Field label="Credit limit (RM)" hint="Optional" error={creditLimitError}>
                {(p) => (
                  <input
                    {...p}
                    className="ui-input"
                    inputMode="decimal"
                    value={creditLimit}
                    onChange={(e) => setCreditLimit(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <fieldset className="ui-check-group" style={{ marginTop: "var(--aifa-space-4)" }}>
              <legend>Party type</legend>
              <div className="ui-check-row">
                {PARTY_TYPE_OPTIONS.map((t) => (
                  <label key={t} className="ui-check">
                    <input type="checkbox" checked={partyTypes.includes(t)} onChange={() => toggleType(t)} />
                    {humanizeStatus(t)}
                  </label>
                ))}
              </div>
            </fieldset>
            {createError && (
              <p className="aifa-alert aifa-alert--danger" role="alert" style={{ marginTop: "var(--aifa-space-3)" }}>
                {createError}
              </p>
            )}
            <div className="ui-form-actions">
              <Button type="submit" variant="primary" loading={createBusy} disabled={!displayName.trim() || partyTypes.length === 0}>
                {createBusy ? "Creating…" : "Create party"}
              </Button>
              {partyTypes.length === 0 && <span className="ui-muted">Choose at least one party type.</span>}
            </div>
          </form>
        </Card>
      )}

      <Card flush>
        <DataTable
          caption="Parties"
          columns={columns}
          rows={filtered}
          rowKey={(p) => p.id}
          error={loadError}
          empty={
            <EmptyState
              icon="users"
              title={tab === "all" ? "No parties yet" : "No parties in this view"}
              description={
                tab === "all"
                  ? "Add your first customer or supplier to start quoting and invoicing."
                  : "Parties of this type will appear here."
              }
              action={
                tab === "all" && !showCreate ? (
                  <Button variant="primary" icon="plus" onClick={() => setShowCreate(true)}>
                    New party
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </Card>
    </div>
  );
}
