import type { BankTransactionType } from "@aifa/core/db/bankingRepository";
import type { OutstandingItem } from "@aifa/core/db/financialSummaryRepository";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

export interface BankTransactionFormValues {
  transactionType: BankTransactionType;
  description: string;
  amount: string;
  currency: string;
  matchBusinessDataId?: string;
}

const TRANSACTION_OPTIONS: { value: BankTransactionType; label: string }[] = [
  { value: "deposit", label: "Deposit" },
  { value: "withdrawal", label: "Withdrawal" },
  { value: "transfer", label: "Transfer" },
  { value: "bank_fee", label: "Bank fee" },
];

/**
 * Manual bank transaction capture — Vol 6_4 §2 (Deposit/Withdrawal/
 * Transfer/Bank Fee), Sprint 7. Separate from ManualCaptureForm (which now
 * only handles Expense/Sale/Purchase, all AI-interpreted) rather than
 * overloading it with banking-specific concepts like reconciliation
 * matching, the same reasoning that gave photo capture its own dedicated
 * flow in Sprint 5. Deposit/Withdrawal can optionally match an existing
 * outstanding invoice/bill (Vol 6_4 §4 reconciliation) — selecting a match
 * locks the amount/currency to that item's outstanding balance, since
 * Phase 1 only supports full-amount settlement (see
 * bankingRepository.ts).
 */
export function BankTransactionForm({
  onSubmit,
  submitting,
  loadCandidates,
}: {
  onSubmit: (values: BankTransactionFormValues) => Promise<void> | void;
  submitting: boolean;
  loadCandidates: (
    type: "deposit" | "withdrawal",
  ) => Promise<OutstandingItem[]>;
}) {
  const [transactionType, setTransactionType] =
    useState<BankTransactionType>("deposit");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("MYR");
  const [candidates, setCandidates] = useState<OutstandingItem[]>([]);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canMatch =
    transactionType === "deposit" || transactionType === "withdrawal";

  useEffect(() => {
    if (!canMatch) {
      setCandidates([]);
      setMatchId(null);
      return;
    }
    let cancelled = false;
    loadCandidates(transactionType as "deposit" | "withdrawal").then(
      (items) => {
        if (!cancelled) setCandidates(items);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [transactionType, canMatch, loadCandidates]);

  function handleTypeChange(next: BankTransactionType) {
    setTransactionType(next);
    setMatchId(null);
  }

  function handleSelectMatch(item: OutstandingItem) {
    setMatchId(item.businessDataId);
    setAmount(String(item.amount));
    setCurrency(item.currency);
  }

  const canSubmit =
    description.trim().length > 0 && Number(amount) > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) {
      setError("Enter a description and an amount greater than zero.");
      return;
    }
    setError(null);
    await onSubmit({
      transactionType,
      description: description.trim(),
      amount,
      currency,
      matchBusinessDataId: matchId ?? undefined,
    });
    setDescription("");
    setAmount("");
    setMatchId(null);
  }

  return (
    <View style={styles.form}>
      <Text style={styles.label}>Transaction type</Text>
      <View style={styles.chipRow}>
        {TRANSACTION_OPTIONS.map((option) => (
          <Pressable
            key={option.value}
            onPress={() => handleTypeChange(option.value)}
            style={[
              styles.chip,
              transactionType === option.value && styles.chipSelected,
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: transactionType === option.value }}
          >
            <Text
              style={[
                styles.chipText,
                transactionType === option.value && styles.chipTextSelected,
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {transactionType === "transfer" && (
        <Text style={styles.notice}>
          Transfers between your own accounts aren't reflected in your cash
          position yet — this app currently tracks a single combined Cash/Bank
          balance. It's still logged for your records.
        </Text>
      )}

      <Text style={styles.label}>What happened?</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Monthly account maintenance fee"
        value={description}
        onChangeText={setDescription}
        accessibilityLabel="Description"
      />

      <View style={styles.row}>
        <View style={styles.rowItem}>
          <Text style={styles.label}>Amount</Text>
          <TextInput
            style={styles.input}
            placeholder="0.00"
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={(v) => {
              setAmount(v);
              setMatchId(null); // typing a new amount invalidates a locked match
            }}
            editable={!matchId}
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
            editable={!matchId}
            accessibilityLabel="Currency"
          />
        </View>
      </View>

      {canMatch && candidates.length > 0 && (
        <>
          <Text style={styles.label}>
            Match to an outstanding{" "}
            {transactionType === "deposit" ? "invoice" : "bill"}? (optional —
            settles it in full)
          </Text>
          <View style={styles.matchList}>
            {candidates.map((item) => (
              <Pressable
                key={item.businessDataId}
                onPress={() => handleSelectMatch(item)}
                style={[
                  styles.matchRow,
                  matchId === item.businessDataId && styles.matchRowSelected,
                ]}
                accessibilityRole="button"
              >
                <Text style={styles.matchRowText}>
                  {item.counterpartyName || item.description || "Untitled"} —{" "}
                  {item.currency} {item.amount.toFixed(2)}
                </Text>
              </Pressable>
            ))}
          </View>
          {matchId && (
            <Pressable
              onPress={() => {
                setMatchId(null);
                setAmount("");
              }}
              accessibilityRole="button"
            >
              <Text style={styles.clearMatchText}>Clear match</Text>
            </Pressable>
          )}
        </>
      )}

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
          <Text style={styles.submitText}>Log transaction</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 8 },
  label: { fontSize: 13, fontWeight: "600", color: "#333", marginTop: 8 },
  notice: { fontSize: 12, color: "#8a5a00", fontStyle: "italic" },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
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
  matchList: { gap: 6 },
  matchRow: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    backgroundColor: "#f8f8f8",
  },
  matchRowSelected: { borderColor: "#222", backgroundColor: "#eee" },
  matchRowText: { fontSize: 13, color: "#222" },
  clearMatchText: {
    fontSize: 12,
    color: "#555",
    textDecorationLine: "underline",
  },
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
