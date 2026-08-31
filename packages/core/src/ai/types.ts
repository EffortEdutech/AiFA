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

/** The three Phase 1 domains that go through AI classification. Banking (Sprint 7) is not included yet. */
export type BusinessDomain = "expense" | "sale" | "purchase";

export interface CapturePcbInput {
  domain: BusinessDomain;
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
