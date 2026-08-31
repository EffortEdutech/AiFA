/**
 * AI provider factory — picks the real cloud provider when configured,
 * otherwise the local placeholder, so the app is runnable without secrets
 * in this repo (Vol 11_0 §4: model choice is a build-time config, not
 * hardcoded).
 *
 * Sprint 6 (AI Gateway migration, text-only phase): when
 * EXPO_PUBLIC_AI_GATEWAY_URL is set, classify() and answerFinancialQuestion()
 * route through the centralized AI Gateway instead of calling Anthropic
 * directly from the client — the real fix for AnthropicExpenseProvider's
 * documented key-exposure risk (a public Expo env var ships inside the app
 * bundle, extractable by anyone who unpacks it). Selection between Gateway
 * and the local heuristic happens per-call, inside
 * GatewayOrLocalExpenseProvider, based on whether a Supabase session exists
 * — not once here — so this factory can stay synchronous, matching all four
 * of its existing call sites (CaptureScreen.tsx, WorkspaceScreen.tsx), none
 * of which currently await it.
 *
 * Photo/receipt extraction (extractExpenseFromImage) is NOT migrated yet —
 * the Gateway has no multimodal /ai-chat support today (plain-text message
 * content only) — so it keeps using AnthropicExpenseProvider's direct call
 * whenever EXPO_PUBLIC_AI_API_KEY is configured, Gateway or not.
 */
import { AnthropicExpenseProvider } from "@aifa/core/ai/providers/anthropicProvider";
import { GatewayOrLocalExpenseProvider } from "@aifa/core/ai/providers/compositeProvider";
import { GatewayExpenseProvider } from "@aifa/core/ai/providers/gatewayProvider";
import { LocalHeuristicExpenseProvider } from "@aifa/core/ai/providers/localHeuristicProvider";
import type { AiProvider } from "@aifa/core/ai/types";

import { getCurrentSession } from "../lib/auth";

let cachedProvider: AiProvider | null = null;

export function getDefaultExpenseProvider(): AiProvider {
  if (cachedProvider) return cachedProvider;

  const gatewayUrl = process.env.EXPO_PUBLIC_AI_GATEWAY_URL;
  const hasDirectKey = Boolean(process.env.EXPO_PUBLIC_AI_API_KEY);
  // Vision stays on the direct Anthropic call regardless of Gateway config
  // — see this file's header comment and gatewayProvider.ts.
  const visionProvider = hasDirectKey
    ? new AnthropicExpenseProvider()
    : undefined;

  if (gatewayUrl) {
    const gatewayProvider = new GatewayExpenseProvider({
      gatewayUrl,
      appId: process.env.EXPO_PUBLIC_AI_GATEWAY_APP_ID,
      getAccessToken: async () =>
        (await getCurrentSession())?.access_token ?? null,
    });
    cachedProvider = new GatewayOrLocalExpenseProvider(
      gatewayProvider,
      new LocalHeuristicExpenseProvider(),
      visionProvider,
      async () => Boolean(await getCurrentSession()),
    );
    return cachedProvider;
  }

  cachedProvider = visionProvider ?? new LocalHeuristicExpenseProvider();
  return cachedProvider;
}
