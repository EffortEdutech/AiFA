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
 *
 * UI polish Phase 4: presentation only — shared header, tables, labelled
 * fields. All notes and disclosures below are kept.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabaseLegalCommercialTransport } from "@aifa/core/sync/legalCommercialTransport";
import type { Contract, ContractAlert, ContractType } from "@aifa/core/sync/legalCommercialTransport";
import { createSupabasePaymentVouchersReportsTransport } from "@aifa/core/sync/paymentVouchersReportsTransport";
import type { Party } from "@aifa/core/sync/partyAndLedgerTransport";

import { supabase } from "../../lib/supabaseClient";
import { listParties } from "../../lib/partiesAndAccounts";
import { listContracts } from "../../lib/legalCommercial";
import { Button, Card, DataTable, Field, PageHeader, StatusPill, formatMoney, type Column } from "../../ui";
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

  const alertColumns: Column<ContractAlert>[] = [
    { key: "type", header: "Alert", render: (a) => a.alertType },
    { key: "contract", header: "Contract", render: (a) => contractLabel(a.contractId) },
    { key: "trigger", header: "Trigger date", render: (a) => a.triggerDate },
    {
      key: "status",
      header: "Status",
      render: (a) => (
        <>
          <StatusPill status={a.status} />
          {a.notifiedAt && <div className="ui-cell-sub">notified {a.notifiedAt.slice(0, 10)}</div>}
        </>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (a) =>
        a.status === "pending" ? (
          <Button size="sm" variant="secondary" loading={busyAlertId === a.id} onClick={() => void handleAcknowledge(a.id)}>
            {busyAlertId === a.id ? "Acknowledging…" : "Acknowledge"}
          </Button>
        ) : null,
    },
  ];

  const contractColumns: Column<Contract>[] = [
    {
      key: "contract",
      header: "Contract",
      render: (c) => (
        <>
          <strong>
            {c.contractType} — {partyName(c.counterpartyId)}
          </strong>
          <div className="ui-cell-sub">
            {c.startDate ?? "no start date"} → {c.endDate ?? "no end date"}
            {c.autoRenew && " · auto-renew"}
            {c.renewalNoticeDays != null && ` · ${c.renewalNoticeDays}d notice`}
          </div>
        </>
      ),
    },
    {
      key: "override",
      header: "Credit limit override",
      numeric: true,
      render: (c) => (c.creditLimitOverride != null ? formatMoney(c.creditLimitOverride) : "—"),
    },
    { key: "status", header: "Status", render: (c) => <StatusPill status={c.status} /> },
  ];

  return (
    <div className="aifa-page">
      <PageHeader
        title="Contracts & Alerts"
        actions={
          <Button variant="primary" icon={showCreate ? undefined : "plus"} onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? "Cancel" : "New Contract"}
          </Button>
        }
      />

      {loadError && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {loadError}
        </p>
      )}

      {showCreate && (
        <Card title="New Contract">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!createBusy && counterpartyId) void handleCreate();
            }}
          >
            <div className="ui-form-grid">
              <Field label="Counterparty" required>
                {(p) => (
                  <select {...p} className="ui-select" value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)}>
                    <option value="">Select counterparty…</option>
                    {parties.map((pt) => (
                      <option key={pt.id} value={pt.id}>
                        {pt.displayName}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Contract type">
                {(p) => (
                  <select {...p} className="ui-select" value={contractType} onChange={(e) => setContractType(e.target.value as ContractType)}>
                    {CONTRACT_TYPE_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Start date">
                {(p) => <input {...p} className="ui-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />}
              </Field>
              <Field label="End date">
                {(p) => <input {...p} className="ui-input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />}
              </Field>
              <Field label="Renewal notice days">
                {(p) => <input {...p} className="ui-input" value={renewalNoticeDays} onChange={(e) => setRenewalNoticeDays(e.target.value)} />}
              </Field>
              <Field label="Credit limit override (RM, optional)">
                {(p) => <input {...p} className="ui-input" value={creditLimitOverride} onChange={(e) => setCreditLimitOverride(e.target.value)} />}
              </Field>
              <Field label="Document storage ref (optional)" hint="See this page's own header for the capability caveat.">
                {(p) => <input {...p} className="ui-input" value={documentStorageRef} onChange={(e) => setDocumentStorageRef(e.target.value)} />}
              </Field>
            </div>
            <label className="ui-check" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} />
              Auto-renew
            </label>
            <div className="ui-form-actions">
              <Button type="submit" variant="primary" loading={createBusy} disabled={!counterpartyId}>
                {createBusy ? "Creating…" : "Create Contract"}
              </Button>
            </div>
            <p className="ui-muted">
              {accessModel === "solo"
                ? "You're the sole approver — a Contract you create is approved automatically (solo_self_resolved) and moves straight to 'pending_signature', no separate review step."
                : "A new Contract routes through the Approvals inbox before it moves from 'draft' to 'pending_signature'."}{" "}
              {accessModel !== "solo" && onGoToApprovals && (
                <button type="button" className="aifa-link-btn" onClick={onGoToApprovals}>
                  Go to Approvals
                </button>
              )}
            </p>
            {documentAttachError && (
              <p className="aifa-alert aifa-alert--warning" role="alert">
                Document not attached: {documentAttachError} — the Contract itself was still created without it.
              </p>
            )}
            {lastCreatedContractId && !createError && (
              <p className="aifa-alert aifa-alert--info" role="status">
                Contract created (#{lastCreatedContractId.slice(0, 8)}). If it is later rejected in Approvals, its
                draft row is deleted rather than marked "rejected" — it will simply stop appearing below.
              </p>
            )}
            {createError && (
              <p className="aifa-alert aifa-alert--danger" role="alert">
                {createError}
              </p>
            )}
          </form>
        </Card>
      )}

      {alertError && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {alertError}
        </p>
      )}

      <Card
        title="Due Alerts"
        description="Shows only alerts whose lead time (end date minus renewal-notice days) has been reached today — not every Contract nearing its own end date."
        flush
      >
        <DataTable
          caption="Due contract alerts"
          columns={alertColumns}
          rows={loadError ? [] : dueAlerts}
          rowKey={(a) => a.id}
          empty={<div className="ui-table-state">No alerts due.</div>}
        />
      </Card>

      <Card title="Contracts" flush>
        <DataTable
          caption="Contracts"
          columns={contractColumns}
          rows={loadError ? [] : contracts}
          rowKey={(c) => c.id}
          empty={<div className="ui-table-state">No contracts yet.</div>}
        />
      </Card>
    </div>
  );
}
