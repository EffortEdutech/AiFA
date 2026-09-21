/**
 * AI pipeline types — Vol 3_1 (KRCE / PCB contract), Vol 11_1 §6 (Phase 1
 * minimal PCB), Vol 5_2 §4.1 (single orchestrated pipeline, not agents).
 *
 * Sprint 6: generalised from Expense-only naming to cover all three
 * AI-interpreted Phase 1 domains (expense, sale, purchase) sharing one
 * pipeline shape, per Vol 6_0 §4 ("shared engine, domain-scoped rules").
 * Photo/vision capture (Sprint 5) remains Expense-only — see
 * capturePipeline.ts's photo functions — so vision types keep their
 * Expense-specific names.
 */

/**
 * Sprint 57 (Phase 5, 14 September 2026 revision — Vol_5_5 §7): widened from
 * the original 5 values (expense/sale/purchase/leave_application/
 * unclassified) to cover every domain the owner's full-module objective
 * names. The new members below have NO Path B RPC or ledger-posting
 * behaviour yet — Sprints 58-60 give each one a real destination
 * (draft-then-approve, per those sprints' own scope); until then, a
 * `classifyPathBIntake` result carrying one of them still lands in
 * `unclassified`/Capture Triage exactly like any domain this codebase
 * doesn't yet have a bridge for (see inputRouter.ts). Adding a domain
 * literal here is deliberately decoupled from having somewhere for it to
 * go — the alternative (only adding a domain the moment its bridge sprint
 * ships) would mean Sprint 57's classifier can never be tested against the
 * owner's real full domain list until every later sprint is already done.
 */
export type BusinessDomain =
  | "expense"
  | "sale"
  | "purchase"
  | "leave_application"
  | "purchase_order"
  | "delivery_order"
  | "stock_adjustment"
  | "commission"
  | "attendance_correction"
  | "e_invoice_flag"
  | "contract_alert"
  | "e_signature_request"
  | "unclassified";

/**
 * Sprint 53 (Phase 5, Vol_5_5 §7): the ORIGINAL three-domain subset that
 * actually goes through AI ledger classification (`capturePipeline.ts`'s
 * `classifyAndRoute`, `pcb.ts`'s category lists). `leave_application` and
 * `unclassified` are real `BusinessDomain` values the Universal Input
 * Router (Vol_5_5) can detect, but neither has a chart-of-accounts
 * category or a ledger posting — they are resolved through their own
 * dedicated flow instead (see `inputRouter.ts` / `CaptureRouterPage.tsx`),
 * never through `classifyAndRoute`. Kept as its own named type rather
 * than inlining the three-way union everywhere it's needed, so a future
 * domain addition to `BusinessDomain` doesn't silently need to also be
 * ledger-classifiable to type-check.
 */
export type AiLedgerDomain = "expense" | "sale" | "purchase";

export interface CapturePcbInput {
  domain: AiLedgerDomain;
  businessEventId: string;
  businessDataId: string;
  description: string;
  counterpartyName: string | null;
  amount: number;
  currency: string;
  paymentMethod: string;
}

/**
 * Phase 1 minimal PCB — Vol 11_1 §6. The full Vol 3_1 §4 contract (ontology
 * concepts, governance metadata, token budget, etc.) is the target shape;
 * this is the honest reduced subset, not a different contract.
 */
/**
 * Sprint 10 security audit finding (Vol 8_2 Section 3, Vol 3_1 Section 4,
 * Vol 11_1 Section 6): "security classification" is a REQUIRED PCB field
 * even in Phase 1's minimal-field form -- Vol 11_1 Section 6 says so
 * explicitly ("remain required... nothing here is skipped for being
 * hard, only for being premature"). This type omitted it entirely until
 * now, a genuine gap, not a documented simplification. Phase 1 has no
 * high-sensitivity domain implemented yet (payroll is Vol 6_7, unbuilt --
 * Phase 2/3), so every Phase 1 PCB is correctly "standard" today; the
 * field exists now so KRCE (pcb.ts) has somewhere honest to put the
 * classification the moment a higher-sensitivity domain is added, rather
 * than bolting it on under time pressure later.
 */
export type PcbSensitivityClassification = "standard" | "high";

export interface ProfessionalContextBundle {
  user_intent: string;
  relevant_rules: string[]; // Finance PKA rule IDs, e.g. "EXP-001", "SALE-001"
  business_context: Record<string, unknown>;
  financial_context: Record<string, unknown>;
  source_references: string[]; // BusinessEvent id(s)
  pka_version: string;
  limitations: string[];
  /** Vol 3_1 Section 4's required "Security classification" field -- see PcbSensitivityClassification's own comment above. */
  sensitivity_classification: PcbSensitivityClassification;
}

export interface CategoryClassificationResult {
  /** One of the current domain's chart-of-accounts categories, or null when the model could not confidently pick one. */
  category: string | null;
  /** 0.0-1.0 */
  confidence: number;
  reasoning: string;
  /** Populated when confidence is expected to fall below the clarify threshold; still optional here since routing is the pipeline's job, not the provider's. */
  clarifying_question: string | null;
  matched_rule_ids: string[];
}

export interface AiClassificationMetrics {
  latencyMs: number;
  /** Directional estimate, not billing-accurate — see anthropicProvider.ts. Null when usage data isn't available (e.g. a test double). */
  estimatedCostUsd: number | null;
  model: string;
}

/**
 * Structured fields a vision-capable provider was able to read off a
 * receipt/invoice image (Vol 7_1 §5.1). Any field can be null — that's the
 * "partial success" case, e.g. amount unreadable on a faded receipt.
 * Photo capture is Expense-only as of Sprint 6 — this type isn't
 * domain-parameterised.
 */
export interface VisionExtractedFields {
  description: string | null;
  counterpartyName: string | null;
  amount: number | null;
  currency: string | null;
}

export interface VisionExtractionResult {
  extractedFields: VisionExtractedFields;
  /**
   * 'complete': every field needed to classify was read confidently.
   * 'partial': some fields read, at least one missing/unreadable.
   * 'failed': nothing usable was read (Vol 7_1 §5.1's first failure mode).
   */
  extractionStatus: "complete" | "partial" | "failed";
}

export interface VisionExtractionInput {
  base64Image: string;
  mimeType: string;
  /**
   * Sprint 55 (Phase 5, Universal Media & Voice Intake Foundation) —
   * defaults to "image" when omitted, matching every existing call site
   * (Sprint 5/6's photo capture never set this field). "pdf" is new this
   * sprint: a provider implementing this method must branch its own
   * request-construction logic per `kind` (Anthropic's real Messages API
   * uses a different content-block type for PDF vs. image input) — see
   * `anthropicProvider.ts`'s own header for what's actually wired up
   * versus disclosed-as-unverified.
   */
  kind?: "image" | "pdf";
}

/**
 * Sprint 55 — a forwarded/shared voice note, pre-transcription. Kept
 * separate from VisionExtractionInput (not a third `kind`) because
 * transcription and vision extraction are genuinely different
 * capabilities a provider may support independently of one another.
 */
export interface AudioTranscriptionInput {
  base64Audio: string;
  mimeType: string;
}

/**
 * A transcribed voice note becomes plain text and re-enters the EXACT
 * SAME text classification path every other text intake already uses
 * (`classifyChannelIntakeDomain`) — this type only carries the
 * transcript itself, never a domain guess of its own.
 */
export interface AudioTranscriptionResult {
  transcript: string | null;
  /** 'failed' covers both "no speech recognised" and a hard provider error — Vol 7_1 §5.1's own "extraction fails entirely" honesty pattern, extended to audio. */
  status: "complete" | "failed";
}

/**
 * Sprint 7 — AI Workspace (Vol 7_2) free-form Q&A result. Field names are
 * snake_case to mirror the raw model JSON response shape directly, same
 * convention as CategoryClassificationResult.
 */
export interface WorkspaceAnswerResult {
  answer: string;
  /**
   * BusinessEvent ids the answer is grounded in (Vol 7_2 §4 explainability
   * surface), or a short descriptive string for a pure computation with no
   * single source event (e.g. "cash_position"). Empty when out_of_scope is
   * true.
   */
  sources: string[];
  /** True when the question cannot be answered from the governed financial_context (Vol 1_4 §7) -- the provider must set this explicitly rather than guessing an answer. */
  out_of_scope: boolean;
}

/**
 * Sprint 57 (Phase 5, 14 September 2026) — a NEW capability, distinct from
 * `classify()` below. `classify()` picks a category WITHIN an
 * already-known domain (`event.domain_hint`, decided before it is ever
 * called); nothing in this codebase previously looked at raw text and
 * decided WHICH domain it belongs to in the first place — that gap is what
 * `classifyDomain` fills. See inputRouter.ts's `classifyPathBIntake` for
 * the caller that uses this, and Sprint 57's own sprint-plan document
 * (CORRECTION #2) for why this is a new method rather than a reuse of
 * `classify()`.
 */
export interface DomainClassificationInput {
  /** Raw captured text, or a short synthesised description of already-extracted fields (e.g. from a photo/PDF/voice capture) — either way, plain text the model reads directly. */
  rawText: string;
  /** The domains this call is allowed to choose from — always the full current `BusinessDomain` list minus `unclassified` (the model should say "unclassified" by returning a null/low-confidence result, not by being offered it as a target). */
  candidateDomains: BusinessDomain[];
}

export interface DomainClassificationResult {
  /** Null when the model itself could not confidently place the text in any candidate domain — distinct from a low-confidence guess (Vol_5_5 §7's "clarify rather than guess" principle, applied here to domain instead of category). */
  domain: BusinessDomain | null;
  /** 0.0-1.0 */
  confidence: number;
  reasoning: string;
  /** Whatever structured fields the model could read off the text for the chosen domain (amount, counterparty, dates, line items) — shape varies by domain; downstream domain-bridge sprints (58-60) are what actually consume specific fields, this call only reports what it saw. */
  extractedFields: Record<string, unknown>;
}

/**
 * A provider is a single classify call — deliberately not split into
 * separate agents (Vol 5_2 §4.1 Phase 1 scope; splitting is a Phase 2
 * decision per the Sprint 3 risk register). classify() is domain-agnostic:
 * the PCB it receives already carries the candidate categories/rules for
 * whichever domain (expense/sale/purchase) the caller is classifying, per
 * Vol 3_1's "the PCB is the enforcement boundary" principle — the provider
 * itself does not need to know which domain it's classifying.
 */
export interface AiProvider {
  readonly name: string;
  classify(pcb: ProfessionalContextBundle): Promise<{
    result: CategoryClassificationResult;
    metrics: AiClassificationMetrics;
  }>;
  /**
   * Optional — Sprint 57. A provider without a real domain-classification
   * capability simply omits this method; the caller (`inputRouter.ts`'s
   * `classifyPathBIntake`) falls back to the existing
   * `classifyChannelIntakeDomain` regex heuristic — the same "missing
   * capability is an honest, handled case, never a silent drop" pattern
   * `extractExpenseFromImage`/`transcribeAudio` already use below.
   */
  classifyDomain?(input: DomainClassificationInput): Promise<{
    result: DomainClassificationResult;
    metrics: AiClassificationMetrics;
  }>;
  /**
   * Optional — a provider without vision capability simply omits this
   * method. The photo pipeline treats a missing method exactly like
   * extractionStatus 'failed': an honest instance of Vol 7_1 §5.1's
   * "OCR/vision extraction fails entirely" case, not a special code path.
   * Still Expense-only (photo capture is not extended to Sale/Purchase
   * this sprint — see capturePipeline.ts).
   */
  extractExpenseFromImage?(input: VisionExtractionInput): Promise<{
    result: VisionExtractionResult;
    metrics: AiClassificationMetrics;
  }>;
  /**
   * Optional — Sprint 55. A provider without real speech-to-text capability
   * simply omits this method; the caller (`pathBMediaExtraction.ts`) treats
   * a missing method as an honest "voice transcription isn't configured
   * yet" outcome — never a silent drop, never a guessed transcript. As of
   * this sprint, NEITHER shipped provider (`AnthropicExpenseProvider`,
   * `GatewayExpenseProvider`) implements this: transcription needs a real
   * speech-to-text vendor decision (a distinct capability from Claude's
   * text/vision calls), which is the owner's own call to make, same class
   * of decision as Phase 3's e-Invoice/WhatsApp external-account
   * dependencies — not something to silently pick on their behalf.
   */
  transcribeAudio?(input: AudioTranscriptionInput): Promise<{
    result: AudioTranscriptionResult;
    metrics: AiClassificationMetrics;
  }>;
  /**
   * Optional — Sprint 7's AI Workspace (Vol 7_2) free-form Q&A. A provider
   * without real reasoning capability simply omits this method;
   * workspacePipeline.ts treats a missing method as an honest "no
   * open-ended answering available" response, distinct from out_of_scope
   * (which means a capable provider evaluated the question and declined
   * it). LocalHeuristicExpenseProvider DOES implement this — via a small
   * keyword-routed pattern set, not real reasoning — see that file.
   */
  answerFinancialQuestion?(input: {
    pcb: ProfessionalContextBundle;
    question: string;
  }): Promise<{
    result: WorkspaceAnswerResult;
    metrics: AiClassificationMetrics;
  }>;
}
