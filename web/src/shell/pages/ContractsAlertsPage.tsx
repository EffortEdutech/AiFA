/**
 * Contracts & Alerts — Sprint 47 (Vol 13_0 §12 Module I).
 *
 * NO-'rejected'-ENUM NOTE: `ContractStatus` is 'draft' | 'pending_signature'
 * | 'active' | 'expired' | 'terminated' — there is no 'rejected' value.
 * Per the backend's own trigger (`sync_contract_on_task_decision`), a
 * rejected Contract's 'draft' row is DELETED, not status-flipped — same
 * precedent as Sprint 46's OvertimeRecord/CommissionCalculation. This
 * page therefore never renders a "rejected" badge; a rejected Contract
 * simply stops appearing in the list after reload, and the create form's
 * own confirmation banner says so up front rather than implying a status
 * this data model does not have.
 *
 * ALERT LEAD-TIME NOTE: `listDueContractAlerts` (called directly from
 * the transport below — a genuine read RPC, not duplicated in lib/)
 * returns only alerts whose `triggerDate` (= end_date - renewal_notice_
 * days, NOT end_date itself) has been reached — Sprint 36's own verified
 * DoD nuance. A Contract expiring in 30 days with a 30-day notice period
 * shows up today; the same Contract with a 7-day notice period does not
 * show up until 7 days before expiry.
 *
 * DOCUMENT ATTACHMENT NOTE (disclosed): `createDocument` (reused from
 * Sprint 41's `paymentVouchersReportsTransport.ts` per this sprint's own
 * Task Breakdown) requires `capture` on `expense` OR `configure` on
 * `accounting_reports` — NOT `legal_contract`. A membership holding only
 * `legal_contract: capture` (a plausible "Legal" role) can create a
 * Contract but will see `createDocument` fail with `not_authorized` if
 * they try to attach a document — a real backend capability mismatch
 * this sprint did not invent and is not positioned to silently paper
 * over. The attachment field is optional and its own error is surfaced
 * verbatim rather than blocking Contract creation itself.
 *
 * SOLO VS TEAM APPROVAL ROUTING: `createContract` opens a real
 * ApprovalTask. For a solo business (`accessModel === "solo"`), the
 * backend resolves that task in the SAME transaction as creation
 * (`resolved_via = 'solo_self_resolved'`, Vol 13_3 §3) — this page's
 * banner says so explicitly, matching every other capture-then-approve
 * flow this phase.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabaseLegalCommercialTransport } from "@aifa/core/sync/legalCommercialTransport";
import type { Contract, ContractAlert, ContractType } from "@aifa/core/sync/legalCommercialTransport";
import { createSupabasePaymentVouchersReportsTransport } from "@aifa/core/sync/paymentVouchersReportsTransport";
import type { Party } from "@aifa/core/sync/partyAndLedgerTransport";

import { supabase } from "../../lib/supabaseClient";
import { listParties } from "../../lib/partiesAndAccounts";
import { listContracts } from "../../lib/legalCommercial";
import { useAccess } from "../AccessContext";

const legalCommercialTransport = createSupabaseLegalCommercialTransport(supabase);
const paymentVouchersReportsTransport = createSupabasePaymentVouchersReportsTransport(supabase);

const CONTRACT_TYPE_OPTIONS: ContractType[] = ["distributor_agreement", "nda", "employment_contract", "other"];

interface Props {
  businessId: string;
  onGoToApprovals?: () => void;
}

export function ContractsAlertsPage({ businessId, onGoToApprovals }: Props): JSX.Element {
  const { accessModel } = useAccess();

  const [contracts, setContracts] = useState<Contract[] | null>(null);
  const [dueAlerts, setDueAlerts] = useState<ContractAlert[] | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [counterpartyId, setCounterpartyId] = useState("");
  const [contractType, setContractType] = useState<ContractType>("distributor_agreement");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [autoRenew, setAutoRenew] = useState(false);
  const [renewalNoticeDays, setRenewalNoticeDays] = useState("");
  const [creditLimitOverride, setCreditLimitOverride] = useState("");
  const [documentStorageRef, setDocumentStorageRef] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [documentAttachError, setDocumentAttachError] = useState<string | null>(null);
  const [lastCreatedContractId, setLastCreatedContractId] = useState<string | null>(null);

  const [busyAlertId, setBusyAlertId] = useState<string | null>(null);
  const [alertError, setAlertError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [c, alerts, p] = await Promise.all([
        listContracts(businessId),
        legalCommercialTransport.listDueContractAlerts(businessId),
        listParties(businessId),
      ]);
      setContracts(c);
      setDueAlerts(alerts);
      setParties(p);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load contracts.");
    }
  }, [businessId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  function partyName(id: string): string {
    return parties.find((p) => p.id === id)?.displayName ?? `Party #${id.slice(0, 8)}`;
  }

  function contractLabel(contractId: string): string {
    const c = contracts?.find((x) => x.id === contractId);
    return c ? `${c.contractType} — ${partyName(c.counterpartyId)}` : `Contract #${contractId.slice(0, 8)}`;
  }

  async function handleCreate(): Promise<void> {
    if (!counterpartyId) return;
    setCreateBusy(true);
    setCreateError(null);
    setDocumentAttachError(null);
    setLastCreatedContractId(null);
    try {
      let documentId: string | null = null;
      if (documentStorageRef.trim()) {
        try {
          const doc = await paymentVouchersReportsTransport.createDocument({
            businessId,
            storageRef: documentStorageRef.trim(),
          });
          documentId = doc.id;
        } catch (err) {
          // See this file's own header (DOCUMENT ATTACHMENT NOTE) — a real
          // capability mismatch, not silently swallowed; the Contract is
          // still created below without the attachment.
          setDocumentAttachError(err instanceof Error ? err.message : "Could not attach the document.");
        }
      }
      const created = await legalCommercialTransport.createContract({
        businessId,
        counterpartyId,
        contractType,
        startDate: startDate.trim() || null,
        endDate: endDate.trim() || null,
        autoRenew,
        renewalNoticeDays: renewalNoticeDays.trim() ? Number(renewalNoticeDays) : null,
        documentId,
        creditLimitOverride: creditLimitOverride.trim() ? Number(creditLimitOverride) : null,
      });
      setLastCreatedContractId(created.id);
      setCounterpartyId("");
      setContractType("distributor_agreement");
      setStartDate("");
      setEndDate("");
      setAutoRenew(false);
      setRenewalNoticeDays("");
      setCreditLimitOverride("");
      setDocumentStorageRef("");
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create this Contract.");
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleAcknowledge(alertId: string): Promise<void> {
    setBusyAlertId(alertId);
    setAlertError(null);
    try {
      await legalCommercialTransport.acknowledgeContractAlert(alertId);
      await load();
    } catch (err) {
      setAlertError(err instanceof Error ? err.message : "Could not acknowledge this alert.");
    } finally {
      setBusyAlertId(null);
    }
  }

  if (loadError) {
    return (
      <div className="aifa-page">
        <h1>Contracts &amp; Alerts</h1>
        <p className="error">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="aifa-page">
      <h1>Contracts &amp; Alerts</h1>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>Due Alerts</strong>
        </div>
        <p className="muted" style={{ margin: "4px 0" }}>
          Shows only alerts whose lead time (end date minus renewal-notice days) has been reached today — not
          every Contract nearing its own end date.
        </p>
        {alertError && <p className="error">{alertError}</p>}
        {dueAlerts === null ? (
          <p className="muted">Loading…</p>
        ) : dueAlerts.length === 0 ? (
          <p className="muted">No alerts due.</p>
        ) : (
          dueAlerts.map((a) => (
            <div key={a.id} className="row" style={{ justifyContent: "space-between", padding: "6px 0", borderTop: "1px solid #333" }}>
              <span>
                {a.alertType} — {contractLabel(a.contractId)} (trigger {a.triggerDate}) — {a.status}
                {a.notifiedAt && <span className="muted"> · notified {a.notifiedAt.slice(0, 10)}</span>}
              </span>
              {a.status === "pending" && (
                <button onClick={() => void handleAcknowledge(a.id)} disabled={busyAlertId === a.id}>
                  {busyAlertId === a.id ? "Acknowledging…" : "Acknowledge"}
                </button>
              )}
            </div>
          ))
        )}
      </div>

      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <strong>Contracts</strong>
        <button onClick={() => setShowCreate((v) => !v)}>{showCreate ? "Cancel" : "New Contract"}</button>
      </div>

      {showCreate && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <select value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)} style={{ padding: 6 }}>
              <option value="">Select counterparty…</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
            <select value={contractType} onChange={(e) => setContractType(e.target.value as ContractType)} style={{ padding: 6 }}>
              {CONTRACT_TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input type="date" placeholder="Start date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ padding: 6 }} />
            <input type="date" placeholder="End date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ padding: 6 }} />
            <label className="row" style={{ gap: 4 }}>
              <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} />
              Auto-renew
            </label>
            <input
              placeholder="Renewal notice days"
              value={renewalNoticeDays}
              onChange={(e) => setRenewalNoticeDays(e.target.value)}
              style={{ padding: 6, width: 160 }}
            />
            <input
              placeholder="Credit limit override (RM, optional)"
              value={creditLimitOverride}
              onChange={(e) => setCreditLimitOverride(e.target.value)}
              style={{ padding: 6, width: 220 }}
            />
            <input
              placeholder="Document storage ref (optional — see this page's own header)"
              value={documentStorageRef}
              onChange={(e) => setDocumentStorageRef(e.target.value)}
              style={{ padding: 6, width: 320 }}
            />
            <button onClick={() => void handleCreate()} disabled={createBusy || !counterpartyId}>
              {createBusy ? "Creating…" : "Create Contract"}
            </button>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            {accessModel === "solo"
              ? "You're the sole approver — a Contract you create is approved automatically (solo_self_resolved) and moves straight to 'pending_signature', no separate review step."
              : "A new Contract routes through the Approvals inbox before it moves from 'draft' to 'pending_signature'."}{" "}
            {accessModel !== "solo" && onGoToApprovals && (
              <button onClick={onGoToApprovals} style={{ padding: "0 4px" }}>
                Go to Approvals
              </button>
            )}
          </p>
          {documentAttachError && (
            <p className="error" style={{ marginTop: 4 }}>
              Document not attached: {documentAttachError} — the Contract itself was still created without it.
            </p>
          )}
          {lastCreatedContractId && !createError && (
            <p className="muted" style={{ marginTop: 4 }}>
              Contract created (#{lastCreatedContractId.slice(0, 8)}). If it is later rejected in Approvals, its
              draft row is deleted rather than marked "rejected" — it will simply stop appearing below.
            </p>
          )}
          {createError && <p className="error">{createError}</p>}
        </div>
      )}

      {contracts === null ? (
        <p className="muted">Loading…</p>
      ) : contracts.length === 0 ? (
        <p className="muted">No contracts yet.</p>
      ) : (
        contracts.map((c) => (
          <div key={c.id} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>
                {c.contractType} — {partyName(c.counterpartyId)}
              </strong>
              <span className="muted">{c.status}</span>
            </div>
            <p className="muted" style={{ margin: "4px 0" }}>
              {c.startDate ?? "no start date"} → {c.endDate ?? "no end date"}
              {c.autoRenew && " · auto-renew"}
              {c.renewalNoticeDays != null && ` · ${c.renewalNoticeDays}d notice`}
              {c.creditLimitOverride != null && ` · credit limit override RM${c.creditLimitOverride.toFixed(2)}`}
            </p>
          </div>
        ))
      )}
    </div>
  );
}
