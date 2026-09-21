/**
 * Shared "detected domain → resolve fields → Confirm & Save" block —
 * Sprint 54 extraction so both the in-app Quick Capture screen and the
 * new Forward-to-AiFA screen render (and therefore test) the identical
 * resolve/submit UI against `useCaptureRouterCore`, instead of two
 * near-identical copies of this JSX drifting apart over time.
 */
import type { ChannelIntake } from "@aifa/core/ai/channelIntake";

import { DOMAIN_LABELS, PAYMENT_METHODS, type RoutableDomain, type useCaptureRouterCore } from "./useCaptureRouterCore";

type CaptureRouterCore = ReturnType<typeof useCaptureRouterCore>;

interface Props {
  core: CaptureRouterCore;
  buildIntake: () => ChannelIntake;
}

/**
 * Sprint 61 — the pending "chained intakes" list (a PO's stock receipt
 * now due, a payment now due, an invoice awaiting payment, etc.). A
 * separate, always-rendered block above the resolve form itself, since
 * a chained intake isn't tied to whatever capture is currently being
 * typed — mirrors the Triage list's own separateness from this form.
 */
function ChainedIntakesList({ core }: { core: CaptureRouterCore }): JSX.Element | null {
  if (core.chainedIntakes.length === 0) return null;
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <p className="muted" style={{ marginTop: 0 }}>
        Next steps from earlier approvals — these were created automatically, nothing here posts anything on its
        own.
      </p>
      {core.chainedIntakes.map((intake) => (
        <div key={intake.id} className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
          <span>{intake.summary ?? `${intake.domain} (${intake.subjectType})`}</span>
          <button onClick={() => core.handleDismissChainedIntake(intake.id)}>Dismiss</button>
        </div>
      ))}
    </div>
  );
}

export function CaptureResolveForm({ core, buildIntake }: Props): JSX.Element | null {
  if (!(core.rawText.trim() && core.detectedDomain)) {
    return <ChainedIntakesList core={core} />;
  }

  return (
    <>
      <ChainedIntakesList core={core} />
      <div className="card" style={{ marginTop: 12 }}>
      <div className="row">
        <label>
          Detected as:{" "}
          <select
            value={core.effectiveDomain ?? "unclassified"}
            onChange={(e) => core.setOverrideDomain(e.target.value as RoutableDomain)}
            style={{ padding: 6 }}
          >
            {(Object.keys(DOMAIN_LABELS) as RoutableDomain[]).map((d) => (
              <option key={d} value={d}>
                {DOMAIN_LABELS[d]}
                {d === core.detectedDomain ? " (auto-detected)" : ""}
              </option>
            ))}
          </select>
        </label>
        <span className="muted"> — not right? Pick a different type above.</span>
      </div>

      {/* Sprint 61 — only shown once a channel-domain pair has actually
          earned reduced-friction handling; this NEVER means the capture
          skips Confirm & Save or the underlying approval gate — it only
          means the owner isn't being asked to double-check a
          classification this same channel+domain pair has gotten right
          repeatedly before. Never shown for the five permanent-approval
          domains — confidenceTier can't be "trusted_skip_confirm" for
          those (enforced server-side, see the Sprint 61 migration). */}
      {core.confidenceTier === "trusted_skip_confirm" && (
        <p className="muted" style={{ marginTop: 4, fontSize: "0.85em" }}>
          Trusted — {core.trustStatus?.confirmationCount ?? 0}/{core.trustStatus?.autoRecordThreshold ?? 3} correct
          confirmations for this channel + domain. Still your call to Confirm & Save below.
        </p>
      )}

      {/* Sprint 57 — only shown when a real AI call produced this result; the
          regex fallback (detectionSource === "heuristic_fallback", true for
          every capture today, since no shipped provider implements
          classifyDomain yet) makes no calibrated confidence claim, so
          nothing is shown rather than displaying a fabricated number. */}
      {core.detectionSource === "ai" && core.detectionConfidence != null && (
        <p className="muted" style={{ marginTop: 4, fontSize: "0.85em" }}>
          AI confidence: {Math.round(core.detectionConfidence * 100)}%
        </p>
      )}

      {core.effectiveDomain === "expense" && (
        <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
          <select value={core.payeePartyId} onChange={(e) => core.setPayeePartyId(e.target.value)} style={{ padding: 6, minWidth: 180 }}>
            <option value="">Payee…</option>
            {core.parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
          <select value={core.expenseCategory} onChange={(e) => core.setExpenseCategory(e.target.value)} style={{ padding: 6, minWidth: 180 }}>
            <option value="">Category…</option>
            {core.expenseAccounts.map((a) => (
              <option key={a.id} value={a.accountName}>
                {a.accountName}
              </option>
            ))}
          </select>
          <select value={core.paymentMethod} onChange={(e) => core.setPaymentMethod(e.target.value as (typeof PAYMENT_METHODS)[number])} style={{ padding: 6 }}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={core.amount}
            onChange={(e) => core.setAmount(e.target.value)}
            placeholder="Amount"
            style={{ padding: 6, width: 120 }}
          />
        </div>
      )}

      {core.effectiveDomain === "leave_application" && (
        <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
          <select value={core.employeePartyId} onChange={(e) => core.setEmployeePartyId(e.target.value)} style={{ padding: 6, minWidth: 180 }}>
            <option value="">Employee…</option>
            {core.employees.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
          <select value={core.leaveTypeId} onChange={(e) => core.setLeaveTypeId(e.target.value)} style={{ padding: 6, minWidth: 160 }}>
            <option value="">Leave type…</option>
            {core.leaveTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <input type="date" value={core.startDate} onChange={(e) => core.setStartDate(e.target.value)} style={{ padding: 6 }} />
          <input type="date" value={core.endDate} onChange={(e) => core.setEndDate(e.target.value)} style={{ padding: 6 }} />
        </div>
      )}

      {core.effectiveDomain === "sale" && (
        <div style={{ marginTop: 8 }}>
          <p className="muted">
            Looks like money coming IN for a sale that already happened — once you approve this, it goes straight
            to a real Invoice (not a Quotation waiting to be sent), since the sale is already done. Nothing is
            issued until you approve it.
          </p>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <input
              type="text"
              value={core.counterpartyName}
              onChange={(e) => core.setCounterpartyName(e.target.value)}
              placeholder="Customer name…"
              style={{ padding: 6, minWidth: 180 }}
            />
            <input
              type="number"
              value={core.amount}
              onChange={(e) => core.setAmount(e.target.value)}
              placeholder="Amount"
              style={{ padding: 6, width: 120 }}
            />
          </div>
        </div>
      )}

      {core.effectiveDomain === "purchase_order" && (
        <div style={{ marginTop: 8 }}>
          <p className="muted">
            Looks like a Purchase Order — this drafts a PO for you to review, never approved automatically.
          </p>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <input
              type="text"
              value={core.counterpartyName}
              onChange={(e) => core.setCounterpartyName(e.target.value)}
              placeholder="Supplier name…"
              style={{ padding: 6, minWidth: 180 }}
            />
            <input
              type="number"
              value={core.amount}
              onChange={(e) => core.setAmount(e.target.value)}
              placeholder="Amount"
              style={{ padding: 6, width: 120 }}
            />
          </div>
        </div>
      )}

      {core.effectiveDomain === "commission" && (
        <div style={{ marginTop: 8 }}>
          <p className="muted">
            Drafts a manual/ad hoc commission (a flat stated amount, not derived from an invoice or rule) — never
            approved automatically.
          </p>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <select value={core.agentPartyId} onChange={(e) => core.setAgentPartyId(e.target.value)} style={{ padding: 6, minWidth: 180 }}>
              <option value="">Agent…</option>
              {core.agents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={core.amount}
              onChange={(e) => core.setAmount(e.target.value)}
              placeholder="Amount"
              style={{ padding: 6, width: 120 }}
            />
          </div>
        </div>
      )}

      {core.effectiveDomain === "attendance_correction" && (
        <div style={{ marginTop: 8 }}>
          <p className="muted">
            Fixes a missed or incorrect clock-in/out — always requires approval before it becomes a real attendance
            record.
          </p>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <select value={core.employeePartyId} onChange={(e) => core.setEmployeePartyId(e.target.value)} style={{ padding: 6, minWidth: 180 }}>
              <option value="">Employee…</option>
              {core.employees.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
            <select
              value={core.correctionClockType}
              onChange={(e) => core.setCorrectionClockType(e.target.value as "in" | "out")}
              style={{ padding: 6 }}
            >
              <option value="in">Clock in</option>
              <option value="out">Clock out</option>
            </select>
            <input
              type="datetime-local"
              value={core.correctedAt}
              onChange={(e) => core.setCorrectedAt(e.target.value)}
              style={{ padding: 6 }}
            />
          </div>
        </div>
      )}

      {core.effectiveDomain === "delivery_order" && (
        <div style={{ marginTop: 8 }}>
          <p className="muted">
            Requires a real invoice that doesn't already have a Delivery Order — if the number below doesn't match
            one, save this to Unclassified Triage instead.
          </p>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <input
              type="text"
              list="capture-router-invoices-awaiting-delivery"
              value={core.invoiceNoInput}
              onChange={(e) => core.setInvoiceNoInput(e.target.value)}
              placeholder="Invoice no…"
              style={{ padding: 6, minWidth: 140 }}
            />
            <datalist id="capture-router-invoices-awaiting-delivery">
              {core.invoicesAwaitingDelivery.map((inv) => (
                <option key={inv.id} value={inv.invoiceNo} />
              ))}
            </datalist>
            <select value={core.warehouseId} onChange={(e) => core.setWarehouseId(e.target.value)} style={{ padding: 6, minWidth: 160 }}>
              <option value="">Warehouse…</option>
              {core.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <select value={core.productId} onChange={(e) => core.setProductId(e.target.value)} style={{ padding: 6, minWidth: 160 }}>
              <option value="">Product…</option>
              {core.stockTrackedProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={core.deliveryQuantity}
              onChange={(e) => core.setDeliveryQuantity(e.target.value)}
              placeholder="Quantity"
              style={{ padding: 6, width: 100 }}
            />
          </div>
        </div>
      )}

      {core.effectiveDomain === "stock_adjustment" && (
        <div style={{ marginTop: 8 }}>
          <p className="muted">
            Increase or decrease on-hand quantity for one product — always requires approval before it posts a
            stock movement.
          </p>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <select value={core.warehouseId} onChange={(e) => core.setWarehouseId(e.target.value)} style={{ padding: 6, minWidth: 160 }}>
              <option value="">Warehouse…</option>
              {core.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <select value={core.productId} onChange={(e) => core.setProductId(e.target.value)} style={{ padding: 6, minWidth: 160 }}>
              <option value="">Product…</option>
              {core.stockTrackedProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={core.stockAdjustmentDelta}
              onChange={(e) => core.setStockAdjustmentDelta(e.target.value)}
              placeholder="Quantity change (± )"
              style={{ padding: 6, width: 160 }}
            />
          </div>
        </div>
      )}

      {core.effectiveDomain === "e_invoice_flag" && (
        <div style={{ marginTop: 8 }}>
          <p className="muted">
            Requires a real invoice that doesn't already have an active e-Invoice submission — if the number below
            doesn't match one, save this to Unclassified Triage instead. Creates a draft only; nothing reaches LHDN
            until you click Submit on the e-Invoice & SST page.
          </p>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <input
              type="text"
              list="capture-router-invoices-eligible-for-einvoice"
              value={core.invoiceNoInput}
              onChange={(e) => core.setInvoiceNoInput(e.target.value)}
              placeholder="Invoice no…"
              style={{ padding: 6, minWidth: 140 }}
            />
            <datalist id="capture-router-invoices-eligible-for-einvoice">
              {core.eInvoiceEligibleInvoices.map((inv) => (
                <option key={inv.id} value={inv.invoiceNo} />
              ))}
            </datalist>
          </div>
        </div>
      )}

      {core.effectiveDomain === "contract_alert" && (
        <div style={{ marginTop: 8 }}>
          <p className="muted">
            Drafts a new Contract — never approved automatically. A renewal/expiry alert is generated automatically
            once an end date and notice period are both set.
          </p>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <input
              type="text"
              value={core.counterpartyName}
              onChange={(e) => core.setCounterpartyName(e.target.value)}
              placeholder="Counterparty name…"
              style={{ padding: 6, minWidth: 180 }}
            />
            <select
              value={core.contractType}
              onChange={(e) => core.setContractType(e.target.value as typeof core.contractType)}
              style={{ padding: 6 }}
            >
              <option value="distributor_agreement">Distributor agreement</option>
              <option value="nda">NDA</option>
              <option value="employment_contract">Employment contract</option>
              <option value="other">Other</option>
            </select>
            <input type="date" value={core.startDate} onChange={(e) => core.setStartDate(e.target.value)} style={{ padding: 6 }} />
            <input type="date" value={core.endDate} onChange={(e) => core.setEndDate(e.target.value)} style={{ padding: 6 }} />
            <input
              type="number"
              value={core.renewalNoticeDays}
              onChange={(e) => core.setRenewalNoticeDays(e.target.value)}
              placeholder="Renewal notice (days)"
              style={{ padding: 6, width: 160 }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input type="checkbox" checked={core.autoRenew} onChange={(e) => core.setAutoRenew(e.target.checked)} />
              Auto-renews
            </label>
          </div>
        </div>
      )}

      {core.effectiveDomain === "e_signature_request" && (
        <div style={{ marginTop: 8 }}>
          <p className="muted">
            Drafts a request to sign an existing Contract that's ready for signature — nothing is sent to a signer
            until this is approved.
          </p>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <select
              value={core.signatureContractId}
              onChange={(e) => core.setSignatureContractId(e.target.value)}
              style={{ padding: 6, minWidth: 220 }}
            >
              <option value="">Contract ready for signature…</option>
              {core.contractsPendingSignature.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.contractType} — {c.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {core.effectiveDomain === "unclassified" && (
        <p className="muted" style={{ marginTop: 8 }}>
          This will be saved to your Unclassified Triage list below for you to handle manually — nothing is guessed
          or dropped.
        </p>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <button onClick={() => core.handleSubmit(buildIntake())} disabled={core.busy}>
          {core.busy ? "Saving…" : "Confirm & Save"}
        </button>
      </div>
      </div>
    </>
  );
}
