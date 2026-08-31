/**
 * Gateway-backed AI provider — routes classify() and answerFinancialQuestion()
 * through the centralized AI Gateway (separate repo: ai-gateway-service)
 * instead of calling Anthropic directly. This is the real fix for
 * AnthropicExpenseProvider's documented risk: EXPO_PUBLIC_AI_API_KEY is a
 * public Expo env var, which means it ships inside the client bundle and is
 * extractable by anyone who unpacks the app (see anthropicProvider.ts's own
 * SECURITY comment). The Gateway holds the real provider key encrypted
 * server-side; this app only ever holds a short-lived Supabase session token.
 *
 * Not built on `@platform/ai-sdk` (the Gateway's own client package) — that
 * package isn't published anywhere this separate repo can `npm install` from
 * yet (open item on the Gateway's own sprint plan, Sprint 6). This talks the
 * same wire protocol directly via fetch, matching anthropicProvider.ts's
 * existing style, and can be swapped for the real SDK later without changing
 * this provider's external AiProvider shape.
 *
 * Vision (extractExpenseFromImage) is intentionally NOT implemented here —
 * the Gateway's /ai-chat only accepts plain-text message content today, no
 * image blocks. Photo capture keeps using AnthropicExpenseProvider's direct
 * call until the Gateway adds multimodal support — see client.ts's factory
 * and compositeProvider.ts.
 *
 * Requires:
 *  - AiFA registered as an app in the Gateway's `apps` table (not done yet
 *    as of this writing — the Gateway only knows AIntern so far).
 *  - A BYOK or platform credential configured in the Gateway for whichever
 *    (scope, provider) this app's signed-in users resolve to — without one,
 *    every call fails with 424 no_credential_available, which surfaces here
 *    as a thrown Error and gets caught by compositeProvider.ts's fallback.
 */
import type {
  AiClassificationMetrics,
  AiProvider,
  CategoryClassificationResult,
  ProfessionalContextBundle,
  WorkspaceAnswerResult,
} from "../types";
import {
  buildPrompt,
  buildWorkspacePrompt,
  parseClassificationJson,
  parseWorkspaceAnswerJson,
} from "./promptBuilders";

const DEFAULT_MODEL = "claude-sonnet-4-5";
const DEFAULT_APP_ID = "aifa";

export interface GatewayExpenseProviderOptions {
  /** e.g. https://<gateway-project-ref>.supabase.co/functions/v1 */
  gatewayUrl: string;
  /** Called fresh on every request — never cached — so Supabase's own
   *  autoRefreshToken session handling (supabaseClient.ts) is always
   *  respected, same reasoning as @platform/ai-sdk's getUserToken(). Return
   *  null when there's no signed-in session; the caller (compositeProvider.ts)
   *  is responsible for not calling this provider in that case, but this
   *  provider also fails loudly rather than silently if it happens anyway. */
  getAccessToken: () => Promise<string | null>;
  appId?: string;
  provider?: string;
  model?: string;
}

export class GatewayExpenseProvider implements AiProvider {
  readonly name = "gateway";
  private readonly gatewayUrl: string;
  private readonly appId: string;
  private readonly provider: string;
  private readonly model: string;
  private readonly getAccessToken: () => Promise<string | null>;

  constructor(options: GatewayExpenseProviderOptions) {
    this.gatewayUrl = options.gatewayUrl.replace(/\/+$/, "");
    this.getAccessToken = options.getAccessToken;
    this.appId = options.appId ?? DEFAULT_APP_ID;
    this.provider =
      options.provider ?? process.env.EXPO_PUBLIC_AI_PROVIDER ?? "anthropic";
    this.model =
      options.model ?? process.env.EXPO_PUBLIC_AI_MODEL ?? DEFAULT_MODEL;
  }

  private async chat(
    messages: { role: "user"; content: string }[],
  ): Promise<{ content: string }> {
    const token = await this.getAccessToken();
    if (!token) {
      throw new Error(
        "GatewayExpenseProvider called with no Supabase session — the caller " +
          "must check for a signed-in session before selecting this provider " +
          "(see client.ts's factory / compositeProvider.ts).",
      );
    }

    const response = await fetch(`${this.gatewayUrl}/ai-chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${token}`,
        "x-app-id": this.appId,
      },
      body: JSON.stringify({
        provider: this.provider,
        model: this.model,
        messages,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `AI Gateway request failed (${response.status}): ${errorText}`,
      );
    }

    const payload = (await response.json()) as { content?: string };
    return { content: payload.content ?? "" };
  }

  async classify(pcb: ProfessionalContextBundle): Promise<{
    result: CategoryClassificationResult;
    metrics: AiClassificationMetrics;
  }> {
    const startedAt = Date.now();
    const { content } = await this.chat([
      { role: "user", content: buildPrompt(pcb) },
    ]);
    const result = parseClassificationJson(content);
    return {
      result,
      metrics: {
        latencyMs: Date.now() - startedAt,
        // The Gateway computes and meters real cost server-side
        // (usage_events, Gateway Sprint 4) — this client has no per-token
        // pricing of its own to estimate from, unlike
        // AnthropicExpenseProvider's local DEFAULT_*_COST_PER_1K estimate.
        estimatedCostUsd: null,
        model: this.model,
      },
    };
  }

  async answerFinancialQuestion({
    pcb,
    question,
  }: {
    pcb: ProfessionalContextBundle;
    question: string;
  }): Promise<{ result: WorkspaceAnswerResult; metrics: AiClassificationMetrics }> {
    const startedAt = Date.now();
    const { content } = await this.chat([
      { role: "user", content: buildWorkspacePrompt(pcb, question) },
    ]);
    const result = parseWorkspaceAnswerJson(content);
    return {
      result,
      metrics: {
        latencyMs: Date.now() - startedAt,
        estimatedCostUsd: null,
        model: this.model,
      },
    };
  }
}
