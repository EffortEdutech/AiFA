/**
 * Universal Input Router — domain detection — Sprint 53 (Phase 5,
 * Vol_5_5 §4/§7).
 *
 * Deliberately a keyword + regex heuristic, not an AI provider call —
 * a Phase 1-style starting rule, same spirit as
 * `capturePipeline.ts`'s own `TRUSTED_MAPPING_CONFIDENCE_FLOOR` comment
 * ("a Phase 1 starting config, not derived from a formal model"). A
 * real AI-provider-backed router is a disclosed future upgrade (Sprint
 * 56 formalises routing/confidence) — see Vol_5_5 §7 and Sprint 53's
 * own Safe-to-Carry-Over section.
 *
 * Scope this sprint (see Sprint 53's own correction note): `expense`
 * and `leave_application` are the two domains this heuristic actually
 * routes to a real Path B RPC; `sale`/`purchase` one-shot text capture
 * is out of scope (no single-call Path B RPC exists for either yet).
 * Anything else — or anything financial-looking with no leave
 * keyword AND no parseable amount — is `unclassified`.
 *
 * 2026-09-13 addition: `sale` is now DETECTED (so an owner typing/
 * forwarding/speaking "invoice sent to ABC Sdn Bhd, RM500" gets an
 * honest "Sale / Income" label instead of being silently bucketed as
 * an expense just because a number is present) even though it still
 * has no one-shot posting RPC — a detected `sale` still lands in
 * Capture Triage, same as `unclassified`, but with its real domain
 * recorded (`capture_triage.detected_domain = 'sale'`) instead of a
 * generic "couldn't tell" label. This does NOT extend to image/PDF
 * OCR text (too unreliable to guess sale-vs-expense direction from a
 * scanned document alone) — see pathBMediaExtraction.ts's own header.
 *
 * This module never posts anything itself — it only classifies raw
 * text and extracts what it can. The caller (CaptureRouterPage.tsx)
 * always shows the result to the owner for confirmation/correction
 * before any Path B RPC is called — nothing here is ever trusted to
 * post silently.
 */
import type {
  AiProvider,
  BusinessDomain,
  DomainClassificationResult,
} from "./types";
import type { InputChannel } from "./channelIntake";

/**
 * Sprint 57 (Phase 5, 14 September 2026) — every domain `classifyPathBIntake`
 * will ask a capable provider to choose between. Kept as one list here
 * rather than derived from the `BusinessDomain` union at the type level, so
 * a future domain literal can be added to the type without silently also
 * becoming classifiable before its own domain-bridge sprint is ready for
 * it — adding to this list is a deliberate, visible, one-line decision.
 */
export const CLASSIFIABLE_DOMAINS: BusinessDomain[] = [
  "expense",
  "sale",
  "purchase",
  "leave_application",
  "purchase_order",
  "delivery_order",
  "stock_adjustment",
  "commission",
  "attendance_correction",
  "e_invoice_flag",
  "contract_alert",
  "e_signature_request",
];

export interface DetectedDateRange {
  startDate: string;
  endDate: string;
}

export interface DomainDetectionResult {
  domain: BusinessDomain;
  /** Present when domain === "expense" or "sale" and an amount-shaped number was found in the text. */
  extractedAmount: number | null;
  /** Present only when domain === "leave_application" and a date or date range was found (ISO yyyy-mm-dd only — Vol_5_5 §7 does not attempt natural-language date parsing this sprint, e.g. "next Monday"; the confirm step lets the owner fill in dates the heuristic missed). */
  extractedDates: DetectedDateRange | null;
}

const LEAVE_KEYWORDS: RegExp[] = [
  /\bleave\b/i,
  /\bcuti\b/i,
  /\bmc\b/i,
  /medical certificate/i,
  /\bday off\b/i,
  /\btime off\b/i,
  /annual leave/i,
  /sick leave/i,
  /emergency leave/i,
  /\bapply(ing)? (for )?leave\b/i,
];

/**
 * Owner-authored (typed/forwarded/spoken) language for money coming
 * INTO the business — deliberately distinct from LEAVE_KEYWORDS'
 * checked-first priority and from the plain AMOUNT_PATTERN fallback
 * (which alone cannot tell a sale from an expense). Not applied to
 * OCR'd image/PDF text — see this file's header.
 *
 * 2026-09-13 fix: the first version required "to"/"for" to sit
 * IMMEDIATELY after "invoice(d)"/"quotation" (`/\binvoice(d)? (to|for)\b/i`),
 * so real owner phrasing like "invoiced ABC Sdn Bhd RM500" (no
 * preposition at all between the verb and the customer name) never
 * matched and fell through to the plain amount fallback → wrongly
 * "Expense". Loosened to match "invoice(d)"/"quotation" ANYWHERE in
 * the text UNLESS immediately followed by "from" — "invoice from
 * <supplier>" / "quotation from <supplier>" is the one common phrasing
 * that actually signals the opposite direction (money going OUT, an
 * incoming purchase invoice), so that specific case is excluded.
 */
const SALE_KEYWORDS: RegExp[] = [
  /\binvoice(d)?\b(?!\s+from)/i,
  /\bquotation\b(?!\s+from)/i,
  /\bsold to\b/i,
  /\bsale to\b/i,
  /customer paid/i,
  /payment received/i,
  /deposit received/i,
  /\breceived from\b/i,
  /\bjualan\b/i,
  /resit jualan/i,
];

const AMOUNT_PATTERN = /(?:rm|myr|\$)\s?(\d+(?:,\d{3})*(?:\.\d{1,2})?)|(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s?(?:rm|myr|ringgit)/i;
const DATE_RANGE_PATTERN = /(\d{4}-\d{2}-\d{2})\s*(?:to|until|till|-|–)\s*(\d{4}-\d{2}-\d{2})/i;
const SINGLE_DATE_PATTERN = /(\d{4}-\d{2}-\d{2})/;

function extractAmount(text: string): number | null {
  const match = text.match(AMOUNT_PATTERN);
  if (!match) return null;
  const raw = match[1] ?? match[2];
  const value = Number(raw.replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * 14 September 2026 addition (owner-reported PO capture failure — "Issue
 * PO to KBCM for purchase of 60 boxes of vitamins. each box price rm23"
 * classified correctly at 98% confidence but failed Confirm & Save with
 * "Enter the supplier's name and a positive amount"). Root cause:
 * AMOUNT_PATTERN/extractAmount only ever finds ONE plain RM-shaped
 * number, and a real classifyDomain() Gateway call can hit the same
 * limitation — neither can tell "60 boxes, each box price RM23" is a
 * quantity × unit price that needs multiplying, not a flat total. This
 * is a narrow, ADDITIVE fallback — callers should try their normal
 * amount first and only fall back to this when that came back null, so
 * a capture that already states a flat total ("PO for RM1200") keeps
 * using that number as-is, never re-multiplied by an unrelated quantity
 * mentioned elsewhere in the text. Counterparty-name extraction is a
 * separate, harder problem (unreliable to regex-guess a company name)
 * and is deliberately NOT addressed here — see useCaptureRouterCore.ts's
 * own comment on this fallback's use for what still needs manual entry.
 */
const QUANTITY_PATTERN =
  /\b(\d+(?:\.\d+)?)\s*(?:boxes?|units?|pcs?|pieces?|nos?|kg|kilograms?|litres?|liters?|bottles?|packs?|cartons?|items?)\b/i;
const PER_UNIT_PRICE_PATTERN =
  /(?:each|per)\s*(?:box|unit|pc|piece|item|carton|pack|bottle)?\s*(?:price\s*)?(?:is\s*)?(?:rm|myr|\$)\s?(\d+(?:,\d{3})*(?:\.\d{1,2})?)|(?:rm|myr|\$)\s?(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:each|per\s*(?:box|unit|pc|piece|item))/i;

export function extractQuantityUnitPriceTotal(text: string): number | null {
  const qtyMatch = text.match(QUANTITY_PATTERN);
  const priceMatch = text.match(PER_UNIT_PRICE_PATTERN);
  if (!qtyMatch || !priceMatch) return null;
  const quantity = Number(qtyMatch[1]);
  const rawPrice = (priceMatch[1] ?? priceMatch[2] ?? "").replace(/,/g, "");
  const unitPrice = Number(rawPrice);
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0) {
    return null;
  }
  const total = quantity * unitPrice;
  return Number.isFinite(total) && total > 0 ? total : null;
}

function extractDates(text: string): DetectedDateRange | null {
  const rangeMatch = text.match(DATE_RANGE_PATTERN);
  if (rangeMatch) {
    return { startDate: rangeMatch[1], endDate: rangeMatch[2] };
  }
  const singleMatch = text.match(SINGLE_DATE_PATTERN);
  if (singleMatch) {
    return { startDate: singleMatch[1], endDate: singleMatch[1] };
  }
  return null;
}

/**
 * Classifies raw free text into a `BusinessDomain` this sprint's router
 * knows how to act on, plus whatever it could confidently extract.
 * Leave detection takes priority over amount detection — a leave
 * request that happens to mention a number (e.g. a phone number, or
 * "leave for 3 days") must not be misfiled as an expense.
 */
/**
 * Sprint 57 (Phase 5, 14 September 2026) result shape for
 * `classifyPathBIntake` — a superset of `DomainDetectionResult` above
 * (kept as its own type rather than widening that one, since
 * `classifyChannelIntakeDomain`'s callers/tests should not be forced to
 * suddenly handle `confidence`/`source`/`extractedFields` they never asked
 * for). `source` tells the caller honestly whether this came from a real
 * AI call or the regex fallback — never blurred together, so a UI can
 * choose to show "AI confidence: 0.86" only when it's a real calibrated
 * number, not a heuristic's guess dressed up as one.
 */
export interface PathBClassificationResult {
  domain: BusinessDomain;
  confidence: number;
  extractedAmount: number | null;
  extractedDates: DetectedDateRange | null;
  extractedFields: Record<string, unknown>;
  reasoning: string | null;
  source: "ai" | "heuristic_fallback";
}

function extractDatesFromFields(fields: Record<string, unknown>): DetectedDateRange | null {
  const start = fields.startDate;
  const end = fields.endDate;
  if (typeof start === "string" && typeof end === "string") {
    return { startDate: start, endDate: end };
  }
  return null;
}

/**
 * The Sprint 57 production entry point every Path B caller should move to
 * (see Sprint 57's own sprint-plan document). Tries a real AI-backed
 * domain classification first via `provider.classifyDomain`; falls back to
 * `classifyChannelIntakeDomain`'s regex heuristic when the provider
 * doesn't implement that method, or when the call itself fails (network
 * error, Gateway unreachable) — the input is never dropped, and the
 * caller is always told honestly which path produced the result via
 * `source`. `classifyChannelIntakeDomain` itself is kept, unchanged and
 * still directly callable, as that fallback and for any caller not yet
 * migrated.
 */
export async function classifyPathBIntake(
  rawText: string,
  provider: AiProvider,
): Promise<PathBClassificationResult> {
  const text = rawText.trim();
  if (!text) {
    return {
      domain: "unclassified",
      confidence: 0,
      extractedAmount: null,
      extractedDates: null,
      extractedFields: {},
      reasoning: null,
      source: "heuristic_fallback",
    };
  }

  if (provider.classifyDomain) {
    try {
      const { result }: { result: DomainClassificationResult } =
        await provider.classifyDomain({
          rawText: text,
          candidateDomains: CLASSIFIABLE_DOMAINS,
        });
      const domain: BusinessDomain =
        result.domain && CLASSIFIABLE_DOMAINS.includes(result.domain)
          ? result.domain
          : "unclassified";
      const amountField = result.extractedFields.amount;
      return {
        domain,
        confidence: result.confidence,
        extractedAmount: typeof amountField === "number" ? amountField : null,
        extractedDates: extractDatesFromFields(result.extractedFields),
        extractedFields: result.extractedFields,
        reasoning: result.reasoning,
        source: "ai",
      };
    } catch {
      // Network/provider failure — fall through to the heuristic rather
      // than throwing past this function and losing the input, the same
      // "never silently drop" discipline capturePipeline.ts's classify()
      // call already applies (see its own try/catch around provider.classify).
    }
  }

  const heuristic = classifyChannelIntakeDomain(text);
  return {
    domain: heuristic.domain,
    confidence: 0,
    extractedAmount: heuristic.extractedAmount,
    extractedDates: heuristic.extractedDates,
    extractedFields: {},
    reasoning: null,
    source: "heuristic_fallback",
  };
}

export function classifyChannelIntakeDomain(rawText: string): DomainDetectionResult {
  const text = rawText.trim();

  if (LEAVE_KEYWORDS.some((re) => re.test(text))) {
    return {
      domain: "leave_application",
      extractedAmount: null,
      extractedDates: extractDates(text),
    };
  }

  // Checked before the bare amount fallback — a sale mentioning a
  // number ("invoiced ABC Sdn Bhd RM500") must not be misfiled as an
  // expense just because AMOUNT_PATTERN also matches it.
  if (SALE_KEYWORDS.some((re) => re.test(text))) {
    return { domain: "sale", extractedAmount: extractAmount(text), extractedDates: null };
  }

  const amount = extractAmount(text);
  if (amount != null) {
    return { domain: "expense", extractedAmount: amount, extractedDates: null };
  }

  return { domain: "unclassified", extractedAmount: null, extractedDates: null };
}

/**
 * Sprint 61 (Phase 5, 16 September 2026) — the "channel × domain
 * confidence table" Vol_5_5 §8 describes, per the sprint doc's own
 * generalization of the original Sprint 57 design plus Sprint 58's
 * chaining precedent. See the Sprint 61 migration's own header for why
 * this could NOT be built by extending
 * businessKnowledgeRepository.ts's existing (Path A-only) mechanism —
 * this is a fresh, Path B-native decision, keyed on the SAME
 * confirmation-count/threshold shape that file uses, sourced from the
 * new `channel_domain_trust` table via
 * routingAndChainingTransport.ts's `getChannelDomainTrustStatus`.
 *
 * Deliberately NOT called from anywhere in Path A (capturePipeline.ts,
 * the in-app photo capture flow) — that flow's own
 * TRUSTED_MAPPING_CONFIDENCE_FLOOR/confidence_thresholds logic is
 * completely untouched by this sprint, per its own explicit regression
 * requirement (DoD: "In-app photo capture's existing auto-record
 * behaviour for a trusted vendor is unchanged").
 */
export const PERMANENT_APPROVAL_DOMAINS: BusinessDomain[] = [
  "attendance_correction",
  "stock_adjustment",
  "e_invoice_flag",
  "contract_alert",
  "e_signature_request",
];

export type ConfidenceTier = "confirm_required" | "trusted_skip_confirm";

/**
 * Pure decision function — takes the channel, the classified domain,
 * and an already-fetched trust status (this function does no I/O
 * itself; the caller fetches trust via getChannelDomainTrustStatus).
 *
 * "trusted_skip_confirm" means only that the owner is not asked to
 * re-verify the AI's domain classification — it never means the
 * capture is auto-recorded without a draft, and it never overrides the
 * permanent-approval-domain list below, which the trust status itself
 * already enforces (this function's own domain check is a second,
 * redundant guard — a caller here can never accidentally trust one of
 * the five domains even if a future trust-status source forgot to).
 */
export function decideConfidenceTier(params: {
  channel: InputChannel;
  domain: BusinessDomain;
  trustStatus: { isTrusted: boolean };
}): ConfidenceTier {
  if (PERMANENT_APPROVAL_DOMAINS.includes(params.domain)) {
    return "confirm_required";
  }
  return params.trustStatus.isTrusted ? "trusted_skip_confirm" : "confirm_required";
}
