/**
 * BYOK settings card — web port of app/src/components/BYOKSettingsCard.tsx
 * (Sprint 6), added post-Sprint-55 once the Gateway's own credential
 * endpoints were confirmed live and AiFA was registered with the Gateway
 * (`apps` table). Lets a signed-in owner add, replace, and remove their
 * own AI provider keys, stored encrypted in the Gateway's vault — never in
 * this app's bundle or database. Same client (`GatewayCredentialsClient`
 * from `@aifa/core`) and wire protocol as mobile; only the rendering is
 * web-native (shared ui kit: Card, Button, Field) instead of React Native
 * primitives. UI polish Phase 4: presentation only.
 *
 * Rendered only when `VITE_AI_GATEWAY_URL` is configured — same
 * graceful-degradation pattern as `aiProvider.ts`'s own Gateway/local
 * fallback and the mobile card: renders nothing rather than an error state
 * when the Gateway isn't set up for this environment.
 *
 * "Test connection" is intentionally NOT included — `POST /ai-credentials/
 * :id/test` is still a 501 stub on the Gateway (tracked on the Gateway's
 * own sprint plan, not this repo's).
 *
 * Not gated behind `settings: configure` capability, matching the mobile
 * card: an AI provider key is personal to the signed-in owner (`scope:
 * "personal"`, keyed off the caller's own `gateway_users.id` via
 * `/ai-whoami`), not a shared business setting, so every signed-in owner
 * manages their own regardless of role.
 */
import {
  GatewayCredentialsClient,
  type GatewayCredentialSummary,
} from "@aifa/core/ai/gatewayCredentialsClient";
import { useCallback, useEffect, useState } from "react";

import { Button, Card, Field, StatusPill } from "../ui";
import { getCurrentSession } from "../lib/auth";

const PROVIDERS = ["openai", "anthropic", "gemini", "openrouter"] as const;
type ProviderId = (typeof PROVIDERS)[number];

const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  openrouter: "OpenRouter",
};

export function BYOKSettingsCard(): JSX.Element | null {
  const gatewayUrl = import.meta.env.VITE_AI_GATEWAY_URL as string | undefined;

  const [client] = useState(() =>
    gatewayUrl
      ? new GatewayCredentialsClient({
          gatewayUrl,
          appId: import.meta.env.VITE_AI_GATEWAY_APP_ID as string | undefined,
          getAccessToken: async () =>
            (await getCurrentSession())?.access_token ?? null,
        })
      : null,
  );

  const [gatewayUserId, setGatewayUserId] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<GatewayCredentialSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingProvider, setEditingProvider] = useState<ProviderId | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      const who = await client.whoami();
      setGatewayUserId(who.gatewayUserId);
      const list = await client.listCredentials("personal", who.gatewayUserId);
      setCredentials(list.filter((c) => c.status === "active"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your AI keys from the Gateway.");
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleSave(provider: ProviderId): Promise<void> {
    if (!client || !gatewayUserId || !keyInput.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const existing = credentials.find((c) => c.provider === provider);
      if (existing) {
        await client.rotateCredential(existing.id, keyInput.trim());
      } else {
        await client.addCredential({
          scope: "personal",
          scopeId: gatewayUserId,
          provider,
          apiKey: keyInput.trim(),
        });
      }
      setKeyInput("");
      setEditingProvider(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that key.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(credentialId: string): Promise<void> {
    if (!client) return;
    setError(null);
    try {
      await client.revokeCredential(credentialId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove that key.");
    }
  }

  if (!gatewayUrl) {
    // Not configured — nothing to show, matches aiProvider.ts's own
    // Gateway/local fallback and the mobile card's identical guard.
    return null;
  }

  return (
    <Card
      title="AI provider keys"
      description="Add your own API key for a provider to use it for AI classification, image/PDF extraction, and the AI Workspace, instead of this app's built-in model. Keys are stored encrypted in the Gateway, never on this device or in this app."
    >
      {error && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="ui-muted">Loading…</p>
      ) : (
        <ul className="ui-move-list">
          {PROVIDERS.map((provider) => {
            const existing = credentials.find((c) => c.provider === provider);
            const isEditing = editingProvider === provider;
            return (
              <li key={provider} className="ui-move" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                  <strong>{PROVIDER_LABELS[provider]}</strong>
                  <div className="ui-cell-sub">
                    {existing ? <StatusPill status="active" label={`•••• ${existing.key_last4 ?? "????"}`} tone="success" /> : "Not configured"}
                  </div>
                  {isEditing && (
                    <form
                      style={{ marginTop: 8 }}
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!saving && keyInput.trim()) void handleSave(provider);
                      }}
                    >
                      <Field label={`${PROVIDER_LABELS[provider]} API key`}>
                        {(p) => (
                          <input
                            {...p}
                            className="ui-input"
                            type="password"
                            autoCapitalize="off"
                            autoComplete="off"
                            value={keyInput}
                            onChange={(e) => setKeyInput(e.target.value)}
                          />
                        )}
                      </Field>
                      <div className="ui-form-actions">
                        <Button type="submit" variant="primary" size="sm" loading={saving} disabled={!keyInput.trim()}>
                          {saving ? "Saving…" : "Save"}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={saving}
                          onClick={() => {
                            setEditingProvider(null);
                            setKeyInput("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  )}
                </div>
                {!isEditing && (
                  <div className="ui-inline-actions">
                    <Button size="sm" variant="secondary" onClick={() => setEditingProvider(provider)}>
                      {existing ? "Replace" : "Add key"}
                    </Button>
                    {existing && (
                      <Button size="sm" variant="danger" onClick={() => void handleRemove(existing.id)}>
                        Remove
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
