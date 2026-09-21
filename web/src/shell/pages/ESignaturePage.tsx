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
 */
import { useCallback, useEffect, useState, type CSSProperties } from "react";

import { createSupabaseLegalCommercialTransport } from "@aifa/core/sync/legalCommercialTransport";
import type { Contract, ESignatureEnvelope } from "@aifa/core/sync/legalCommercialTransport";
import type { Quotation } from "@aifa/core/sync/quotationInvoiceTransport";
import type { Party } from "@aifa/core/sync/partyAndLedgerTransport";

import { supabase } from "../../lib/supabaseClient";
import { listParties } from "../../lib/partiesAndAccounts";
import { listQuotations } from "../../lib/salesCycle";
import { listContracts, listESignatureEnvelopes } from "../../lib/legalCommercial";

const legalCommercialTransport = createSupabaseLegalCommercialTransport(supabase);

const STUB_BANNER_STYLE: CSSProperties = {
  padding: "8px 12px",
  marginBottom: 12,
  borderRadius: 6,
  background: "#7a1f1f",
  color: "#fff",
  fontWeight: 700,
  textAlign: "center",
};

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

  if (loadError) {
    return (
      <div className="aifa-page">
        <h1>e-Signature</h1>
        <p className="error">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="aifa-page">
      <h1>e-Signature</h1>

      <div style={STUB_BANNER_STYLE}>
        ⚠ SIMULATED — NOT CONNECTED TO A REAL E-SIGNATURE PROVIDER. The sent→viewed→signed/declined lifecycle
        below is entirely server-simulated; no real vendor API is called.
      </div>
      <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>{LEGAL_VALIDITY_CAUTION}</p>

      <div className="card" style={{ marginBottom: 16 }}>
        <strong>Send a new envelope</strong>
        <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <select
            value={sourceKind}
            onChange={(e) => {
              setSourceKind(e.target.value as "contract" | "quotation");
              setSourceId("");
            }}
            style={{ padding: 6 }}
          >
            <option value="contract">Contract (pending_signature)</option>
            <option value="quotation">Quotation (sent)</option>
          </select>
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} style={{ padding: 6, minWidth: 260 }}>
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
          <button onClick={() => void handleSend()} disabled={sendBusy || !sourceId}>
            {sendBusy ? "Sending…" : "Send Envelope"}
          </button>
        </div>
        {sourceKind === "contract" && eligibleContracts.length === 0 && (
          <p className="muted" style={{ marginTop: 6 }}>No Contracts are currently 'pending_signature'.</p>
        )}
        {sourceKind === "quotation" && eligibleQuotations.length === 0 && (
          <p className="muted" style={{ marginTop: 6 }}>No Quotations are currently 'sent'.</p>
        )}
        {sendError && <p className="error">{sendError}</p>}
      </div>

      <div style={STUB_BANNER_STYLE}>⚠ SIMULATED — NOT CONNECTED TO A REAL E-SIGNATURE PROVIDER.</div>

      {actionError && <p className="error">{actionError}</p>}

      {envelopes === null ? (
        <p className="muted">Loading…</p>
      ) : envelopes.length === 0 ? (
        <p className="muted">No e-signature envelopes yet.</p>
      ) : (
        envelopes.map((env) => {
          const busy = busyId === env.id;
          return (
            <div key={env.id} className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{sourceLabel(env)}</strong>
                <span className="muted">{env.status}</span>
              </div>
              <p className="muted" style={{ margin: "4px 0" }}>
                provider: {env.provider} · sent {env.createdAt.slice(0, 10)}
              </p>
              <div className="row" style={{ gap: 8 }}>
                {env.status === "sent" && (
                  <button onClick={() => void handleAction(env.id, "viewed")} disabled={busy}>
                    {busy ? "…" : "Mark Viewed"}
                  </button>
                )}
                {(env.status === "sent" || env.status === "viewed") && (
                  <>
                    <button onClick={() => void handleAction(env.id, "signed")} disabled={busy}>
                      {busy ? "…" : "Mark Signed"}
                    </button>
                    <button onClick={() => void handleAction(env.id, "declined")} disabled={busy} style={{ color: "#c0392b", borderColor: "#c0392b" }}>
                      {busy ? "…" : "Mark Declined"}
                    </button>
                  </>
                )}
                {env.status === "signed" && (
                  <span className="muted">
                    {env.contractId ? "Contract moved to 'active'." : "Quotation moved to 'accepted'."}
                  </span>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
