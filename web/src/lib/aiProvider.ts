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
      getAccessToken: async () =>
        (await getCurrentSession())?.access_token ?? null,
    });
    cachedProvider = new GatewayOrLocalExpenseProvider(
      gatewayProvider,
      localFallback,
      undefined, // no vision provider on web this sprint — file/photo capture is Phase 2b (Vol 12_0 §4)
      async () => Boolean(await getCurrentSession()),
    );
    return cachedProvider;
  }

  cachedProvider = localFallback;
  return cachedProvider;
}
