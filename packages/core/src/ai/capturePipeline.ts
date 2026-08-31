/**
 * Capture interpretation pipeline — Sprint 3 (Expense only), generalised in
 * Sprint 6 to also cover Sale and Purchase (Vol 6_0 §4: one shared engine,
 * domain-scoped rules sourced from the Finance PKA). Single orchestrated
 * call chain per domain (Vol 5_2 §4.1: classify -> route -> record, not
 * separate agents yet).
 *
 * Confidence routing per Vol 2_2 §4.1 / accounting_rules.json
 * confidence_thresholds (shared across all three domains):
 *   >= auto_record_min   -> finalize immediately (posted, editable only via
 *                            a superseding correction event, Vol 4_0 §7)
 *   >= draft_confirm_min  -> recorded as a draft; owner sees one-tap
 *                            confirm/correct before it counts toward
 *                            reports (Vol 2_2 §4.1)
 *   below draft_confirm_min -> not recorded as a draft; owner is asked a
 *                            specific clarifying question instead
 *
 * Photo capture (Sprint 5) remains Expense-only — see
 * runExpensePhotoInterpretation/completePhotoCapture at the bottom of this
 * file — but both call the same classifyAndRoute core as the text flow for
 * all three domains, so there is exactly one routing implementation, not
 * one per domain or one per capture mode.
 */
import { buildCapturePcb, categoriesForDomain } from "./pcb";
import type {
  AiProvider,
  BusinessDomain,
  VisionExtractedFields,
} from "./types";
import accountingRules from "../../pka/accounting_rules.json";

import {
  CASH_BANK_ACCOUNT,
  ACCOUNTS_PAYABLE_ACCOUNT,
  ACCOUNTS_RECEIVABLE_ACCOUNT,
} from "../db/accounts";
import { recordAiInterpretation } from "../db/aiInterpretationRepository";
import {
  recordCaptureQueued,
  createQueuedPhotoEvent,
  attachExpenseBusinessData,
  setBusinessEventStatus,
  setBusinessDataClassification,
  setSupersededBy,
  getActivityItemByEventId,
  getBusinessEventById,
  type BusinessEvent,
  type BusinessData,
  type DomainHint,
  type PaymentMethod,
} from "../db/businessEventRepository";
import {
  getTrustedVendorCategory,
  recordVendorCategoryConfirmation,
  TRUSTED_CONFIRMATION_THRESHOLD,
} from "../db/businessKnowledgeRepository";
import {
  saveDocument,
  updateExtractionStatus,
  listDocumentsForEvent,
  getDocumentBlob,
} from "../db/documentRepository";
import { logAppError } from "../db/errorLogRepository";
import {
  createLedgerEntries,
  listLedgerEntriesForBusinessData,
  reverseLedgerEntries,
} from "../db/ledgerRepository";
import type { SqlDb } from "../db/types";

/**
 * Sprint 11 (Vol 8_6 Section 2, "AI Runtime health... error rates") --
 * best-effort error logging around a thrown provider call. Deliberately
 * swallows its OWN failures (e.g. if `db` is somehow unusable) rather than
 * letting a logging problem mask or replace the original queued-retry
 * behaviour Sprint 9 already built -- observability must never become a
 * new way for a capture to get lost.
 */
async function logAiCallError(
  db: SqlDb,
  err: unknown,
  context: Record<string, unknown>,
): Promise<void> {
  try {
    await logAppError(db, {
      errorType: "ai_call_error",
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? (err.stack ?? null) : null,
      context,
    });
  } catch {
    // Logging the error must never itself throw and mask the original
    // queued/retry outcome -- see this function's own comment above.
  }
}

/**
 * Sprint 9 adds `queued_retry` (Vol 7_4 §2-3): the event/data are already
 * safely persisted locally, but the AI classification call itself either
 * could not be attempted (caller signalled offline) or was attempted and
 * failed (a network error mid-call) -- distinct from `clarify`, which
 * means the AI WAS reached and genuinely doesn't know the category.
 * `resumeQueuedCaptures` retries these once connectivity returns; nothing
 * is lost or silently dropped in either case.
 */
export type InterpretationDecision =
  "auto_record" | "draft_confirm" | "clarify" | "queued_retry";

export interface InterpretationOutcome {
  event: BusinessEvent;
  data: BusinessData;
  decision: InterpretationDecision;
  category: string | null;
  confidence: number;
  clarifyingQuestion: string | null;
}

export interface RunCaptureInterpretationInput {
  domain: BusinessDomain;
  businessId: string;
  description: string;
  counterpartyName?: string;
  amount: number;
  currency: string;
  paymentMethod: PaymentMethod;
  /**
   * Sprint 9 — caller-supplied connectivity signal (Vol 7_4 §2), mirroring
   * the photo flow's existing `isOnline` param (Sprint 5). Omitted/true
   * attempts classification normally; explicit `false` skips the network
   * call entirely and leaves the event `queued` for later resumption via
   * `resumeQueuedCaptures`.
   */
  isOnline?: boolean;
}

/**
 * Ledger posting shape per domain (Vol 6_1 §3, Vol 6_2 §3, and the
 * pre-existing EXP-001 rule). Expense and Purchase share the same shape
 * (debit the matched category, credit Cash/Bank or the deferred-payment
 * account); Sale is the mirror image (debit Cash/Bank or the
 * deferred-payment account, credit the matched category, which is always
 * Sales Revenue in Phase 1). This is the one Expense-only assumption the
 * Sprint 3 pipeline actually had baked in — fixed here rather than
 * duplicated per domain.
 */
function ledgerAccountsForDomain(
  domain: BusinessDomain,
  category: string,
  paymentMethod: PaymentMethod,
): { debitAccount: string; creditAccount: string } {
  if (domain === "sale") {
    const cashOrReceivable =
      paymentMethod === "unspecified"
        ? ACCOUNTS_RECEIVABLE_ACCOUNT
        : CASH_BANK_ACCOUNT;
    return { debitAccount: cashOrReceivable, creditAccount: category };
  }
  // expense + purchase: debit the category, credit Cash/Bank or Payable.
  const cashOrPayable =
    paymentMethod === "unspecified"
      ? ACCOUNTS_PAYABLE_ACCOUNT
      : CASH_BANK_ACCOUNT;
  return { debitAccount: category, creditAccount: cashOrPayable };
}

function isKnownCategory(
  domain: BusinessDomain,
  category: string | null,
): category is string {
  if (!category) return false;
  return categoriesForDomain(domain).some(
    (entry) => entry.category === category,
  );
}

const AI_INTERPRETED_DOMAINS: DomainHint[] = ["expense", "sale", "purchase"];

/**
 * Confidence floor applied when a trusted vendor mapping (Vol 4_2, Vol
 * 11_1 §7) agrees with the AI's own independent category guess -- high
 * enough to reliably clear `confidence_thresholds.auto_record_min`
 * (0.90 in accounting_rules.json) without being pinned at a suspicious
 * 1.0 (which is reserved for actual owner certainty, see
 * confirmCategory/correctConfirmedCapture). A Phase 1 starting config
 * (Vol 0_1 §3.4), not derived from a formal model.
 */
const TRUSTED_MAPPING_CONFIDENCE_FLOOR = 0.95;

function isAiInterpretedDomain(domain: DomainHint): domain is BusinessDomain {
  return (AI_INTERPRETED_DOMAINS as DomainHint[]).includes(domain);
}

/**
 * Every Phase 1 chart-of-accounts category string for a domain. Accepts
 * the full DomainHint (not just BusinessDomain) so UI callers like
 * ActivityFeed — which render rows for every domain, not just the three
 * AI-interpreted ones — can call this directly without a separate narrowing
 * step; Banking/Unclassified (not AI-interpreted, no categories yet)
 * return an empty list rather than throwing.
 */
export function categoryOptionsForDomain(domain: DomainHint): string[] {
  if (!isAiInterpretedDomain(domain)) return [];
  return categoriesForDomain(domain).map((entry) => entry.category);
}

/** Backward-compatible convenience export — the Expense-only subset, used by the photo capture flow and its fallback form (both still Expense-only as of Sprint 6). */
export const EXPENSE_CATEGORY_OPTIONS = categoryOptionsForDomain("expense");

/**
 * Finalises a category for a BusinessData row: persists the classification,
 * posts the balanced double-entry ledger lines (Vol 2_2 §5, domain-scoped
 * posting rule from ledgerAccountsForDomain), then confirms the parent
 * BusinessEvent last.
 *
 * Statement order is load-bearing: once status='confirmed' the DB trigger
 * blocks further writes to the event row, and nothing after this function
 * ever touches business_data again — so this ordering is what makes
 * BusinessData effectively immutable too, even though the trigger itself
 * only guards business_events (Vol 4_0 §7 applies transitively via this
 * invariant, not via a second trigger).
 */
async function finalizeCategory(
  db: SqlDb,
  eventId: string,
  dataId: string,
  domain: BusinessDomain,
  category: string,
  confidence: number,
  amount: number,
  currency: string,
  paymentMethod: PaymentMethod,
): Promise<void> {
  const { debitAccount, creditAccount } = ledgerAccountsForDomain(
    domain,
    category,
    paymentMethod,
  );
  await setBusinessDataClassification(db, dataId, category, confidence);
  await createLedgerEntries(db, [
    {
      businessDataId: dataId,
      account: debitAccount,
      direction: "debit",
      amount,
      currency,
    },
    {
      businessDataId: dataId,
      account: creditAccount,
      direction: "credit",
      amount,
      currency,
    },
  ]);
  await setBusinessEventStatus(db, eventId, "confirmed");
}

/** Sprint 9 — a queued/queued_retry outcome shares this shape everywhere it's produced (offline skip, or a classify() call that threw). Never writes an ai_interpretations row -- nothing was actually decided, so there is nothing genuine to log (Vol 11_1 §8's schema has no "attempted but failed" decision value, deliberately -- see migrations.ts). */
function queuedRetryOutcome(
  event: BusinessEvent,
  data: BusinessData,
): InterpretationOutcome {
  return {
    event: { ...event, status: "queued" },
    data,
    decision: "queued_retry",
    category: null,
    confidence: 0,
    clarifyingQuestion: null,
  };
}

/**
 * Shared classify+route core: builds the domain-scoped PCB from an
 * EXISTING event/data pair (domain read off event.domain_hint), calls the
 * provider's classifier, records the interpretation, and routes per the
 * confidence thresholds. Used by the text flow for all three AI-interpreted
 * domains (runCaptureInterpretation) and by the Expense photo flow
 * (Sprint 5's completePhotoCapture / the 'complete' extraction branch of
 * runExpensePhotoInterpretation) — one implementation of the routing
 * logic, not one copy per domain or capture mode.
 *
 * Sprint 9 (Vol 7_4 §2-3): `isOnline: false` skips the network call
 * entirely and leaves the event `queued`, exactly like the photo flow's
 * pre-existing offline branch. Even when the caller believes it's online,
 * the provider call is wrapped so a genuine network failure ALSO leaves
 * the event safely `queued` (never stuck at `processing` with no way
 * forward) rather than throwing past this function and losing the event
 * in an ambiguous state -- see resumeQueuedCaptures for how these get
 * retried once connectivity actually returns.
 */
async function classifyAndRoute(
  db: SqlDb,
  provider: AiProvider,
  event: BusinessEvent,
  data: BusinessData,
  options?: { isOnline?: boolean },
): Promise<InterpretationOutcome> {
  const domain = event.domain_hint as BusinessDomain;

  if (options?.isOnline === false) {
    await setBusinessEventStatus(db, event.id, "queued");
    return queuedRetryOutcome(event, data);
  }

  const pcb = buildCapturePcb({
    domain,
    businessEventId: event.id,
    businessDataId: data.id,
    description: event.raw_input_ref ?? "",
    counterpartyName: data.counterparty_name,
    amount: data.amount,
    currency: data.currency,
    paymentMethod: data.payment_method,
  });

  let classifyResult: Awaited<ReturnType<AiProvider["classify"]>>;
  try {
    classifyResult = await provider.classify(pcb);
  } catch (err) {
    // Network (or provider-side) failure mid-call -- the event/data are
    // already safely persisted; leave it queued for resumeQueuedCaptures
    // rather than letting the exception propagate and strand the event at
    // 'processing' with no defined path forward. Sprint 11: also logged
    // for observability (Vol 8_6 Section 2) -- Sprint 9's queued_retry
    // behaviour is unchanged, this only adds visibility on top of it.
    await logAiCallError(db, err, {
      businessEventId: event.id,
      domain,
      operation: "classify",
    });
    await setBusinessEventStatus(db, event.id, "queued");
    return queuedRetryOutcome(event, data);
  }
  const { result, metrics } = classifyResult;

  // Never invent accounting treatment outside what the PCB supports
  // (Vol 2_2 §6): a category the PKA bundle doesn't recognise for this
  // domain is treated as zero confidence, forcing the clarify path rather
  // than posting a guess the Finance PKA never actually endorsed.
  const categoryRecognised = isKnownCategory(domain, result.category);
  const safeCategory = categoryRecognised ? result.category : null;
  let safeConfidence = categoryRecognised ? result.confidence : 0;

  // Sprint 8 -- Business Knowledge trust boost (Vol 4_2 §6, Vol 11_1 §7).
  // Only applied when the AI's OWN independent category guess already
  // agrees with a trusted vendor mapping -- this reinforces agreement, it
  // never substitutes the business's remembered category for the AI's
  // guess when they disagree or when the AI recognised nothing at all.
  // That agreement-required design is deliberate: overriding the AI's
  // independent answer with stale business knowledge is exactly the
  // "over-eager auto-categorisation erodes trust" risk the Sprint 8 risk
  // register calls out: the 3-confirmation threshold alone is not treated
  // as sufficient protection here, requiring agreement is the stronger
  // guard.
  let trustedMappingApplied = false;
  if (safeCategory && data.counterparty_name) {
    const trustedCategory = await getTrustedVendorCategory(
      db,
      event.business_id,
      data.counterparty_name,
    );
    if (trustedCategory && trustedCategory === safeCategory) {
      safeConfidence = Math.max(
        safeConfidence,
        TRUSTED_MAPPING_CONFIDENCE_FLOOR,
      );
      trustedMappingApplied = true;
    }
  }

  const reasoning = trustedMappingApplied
    ? `${result.reasoning} [Business Knowledge: "${data.counterparty_name}" has a trusted "${safeCategory}" mapping from ${TRUSTED_CONFIRMATION_THRESHOLD}+ consistent owner confirmations -- confidence boosted.]`
    : result.reasoning;

  const thresholds = accountingRules.confidence_thresholds;
  let decision: InterpretationDecision;
  if (safeConfidence >= thresholds.auto_record_min) {
    decision = "auto_record";
  } else if (safeConfidence >= thresholds.draft_confirm_min) {
    decision = "draft_confirm";
  } else {
    decision = "clarify";
  }

  const clarifyingQuestion =
    decision === "clarify"
      ? (result.clarifying_question ?? "Which category does this belong to?")
      : null;

  await recordAiInterpretation(db, {
    businessEventId: event.id,
    businessDataId: data.id,
    model: metrics.model,
    decision,
    category: safeCategory,
    confidence: safeConfidence,
    reasoning,
    clarifyingQuestion,
    matchedRuleIds: result.matched_rule_ids,
    sourceReferences: pcb.source_references,
    pkaVersion: pcb.pka_version,
    latencyMs: metrics.latencyMs,
    estimatedCostUsd: metrics.estimatedCostUsd,
  });

  let finalStatus: BusinessEvent["status"];
  if (decision === "auto_record" && safeCategory) {
    await finalizeCategory(
      db,
      event.id,
      data.id,
      domain,
      safeCategory,
      safeConfidence,
      data.amount,
      data.currency,
      data.payment_method,
    );
    finalStatus = "confirmed";
  } else if (decision === "draft_confirm" && safeCategory) {
    await setBusinessDataClassification(
      db,
      data.id,
      safeCategory,
      safeConfidence,
    );
    await setBusinessEventStatus(db, event.id, "draft");
    finalStatus = "draft";
  } else {
    await setBusinessEventStatus(db, event.id, "needs_clarification");
    finalStatus = "needs_clarification";
  }

  return {
    event: { ...event, status: finalStatus },
    data:
      decision === "clarify"
        ? data
        : { ...data, category_guess: safeCategory, confidence: safeConfidence },
    decision,
    category: safeCategory,
    confidence: safeConfidence,
    clarifyingQuestion,
  };
}

/**
 * Captures a Business Event in an AI-interpreted domain (expense, sale, or
 * purchase as of Sprint 6), builds its PCB, calls the AI provider, records
 * the interpretation for explainability/cost tracking, and routes the
 * result per the confidence thresholds. This is the "no more manual-only
 * entry" pipeline entry point — replaces runExpenseInterpretation, now
 * domain-parameterised via input.domain.
 */
export async function runCaptureInterpretation(
  db: SqlDb,
  provider: AiProvider,
  input: RunCaptureInterpretationInput,
): Promise<InterpretationOutcome> {
  const { event, data } = await recordCaptureQueued(db, input);
  if (input.isOnline === false) {
    // Never touches 'processing' at all when the caller already knows
    // there's no connectivity to attempt with (Vol 7_4 §2) -- stays
    // 'queued' from recordCaptureQueued's own initial write.
    return classifyAndRoute(db, provider, event, data, { isOnline: false });
  }
  await setBusinessEventStatus(db, event.id, "processing");
  return classifyAndRoute(
    db,
    provider,
    { ...event, status: "processing" },
    data,
    { isOnline: input.isOnline },
  );
}

/**
 * Sprint 9 (Vol 7_4 §4 "Sync Resumption Flow") — retries every still-
 * pending AI-interpreted text capture (queued or stuck-processing) for a
 * business once connectivity returns. Deliberately narrow: only events
 * that ALREADY have a linked BusinessData row (text captures, and photo
 * captures whose extraction already completed) are handled here --
 * `resumeQueuedPhotoCaptures` below covers the separate case of a photo
 * that never got as far as extraction. Banking is not included: it is
 * manual/deterministic (Vol 6_4) and confirms immediately with no AI call
 * to ever get stuck on.
 */
export async function resumeQueuedCaptures(
  db: SqlDb,
  provider: AiProvider,
  businessId: string,
): Promise<InterpretationOutcome[]> {
  const pending = await db.queryAll<{ id: string; domain_hint: DomainHint }>(
    `SELECT id, domain_hint FROM business_events
     WHERE business_id = ? AND status IN ('queued', 'processing')
       AND domain_hint IN ('expense', 'sale', 'purchase');`,
    [businessId],
  );

  const resumed: InterpretationOutcome[] = [];
  for (const row of pending) {
    const item = await getActivityItemByEventId(db, row.id);
    // No BusinessData yet -- this is a photo capture that never reached
    // extraction; resumeQueuedPhotoCaptures handles that case instead.
    if (!item) continue;
    resumed.push(
      await classifyAndRoute(db, provider, item.event, item.data, {
        isOnline: true,
      }),
    );
  }
  return resumed;
}

/**
 * Owner-driven resolution for a 'draft' event (accept the AI's category as
 * given, or correct it) or a 'needs_clarification' event (answer the
 * clarifying question by picking a category directly). Both cases reduce
 * to the same operation: the owner supplies a category with certainty,
 * recorded as confidence 1.0 — distinct from an AI guess, and (Sprint 8)
 * the training signal for the Business Knowledge Store heuristic (Vol
 * 4_2): a named vendor's confirmed category is recorded via
 * recordVendorCategoryConfirmation, feeding future classifyAndRoute calls'
 * trust boost once it crosses TRUSTED_CONFIRMATION_THRESHOLD. Domain is
 * read off event.domain_hint, same as classifyAndRoute — works for any of
 * the three AI-interpreted domains.
 */
export async function confirmCategory(
  db: SqlDb,
  event: Pick<BusinessEvent, "id" | "status" | "domain_hint" | "business_id">,
  data: Pick<BusinessData, "id" | "amount" | "currency" | "counterparty_name">,
  chosenCategory: string,
  paymentMethod: PaymentMethod,
): Promise<void> {
  if (event.status !== "draft" && event.status !== "needs_clarification") {
    throw new Error(
      `Cannot confirm a category for a Business Event in status '${event.status}'.`,
    );
  }
  const domain = event.domain_hint as BusinessDomain;
  if (!isKnownCategory(domain, chosenCategory)) {
    throw new Error(
      `'${chosenCategory}' is not a recognised Phase 1 '${domain}' category.`,
    );
  }
  await finalizeCategory(
    db,
    event.id,
    data.id,
    domain,
    chosenCategory,
    1.0,
    data.amount,
    data.currency,
    paymentMethod,
  );
  // No named vendor/counterparty -- nothing to learn (Vol 11_1 §7's `key`
  // is the vendor name; a generic/anonymous capture has none).
  if (data.counterparty_name) {
    await recordVendorCategoryConfirmation(
      db,
      event.business_id,
      data.counterparty_name,
      chosenCategory,
    );
  }
}

/**
 * Corrects an already-CONFIRMED capture's category (Vol 4_1 §4:
 * corrections are reversing entries, never an in-place edit — distinct
 * from confirmCategory above, which only handles pre-confirmation
 * 'draft'/'needs_clarification' events). Works for any of the three
 * AI-interpreted domains (domain read off the original event's
 * domain_hint). Sequence:
 *
 *  1. Reverse the original BusinessData's ledger postings (nets to zero;
 *     the original entries are untouched, per double-entry convention).
 *  2. Create a brand-new BusinessEvent + BusinessData for the correction,
 *     confirmed immediately with the corrected category (confidence 1.0,
 *     owner-certain, same as confirmCategory).
 *  3. Link the original event forward via superseded_by (Vol 4_0 §7) —
 *     allowed exactly once by the migration 4 trigger; the original row
 *     itself is never edited beyond that single linkage.
 */
export async function correctConfirmedCapture(
  db: SqlDb,
  originalEventId: string,
  correctedCategory: string,
): Promise<{ correctingEvent: BusinessEvent; correctingData: BusinessData }> {
  const original = await getActivityItemByEventId(db, originalEventId);
  if (!original) {
    throw new Error(`Business Event '${originalEventId}' not found.`);
  }
  if (original.event.status !== "confirmed") {
    throw new Error(
      `correctConfirmedCapture only applies to a 'confirmed' event; '${originalEventId}' is '${original.event.status}'. Use confirmCategory for a draft or needs_clarification event instead.`,
    );
  }
  if (original.event.superseded_by) {
    throw new Error(
      `Business Event '${originalEventId}' has already been corrected (superseded by '${original.event.superseded_by}').`,
    );
  }
  const domain = original.event.domain_hint as BusinessDomain;
  if (!isKnownCategory(domain, correctedCategory)) {
    throw new Error(
      `'${correctedCategory}' is not a recognised Phase 1 '${domain}' category.`,
    );
  }

  const originalEntries = await listLedgerEntriesForBusinessData(
    db,
    original.data.id,
  );
  await reverseLedgerEntries(db, originalEntries);

  const { event: correctingEvent, data: correctingData } =
    await recordCaptureQueued(db, {
      domain,
      businessId: original.event.business_id,
      description: original.event.raw_input_ref ?? "",
      counterpartyName: original.data.counterparty_name ?? undefined,
      amount: original.data.amount,
      currency: original.data.currency,
      paymentMethod: original.data.payment_method,
    });

  await finalizeCategory(
    db,
    correctingEvent.id,
    correctingData.id,
    domain,
    correctedCategory,
    1.0,
    original.data.amount,
    original.data.currency,
    original.data.payment_method,
  );

  await setSupersededBy(db, originalEventId, correctingEvent.id);

  // A correction is also owner-certainty about the right category for
  // this vendor (Sprint 8, Vol 4_2) — feeds the same Business Knowledge
  // heuristic as confirmCategory. Notably this also means a vendor that
  // was WRONGLY auto-categorised and then corrected starts a fresh streak
  // under the corrected category rather than staying trusted on the wrong
  // one (recordVendorCategoryConfirmation resets on a differing value).
  if (original.data.counterparty_name) {
    await recordVendorCategoryConfirmation(
      db,
      original.event.business_id,
      original.data.counterparty_name,
      correctedCategory,
    );
  }

  return {
    correctingEvent: { ...correctingEvent, status: "confirmed" },
    correctingData: {
      ...correctingData,
      category_guess: correctedCategory,
      confidence: 1.0,
    },
  };
}

/**
 * Result of attempting a photo capture — mirrors Vol 7_1 §5.1's three
 * failure modes plus the success path, so the UI can render each
 * distinctly instead of collapsing them into a generic error. Photo
 * capture remains Expense-only as of Sprint 6.
 */
export type PhotoCaptureOutcome =
  | { kind: "queued_offline"; event: BusinessEvent; documentId: string }
  | {
      kind: "needs_manual_entry"; // extraction failed entirely OR no vision-capable provider
      event: BusinessEvent;
      documentId: string;
      prefill: null;
    }
  | {
      kind: "needs_manual_entry"; // partial extraction -- some fields pre-filled
      event: BusinessEvent;
      documentId: string;
      prefill: VisionExtractedFields;
    }
  | {
      kind: "interpreted";
      documentId: string;
      outcome: InterpretationOutcome;
    };

export interface CapturePhotoInput {
  businessId: string;
  base64Image: string;
  mimeType: string;
  /**
   * Caller-supplied connectivity signal (Vol 7_1 §5.1's "no connectivity
   * during capture" mode) — Phase 1 does not yet have a real network
   * reachability check wired in (Sprint 9 hardens offline behaviour); the
   * UI passes what it currently knows, defaulting to true.
   */
  isOnline?: boolean;
}

/**
 * Photo capture entry point (Vol 7_1 §2 photo mode, Vol 7_6 Document
 * lifecycle). Expense-only (Sprint 5 scope, unchanged by Sprint 6). Always
 * saves the image as a Document immediately — evidence is never lost even
 * if extraction fails entirely — then branches on the three Vol 7_1 §5.1
 * failure modes:
 *
 *  - offline at capture time: event stays 'queued', nothing else attempted
 *    yet (Sprint 9 will add real retry-when-online handling)
 *  - the provider has no vision capability, or extraction fails entirely:
 *    'needs_manual_entry' with no prefill -- UI shows the photo plus
 *    Sprint 2's blank quick-entry form
 *  - extraction is 'partial': 'needs_manual_entry' WITH prefill -- UI
 *    shows the same form pre-filled, missing fields highlighted
 *  - extraction is 'complete': BusinessData is attached immediately and
 *    run through the same classifyAndRoute confidence routing as text
 *    capture (Sprint 3) -- no separate routing logic to maintain
 */
/**
 * Sprint 9 extraction: attempts vision extraction for an event/document
 * that already exist (shared by the initial capture below and by
 * `resumeQueuedPhotoCaptures`, which re-enters here after connectivity
 * returns instead of re-creating the event/document). A thrown error from
 * the provider (network failure, not a `result.extractionStatus` value)
 * leaves the event `queued` and the document `not_attempted` -- exactly
 * the same recoverable state as never having attempted extraction at all
 * -- rather than mis-filing it as `needs_clarification` (which Vol 7_1
 * §5.1 reserves for a genuine extraction attempt that came back
 * failed/partial, not for "never got to try").
 */
async function extractAndRoutePhoto(
  db: SqlDb,
  provider: AiProvider,
  event: BusinessEvent,
  documentId: string,
  base64Image: string,
  mimeType: string,
): Promise<PhotoCaptureOutcome> {
  if (!provider.extractExpenseFromImage) {
    await updateExtractionStatus(db, documentId, "failed");
    await setBusinessEventStatus(db, event.id, "needs_clarification");
    return {
      kind: "needs_manual_entry",
      event: { ...event, status: "needs_clarification" },
      documentId,
      prefill: null,
    };
  }

  await setBusinessEventStatus(db, event.id, "processing");
  let extraction: Awaited<
    ReturnType<NonNullable<AiProvider["extractExpenseFromImage"]>>
  >;
  try {
    extraction = await provider.extractExpenseFromImage({
      base64Image,
      mimeType,
    });
  } catch (err) {
    await logAiCallError(db, err, {
      businessEventId: event.id,
      documentId,
      operation: "extractExpenseFromImage",
    });
    await setBusinessEventStatus(db, event.id, "queued");
    return {
      kind: "queued_offline",
      event: { ...event, status: "queued" },
      documentId,
    };
  }
  const { result } = extraction;

  await updateExtractionStatus(db, documentId, result.extractionStatus);

  if (result.extractionStatus === "failed") {
    await setBusinessEventStatus(db, event.id, "needs_clarification");
    return {
      kind: "needs_manual_entry",
      event: { ...event, status: "needs_clarification" },
      documentId,
      prefill: null,
    };
  }

  if (result.extractionStatus === "partial") {
    await setBusinessEventStatus(db, event.id, "needs_clarification");
    return {
      kind: "needs_manual_entry",
      event: { ...event, status: "needs_clarification" },
      documentId,
      prefill: result.extractedFields,
    };
  }

  // 'complete': every field needed is present -- attach data and classify
  // exactly as the text flow would, no owner interaction required first.
  const fields = result.extractedFields;
  if (fields.amount == null || fields.currency == null) {
    // Defensive: a provider claiming 'complete' without the fields the
    // schema requires is a contract violation, not something to guess
    // past. Treat it the same as 'failed' rather than writing a fabricated
    // amount.
    await updateExtractionStatus(db, documentId, "failed");
    await setBusinessEventStatus(db, event.id, "needs_clarification");
    return {
      kind: "needs_manual_entry",
      event: { ...event, status: "needs_clarification" },
      documentId,
      prefill: null,
    };
  }

  const data = await attachExpenseBusinessData(db, {
    eventId: event.id,
    description: fields.description ?? "",
    counterpartyName: fields.counterpartyName ?? undefined,
    amount: fields.amount,
    currency: fields.currency,
    paymentMethod: "unspecified",
  });

  const outcome = await classifyAndRoute(
    db,
    provider,
    { ...event, status: "processing", raw_input_ref: fields.description },
    data,
    { isOnline: true },
  );

  return { kind: "interpreted", documentId, outcome };
}

export async function runExpensePhotoInterpretation(
  db: SqlDb,
  provider: AiProvider,
  input: CapturePhotoInput,
): Promise<PhotoCaptureOutcome> {
  const event = await createQueuedPhotoEvent(db, {
    businessId: input.businessId,
  });
  const { document } = await saveDocument(db, {
    businessEventId: event.id,
    type: "receipt",
    extractionStatus: "not_attempted",
    mimeType: input.mimeType,
    base64Data: input.base64Image,
  });

  if (input.isOnline === false) {
    // Event and Document both already persisted with 'queued'/'not_attempted'
    // -- nothing lost, nothing guessed. resumeQueuedPhotoCaptures (Sprint 9)
    // retries this once connectivity returns.
    return { kind: "queued_offline", event, documentId: document.id };
  }

  return extractAndRoutePhoto(
    db,
    provider,
    event,
    document.id,
    input.base64Image,
    input.mimeType,
  );
}

/**
 * Sprint 9 (Vol 7_4 §4) — retries every photo capture still sitting at
 * `queued` with NO BusinessData yet (extraction was never attempted,
 * either because the owner captured it offline or a prior attempt threw
 * mid-call). Complements `resumeQueuedCaptures`, which only handles
 * events that already reached BusinessData. Re-fetches the stored image
 * bytes from `document_blobs` rather than requiring the owner to
 * re-photograph anything -- the whole point of saving the Document
 * immediately at capture time (Sprint 5).
 */
export async function resumeQueuedPhotoCaptures(
  db: SqlDb,
  provider: AiProvider,
  businessId: string,
): Promise<PhotoCaptureOutcome[]> {
  const pending = await db.queryAll<{ id: string }>(
    `SELECT be.id as id FROM business_events be
     WHERE be.business_id = ? AND be.status = 'queued' AND be.domain_hint = 'expense'
       AND be.capture_mode = 'photo'
       AND NOT EXISTS (SELECT 1 FROM business_data bd WHERE bd.business_event_id = be.id);`,
    [businessId],
  );

  const results: PhotoCaptureOutcome[] = [];
  for (const row of pending) {
    const eventRow = await getBusinessEventById(db, row.id);
    if (!eventRow) continue; // defensive; row just came from business_events itself

    const docs = await listDocumentsForEvent(db, row.id);
    const doc = docs[0];
    if (!doc) continue; // shouldn't happen; nothing to resume without a document

    const blob = await getDocumentBlob(db, doc.file_ref);
    if (!blob) continue;

    results.push(
      await extractAndRoutePhoto(
        db,
        provider,
        eventRow,
        doc.id,
        blob.base64_data,
        blob.mime_type,
      ),
    );
  }
  return results;
}

export interface ResumeSummary {
  resumedCaptures: InterpretationOutcome[];
  resumedPhotos: PhotoCaptureOutcome[];
}

/**
 * Sprint 12 bug-bash finding: `classifyAndRoute` does not mark an event
 * 'processing' before its network call the way `runCaptureInterpretation`
 * does for a fresh capture (Sprint 9 deliberately leaves it 'queued' so a
 * thrown/offline outcome has nothing to undo). That is safe for a single
 * in-flight attempt, but it means two *concurrent* `resumeQueuedWork`
 * passes for the same business (e.g. connectivity flapping
 * offline->online->offline->online faster than one AI round-trip, each
 * transition re-triggering `useAutoResume`) could both select the same
 * still-'queued' event and both call the provider for it. Ledger postings
 * are already protected from that (deterministic id + INSERT OR IGNORE,
 * see ledgerRepository.ts), but `recordAiInterpretation`'s id is
 * timestamp-based with a plain INSERT — a genuine duplicate
 * ai_interpretations row (and a last-write-wins race on the event's
 * final status) was possible without this guard. Fixed with the simplest
 * correct tool for a single-threaded JS runtime: an in-process
 * per-business in-flight flag, so a second overlapping call for the same
 * business is a safe no-op (returns empty results) instead of a second
 * concurrent pass. Does not change the intentional retry-a-stuck-
 * 'processing'-event recovery semantics (Vol 7_4 §4) at all -- those
 * still resume normally on the NEXT (non-overlapping) call.
 */
const resumeInFlight = new Set<string>();

export async function resumeQueuedWork(
  db: SqlDb,
  provider: AiProvider,
  businessId: string,
): Promise<ResumeSummary> {
  if (resumeInFlight.has(businessId)) {
    return { resumedCaptures: [], resumedPhotos: [] };
  }
  resumeInFlight.add(businessId);
  try {
    const [resumedCaptures, resumedPhotos] = await Promise.all([
      resumeQueuedCaptures(db, provider, businessId),
      resumeQueuedPhotoCaptures(db, provider, businessId),
    ]);
    return { resumedCaptures, resumedPhotos };
  } finally {
    resumeInFlight.delete(businessId);
  }
}

export interface CompletePhotoCaptureInput {
  eventId: string;
  description: string;
  counterpartyName?: string;
  amount: number;
  currency: string;
  paymentMethod: PaymentMethod;
}

/**
 * Owner completes the Vol 7_1 §5.1 fallback form for a photo event that
 * had 'failed' or 'partial' extraction — attaches the (now complete)
 * BusinessData and runs the same classification/routing as every other
 * path. Expense-only, same as the rest of the photo flow. This is the
 * photo-flow counterpart to runCaptureInterpretation for text, sharing
 * classifyAndRoute rather than duplicating it.
 */
export async function completePhotoCapture(
  db: SqlDb,
  provider: AiProvider,
  input: CompletePhotoCaptureInput,
): Promise<InterpretationOutcome> {
  const data = await attachExpenseBusinessData(db, input);
  await setBusinessEventStatus(db, input.eventId, "processing");
  const eventRow = await getActivityItemByEventId(db, input.eventId);
  if (!eventRow) {
    throw new Error(`Business Event '${input.eventId}' not found.`);
  }
  return classifyAndRoute(
    db,
    provider,
    {
      ...eventRow.event,
      status: "processing",
      raw_input_ref: input.description,
    },
    data,
  );
}
