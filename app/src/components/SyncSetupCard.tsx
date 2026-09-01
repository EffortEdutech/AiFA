/**
 * Sprint 17 — the one-time setup step db/syncBootstrap.ts's own doc
 * describes: an owner who is signed in but hasn't yet completed sync
 * setup on THIS device sees this card in Settings instead of silently
 * having no sync at all. Deliberately minimal (a label field and a
 * two-way choice), matching this sprint's "minimal device picker" scope
 * elsewhere — a fuller onboarding flow (QR-code pairing, a dedicated
 * first-run screen) is not this sprint's job, this card exists so the
 * RPC/DEK-derivation path built this sprint has somewhere real to be
 * triggered from.
 */
import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { bootstrapSyncOnThisDevice } from "@/db/syncBootstrap";

export interface SyncSetupCardProps {
  businessId: string;
  onBootstrapped: () => void;
}

type Mode = "first" | "join";

export default function SyncSetupCard({
  businessId,
  onBootstrapped,
}: SyncSetupCardProps) {
  const [mode, setMode] = useState<Mode>("first");
  const [deviceLabel, setDeviceLabel] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    const label = deviceLabel.trim();
    if (!label) {
      setError('Give this device a name (e.g. "My phone").');
      return;
    }
    if (mode === "join" && !recoveryCode.trim()) {
      setError("Enter the recovery code from your other device.");
      return;
    }

    setIsSubmitting(true);
    try {
      await bootstrapSyncOnThisDevice({
        businessId,
        deviceLabel: label,
        recoveryCode: mode === "join" ? recoveryCode.trim() : undefined,
      });
      onBootstrapped();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set up sync.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Sync across devices</Text>
      <Text style={styles.hint}>
        Enable sync to keep this business's data current across your devices,
        with only one device able to make changes at a time.
      </Text>

      <View style={styles.modeRow}>
        <Pressable
          onPress={() => setMode("first")}
          style={[
            styles.modeButton,
            mode === "first" && styles.modeButtonActive,
          ]}
          accessibilityRole="button"
        >
          <Text style={styles.modeButtonText}>This is my first device</Text>
        </Pressable>
        <Pressable
          onPress={() => setMode("join")}
          style={[
            styles.modeButton,
            mode === "join" && styles.modeButtonActive,
          ]}
          accessibilityRole="button"
        >
          <Text style={styles.modeButtonText}>I have another device</Text>
        </Pressable>
      </View>

      <TextInput
        value={deviceLabel}
        onChangeText={setDeviceLabel}
        placeholder="Device name (e.g. My phone)"
        style={styles.input}
      />

      {mode === "join" && (
        <TextInput
          value={recoveryCode}
          onChangeText={setRecoveryCode}
          placeholder="Recovery code from your other device"
          autoCapitalize="none"
          style={styles.input}
        />
      )}

      {mode === "join" && (
        <Text style={styles.hint}>
          Find this on your other device under Settings → Data & Privacy →
          reveal recovery code.
        </Text>
      )}

      <Pressable
        onPress={() => handleSubmit().catch(() => {})}
        disabled={isSubmitting}
        style={styles.submitButton}
        accessibilityRole="button"
      >
        {isSubmitting ? (
          <ActivityIndicator size="small" />
        ) : (
          <Text style={styles.submitButtonText}>Enable sync</Text>
        )}
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 12,
    marginVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
  },
  hint: {
    fontSize: 12,
    color: "#767676",
    marginBottom: 8,
  },
  modeRow: {
    flexDirection: "row",
    marginBottom: 8,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 6,
    marginRight: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#999",
    alignItems: "center",
  },
  modeButtonActive: {
    borderColor: "#333",
    backgroundColor: "#f0f0f0",
  },
  modeButtonText: {
    fontSize: 11,
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 4,
    padding: 8,
    fontSize: 13,
    marginBottom: 8,
  },
  submitButton: {
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#333",
  },
  submitButtonText: {
    fontSize: 12,
    fontWeight: "600",
  },
  error: {
    color: "#c0392b",
    fontSize: 12,
    marginTop: 4,
  },
});
