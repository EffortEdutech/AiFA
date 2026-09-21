/**
 * Selects Gateway vs. local-heuristic classification per call, based on
 * whether a Supabase session currently exists — preserves AiFA's
 * local-first principle (Vol 4_4 §2: a signed-out owner can still capture
 * and classify, just via the existing placeholder heuristic, exactly like
 * today's "no key configured" case) while giving signed-in owners real
 * Gateway-backed classification without exposing a provider key in the
 * client bundle.
 *
 * A Gateway call that fails at runtime (network blip, rate limit, Gateway
 * outage, no credential configured yet) also falls back to the local
 * heuristic rather than surfacing a hard error to the owner — the same
 * resilience posture the app already has for "no key configured", just
 * decided per-call instead of once at app startup.
 *
 * Sprint 55 (Universal Media & Voice Intake Foundation) — vision
 * (extractExpenseFromImage) now follows a Gateway-first-then-injected-
 * vision-provider order, mirroring classify()'s Gateway-then-local shape as
 * closely as the two capabilities allow. UNLIKE classify(), there is no
 * local-heuristic vision fallback to degrade to (LocalHeuristicExpenseProvider
 * has no camera/OCR logic at all) — so a Gateway failure falls back to the
 * injected `vision` provider (mobile's existing direct-key
 * AnthropicExpenseProvider) if one was supplied, and only throws when
 * NEITHER path is available, an honest error rather than a silent no-op.
 * Until the Gateway's own `/ai-vision` route exists (see gatewayProvider.ts's
 * header for the full contract it's missing), every signed-in Gateway
 * attempt will fail and fall through to `vision` — exactly the intended
 * behaviour for a not-yet-built route, not a bug to work around here.
 */
import type {
  AiClassificationMetrics,
  AiProvider,
  CategoryClassificationResult,
  DomainClassificationInput,
  DomainClassificationResult,
  ProfessionalContextBundle,
  VisionExtractionInput,
  VisionExtractionResult,
  WorkspaceAnswerResult,
} from "../types";

export class GatewayOrLocalExpenseProvider implements AiProvider {
  readonly name = "gateway-or-local";

  private readonly gateway: AiProvider;
  private readonly local: AiProvider;
  private readonly vision?: AiProvider;
  private readonly hasSession: () => Promise<boolean>;

  constructor(
    gateway: AiProvider,
    local: AiProvider,
    // Optional — mobile's existing direct-key AnthropicExpenseProvider
    // (photo/receipt capture, Sprint 5/6). Sprint 55: no longer the ONLY
    // vision path — see this file's header for the new Gateway-first order.
    // On web this is simply omitted (aiProvider.ts's own comment: "no
    // vision provider on web this sprint" predates Sprint 55, since fixed —
    // web now reaches vision via the Gateway path this class adds).
    vision?: AiProvider,
    // Injected rather than imported directly (Sprint 13, @aifa/core
    // extraction): this class lives in @aifa/core and must not depend on
    // the mobile app's lib/auth.ts. The caller (app/src/ai/client.ts)
    // supplies a closure over its own session check. Defaults to "no
    // session" so a caller that forgets to pass one degrades safely to the
    // local-only path rather than throwing.
    hasSession: () => Promise<boolean> = async () => false,
  ) {
    this.gateway = gateway;
    this.local = local;
    this.vision = vision;
    this.hasSession = hasSession;
  }

  /**
   * Sprint 55 — see this file's header for the Gateway-first-then-injected-
   * vision order and why there is no local-heuristic fallback here.
   */
  async extractExpenseFromImage(
    input: VisionExtractionInput,
  ): Promise<{ result: VisionExtractionResult; metrics: AiClassificationMetrics }> {
    if ((await this.hasSession()) && this.gateway.extractExpenseFromImage) {
      try {
        return await this.gateway.extractExpenseFromImage(input);
      } catch (err) {
        console.warn(
          "GatewayOrLocalExpenseProvider: Gateway extractExpenseFromImage() failed, falling back to the injected vision provider if one exists.",
          err,
        );
      }
    }
    if (this.vision?.extractExpenseFromImage) {
      return this.vision.extractExpenseFromImage(input);
    }
    throw new Error(
      "No vision capability available: not signed in to a Gateway session and no direct vision provider was configured for this platform.",
    );
  }

  async classify(pcb: ProfessionalContextBundle): Promise<{
    result: CategoryClassificationResult;
    metrics: AiClassificationMetrics;
  }> {
    if (await this.hasSession()) {
      try {
        return await this.gateway.classify(pcb);
      } catch (err) {
        console.warn(
          "GatewayOrLocalExpenseProvider: Gateway classify() failed, falling back to local heuristic.",
          err,
        );
      }
    }
    return this.local.classify(pcb);
  }

  /**
   * Sprint 57 (Phase 5, 14 September 2026) — Gateway-only, no local
   * fallback inside this class, mirroring `extractExpenseFromImage`'s
   * pattern above rather than `classify()`'s: `LocalHeuristicExpenseProvider`
   * has no real domain-classification logic to fall back to (same reason
   * it has no vision logic). Throwing here is the correct, honest outcome
   * when not signed in or when the Gateway call fails — the caller
   * (`inputRouter.ts`'s `classifyPathBIntake`) is what actually degrades
   * gracefully, to the regex heuristic, one layer up; this class does not
   * need to duplicate that fallback itself.
   */
  async classifyDomain(input: DomainClassificationInput): Promise<{
    result: DomainClassificationResult;
    metrics: AiClassificationMetrics;
  }> {
    if ((await this.hasSession()) && this.gateway.classifyDomain) {
      return this.gateway.classifyDomain(input);
    }
    throw new Error(
      "No domain-classification capability available: not signed in to a Gateway session (or the configured Gateway provider does not implement classifyDomain).",
    );
  }

  async answerFinancialQuestion(input: {
    pcb: ProfessionalContextBundle;
    question: string;
  }): Promise<{ result: WorkspaceAnswerResult; metrics: AiClassificationMetrics }> {
    if ((await this.hasSession()) && this.gateway.answerFinancialQuestion) {
      try {
        return await this.gateway.answerFinancialQuestion(input);
      } catch (err) {
        console.warn(
          "GatewayOrLocalExpenseProvider: Gateway answerFinancialQuestion() failed, falling back to local heuristic.",
          err,
        );
      }
    }
    if (this.local.answerFinancialQuestion) {
      return this.local.answerFinancialQuestion(input);
    }
    throw new Error(
      "Neither the Gateway provider nor the local provider implements answerFinancialQuestion().",
    );
  }
}
