/**
 * Real AI provider — Vol 11_0 §4 ("a single cloud-hosted frontier model
 * accessed via API ... model choice is a build-time config, not
 * hardcoded"). Not exercised by the test suite: it needs a real network
 * call and a real API key, neither available in the build sandbox this
 * project was scaffolded in.
 *
 * SECURITY: the API key is read from an environment variable at runtime,
 * never hardcoded, never logged, never committed. Set
 * EXPO_PUBLIC_AI_API_KEY in your local .env (see .env.example) — do not
 * ask an AI assistant to fetch, guess, or print this value, and do not
 * ship a real key inside a production client bundle (route through a
 * small backend function before general release; direct-from-app calls
 * are acceptable for early local development only, per app/README.md).
 *
 * Sprint 6 (AI Gateway migration): this is exactly the risk gatewayProvider.ts
 * fixes for classify()/answerFinancialQuestion() once a Supabase session and
 * EXPO_PUBLIC_AI_GATEWAY_URL are configured — see client.ts's factory. This
 * class stays in use for extractExpenseFromImage() (photo/receipt capture),
 * since the Gateway has no multimodal /ai-chat support yet, and as the
 * signed-out/no-Gateway-configured fallback for classify()/
 * answerFinancialQuestion() too.
 *
 * Prompt construction and response parsing now live in promptBuilders.ts
 * (shared with gatewayProvider.ts) — this file no longer defines its own
 * copies.
 */
import type {
  AiProvider,
  ProfessionalContextBundle,
  VisionExtractionInput,
} from "../types";
import {
  buildPrompt,
  buildVisionPrompt,
  buildWorkspacePrompt,
  parseClassificationJson,
  parseVisionExtractionJson,
  parseWorkspaceAnswerJson,
} from "./promptBuilders";

const API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-5";

// Anthropic's published per-token pricing changes over time and isn't
// returned by the API itself beyond raw token counts, so this is a rough,
// override-able estimate for the Sprint 3 "cost-per-event measured and
// logged" requirement — directional for tuning the confidence thresholds
// against real usage, not billing-accurate. Override via env if needed.
const DEFAULT_INPUT_COST_PER_1K_USD = Number(
  process.env.EXPO_PUBLIC_AI_INPUT_COST_PER_1K ?? "0.003",
);
const DEFAULT_OUTPUT_COST_PER_1K_USD = Number(
  process.env.EXPO_PUBLIC_AI_OUTPUT_COST_PER_1K ?? "0.015",
);

/**
 * Class name kept as "AnthropicExpenseProvider" from Sprint 3 even though
 * classify() now handles Sale and Purchase too (Sprint 6) — renaming
 * would touch client.ts and every provider import for a cosmetic gain
 * only; flagged in app/README.md as a known, low-priority naming leftover.
 */
export class AnthropicExpenseProvider implements AiProvider {
  readonly name = "anthropic";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(options?: { apiKey?: string; model?: string }) {
    const apiKey = options?.apiKey ?? process.env.EXPO_PUBLIC_AI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Missing AI provider API key. Set EXPO_PUBLIC_AI_API_KEY in your local .env (see .env.example) before using AnthropicExpenseProvider. This is never inferred or fetched automatically — see the project's operating protocol.",
      );
    }
    this.apiKey = apiKey;
    this.model =
      options?.model ?? process.env.EXPO_PUBLIC_AI_MODEL ?? DEFAULT_MODEL;
  }

  async classify(pcb: ProfessionalContextBundle) {
    const startedAt = Date.now();

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 512,
        messages: [{ role: "user", content: buildPrompt(pcb) }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `AI provider request failed (${response.status}): ${errorText}`,
      );
    }

    const payload = (await response.json()) as {
      content?: { text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const latencyMs = Date.now() - startedAt;
    const text = payload.content?.[0]?.text ?? "";
    const result = parseClassificationJson(text);

    const usage = payload.usage;
    const estimatedCostUsd =
      usage?.input_tokens != null && usage?.output_tokens != null
        ? (usage.input_tokens / 1000) * DEFAULT_INPUT_COST_PER_1K_USD +
          (usage.output_tokens / 1000) * DEFAULT_OUTPUT_COST_PER_1K_USD
        : null;

    return {
      result,
      metrics: { latencyMs, estimatedCostUsd, model: this.model },
    };
  }

  async extractExpenseFromImage(input: VisionExtractionInput) {
    const startedAt = Date.now();

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 512,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: input.mimeType,
                  data: input.base64Image,
                },
              },
              { type: "text", text: buildVisionPrompt() },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `AI provider vision request failed (${response.status}): ${errorText}`,
      );
    }

    const payload = (await response.json()) as {
      content?: { text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const latencyMs = Date.now() - startedAt;
    const text = payload.content?.[0]?.text ?? "";
    const result = parseVisionExtractionJson(text);

    const usage = payload.usage;
    const estimatedCostUsd =
      usage?.input_tokens != null && usage?.output_tokens != null
        ? (usage.input_tokens / 1000) * DEFAULT_INPUT_COST_PER_1K_USD +
          (usage.output_tokens / 1000) * DEFAULT_OUTPUT_COST_PER_1K_USD
        : null;

    return {
      result,
      metrics: { latencyMs, estimatedCostUsd, model: this.model },
    };
  }

  async answerFinancialQuestion({
    pcb,
    question,
  }: {
    pcb: ProfessionalContextBundle;
    question: string;
  }) {
    const startedAt = Date.now();

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 512,
        messages: [
          { role: "user", content: buildWorkspacePrompt(pcb, question) },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `AI Workspace request failed (${response.status}): ${errorText}`,
      );
    }

    const payload = (await response.json()) as {
      content?: { text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const latencyMs = Date.now() - startedAt;
    const text = payload.content?.[0]?.text ?? "";
    const result = parseWorkspaceAnswerJson(text);

    const usage = payload.usage;
    const estimatedCostUsd =
      usage?.input_tokens != null && usage?.output_tokens != null
        ? (usage.input_tokens / 1000) * DEFAULT_INPUT_COST_PER_1K_USD +
          (usage.output_tokens / 1000) * DEFAULT_OUTPUT_COST_PER_1K_USD
        : null;

    return {
      result,
      metrics: { latencyMs, estimatedCostUsd, model: this.model },
    };
  }
}
