/**
 * Shared Capture Router core — Sprint 54 (Phase 5, Vol_5_5 §6).
 *
 * Extracted from Sprint 53's `CaptureRouterPage.tsx` verbatim
 * (behaviour-preserving refactor — see Sprint 54's own Risks table)
 * so that BOTH the in-app "Quick Capture (AI)" screen and the new
 * "Forward to AiFA" screen call the exact same `handleDetect`/
 * `handleSubmit` functions against a `ChannelIntake`, rather than each
 * page re-implementing its own near-identical classify+dispatch logic.
 * This is what makes ChannelIntake a real shared abstraction instead
 * of two independent almost-identical structs (Sprint 54 DoD).
 *
 * Still PATH B, NOT PATH A — see `channelIntake.ts`'s header.
 *
 * Sprint 58 (14 September 2026) update: `sale` and `purchase_order` are
 * no longer triage-only labels — see this file's `RoutableDomain` and
 * `handleSubmit`'s new branches for the real draft-and-approve wiring
 * (`create_quotation`/`create_purchase_order` via `find_or_create_party`).
 *
 * Sprint 59 (15 September 2026) update: `commission`, `attendance_correction`,
 * `delivery_order`, and `stock_adjustment` are now real posting domains
 * too — see `RoutableDomain`'s own updated header comment below for each
 * one's specifics. `purchase` (single-transaction) is still not detected
 * by inputRouter.ts and so never appears here; Sprint 60 covers the
 * remaining Accounting/Compliance/Legal domains.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabasePaymentVouchersReportsTransport } from "@aifa/core/sync/paymentVouchersReportsTransport";
import type { PaymentVoucherPaymentMethod } from "@aifa/core/sync/paymentVouchersReportsTransport";
import { createSupabaseAttendanceLeaveCommissionTransport } from "@aifa/core/sync/attendanceLeaveCommissionTransport";
import { createSupabaseCaptureTriageTransport } from "@aifa/core/sync/captureTriageTransport";
import type { CaptureTriageItem } from "@aifa/core/sync/captureTriageTransport";
import { createSupabasePartyAndLedgerTransport } from "@aifa/core/sync/partyAndLedgerTransport";
import type { Party } from "@aifa/core/sync/partyAndLedgerTransport";
import type { LeaveType } from "@aifa/core/sync/attendanceLeaveCommissionTransport";
import { createSupabaseQuotationInvoiceTransport } from "@aifa/core/sync/quotationInvoiceTransport";
import { createSupabasePurchaseOrderTransport } from "@aifa/core/sync/purchaseOrderTransport";
import { createSupabaseInventoryDeliveryTransport } from "@aifa/core/sync/inventoryDeliveryTransport";
import { createSupabaseEInvoiceSstTransport } from "@aifa/core/sync/eInvoiceSstTransport";
import { createSupabaseLegalCommercialTransport } from "@aifa/core/sync/legalCommercialTransport";
import type { Contract, ContractType } from "@aifa/core/sync/legalCommercialTransport";
import { classifyPathBIntake, decideConfidenceTier, extractQuantityUnitPriceTotal } from "@aifa/core/ai/inputRouter";
import type { ConfidenceTier } from "@aifa/core/ai/inputRouter";
import type { BusinessDomain } from "@aifa/core/ai/types";
import type { ChannelIntake } from "@aifa/core/ai/channelIntake";
import { createSupabaseRoutingAndChainingTransport } from "@aifa/core/sync/routingAndChainingTransport";
import type { ChainedIntake, ChannelDomainTrustStatus } from "@aifa/core/sync/routingAndChainingTransport";
import {
  extractMediaViaPathB,
  transcribeVoiceForPathB,
  type MediaExtractionStatus,
} from "@aifa/core/ai/pathBMediaExtraction";

import { supabase } from "../../lib/supabaseClient";
import { getDefaultWebProvider } from "../../lib/aiProvider";
import { listParties, listChartOfAccounts } from "../../lib/partiesAndAccounts";
import { listLeaveTypes } from "../../lib/attendanceLeaveCommission";
import { listCaptureTriage } from "../../lib/captureTriage";
import { listWarehouses, listStockTrackedProducts, type StockTrackedProduct } from "../../lib/inventoryAndDelivery";
import type { Warehouse } from "@aifa/core/sync/inventoryDeliveryTransport";
import { listInvoices } from "../../lib/salesCycle";
import type { Invoice } from "@aifa/core/sync/quotationInvoiceTransport";
import { listEInvoiceSubmissions } from "../../lib/einvoiceSst";
import { listContracts } from "../../lib/legalCommercial";

const paymentVouchersReportsTransport = createSupabasePaymentVouchersReportsTransport(supabase);
const attendanceLeaveCommissionTransport = createSupabaseAttendanceLeaveCommissionTransport(supabase);
const captureTriageTransport = createSupabaseCaptureTriageTransport(supabase);
const partyAndLedgerTransport = createSupabasePartyAndLedgerTransport(supabase);
const quotationInvoiceTransport = createSupabaseQuotationInvoiceTransport(supabase);
const purchaseOrderTransport = createSupabasePurchaseOrderTransport(supabase);
const inventoryDeliveryTransport = createSupabaseInventoryDeliveryTransport(supabase);
const eInvoiceSstTransport = createSupabaseEInvoiceSstTransport(supabase);
const legalCommercialTransport = createSupabaseLegalCommercialTransport(supabase);
const routingAndChainingTransport = createSupabaseRoutingAndChainingTransport(supabase);

export const PAYMENT_METHODS: PaymentVoucherPaymentMethod[] = ["cash", "bank_transfer", "cheque"];

/**
 * The domains this router can label — a subset of BusinessDomain.
 *
 * Sprint 58 (14 September 2026) update: `sale` and `purchase_order` are
 * now real posting domains, not triage-only labels — a detected sale
 * drafts a real Quotation (via the existing `create_quotation`, unchanged
 * since Sprint 28) and a detected `purchase_order` drafts a real Purchase
 * Order (via the new `create_purchase_order`, Sprint 58) through
 * `find_or_create_party` to resolve the AI-extracted counterparty name.
 * Both always require a human Confirm & Save and always land as
 * `drafted`/pending-approval — never auto-issued to a customer or
 * auto-approved — matching every other domain's "never post silently"
 * rule. `purchase` (a single-transaction purchase, distinct from a
 * multi-line PO) is not detected by inputRouter.ts yet and so never
 * appears here.
 *
 * Sprint 59 (15 September 2026) update: `commission`, `attendance_correction`
 * and `stock_adjustment` are now real posting domains too — each always
 * drafts a `status: 'drafted'` row and opens its own ApprovalTask, never
 * auto-approved (both are permanently on Sprint 61's five-domain
 * no-auto-approve list). `delivery_order` is also now routable, but ONLY
 * when the capture resolves to a real, existing invoice that doesn't
 * already have a Delivery Order — create_delivery_order has always
 * required one (see the Sprint 59 migration's header note 3); an
 * unresolvable reference falls through to Unclassified Triage same as
 * any other domain today.
 *
 * Sprint 60 (16 September 2026) update: `e_invoice_flag`, `contract_alert`,
 * and `e_signature_request` are the last three Bridge domains. Checked
 * against the real, already-shipped `eInvoiceSstTransport.ts` /
 * `legalCommercialTransport.ts` schema, two of the three sprint-doc
 * premises didn't hold (see the Sprint 60 migration's own header notes
 * for the full disclosure/resolution):
 *   - `e_invoice_flag` has NO new schema — like `delivery_order`, it
 *     requires the capture to resolve to a real, existing invoice (one
 *     with no active e-Invoice submission yet) and calls the existing
 *     `createSubmission` RPC directly, which already inserts a 'draft'
 *     row; an unresolvable reference falls to Unclassified Triage.
 *   - `contract_alert` also has NO new schema — a ContractAlert has no
 *     standalone draft path of its own (it's only ever generated as a
 *     side effect of creating a whole Contract), so this domain drafts
 *     a new Contract via the existing `createContract` RPC, which
 *     already opens its own ApprovalTask.
 *   - `e_signature_request` is the one domain that genuinely needed new
 *     schema: `e_signature_envelopes` has no draft/undispatched status
 *     at all, so a new `e_signature_requests` draft table gates the
 *     real envelope creation behind approval (Sprint 60 migration).
 */
export type RoutableDomain =
  | "expense"
  | "leave_application"
  | "sale"
  | "purchase_order"
  | "commission"
  | "attendance_correction"
  | "delivery_order"
  | "stock_adjustment"
  | "e_invoice_flag"
  | "contract_alert"
  | "e_signature_request"
  | "unclassified";

/** Sprint 55 — voice transcription's own honest three-state outcome, distinct from mediaStatus. */
export type VoiceStatus = "idle" | "transcribing" | "transcribed" | "not_configured" | "failed";

function toRoutableDomain(domain: BusinessDomain): RoutableDomain {
  return domain === "expense" ||
    domain === "leave_application" ||
    domain === "sale" ||
    domain === "purchase_order" ||
    domain === "commission" ||
    domain === "attendance_correction" ||
    domain === "delivery_order" ||
    domain === "stock_adjustment" ||
    domain === "e_invoice_flag" ||
    domain === "contract_alert" ||
    domain === "e_signature_request"
    ? domain
    : "unclassified";
}

export const DOMAIN_LABELS: Record<RoutableDomain, string> = {
  expense: "Expense",
  leave_application: "Leave application",
  sale: "Sale / Income — already completed (drafts straight toward a real Invoice once you approve — never issued automatically)",
  purchase_order: "Purchase Order (drafts a PO for you to review — never approved automatically)",
  commission: "Commission — manual/ad hoc (drafts a commission for an agent to review — never approved automatically)",
  attendance_correction: "Attendance correction (fixes a missed/incorrect clock-in or clock-out — always requires approval)",
  delivery_order: "Delivery Order (requires a real invoice reference — falls to triage if it can't be resolved)",
  stock_adjustment: "Stock adjustment (increase or decrease on-hand quantity for one product — always requires approval)",
  e_invoice_flag: "e-Invoice / SST flag (requires a real invoice reference — creates a draft submission for the e-Invoice & SST page)",
  contract_alert: "Contract (drafts a new Contract — a renewal/expiry alert is generated automatically once an end date and notice period are set)",
  e_signature_request: "e-Signature request (drafts a request against a contract that's ready for signature — nothing is sent until approved)",
  unclassified: "Unclassified (couldn't tell — goes to triage)",
};

export function useCaptureRouterCore(businessId: string) {
  const [parties, setParties] = useState<Party[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<{ id: string; accountName: string }[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [triage, setTriage] = useState<CaptureTriageItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Sprint 59 — Bridge II lookups
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [stockTrackedProducts, setStockTrackedProducts] = useState<StockTrackedProduct[]>([]);
  const [invoicesAwaitingDelivery, setInvoicesAwaitingDelivery] = useState<Invoice[]>([]);
  // Sprint 60 — Bridge III lookups
  const [eInvoiceEligibleInvoices, setEInvoiceEligibleInvoices] = useState<Invoice[]>([]);
  const [contractsPendingSignature, setContractsPendingSignature] = useState<Contract[]>([]);
  // Sprint 61 — cross-domain chaining & confidence trust
  const [chainedIntakes, setChainedIntakes] = useState<ChainedIntake[]>([]);
  const [trustStatus, setTrustStatus] = useState<ChannelDomainTrustStatus | null>(null);
  const [confidenceTier, setConfidenceTier] = useState<ConfidenceTier | null>(null);

  const [rawText, setRawText] = useState("");
  const [detectedDomain, setDetectedDomain] = useState<RoutableDomain | null>(null);
  const [overrideDomain, setOverrideDomain] = useState<RoutableDomain | null>(null);
  const [lastIntakeChannel, setLastIntakeChannel] = useState<ChannelIntake["channel"] | null>(null);
  // Sprint 57 — real AI confidence when classifyPathBIntake reached a
  // provider that implements classifyDomain; null when the regex fallback
  // produced the result instead (no calibrated confidence to show).
  const [detectionConfidence, setDetectionConfidence] = useState<number | null>(null);
  const [detectionSource, setDetectionSource] = useState<"ai" | "heuristic_fallback" | null>(null);

  // Sprint 55 — Path B media/voice extraction state
  const [mediaStatus, setMediaStatus] = useState<MediaExtractionStatus | "idle" | "extracting">("idle");
  const [mediaHint, setMediaHint] = useState<string | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");

  // Resolved fields — expense
  const [payeePartyId, setPayeePartyId] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentVoucherPaymentMethod>("cash");
  const [amount, setAmount] = useState("");

  // Resolved fields — leave application
  const [employeePartyId, setEmployeePartyId] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Resolved fields — sale / purchase_order (Sprint 58). Shared: both
  // domains draft a single-line document from a bare counterparty NAME
  // (not yet a party id — resolved via findOrCreateParty at submit time)
  // plus the same `amount` state expense already uses, reused here as
  // the one line's total. Multi-line editing is out of this sprint's
  // stated one-chain scope (see Sprint 58 doc, Safe to Carry Over).
  const [counterpartyName, setCounterpartyName] = useState("");

  // Resolved fields — commission (Sprint 59, manual/ad hoc draft)
  const [agentPartyId, setAgentPartyId] = useState("");

  // Resolved fields — attendance correction (Sprint 59)
  const [correctionClockType, setCorrectionClockType] = useState<"in" | "out">("in");
  const [correctedAt, setCorrectedAt] = useState("");

  // Resolved fields — delivery order (Sprint 59). invoiceNoInput is typed/
  // confirmed by the owner and resolved client-side against
  // invoicesAwaitingDelivery — see handleSubmit's delivery_order branch and
  // this file's header note on why an unresolvable reference falls to
  // triage rather than guessing. warehouseId/productId/deliveryQuantity
  // describe the single line this capture drafts (multi-line editing is
  // out of scope here, same posture Sprint 58 took for sale/PO).
  const [invoiceNoInput, setInvoiceNoInput] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [productId, setProductId] = useState("");
  const [deliveryQuantity, setDeliveryQuantity] = useState("");

  // Resolved fields — stock adjustment (Sprint 59). Shares warehouseId/
  // productId with the delivery_order fields above (only one domain's
  // fields are ever shown/submitted at a time).
  const [stockAdjustmentDelta, setStockAdjustmentDelta] = useState("");

  // Resolved fields — contract_alert (Sprint 60, drafts a whole new
  // Contract — see this file's own RoutableDomain header note on why).
  // Reuses counterpartyName/startDate/endDate from the sale/PO and
  // leave_application fields above (only one domain's fields are ever
  // shown/submitted at a time).
  const [contractType, setContractType] = useState<ContractType>("distributor_agreement");
  const [autoRenew, setAutoRenew] = useState(false);
  const [renewalNoticeDays, setRenewalNoticeDays] = useState("");

  // Resolved fields — e_signature_request (Sprint 60). Only a Contract
  // target is offered here (status must be 'pending_signature') — a
  // Quotation-based e-signature request is still available from the
  // e-Signature page's own existing flow, out of this quick-capture
  // domain's scope (see the Sprint 60 close-out notes).
  const [signatureContractId, setSignatureContractId] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [p, accounts, types, triageItems, wh, products, invoices, eInvoiceSubmissions, contracts, chained] = await Promise.all([
        listParties(businessId),
        listChartOfAccounts(businessId),
        listLeaveTypes(businessId),
        listCaptureTriage(businessId),
        listWarehouses(businessId),
        listStockTrackedProducts(businessId),
        listInvoices(businessId),
        listEInvoiceSubmissions(businessId),
        listContracts(businessId),
        routingAndChainingTransport.listChainedIntakes(businessId),
      ]);
      setParties(p);
      setExpenseAccounts(
        accounts.filter((a) => a.accountType === "expense").map((a) => ({ id: a.id, accountName: a.accountName })),
      );
      setLeaveTypes(types);
      setTriage(triageItems);
      setWarehouses(wh);
      setStockTrackedProducts(products);
      // Sprint 59 — only an invoice with no Delivery Order yet is a valid
      // target (create_delivery_order enforces exactly one DO per invoice).
      setInvoicesAwaitingDelivery(invoices.filter((inv) => !inv.deliveryOrderId));
      // Sprint 60 — only an invoice with no active (non-rejected/cancelled)
      // e-Invoice submission is a valid target (create_einvoice_submission
      // throws 'invoice_already_has_an_active_einvoice_submission' otherwise).
      setEInvoiceEligibleInvoices(
        invoices.filter(
          (inv) =>
            !eInvoiceSubmissions.some(
              (s) => s.invoiceId === inv.id && s.status !== "rejected" && s.status !== "cancelled",
            ),
        ),
      );
      // Sprint 60 — only a Contract already in 'pending_signature' is a
      // valid e-Signature target (create_esignature_envelope enforces this).
      setContractsPendingSignature(contracts.filter((c) => c.status === "pending_signature"));
      setChainedIntakes(chained);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load Quick Capture.");
    }
  }, [businessId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const employees = parties.filter((p) => p.partyTypes.includes("employee"));
  const agents = parties.filter((p) => p.partyTypes.includes("agent"));
  const effectiveDomain: RoutableDomain | null = overrideDomain ?? detectedDomain;

  function setRawTextAndReset(text: string): void {
    setRawText(text);
    setDetectedDomain(null);
    setOverrideDomain(null);
  }

  /**
   * The one classify entry point every adapter calls. Takes a real
   * `ChannelIntake`, not a bare string — this is what makes
   * ChannelIntake a genuinely shared, consumed type rather than
   * decoration (Sprint 54 DoD).
   *
   * Sprint 57 update: now calls `classifyPathBIntake`, which tries a real
   * AI-backed domain call first and only falls back to the regex
   * heuristic when the active provider doesn't implement `classifyDomain`
   * (true today — no shipped provider implements it yet, since the
   * Gateway's own server-side route for it does not exist; see Sprint
   * 57's own sprint-plan document) or when that call fails. Either way
   * the result lands through the same `toRoutableDomain` narrowing as
   * before, so behaviour for `expense`/`leave_application`/`sale` is
   * unchanged today — this wiring is what lets a later domain-bridge
   * sprint (58-60) start receiving real AI-classified domains the moment
   * the Gateway route ships, with no further change needed here.
   */
  async function handleDetect(intake: ChannelIntake): Promise<void> {
    setError(null);
    setSuccessMessage(null);
    setLastIntakeChannel(intake.channel);
    const text = (intake.rawText ?? "").trim();
    if (!text) {
      setDetectedDomain(null);
      setDetectionConfidence(null);
      setDetectionSource(null);
      setTrustStatus(null);
      setConfidenceTier(null);
      return;
    }
    const result = await classifyPathBIntake(text, getDefaultWebProvider());
    const routable = toRoutableDomain(result.domain);
    setDetectedDomain(routable);
    setOverrideDomain(null);
    setDetectionConfidence(result.source === "ai" ? result.confidence : null);
    setDetectionSource(result.source);

    // Sprint 61 — channel-domain trust check. Unclassified captures
    // always fall to triage regardless of trust (there is nothing to
    // trust yet), so this is skipped for that case.
    if (routable === "unclassified") {
      setTrustStatus(null);
      setConfidenceTier(null);
    } else {
      try {
        const status = await routingAndChainingTransport.getChannelDomainTrustStatus({
          businessId,
          channel: intake.channel,
          domain: routable,
        });
        setTrustStatus(status);
        setConfidenceTier(
          decideConfidenceTier({ channel: intake.channel, domain: routable, trustStatus: status }),
        );
      } catch {
        // Trust lookup is an enhancement, never a blocker — a failed
        // lookup just means no reduced-friction handling this time,
        // same "never drop the input" discipline classifyPathBIntake's
        // own provider fallback already applies.
        setTrustStatus(null);
        setConfidenceTier("confirm_required");
      }
    }

    // 14 September 2026 fix (owner-reported: "Issue PO to KBCM for
    // purchase of 60 boxes of vitamins. each box price rm23" classified
    // correctly at 98% confidence but failed Confirm & Save with "Enter
    // the supplier's name and a positive amount") — neither the regex
    // heuristic nor a real classifyDomain() Gateway call can tell "60
    // boxes, each box price RM23" is a quantity × unit price needing
    // multiplication, as opposed to a flat stated total. Falls back to
    // extractQuantityUnitPriceTotal ONLY when the normal extraction came
    // back null, so a capture that already states a flat total ("PO for
    // RM1200") is never re-multiplied by an unrelated quantity elsewhere
    // in the text. Counterparty-name extraction is unaffected — it stays
    // whatever `source === "ai"` returned (or blank for the heuristic
    // fallback, unchanged since Sprint 53) and still needs manual entry
    // when AI can't extract it; this fix only ever fills the Amount field.
    const resolvedAmount = result.extractedAmount ?? extractQuantityUnitPriceTotal(text);

    if (routable === "expense") {
      setAmount(resolvedAmount != null ? String(resolvedAmount) : "");
    } else if (routable === "leave_application") {
      setStartDate(result.extractedDates?.startDate ?? "");
      setEndDate(result.extractedDates?.endDate ?? "");
    } else if (routable === "sale" || routable === "purchase_order") {
      // Sprint 58 — extractedFields only ever has real content when
      // `source === "ai"` (the regex fallback returns `{}`, see
      // inputRouter.ts); a heuristic-fallback sale/PO still gets the
      // amount (that heuristic already extracted it, unchanged since
      // Sprint 53), just no counterparty guess — the owner types it.
      const counterparty = result.extractedFields.counterparty;
      setCounterpartyName(typeof counterparty === "string" ? counterparty : "");
      setAmount(resolvedAmount != null ? String(resolvedAmount) : "");
    } else if (routable === "commission") {
      // Sprint 59 — best-effort only; extractedFields has no reliable
      // agent-name field the way sale/PO have `counterparty`, so the
      // owner picks the agent manually below. The amount, when present,
      // is still worth pre-filling the same way every other domain does.
      setAmount(resolvedAmount != null ? String(resolvedAmount) : "");
    } else if (routable === "delivery_order") {
      // Sprint 59 — best-effort invoice-number hint only; if the AI
      // provider didn't extract one, or it doesn't match a real invoice
      // without an existing Delivery Order, handleSubmit's own lookup
      // catches it and the capture falls to Unclassified Triage.
      const invoiceNoField = result.extractedFields.invoiceNo ?? result.extractedFields.invoice_no;
      setInvoiceNoInput(typeof invoiceNoField === "string" ? invoiceNoField : "");
    } else if (routable === "e_invoice_flag") {
      // Sprint 60 — same best-effort invoice-number hint as delivery_order.
      const invoiceNoField = result.extractedFields.invoiceNo ?? result.extractedFields.invoice_no;
      setInvoiceNoInput(typeof invoiceNoField === "string" ? invoiceNoField : "");
    } else if (routable === "contract_alert") {
      // Sprint 60 — best-effort counterparty/dates only; contractType,
      // autoRenew, and renewalNoticeDays have no reliable extracted field
      // yet, so the owner picks those manually below.
      const counterparty = result.extractedFields.counterparty;
      setCounterpartyName(typeof counterparty === "string" ? counterparty : "");
      setEndDate(result.extractedDates?.endDate ?? "");
    }
  }

  function resetForm(): void {
    setRawText("");
    setDetectedDomain(null);
    setOverrideDomain(null);
    setLastIntakeChannel(null);
    setDetectionConfidence(null);
    setDetectionSource(null);
    setTrustStatus(null);
    setConfidenceTier(null);
    setPayeePartyId("");
    setExpenseCategory("");
    setAmount("");
    setEmployeePartyId("");
    setLeaveTypeId("");
    setStartDate("");
    setEndDate("");
    setCounterpartyName("");
    setAgentPartyId("");
    setCorrectionClockType("in");
    setCorrectedAt("");
    setInvoiceNoInput("");
    setWarehouseId("");
    setProductId("");
    setDeliveryQuantity("");
    setStockAdjustmentDelta("");
    setContractType("distributor_agreement");
    setAutoRenew(false);
    setRenewalNoticeDays("");
    setSignatureContractId("");
    setMediaStatus("idle");
    setMediaHint(null);
    setVoiceStatus("idle");
  }

  /**
   * Sprint 55 — image/PDF path. Runs the same real vision extraction
   * Sprint 5/6 already proved (Gateway-first on web, see
   * compositeProvider.ts), pre-fills the SAME expense confirm fields text
   * detection already uses, and never auto-posts (Vol_5_5 §8 — a brand-new
   * extraction path earns trust, it isn't granted it). Payee/category are
   * still the owner's own pick this sprint — the AI's read of the
   * counterparty name is shown as a hint, not fuzzy-matched to a Party.
   */
  async function handleDetectMedia(media: { base64Data: string; mimeType: string; kind: "image" | "pdf" }): Promise<void> {
    setError(null);
    setSuccessMessage(null);
    setMediaStatus("extracting");
    setOverrideDomain(null);
    setLastIntakeChannel(null);
    const outcome = await extractMediaViaPathB(getDefaultWebProvider(), media);
    setMediaStatus(outcome.status);
    if (outcome.status === "failed" || !outcome.fields) {
      setDetectedDomain(null);
      setMediaHint(null);
      return;
    }
    setDetectedDomain("expense");
    setAmount(outcome.fields.amount != null ? String(outcome.fields.amount) : "");
    const hintParts = [outcome.fields.description, outcome.fields.counterpartyName].filter(
      (v): v is string => Boolean(v),
    );
    setMediaHint(hintParts.length > 0 ? `AI read: "${hintParts.join(" — ")}"` : null);
    setRawText(
      [outcome.fields.description, outcome.fields.counterpartyName].filter(Boolean).join(" — ") ||
        "(from forwarded image/PDF)",
    );
  }

  /**
   * Sprint 55 — voice path. A transcribed voice note is handed straight
   * into the EXISTING text classify entry point (`handleDetect`) — no new
   * classification logic exists for voice at all, by design.
   */
  async function handleDetectVoice(media: { base64Data: string; mimeType: string }, channel: ChannelIntake["channel"]): Promise<void> {
    setError(null);
    setSuccessMessage(null);
    setVoiceStatus("transcribing");
    const outcome = await transcribeVoiceForPathB(getDefaultWebProvider(), media);
    if (outcome.status === "not_configured") {
      setVoiceStatus("not_configured");
      return;
    }
    if (outcome.status === "failed") {
      setVoiceStatus("failed");
      return;
    }
    setVoiceStatus("transcribed");
    setRawText(outcome.transcript);
    handleDetect({
      channel,
      businessMembershipId: businessId,
      rawText: outcome.transcript,
      rawMedia: null,
      receivedAt: new Date().toISOString(),
    });
  }

  /**
   * The one dispatch entry point every adapter calls, against the
   * SAME Path B transports Sprint 53 already verified live
   * (`createPaymentVoucher`/`createLeaveApplication`/
   * `createCaptureTriageItem`) — no per-channel special-casing.
   */
  async function handleSubmit(intake: ChannelIntake): Promise<void> {
    if (!effectiveDomain) return;
    const text = (intake.rawText ?? "").trim();
    setBusy(true);
    setError(null);
    setSuccessMessage(null);
    try {
      if (effectiveDomain === "expense") {
        const parsedAmount = Number(amount);
        if (!payeePartyId || !expenseCategory || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
          setError("Pick a payee and category, and enter a positive amount.");
          return;
        }
        await paymentVouchersReportsTransport.createPaymentVoucher({
          businessId,
          payeePartyId,
          expenseCategory,
          paymentMethod,
          grandTotal: parsedAmount,
          notes: text,
        });
        setSuccessMessage("Recorded as a Payment Voucher — see it on the Payment Vouchers / Cash Book pages.");
      } else if (effectiveDomain === "leave_application") {
        if (!employeePartyId || !leaveTypeId || !startDate || !endDate) {
          setError("Pick the employee, leave type, and both dates.");
          return;
        }
        await attendanceLeaveCommissionTransport.createLeaveApplication({
          businessId,
          employeePartyId,
          leaveTypeId,
          startDate,
          endDate,
          aiDraftSummary: text,
        });
        setSuccessMessage("Leave application submitted — see it on the Approvals page.");
      } else if (effectiveDomain === "sale") {
        const parsedAmount = Number(amount);
        if (!counterpartyName.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
          setError("Enter the customer's name and a positive amount.");
          return;
        }
        const party = await partyAndLedgerTransport.findOrCreateParty({
          businessId,
          displayName: counterpartyName.trim(),
          partyTypes: ["customer"],
        });
        await quotationInvoiceTransport.createQuotation({
          businessId,
          partyId: party.id,
          lines: [{ description: text, quantity: 1, unitPrice: parsedAmount }],
          aiDraftSummary: text,
          // Sprint 58 Dependencies note: a sale draft always requires
          // approval — confidence-tiered auto-approval for this domain
          // is Sprint 61's job, not this wiring's to decide.
          autoApproved: false,
          // 14 September 2026 business-flow fix (owner-reported): a
          // capture like "invoiced Sunrise Trading RM800" describes a
          // sale that ALREADY happened — it must not become a pre-sale
          // proposal awaiting a WhatsApp send. alreadyCompleted: true
          // tags the approval task so that approving it issues a real
          // Invoice directly (see quotationInvoiceTransport.ts's own
          // updated header and the migration this relies on).
          alreadyCompleted: true,
        });
        setSuccessMessage(
          `Recorded — once approved on the Approvals page, this will become a real Invoice for ${party.displayName} (Sales → Invoices), not a Quotation.`,
        );
      } else if (effectiveDomain === "purchase_order") {
        const parsedAmount = Number(amount);
        if (!counterpartyName.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
          setError("Enter the supplier's name and a positive amount.");
          return;
        }
        const party = await partyAndLedgerTransport.findOrCreateParty({
          businessId,
          displayName: counterpartyName.trim(),
          partyTypes: ["supplier"],
        });
        await purchaseOrderTransport.createPurchaseOrder({
          businessId,
          partyId: party.id,
          lines: [{ description: text, quantity: 1, unitCost: parsedAmount }],
          aiDraftSummary: text,
          // Same reasoning as the sale branch above — PO always requires
          // approval this sprint, never auto-approved from a capture.
          autoApproved: false,
        });
        setSuccessMessage(
          `Draft Purchase Order created for ${party.displayName} — review it on the Approvals page.`,
        );
      } else if (effectiveDomain === "commission") {
        const parsedAmount = Number(amount);
        if (!agentPartyId || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
          setError("Pick the agent and enter a positive amount.");
          return;
        }
        await attendanceLeaveCommissionTransport.createManualCommissionDraft({
          businessId,
          agentPartyId,
          amount: parsedAmount,
          notes: text || null,
          aiDraftSummary: text,
        });
        setSuccessMessage("Commission draft submitted — see it on the Approvals page.");
      } else if (effectiveDomain === "attendance_correction") {
        if (!employeePartyId || !correctedAt) {
          setError("Pick the employee and the corrected clock time.");
          return;
        }
        await attendanceLeaveCommissionTransport.createAttendanceCorrection({
          businessId,
          employeePartyId,
          clockType: correctionClockType,
          correctedAt: new Date(correctedAt).toISOString(),
          reason: text || null,
          aiDraftSummary: text,
        });
        setSuccessMessage("Attendance correction submitted — see it on the Approvals page.");
      } else if (effectiveDomain === "delivery_order") {
        // Sprint 59 — requires a real, existing invoice with no Delivery
        // Order yet (this file's header note + the migration's own header
        // note 3). Resolved client-side against invoicesAwaitingDelivery
        // rather than a new lookup RPC — no schema change for this domain.
        const matchedInvoice = invoicesAwaitingDelivery.find(
          (inv) => inv.invoiceNo.trim().toLowerCase() === invoiceNoInput.trim().toLowerCase(),
        );
        const parsedQuantity = Number(deliveryQuantity);
        if (!matchedInvoice) {
          setError(
            "Couldn't find an invoice with that number awaiting a Delivery Order — check it, or save this to Unclassified Triage instead.",
          );
          return;
        }
        if (!warehouseId || !productId || !Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
          setError("Pick the warehouse and product, and enter a positive quantity.");
          return;
        }
        await inventoryDeliveryTransport.createDeliveryOrder({
          businessId,
          invoiceId: matchedInvoice.id,
          warehouseId,
          lines: [{ productId, quantity: parsedQuantity }],
          notes: text || null,
          aiDraftSummary: text,
          // Same reasoning as sale/PO above — always requires approval,
          // never auto-approved from a capture.
          autoApproved: false,
        });
        setSuccessMessage(
          `Draft Delivery Order created for invoice ${matchedInvoice.invoiceNo} — review it on the Approvals page.`,
        );
      } else if (effectiveDomain === "stock_adjustment") {
        const parsedDelta = Number(stockAdjustmentDelta);
        if (!warehouseId || !productId || !Number.isFinite(parsedDelta) || parsedDelta === 0) {
          setError("Pick the warehouse and product, and enter a nonzero quantity change (negative to decrease).");
          return;
        }
        await inventoryDeliveryTransport.createStockAdjustment({
          businessId,
          productId,
          warehouseId,
          quantityDelta: parsedDelta,
          reason: text || null,
          aiDraftSummary: text,
        });
        setSuccessMessage("Stock adjustment submitted — see it on the Approvals page.");
      } else if (effectiveDomain === "e_invoice_flag") {
        // Sprint 60 — requires a real, existing invoice with no active
        // e-Invoice submission yet (this file's header note + the
        // migration's own header note 1). Resolved client-side against
        // eInvoiceEligibleInvoices rather than a new lookup RPC — no
        // schema change for this domain.
        const matchedInvoice = eInvoiceEligibleInvoices.find(
          (inv) => inv.invoiceNo.trim().toLowerCase() === invoiceNoInput.trim().toLowerCase(),
        );
        if (!matchedInvoice) {
          setError(
            "Couldn't find an invoice with that number needing e-Invoice/SST handling — check it, or save this to Unclassified Triage instead.",
          );
          return;
        }
        await eInvoiceSstTransport.createSubmission({ businessId, invoiceId: matchedInvoice.id });
        setSuccessMessage(
          `Draft e-Invoice submission created for invoice ${matchedInvoice.invoiceNo} — review and Submit it on the e-Invoice & SST page (nothing reaches LHDN until then).`,
        );
      } else if (effectiveDomain === "contract_alert") {
        // Sprint 60 — drafts a whole new Contract (see this file's own
        // RoutableDomain header note); a ContractAlert is generated
        // automatically by createContract when endDate + renewalNoticeDays
        // are both given.
        if (!counterpartyName.trim()) {
          setError("Enter the counterparty's name.");
          return;
        }
        const parsedRenewalNoticeDays = renewalNoticeDays.trim() ? Number(renewalNoticeDays) : null;
        if (renewalNoticeDays.trim() && !Number.isFinite(parsedRenewalNoticeDays)) {
          setError("Renewal notice days must be a number.");
          return;
        }
        const party = await partyAndLedgerTransport.findOrCreateParty({
          businessId,
          displayName: counterpartyName.trim(),
          partyTypes: ["customer"],
        });
        await legalCommercialTransport.createContract({
          businessId,
          counterpartyId: party.id,
          contractType,
          startDate: startDate || null,
          endDate: endDate || null,
          autoRenew,
          renewalNoticeDays: parsedRenewalNoticeDays,
          aiDraftSummary: text,
        });
        setSuccessMessage(
          `Draft Contract created for ${party.displayName} — review it on the Approvals page.`,
        );
      } else if (effectiveDomain === "e_signature_request") {
        // Sprint 60 — only a Contract already 'pending_signature' can be
        // targeted from this quick-capture domain (see this file's own
        // resolved-field comment on why Quotation targets are out of
        // scope here). Never dispatched until approved — the real
        // envelope is only created by this migration's own trigger.
        if (!signatureContractId) {
          setError("Pick a contract that's ready for signature (status: pending signature).");
          return;
        }
        await legalCommercialTransport.createEsignatureRequestDraft({
          businessId,
          contractId: signatureContractId,
          aiDraftSummary: text,
        });
        setSuccessMessage(
          "e-Signature request submitted — nothing is sent to a signer until this is approved on the Approvals page.",
        );
      } else {
        if (!text) {
          setError("Nothing to save.");
          return;
        }
        await captureTriageTransport.createCaptureTriageItem({
          businessId,
          rawText: text,
          detectedDomain: detectedDomain,
        });
        setSuccessMessage("Couldn't confidently classify this — saved to your Unclassified Triage list below.");
      }

      // Sprint 61 — record whether the owner kept the AI's detected
      // domain as-is (trusted confirmation) or overrode it to something
      // else (reset-to-zero, mirroring businessKnowledgeRepository.ts's
      // own vendor-category behaviour). Skipped for 'unclassified' —
      // there was no real domain guess to confirm or correct. Recorded
      // against detectedDomain (the AI's ORIGINAL guess), not
      // effectiveDomain, so an override still counts as a signal about
      // how good that original guess was. Best-effort: a failed write
      // here never blocks a successful capture the owner is waiting on.
      if (effectiveDomain !== "unclassified" && detectedDomain) {
        try {
          await routingAndChainingTransport.recordChannelDomainConfirmation({
            businessId,
            channel: intake.channel,
            domain: detectedDomain,
            wasCorrect: overrideDomain === null || overrideDomain === detectedDomain,
          });
        } catch {
          // best-effort — see comment above.
        }
      }

      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not process this capture.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResolveTriage(id: string, status: "dismissed" | "resolved"): Promise<void> {
    try {
      await captureTriageTransport.resolveCaptureTriageItem(id, status);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update this triage item.");
    }
  }

  /** Sprint 61 — owner decided a pending chained intake (e.g. "PO approved — confirm stock receipt") needs no action right now. */
  async function handleDismissChainedIntake(id: string): Promise<void> {
    try {
      await routingAndChainingTransport.dismissChainedIntake(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not dismiss this item.");
    }
  }

  return {
    // data
    parties,
    expenseAccounts,
    leaveTypes,
    employees,
    agents,
    warehouses,
    stockTrackedProducts,
    invoicesAwaitingDelivery,
    eInvoiceEligibleInvoices,
    contractsPendingSignature,
    triage,
    loadError,
    // Sprint 61 — cross-domain chaining & confidence trust
    chainedIntakes,
    trustStatus,
    confidenceTier,
    handleDismissChainedIntake,
    // capture state
    rawText,
    setRawText: setRawTextAndReset,
    detectedDomain,
    overrideDomain,
    setOverrideDomain,
    effectiveDomain,
    lastIntakeChannel,
    detectionConfidence,
    detectionSource,
    // resolved fields
    payeePartyId,
    setPayeePartyId,
    expenseCategory,
    setExpenseCategory,
    paymentMethod,
    setPaymentMethod,
    amount,
    setAmount,
    employeePartyId,
    setEmployeePartyId,
    leaveTypeId,
    setLeaveTypeId,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    counterpartyName,
    setCounterpartyName,
    agentPartyId,
    setAgentPartyId,
    correctionClockType,
    setCorrectionClockType,
    correctedAt,
    setCorrectedAt,
    invoiceNoInput,
    setInvoiceNoInput,
    warehouseId,
    setWarehouseId,
    productId,
    setProductId,
    deliveryQuantity,
    setDeliveryQuantity,
    stockAdjustmentDelta,
    setStockAdjustmentDelta,
    contractType,
    setContractType,
    autoRenew,
    setAutoRenew,
    renewalNoticeDays,
    setRenewalNoticeDays,
    signatureContractId,
    setSignatureContractId,
    // status
    busy,
    error,
    successMessage,
    // Sprint 55 — media/voice
    mediaStatus,
    mediaHint,
    voiceStatus,
    // actions — the shared core every adapter calls
    handleDetect,
    handleDetectMedia,
    handleDetectVoice,
    handleSubmit,
    handleResolveTriage,
  };
}
