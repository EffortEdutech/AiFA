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
 * Vision (extractExpenseFromImage) — Sprint 55 (Phase 5, Universal Media &
 * Voice Intake Foundation): implemented against a NEW, NOT YET BUILT
 * Gateway route, `POST {gatewayUrl}/ai-vision`, documented in full below.
 * The Gateway service lives in a separate repo (`ai-gateway-service`) this
 * codebase's own sessions cannot reach — this method is the AiFA-side half
 * of the contract, written so whoever builds the matching Gateway route can
 * do so against a concrete spec instead of a verbal description. Until that
 * route exists, every call here fails (404 or similar), which
 * `compositeProvider.ts` (Sprint 55 update) surfaces honestly rather than
 * silently swallowing — there is no local-heuristic vision fallback to
 * degrade to, unlike classify()'s Gateway-then-local pattern.
 *
 * REQUIRED GATEWAY CONTRACT for POST {gatewayUrl}/ai-vision:
 *   Headers: authorization: Bearer <supabase access token>, x-app-id: <appId>
 *   Body:    { provider: string, model: string, kind: "image" | "pdf",
 *              mimeType: string, base64Data: string, promptText: string }
 *            promptText is this file's own buildVisionPrompt() output, sent
 *            verbatim — the Gateway does NOT need its own copy of the
 *            prompt; it only assembles one multimodal message (the
 *            image/document block plus a text block containing
 *            promptText) and calls the model, exactly like /ai-chat
 *            already does for plain text. Keeps all prompt engineering in
 *            this repo's promptBuilders.ts as the single source of truth.
 *   Success: 200 { content: string } — content is the RAW model text
 *            response (same shape /ai-chat already returns); this file
 *            parses it locally via parseVisionExtractionJson(), exactly
 *            mirroring how classify() parses /ai-chat's content with
 *            parseClassificationJson() — the Gateway does NOT parse the
 *            model's JSON itself, it only proxies the model call, same
 *            division of responsibility /ai-chat already uses.
 *            Internally the Gateway should send kind:"pdf" as an Anthropic
 *            "document" content block and kind:"image" as an "image" block
 *            (see anthropicProvider.ts's own Sprint 55 addition for the
 *            exact branch this mirrors).
 *   Errors:  same convention as /ai-chat (non-2xx + response body text).
 *
 * transcribeAudio is NOT implemented here either, for a different reason:
 * this requires a real speech-to-text vendor decision on the Gateway's own
 * side (Claude has no raw-audio-input capability at all — see
 * anthropicProvider.ts's equivalent note), not just a missing route to add
 * against a known model capability.
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
  DomainClassificationInput,
  DomainClassificationResult,
  ProfessionalContextBundle,
  VisionExtractionInput,
  VisionExtractionResult,
  WorkspaceAnswerResult,
} from "../types";
import {
  buildDomainClassificationPrompt,
  buildPrompt,
  buildVisionPrompt,
  buildWorkspacePrompt,
  parseClassificationJson,
  parseDomainClassificationJson,
  parseVisionExtractionJson,
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
      options.provider ??
      (typeof process !== "undefined"
        ? process.env.EXPO_PUBLIC_AI_PROVIDER
        : undefined) ??
      "anthropic";
    this.model =
      options.model ??
      (typeof process !== "undefined"
        ? process.env.EXPO_PUBLIC_AI_MODEL
        : undefined) ??
      DEFAULT_MODEL;
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

  /**
   * Sprint 57 (Phase 5, 14 September 2026) — unlike `extractExpenseFromImage`
   * below, this does NOT need a new Gateway server route: it reuses the
   * exact same `/ai-chat` route `classify()` already calls via `chat()`,
   * just with a different prompt/parser pair (`buildDomainClassificationPrompt`/
   * `parseDomainClassificationJson`). Worth stating plainly since Sprint 55's
   * vision work established the pattern "new AI capability = new Gateway
   * route," which does not hold here.
   */
  async classifyDomain(input: DomainClassificationInput): Promise<{
    result: DomainClassificationResult;
    metrics: AiClassificationMetrics;
  }> {
    const startedAt = Date.now();
    const { content } = await this.chat([
      {
        role: "user",
        content: buildDomainClassificationPrompt(input.rawText, input.candidateDomains),
      },
    ]);
    const result = parseDomainClassificationJson(content, input.candidateDomains);
    return {
      result,
      metrics: {
        latencyMs: Date.now() - startedAt,
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

  /**
   * Sprint 55 — see this file's header for the full required Gateway
   * contract (`POST {gatewayUrl}/ai-vision`), which does not exist yet on
   * the Gateway side as of this writing. Calls here will fail until that
   * route is built; this method's job is only to be ready the moment it
   * is, not to work around its absence.
   */
  async extractExpenseFromImage(input: VisionExtractionInput): Promise<{
    result: VisionExtractionResult;
    metrics: AiClassificationMetrics;
  }> {
    const startedAt = Date.now();
    const token = await this.getAccessToken();
    if (!token) {
      throw new Error(
        "GatewayExpenseProvider.extractExpenseFromImage called with no Supabase session — " +
          "the caller must check for a signed-in session before selecting this provider.",
      );
    }

    const response = await fetch(`${this.gatewayUrl}/ai-vision`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${token}`,
        "x-app-id": this.appId,
      },
      body: JSON.stringify({
        provider: this.provider,
        model: this.model,
        kind: input.kind ?? "image",
        mimeType: input.mimeType,
        base64Data: input.base64Image,
        promptText: buildVisionPrompt(),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `AI Gateway vision request failed (${response.status}): ${errorText}`,
      );
    }

    const payload = (await response.json()) as { content?: string };
    const result = parseVisionExtractionJson(payload.content ?? "");
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
