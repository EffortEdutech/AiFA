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
 */
import type {
  AiClassificationMetrics,
  AiProvider,
  CategoryClassificationResult,
  ProfessionalContextBundle,
  VisionExtractionInput,
  WorkspaceAnswerResult,
} from "../types";

export class GatewayOrLocalExpenseProvider implements AiProvider {
  readonly name = "gateway-or-local";
  readonly extractExpenseFromImage?: AiProvider["extractExpenseFromImage"];

  private readonly gateway: AiProvider;
  private readonly local: AiProvider;
  private readonly hasSession: () => Promise<boolean>;

  constructor(
    gateway: AiProvider,
    local: AiProvider,
    // Optional — when set (EXPO_PUBLIC_AI_API_KEY still configured), photo/
    // receipt extraction keeps using the direct Anthropic call until the
    // Gateway supports multimodal messages. See gatewayProvider.ts's file
    // comment.
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
    this.hasSession = hasSession;
    if (vision?.extractExpenseFromImage) {
      this.extractExpenseFromImage = (input: VisionExtractionInput) =>
        vision.extractExpenseFromImage!(input);
    }
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
