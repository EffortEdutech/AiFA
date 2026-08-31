import {
  GatewayCredentialsClient,
  type GatewayCredentialSummary,
} from "@aifa/core/ai/gatewayCredentialsClient";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { getCurrentSession } from "@/lib/auth";

/**
 * BYOK settings card — Sprint 6 close-out. Lets a signed-in owner add,
 * replace, and remove their own AI provider keys, stored encrypted in the
 * Gateway's vault instead of this app's bundle (see client.ts/
 * gatewayProvider.ts's file comments for the risk this replaces).
 *
 * Rendered only when both a Supabase session exists (SettingsScreen.tsx's
 * "Account" card, right above this one) AND EXPO_PUBLIC_AI_GATEWAY_URL is
 * configured — matches this app's existing pattern of every feature
 * degrading gracefully on its own rather than blocking the rest of the
 * screen (see SettingsScreen.tsx's file comment).
 *
 * "Test connection" is intentionally NOT included — `POST /ai-credentials/
 * :id/test` is still a 501 stub on the Gateway as of this writing (tracked
 * on the Gateway's own sprint plan, not this repo's).
 *
 * NOT verified against a live Gateway: as of this writing no Edge Function
 * (including /ai-whoami and /ai-credentials) has actually been deployed to
 * the Gateway's Supabase project — only its database schema is live. This
 * card will show its error state ("couldn't load your keys") until that
 * deployment happens, which is expected, not a bug in this file.
 */

const PROVIDERS = ["openai", "anthropic", "gemini", "openrouter"] as const;
type ProviderId = (typeof PROVIDERS)[number];

const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  openrouter: "OpenRouter",
};

export default function BYOKSettingsCard() {
  const gatewayUrl = process.env.EXPO_PUBLIC_AI_GATEWAY_URL;

  const [client] = useState(() =>
    gatewayUrl
      ? new GatewayCredentialsClient({
          gatewayUrl,
          appId: process.env.EXPO_PUBLIC_AI_GATEWAY_APP_ID,
          getAccessToken: async () =>
            (await getCurrentSession())?.access_token ?? null,
        })
      : null,
  );

  const [gatewayUserId, setGatewayUserId] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<GatewayCredentialSummary[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingProvider, setEditingProvider] = useState<ProviderId | null>(
    null,
  );
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
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't load your AI keys from the Gateway.",
      );
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleSave(provider: ProviderId) {
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

  async function handleRemove(credentialId: string) {
    if (!client) return;
    setError(null);
    try {
      await client.revokeCredential(credentialId);
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't remove that key.",
      );
    }
  }

  if (!gatewayUrl) {
    // Not configured — nothing to show, matches this app's other
    // optional/unconfigured features (e.g. no AI key at all falls back to
    // the local heuristic provider without a visible error).
    return null;
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>AI provider keys</Text>
      <Text style={styles.placeholderText}>
        Add your own API key for a provider to use it for AI classification and
        the AI Workspace, instead of this app's built-in model. Keys are stored
        encrypted in the Gateway, never on this device or in this app.
      </Text>

      {error && <Text style={styles.errorText}>{error}</Text>}

      {loading ? (
        <ActivityIndicator />
      ) : (
        PROVIDERS.map((provider) => {
          const existing = credentials.find((c) => c.provider === provider);
          const isEditing = editingProvider === provider;
          return (
            <View key={provider} style={styles.providerRow}>
              <View style={styles.providerRowHeader}>
                <Text style={styles.rowLabel}>{PROVIDER_LABELS[provider]}</Text>
                <Text style={styles.label}>
                  {existing
                    ? `•••• ${existing.key_last4 ?? "????"}`
                    : "Not configured"}
                </Text>
              </View>

              {isEditing ? (
                <>
                  <TextInput
                    style={styles.input}
                    value={keyInput}
                    onChangeText={setKeyInput}
                    placeholder={`${PROVIDER_LABELS[provider]} API key`}
                    autoCapitalize="none"
                    secureTextEntry
                  />
                  <View style={styles.row}>
                    <Pressable
                      style={styles.button}
                      onPress={() => handleSave(provider)}
                      disabled={saving || !keyInput.trim()}
                    >
                      <Text style={styles.buttonText}>
                        {saving ? "Saving…" : "Save"}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.button, styles.secondaryButton]}
                      onPress={() => {
                        setEditingProvider(null);
                        setKeyInput("");
                      }}
                      disabled={saving}
                    >
                      <Text style={styles.buttonText}>Cancel</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <View style={styles.row}>
                  <Pressable
                    style={styles.button}
                    onPress={() => setEditingProvider(provider)}
                  >
                    <Text style={styles.buttonText}>
                      {existing ? "Replace" : "Add key"}
                    </Text>
                  </Pressable>
                  {existing && (
                    <Pressable
                      style={[styles.button, styles.dangerButton]}
                      onPress={() => handleRemove(existing.id)}
                    >
                      <Text style={styles.buttonText}>Remove</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#f2f2f2",
    gap: 8,
  },
  cardTitle: { fontSize: 16, fontWeight: "600" },
  label: { fontSize: 13, color: "#555" },
  placeholderText: { fontSize: 14, color: "#555" },
  errorText: { color: "#dc2626" },
  providerRow: {
    gap: 6,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#e2e2e2",
  },
  providerRowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowLabel: { fontSize: 14, fontWeight: "600" },
  input: {
    backgroundColor: "#fff",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  row: { flexDirection: "row", gap: 8 },
  button: {
    backgroundColor: "#2563eb",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  secondaryButton: { backgroundColor: "#6b7280" },
  dangerButton: { backgroundColor: "#dc2626" },
  buttonText: { color: "#fff", fontWeight: "600" },
});
