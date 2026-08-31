import type { VisionExtractedFields } from "@aifa/core/ai/types";
import type {
  DomainHint,
  PaymentMethod,
} from "@aifa/core/db/businessEventRepository";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

export interface ManualCaptureFormValues {
  domainHint: DomainHint;
  description: string;
  counterpartyName: string;
  amount: string;
  currency: string;
  paymentMethod: PaymentMethod;
}

const DOMAIN_OPTIONS: DomainHint[] = ["expense", "sale", "purchase"]; // Sprint 7: Banking moved to its own dedicated capture flow (BankTransactionForm), same reasoning Sprint 5 gave photo capture its own entry point.
const PAYMENT_OPTIONS: PaymentMethod[] = [
  "cash",
  "bank_transfer",
  "card",
  "unspecified",
];

/**
 * Manual/text capture form — Vol 7_1 Section 2 (text mode). Also the Phase
 * 1 fallback UI for Vol 7_1 Section 5.1's OCR/vision failure modes: pass
 * `prefill` (a partial extraction's fields, null where unreadable) to
 * pre-fill and highlight what still needs manual entry, or omit it
 * entirely for a plain blank capture (extraction failed completely, or
 * this is ordinary text capture).
 */
export function ManualCaptureForm({
  onSubmit,
  submitting,
  prefill,
  lockDomainHint,
}: {
  onSubmit: (values: ManualCaptureFormValues) => Promise<void> | void;
  submitting: boolean;
  prefill?: VisionExtractedFields | null;
  lockDomainHint?: DomainHint;
}) {
  const [domainHint, setDomainHint] = useState<DomainHint>(
    lockDomainHint ?? "expense",
  );
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [counterpartyName, setCounterpartyName] = useState(
    prefill?.counterpartyName ?? "",
  );
  const [amount, setAmount] = useState(
    prefill?.amount != null ? String(prefill.amount) : "",
  );
  const [currency, setCurrency] = useState(prefill?.currency ?? "MYR");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [error, setError] = useState<string | null>(null);

  const descriptionMissing = !!prefill && prefill.description == null;
  const amountMissing = !!prefill && prefill.amount == null;

  const canSubmit =
    description.trim().length > 0 && Number(amount) > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) {
      setError("Enter a description and an amount greater than zero.");
      return;
    }
    setError(null);
    await onSubmit({
      domainHint,
      description: description.trim(),
      counterpartyName: counterpartyName.trim(),
      amount,
      currency,
      paymentMethod,
    });
    setDescription("");
    setCounterpartyName("");
    setAmount("");
  }

  return (
    <View style={styles.form}>
      {prefill && (
        <Text style={styles.prefillHint}>
          We read what we could from the photo — please fill in anything
          highlighted below.
        </Text>
      )}

      <Text style={styles.label}>What happened?</Text>
      <TextInput
        style={[styles.input, descriptionMissing && styles.inputMissing]}
        placeholder="e.g. Office stationery purchased"
        value={description}
        onChangeText={setDescription}
        accessibilityLabel="Description"
      />

      <Text style={styles.label}>Who's it with? (optional)</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. ABC Stationery"
        value={counterpartyName}
        onChangeText={setCounterpartyName}
        accessibilityLabel="Counterparty name"
      />

      <View style={styles.row}>
        <View style={styles.rowItem}>
          <Text style={styles.label}>Amount</Text>
          <TextInput
            style={[styles.input, amountMissing && styles.inputMissing]}
            placeholder="0.00"
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
            accessibilityLabel="Amount"
          />
        </View>
        <View style={styles.rowItem}>
          <Text style={styles.label}>Currency</Text>
          <TextInput
            style={styles.input}
            value={currency}
            onChangeText={setCurrency}
            autoCapitalize="characters"
            maxLength={3}
            accessibilityLabel="Currency"
          />
        </View>
      </View>

      {!lockDomainHint && (
        <>
          <Text style={styles.label}>Type</Text>
          <View style={styles.chipRow}>
            {DOMAIN_OPTIONS.map((option) => (
              <Chip
                key={option}
                label={option}
                selected={option === domainHint}
                onPress={() => setDomainHint(option)}
              />
            ))}
          </View>
        </>
      )}

      <Text style={styles.label}>Payment method</Text>
      <View style={styles.chipRow}>
        {PAYMENT_OPTIONS.map((option) => (
          <Chip
            key={option}
            label={option}
            selected={option === paymentMethod}
            onPress={() => setPaymentMethod(option)}
          />
        ))}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
        onPress={handleSubmit}
        disabled={!canSubmit}
        accessibilityRole="button"
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitText}>Capture</Text>
        )}
      </Pressable>
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  form: { gap: 8 },
  label: { fontSize: 13, fontWeight: "600", color: "#333", marginTop: 8 },
  prefillHint: { fontSize: 12, color: "#8a5a00", fontStyle: "italic" },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  inputMissing: { borderColor: "#c0392b", borderWidth: 2 },
  row: { flexDirection: "row", gap: 12 },
  rowItem: { flex: 1 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  chipSelected: { backgroundColor: "#222", borderColor: "#222" },
  chipText: { fontSize: 13, color: "#333" },
  chipTextSelected: { color: "#fff" },
  error: { color: "#c0392b", fontSize: 13 },
  submitButton: {
    marginTop: 12,
    backgroundColor: "#222",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  submitButtonDisabled: { backgroundColor: "#999" },
  submitText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
