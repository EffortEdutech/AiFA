/**
 * Minimal client for the Gateway's credential-management endpoints
 * (`/ai-whoami`, `/ai-credentials`) — backs the BYOK settings card in
 * SettingsScreen.tsx. Same style/reasoning as ai/providers/gatewayProvider.ts:
 * talks the wire protocol directly via `fetch` rather than depending on
 * `@platform/ai-sdk`, since that package isn't published anywhere this
 * separate repo can `npm install` from yet.
 *
 * `whoami()` exists because `/ai-credentials`' `personal` scope requires
 * `scope_id === (the caller's Gateway-internal gateway_users.id)`, which is
 * generated server-side on first authenticated call — nothing client-side
 * can know it in advance. `GET /ai-whoami` (added alongside this file) just
 * surfaces what the Gateway's own auth resolution already computed.
 */

export interface GatewayCredentialSummary {
  id: string;
  scope: "personal" | "tenant" | "project";
  scope_id: string;
  provider: string;
  mode: "byok" | "platform" | "local";
  key_version: number;
  key_last4: string | null;
  label: string | null;
  status: "active" | "revoked";
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  last_rotated_at: string | null;
}

export class GatewayCredentialsClient {
  private readonly gatewayUrl: string;
  private readonly appId: string;
  private readonly getAccessToken: () => Promise<string | null>;

  // getAccessToken is injected rather than imported (Sprint 13, @aifa/core
  // extraction): this class lives in @aifa/core and must not depend on the
  // mobile app's lib/auth.ts. The caller (BYOKSettingsCard.tsx) supplies a
  // closure over its own session lookup, matching the pattern
  // gatewayProvider.ts's getAccessToken option already used.
  constructor(options: {
    gatewayUrl: string;
    appId?: string;
    getAccessToken: () => Promise<string | null>;
  }) {
    this.gatewayUrl = options.gatewayUrl.replace(/\/+$/, "");
    this.appId = options.appId ?? "aifa";
    this.getAccessToken = options.getAccessToken;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const accessToken = await this.getAccessToken();
    if (!accessToken) {
      throw new Error("GatewayCredentialsClient requires a signed-in Supabase session.");
    }
    return {
      "content-type": "application/json",
      "authorization": `Bearer ${accessToken}`,
      "x-app-id": this.appId,
    };
  }

  async whoami(): Promise<{ gatewayUserId: string; tenantId: string | null }> {
    const headers = await this.authHeaders();
    const response = await fetch(`${this.gatewayUrl}/ai-whoami`, { headers });
    if (!response.ok) {
      throw new Error(`ai-whoami failed (${response.status}): ${await response.text()}`);
    }
    const payload = (await response.json()) as {
      gateway_user_id: string;
      tenant_id: string | null;
    };
    return { gatewayUserId: payload.gateway_user_id, tenantId: payload.tenant_id };
  }

  async listCredentials(
    scope: "personal" | "tenant",
    scopeId: string,
  ): Promise<GatewayCredentialSummary[]> {
    const headers = await this.authHeaders();
    const url = new URL(`${this.gatewayUrl}/ai-credentials`);
    url.searchParams.set("scope", scope);
    url.searchParams.set("scope_id", scopeId);
    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      throw new Error(`ai-credentials list failed (${response.status}): ${await response.text()}`);
    }
    const payload = (await response.json()) as { credentials: GatewayCredentialSummary[] };
    return payload.credentials;
  }

  async addCredential(input: {
    scope: "personal" | "tenant";
    scopeId: string;
    provider: string;
    apiKey: string;
    label?: string;
  }): Promise<GatewayCredentialSummary> {
    const headers = await this.authHeaders();
    const response = await fetch(`${this.gatewayUrl}/ai-credentials`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        scope: input.scope,
        scope_id: input.scopeId,
        provider: input.provider,
        api_key: input.apiKey,
        label: input.label,
      }),
    });
    if (!response.ok) {
      throw new Error(`ai-credentials create failed (${response.status}): ${await response.text()}`);
    }
    return (await response.json()) as GatewayCredentialSummary;
  }

  async rotateCredential(id: string, apiKey: string): Promise<GatewayCredentialSummary> {
    const headers = await this.authHeaders();
    const response = await fetch(`${this.gatewayUrl}/ai-credentials/${id}/rotate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (!response.ok) {
      throw new Error(`ai-credentials rotate failed (${response.status}): ${await response.text()}`);
    }
    return (await response.json()) as GatewayCredentialSummary;
  }

  async revokeCredential(id: string): Promise<void> {
    const headers = await this.authHeaders();
    const response = await fetch(`${this.gatewayUrl}/ai-credentials/${id}`, {
      method: "DELETE",
      headers,
    });
    if (!response.ok && response.status !== 204) {
      throw new Error(`ai-credentials revoke failed (${response.status}): ${await response.text()}`);
    }
  }
}
