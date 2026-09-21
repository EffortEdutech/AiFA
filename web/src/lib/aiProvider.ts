/**
 * AI provider factory for web — Sprint 18. Deliberately narrower than
 * app/src/ai/client.ts's mobile factory: this file wires ONLY the AI
 * Gateway path (token-based, no secret in the client bundle) or the local
 * heuristic fallback — it never offers AnthropicExpenseProvider's direct-
 * API-key path. That mobile file's own header comment already documents
 * why a direct key is a real exposure risk ("a public Expo env var ships
 * inside the app bundle, extractable by anyone who unpacks it"); a public
 * web bundle is trivially inspectable via browser devtools with no app-
 * store review step in between, making that risk strictly worse on this
 * platform. So: Gateway if configured (VITE_AI_GATEWAY_URL), else the
 * capped-confidence local placeholder — the same honest, no-secret-in-
 * bundle choice, just without the mobile-only escape hatch.
 *
 * Sprint 55 update: image/PDF extraction (extractExpenseFromImage) now
 * works on web too, via the Gateway's /ai-vision route, when signed in. No
 * direct vision provider is injected here (the `undefined` third argument
 * below) — web still has no safe direct-key path, by design, and doesn't
 * need one now that the Gateway route covers it.
 *
 * 2026-09-08 fix: `provider`/`model` are now read from
 * VITE_AI_GATEWAY_PROVIDER / VITE_AI_GATEWAY_MODEL instead of always
 * defaulting to gatewayProvider.ts's hardcoded "anthropic" — that default
 * meant every /ai-chat and /ai-vision call asked the Gateway to resolve an
 * Anthropic credential no matter which provider's BYOK key the signed-in
 * owner had actually added (e.g. a Gemini-only key produced
 * no_credential_available for anthropic on every call, silently). Mirrors
 * the EXPO_PUBLIC_AI_PROVIDER / EXPO_PUBLIC_AI_MODEL convention
 * gatewayProvider.ts's constructor already supports for mobile — this is
 * just web's equivalent, since Vite has no process.env to fall back to.
 */
import { GatewayOrLocalExpenseProvider } from "@aifa/core/ai/providers/compositeProvider";
import { GatewayExpenseProvider } from "@aifa/core/ai/providers/gatewayProvider";
import { LocalHeuristicExpenseProvider } from "@aifa/core/ai/providers/localHeuristicProvider";
import type { AiProvider } from "@aifa/core/ai/types";

import { getCurrentSession } from "./auth";

let cachedProvider: AiProvider | null = null;

export function getDefaultWebProvider(): AiProvider {
  if (cachedProvider) return cachedProvider;

  const gatewayUrl = import.meta.env.VITE_AI_GATEWAY_URL as string | undefined;
  const localFallback = new LocalHeuristicExpenseProvider();

  if (gatewayUrl) {
    const gatewayProvider = new GatewayExpenseProvider({
      gatewayUrl,
      appId: import.meta.env.VITE_AI_GATEWAY_APP_ID as string | undefined,
      provider: import.meta.env.VITE_AI_GATEWAY_PROVIDER as string | undefined,
      model: import.meta.env.VITE_AI_GATEWAY_MODEL as string | undefined,
      getAccessToken: async () =>
        (await getCurrentSession())?.access_token ?? null,
    });
    cachedProvider = new GatewayOrLocalExpenseProvider(
      gatewayProvider,
      localFallback,
      undefined, // no direct-key vision provider on web — Gateway's /ai-vision route (Sprint 55) is the only path, by design
      async () => Boolean(await getCurrentSession()),
    );
    return cachedProvider;
  }

  cachedProvider = localFallback;
  return cachedProvider;
}
