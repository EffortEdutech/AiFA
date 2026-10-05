/**
 * e-Signature — Sprint 47 (Vol 13_0 §12 Module I).
 *
 * PROVIDER-AGNOSTIC STUB (see legalCommercialTransport.ts's own header,
 * and Sprint 44's identical double-banner discipline for e-Invoice):
 * the sent → viewed → signed/declined lifecycle below is simulated
 * entirely server-side. Nothing here or in the transport calls a real
 * e-signature vendor (DocuSign, Dropbox Sign, or otherwise) — the
 * "Mark Viewed"/"Mark Signed"/"Mark Declined" buttons stand in for
 * whatever a real recipient-facing signing UI would eventually do.
 * Per Sprint 36's own Outcomes and Risk table (restated here rather
 * than silently dropped now that a UI exists): the e-signature
 * provider's legal validity in the owner's jurisdiction is a legal
 * question outside this plan's technical scope — the same "not a
 * substitute for professional advice" boundary Vol 6_9 §5 states for
 * tax. Do not present a "signed" envelope to a user as having real
 * legal e-signature backing until a real provider is wired in.
 *
 * UI polish Phase 4: presentation only. The SIMULATED banners and the legal
 * validity caution are kept as alerts.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabaseLegalCommercialTransport } from "@aifa/core/sync/legalCommercialTransport";
import type { Contract, ESignatureEnvelope } from "@aifa/core/sync/legalCommercialTransport";
import type { Quotation } from "@aifa/core/sync/quotationInvoiceTransport";
import type { Party } from "@aifa/core/sync/partyAndLedgerTransport";

import { Button, Card, DataTable, Field, PageHeader, StatusPill, formatDate, type Column } from "../../ui";
import { supabase } from "../../lib/supabaseClient";
import { listParties } from "../../lib/partiesAndAccounts";
import { listQuotations } from "../../lib/salesCycle";
import { listContracts, listESignatureEnvelopes } from "../../lib/legalCommercial";

const legalCommercialTransport = createSupabaseLegalCommercialTransport(supabase);

const LEGAL_VALIDITY_CAUTION =
  "The e-signature provider's legal validity in your jurisdiction is a legal question outside this system's technical scope — the same boundary this system already states for tax matters. This is not legal advice; confirm with a qualified professional before relying on a stub-signed document as legally binding.";

interface Props {
  businessId: string;
}

export function ESignaturePage({ businessId }: Props): JSX.Element {
  const [envelopes, setEnvelopes] = useState<ESignatureEnvelope[] | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [sourceKind, setSourceKind] = useState<"contract" | "quotation">("contract");
  const [sourceId, setSourceId] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [env, c, q, p] = await Promise.all([
        listESignatureEnvelopes(businessId),
        listContracts(businessId),
        listQuotations(businessId),
        listParties(businessId),
      ]);
      setEnvelopes(env);
      setContracts(c);
      setQuotations(q);
      setParties(p);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load e-signature envelopes.");
    }
  }, [businessId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  function partyName(id: string): string {
    return parties.find((p) => p.id === id)?.displayName ?? `Party #${id.slice(0, 8)}`;
  }

  function sourceLabel(env: ESignatureEnvelope): string {
    if (env.contractId) {
      const c = contracts.find((x) => x.id === env.contractId);
      return c ? `Contract: ${c.contractType} — ${partyName(c.counterpartyId)}` : `Contract #${env.contractId.slice(0, 8)}`;
    }
    if (env.quotationId) {
      const q = quotations.find((x) => x.id === env.quotationId);
      return q ? `Quotation ${q.quotationNo}` : `Quotation #${env.quotationId.slice(0, 8)}`;
    }
    return "—";
  }

  // Only Contracts already 'pending_signature' / Quotations already 'sent'
  // can have an envelope opened against them — see this file's own
  // transport (create_esignature_envelope enforces this server-side too).
  const eligibleContracts = contracts.filter((c) => c.status === "pending_signature");
  const eligibleQuotations = quotations.filter((q) => q.status === "sent");

  async function handleSend(): Promise<void> {
    if (!sourceId) return;
    setSendBusy(true);
    setSendError(null);
    try {
      await legalCommercialTransport.createEsignatureEnvelope(
        sourceKind === "contract" ? { contractId: sourceId, provider: "generic" } : { quotationId: sourceId, provider: "generic" },
      );
      setSourceId("");
      await load();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Could not send this envelope.");
    } finally {
      setSendBusy(false);
    }
  }

  async function handleAction(envelopeId: string, action: "viewed" | "signed" | "declined"): Promise<void> {
    setBusyId(envelopeId);
    setActionError(null);
    try {
      if (action === "viewed") await legalCommercialTransport.markEsignatureEnvelopeViewed(envelopeId);
      else if (action === "signed") await legalCommercialTransport.markEsignatureEnvelopeSigned(envelopeId);
      else await legalCommercialTransport.markEsignatureEnvelopeDeclined(envelopeId);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That action could not be completed.");
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<ESignatureEnvelope>[] = [
    {
      key: "source",
      header: "Document",
      render: (env) => (
        <>
          <strong>{sourceLabel(env)}</strong>
          <div className="ui-cell-sub">
            provider: {env.provider} · sent {formatDate(env.createdAt)}
          </div>
        </>
      ),
    },
    { key: "status", header: "Status", render: (env) => <StatusPill status={env.status} /> },
    {
      key: "actions",
      header: "",
      render: (env) => {
        const busy = busyId === env.id;
        return (
          <div className="ui-inline-actions">
            {env.status === "sent" && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void handleAction(env.id, "viewed")}>
                Mark Viewed
              </Button>
            )}
            {(env.status === "sent" || env.status === "viewed") && (
              <>
                <Button size="sm" variant="primary" disabled={busy} onClick={() => void handleAction(env.id, "signed")}>
                  Mark Signed
                </Button>
                <Button size="sm" variant="danger" disabled={busy} onClick={() => void handleAction(env.id, "declined")}>
                  Mark Declined
                </Button>
              </>
            )}
            {env.status === "signed" && (
              <span className="ui-muted">{env.contractId ? "Contract moved to 'active'." : "Quotation moved to 'accepted'."}</span>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="aifa-page">
      <PageHeader title="e-Signature" description={LEGAL_VALIDITY_CAUTION} />

      <div className="aifa-alert aifa-alert--danger" role="alert" style={{ textAlign: "center", fontWeight: 700 }}>
        ⚠ SIMULATED — NOT CONNECTED TO A REAL E-SIGNATURE PROVIDER. The sent→viewed→signed/declined lifecycle below
        is entirely server-simulated; no real vendor API is called.
      </div>

      {loadError && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {loadError}
        </p>
      )}

      <Card title="Send a new envelope">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!sendBusy && sourceId) void handleSend();
          }}
        >
          <div className="ui-inline-actions" style={{ alignItems: "flex-end" }}>
            <Field label="Source">
              {(p) => (
                <select
                  {...p}
                  className="ui-select"
                  value={sourceKind}
                  onChange={(e) => {
                    setSourceKind(e.target.value as "contract" | "quotation");
                    setSourceId("");
                  }}
                >
                  <option value="contract">Contract (pending_signature)</option>
                  <option value="quotation">Quotation (sent)</option>
                </select>
              )}
            </Field>
            <Field label="Document">
              {(p) => (
                <select {...p} className="ui-select" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                  <option value="">Select…</option>
                  {sourceKind === "contract"
                    ? eligibleContracts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.contractType} — {partyName(c.counterpartyId)}
                        </option>
                      ))
                    : eligibleQuotations.map((q) => (
                        <option key={q.id} value={q.id}>
                          {q.quotationNo} — {partyName(q.partyId)}
                        </option>
                      ))}
                </select>
              )}
            </Field>
            <Button type="submit" variant="primary" icon="send" loading={sendBusy} disabled={!sourceId}>
              {sendBusy ? "Sending…" : "Send Envelope"}
            </Button>
          </div>
          {sourceKind === "contract" && eligibleContracts.length === 0 && (
            <p className="ui-muted">No Contracts are currently 'pending_signature'.</p>
          )}
          {sourceKind === "quotation" && eligibleQuotations.length === 0 && (
            <p className="ui-muted">No Quotations are currently 'sent'.</p>
          )}
          {sendError && (
            <p className="aifa-alert aifa-alert--danger" role="alert">
              {sendError}
            </p>
          )}
        </form>
      </Card>

      {actionError && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {actionError}
        </p>
      )}

      <Card title="Envelopes" flush>
        <DataTable
          caption="e-Signature envelopes"
          columns={columns}
          rows={loadError ? [] : envelopes}
          rowKey={(env) => env.id}
          empty={<div className="ui-table-state">No e-signature envelopes yet.</div>}
        />
      </Card>
    </div>
  );
}
