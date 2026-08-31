import { getCfoGuidance, type CfoGuidance } from "@aifa/core/ai/cfoGuidance";
import { askWorkspaceQuestion } from "@aifa/core/ai/workspacePipeline";
import { logAppError } from "@aifa/core/db/errorLogRepository";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { getDefaultExpenseProvider } from "@/ai/client";
import { WhyButton } from "@/components/WhyButton";
import { getDb, getLocalBusinessId } from "@/db/client";

/**
 * AI Workspace — Vol 7_2, Sprint 7. Two parts, matching Vol 0_1 §6's
 * deliberately reduced scope: a CFO Guidance summary at the top (cash
 * position, overdue invoices, upcoming bills, today's one recommendation —
 * all deterministic, computed by ai/cfoGuidance.ts) and a conversational
 * Q&A below it (ai/workspacePipeline.ts) that reasons over that same
 * bounded data, never anything broader (Vol 5_3, Vol 1_4 §7). Every
 * answer's sources are shown inline (Vol 7_2 §4 explainability surface);
 * an out-of-scope question is shown distinctly, never silently guessed.
 */

interface QaTurn {
  question: string;
  answer: string;
  sources: string[];
  outOfScope: boolean;
  noProviderConfigured: boolean;
}

export default function WorkspaceScreen() {
  const [guidance, setGuidance] = useState<CfoGuidance | null>(null);
  const [guidanceLoading, setGuidanceLoading] = useState(true);
  const [guidanceError, setGuidanceError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [turns, setTurns] = useState<QaTurn[]>([]);

  const loadGuidance = useCallback(async () => {
    try {
      const db = await getDb();
      const businessId = await getLocalBusinessId();
      setGuidance(await getCfoGuidance(db, businessId));
      setGuidanceError(null);
    } catch (err) {
      setGuidanceError(
        err instanceof Error ? err.message : "Failed to load CFO guidance.",
      );
    } finally {
      // Sprint 11 polish-pass fix: this screen previously had no loading
      // state at all for the initial fetch -- a slow first load just
      // showed a bare heading with nothing else, indistinguishable from
      // "there's genuinely nothing to show yet."
      setGuidanceLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGuidance();
  }, [loadGuidance]);

  async function handleRefresh() {
    setRefreshing(true);
    await loadGuidance();
    setRefreshing(false);
  }

  async function handleAsk() {
    const trimmed = question.trim();
    if (!trimmed || asking) return;
    setAsking(true);
    setAskError(null);
    try {
      const db = await getDb();
      const businessId = await getLocalBusinessId();
      const result = await askWorkspaceQuestion(
        db,
        getDefaultExpenseProvider(),
        {
          businessId,
          question: trimmed,
        },
      );
      setTurns((prev) => [
        {
          question: trimmed,
          answer: result.answer,
          sources: result.sources,
          outOfScope: result.outOfScope,
          noProviderConfigured: result.noProviderConfigured,
        },
        ...prev,
      ]);
      setQuestion("");
    } catch (err) {
      // Sprint 11: this call previously had no error handling at all -- a
      // network failure mid-question would throw uncaught past this
      // function, a real missing-error-state gap the polish pass caught.
      // Logged for observability (Vol 8_6) and surfaced to the owner
      // rather than silently failing.
      const message =
        err instanceof Error
          ? err.message
          : "Something went wrong answering that question.";
      setAskError(message);
      try {
        const db = await getDb();
        await logAppError(db, {
          errorType: "workspace_call_error",
          message,
          stack: err instanceof Error ? (err.stack ?? null) : null,
          context: { question: trimmed.length }, // length only -- never log the question text itself (Vol 8_6 Section 3)
        });
      } catch {
        // best-effort, see crashReporting.ts's own comment on this pattern
      }
    } finally {
      setAsking(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        <Text style={styles.heading}>AI Workspace</Text>

        {guidanceError && <Text style={styles.error}>{guidanceError}</Text>}

        {guidanceLoading && <ActivityIndicator style={styles.loading} />}

        {guidance && (
          <>
            {guidance.todayRecommendation ? (
              <View style={styles.recommendationCard}>
                <View style={styles.recommendationHeaderRow}>
                  <Text style={styles.recommendationLabel}>Today</Text>
                  <WhyButton
                    businessEventId={
                      guidance.todayRecommendation.sourceBusinessEventId
                    }
                  />
                </View>
                <Text style={styles.recommendationText}>
                  {guidance.todayRecommendation.message}
                </Text>
              </View>
            ) : (
              <View style={styles.recommendationCardQuiet}>
                <Text style={styles.recommendationQuietText}>
                  Nothing needs your attention today.
                </Text>
              </View>
            )}

            <View style={styles.summaryRow}>
              <View style={[styles.summaryCard]}>
                <Text style={styles.summaryLabel}>Overdue invoices</Text>
                <Text style={styles.summaryValue}>
                  {guidance.overdueReceivables.length === 0
                    ? "None"
                    : `${guidance.cashPosition.currency} ${guidance.totalOverdueAmount.toFixed(2)}`}
                </Text>
              </View>
              <View style={[styles.summaryCard]}>
                <Text style={styles.summaryLabel}>Upcoming bills</Text>
                <Text style={styles.summaryValue}>
                  {guidance.upcomingPayables.length === 0
                    ? "None"
                    : `${guidance.cashPosition.currency} ${guidance.totalUpcomingPayableAmount.toFixed(2)}`}
                </Text>
              </View>
            </View>
          </>
        )}

        <Text style={styles.sectionHeading}>Ask a question</Text>
        <Text style={styles.hint}>
          Scoped to cash position, overdue invoices, upcoming bills, and today's
          recommendation — not a general chatbot.
        </Text>
        <View style={styles.askRow}>
          <TextInput
            style={styles.askInput}
            placeholder="e.g. Who owes me money?"
            value={question}
            onChangeText={setQuestion}
            onSubmitEditing={handleAsk}
            accessibilityLabel="Ask a financial question"
          />
          <Pressable
            style={[styles.askButton, asking && styles.askButtonDisabled]}
            onPress={handleAsk}
            disabled={asking || !question.trim()}
            accessibilityRole="button"
          >
            {asking ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.askButtonText}>Ask</Text>
            )}
          </Pressable>
        </View>

        {askError && <Text style={styles.error}>{askError}</Text>}

        {turns.map((turn, i) => (
          <View key={i} style={styles.turn}>
            <Text style={styles.turnQuestion}>{turn.question}</Text>
            <Text
              style={
                turn.outOfScope
                  ? styles.turnAnswerOutOfScope
                  : styles.turnAnswer
              }
            >
              {turn.answer}
            </Text>
            {turn.sources.length > 0 && (
              <View style={styles.turnSourcesRow}>
                <Text style={styles.turnSources}>
                  Source: {turn.sources.join(", ")}
                </Text>
                <WhyButton businessEventId={turn.sources[0]} />
              </View>
            )}
          </View>
        ))}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: 16, gap: 10 },
  heading: { fontSize: 24, fontWeight: "600" },
  error: { color: "#c0392b", fontSize: 13 },
  loading: { marginVertical: 16 },
  sectionHeading: { fontSize: 16, fontWeight: "600", marginTop: 12 },
  hint: { fontSize: 12, color: "#767676" },
  recommendationCard: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#fff4d6",
    gap: 4,
  },
  recommendationHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  recommendationLabel: { fontSize: 12, fontWeight: "700", color: "#8a5a00" },
  recommendationText: { fontSize: 15, color: "#222" },
  recommendationCardQuiet: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#f2f2f2",
  },
  recommendationQuietText: { fontSize: 14, color: "#555" },
  summaryRow: { flexDirection: "row", gap: 12 },
  summaryCard: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#f8f8f8",
    gap: 4,
  },
  summaryLabel: { fontSize: 12, color: "#666", fontWeight: "600" },
  summaryValue: { fontSize: 15, fontWeight: "700", color: "#222" },
  askRow: { flexDirection: "row", gap: 8 },
  askInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  askButton: {
    backgroundColor: "#222",
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  askButtonDisabled: { backgroundColor: "#999" },
  askButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  turn: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#f8f8f8",
    gap: 4,
  },
  turnQuestion: { fontSize: 13, fontWeight: "600", color: "#222" },
  turnAnswer: { fontSize: 14, color: "#222" },
  turnAnswerOutOfScope: { fontSize: 14, color: "#8a5a00", fontStyle: "italic" },
  turnSourcesRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  turnSources: { fontSize: 11, color: "#767676", flexShrink: 1 },
});
