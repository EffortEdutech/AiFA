import {
  getWhyDetailForEvent,
  type WhyConfidenceState,
  type WhyDetail,
} from "@aifa/core/ai/whyDetail";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { getDb } from "@/db/client";

/**
 * The "why" drill-down affordance — Vol 5_3 Section 4, Vol 1_2 Section 5.
 * A single small "Why?" link that, on tap, fetches and shows the
 * originating Business Event, the AI's reasoning and matched PKA rule(s),
 * and a visually distinct confidence-state badge (Vol 5_3 Section 3: a
 * low-confidence/insufficient-context state must never look identical to
 * a confident one). Self-contained — owns its own modal state — so any
 * screen can drop `<WhyButton businessEventId={...} />` in without wiring
 * a shared modal/provider.
 */
export function WhyButton({ businessEventId }: { businessEventId: string }) {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<WhyDetail | null | undefined>(undefined);

  async function handleOpen() {
    setVisible(true);
    setLoading(true);
    try {
      const db = await getDb();
      const result = await getWhyDetailForEvent(db, businessEventId);
      setDetail(result);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Pressable
        onPress={handleOpen}
        accessibilityRole="button"
        accessibilityLabel="Why was this recorded"
        hitSlop={8}
      >
        <Text style={styles.link}>Why?</Text>
      </Pressable>
      <Modal
        visible={visible}
        animationType="slide"
        transparent
        onRequestClose={() => setVisible(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <ScrollView contentContainerStyle={styles.sheetContent}>
              <Text style={styles.heading}>Why was this recorded?</Text>
              {loading && <ActivityIndicator style={styles.loading} />}
              {!loading && detail === null && (
                <Text style={styles.bodyText}>
                  No further detail is available for this item.
                </Text>
              )}
              {!loading && detail && <WhyDetailBody detail={detail} />}
            </ScrollView>
            <Pressable
              style={styles.closeButton}
              onPress={() => setVisible(false)}
              accessibilityRole="button"
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const CONFIDENCE_BADGE: Record<
  WhyConfidenceState,
  { label: string; color: string; background: string }
> = {
  confirmed_high_confidence: {
    label: "Confident — recorded automatically",
    color: "#1b5e20",
    background: "#e3f5e6",
  },
  confirmed_after_review: {
    label: "Confirmed by you",
    color: "#1b5e20",
    background: "#e3f5e6",
  },
  needs_review_low_confidence: {
    label: "Low confidence — awaiting your review",
    color: "#8a5a00",
    background: "#fff4d6",
  },
  awaiting_clarification: {
    label: "Insufficient context — a question is waiting for you",
    color: "#8a5a00",
    background: "#fff4d6",
  },
  queued_not_yet_interpreted: {
    label: "Not yet reviewed by AI (offline or in progress)",
    color: "#555",
    background: "#eee",
  },
  manual_no_ai: {
    label: "Manual entry — no AI involved",
    color: "#555",
    background: "#eee",
  },
};

function WhyDetailBody({ detail }: { detail: WhyDetail }) {
  const { event, data, latest } = detail;
  const badge = CONFIDENCE_BADGE[detail.confidenceState];

  let matchedRules: string[] = [];
  try {
    matchedRules = latest ? JSON.parse(latest.matched_rule_ids) : [];
  } catch {
    matchedRules = [];
  }

  return (
    <View style={styles.body}>
      <View style={[styles.badge, { backgroundColor: badge.background }]}>
        <Text style={[styles.badgeText, { color: badge.color }]}>
          {badge.label}
        </Text>
      </View>

      {detail.wasCorrected && (
        <Text style={styles.correctedNote}>
          This was later corrected — a newer version replaced it.
        </Text>
      )}

      <Text style={styles.bodyLabel}>What was captured</Text>
      <Text style={styles.bodyText}>
        {event.raw_input_ref || "(no description)"}
        {data ? ` — ${data.currency} ${data.amount.toFixed(2)}` : ""}
      </Text>
      <Text style={styles.bodyMeta}>
        {event.domain_hint} · {event.capture_mode} ·{" "}
        {new Date(event.captured_at).toLocaleString()}
      </Text>

      {latest && (
        <>
          <Text style={styles.bodyLabel}>AI's reasoning</Text>
          <Text style={styles.bodyText}>{latest.reasoning}</Text>

          {latest.clarifying_question && (
            <>
              <Text style={styles.bodyLabel}>Question asked</Text>
              <Text style={styles.bodyText}>{latest.clarifying_question}</Text>
            </>
          )}

          <Text style={styles.bodyLabel}>Governed by</Text>
          <Text style={styles.bodyText}>
            {matchedRules.length > 0
              ? `Finance PKA rule(s): ${matchedRules.join(", ")}`
              : "No specific PKA rule matched."}
            {" · "}PKA v{latest.pka_version}
          </Text>

          <Text style={styles.bodyMeta}>
            Model: {latest.model} · Confidence:{" "}
            {Math.round(latest.confidence * 100)}%
          </Text>
        </>
      )}

      {!latest && detail.confidenceState === "manual_no_ai" && (
        <Text style={styles.bodyText}>
          This is a Banking entry — recorded deterministically from what you
          entered, per Finance PKA rule BANK-001. No AI classification was
          involved because there is no category to guess here.
        </Text>
      )}

      {!latest && detail.confidenceState === "queued_not_yet_interpreted" && (
        <Text style={styles.bodyText}>
          This is saved safely on your device but hasn't been reviewed by AI yet
          — it will process automatically once you're back online.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  link: {
    fontSize: 12,
    color: "#2563eb",
    textDecorationLine: "underline",
    paddingVertical: 2,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "80%",
    padding: 16,
    gap: 12,
  },
  sheetContent: { gap: 10, paddingBottom: 8 },
  heading: { fontSize: 18, fontWeight: "700" },
  loading: { marginVertical: 24 },
  body: { gap: 6 },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  badgeText: { fontSize: 12, fontWeight: "700" },
  correctedNote: { fontSize: 12, color: "#8a5a00", fontStyle: "italic" },
  bodyLabel: { fontSize: 12, fontWeight: "700", color: "#333", marginTop: 6 },
  bodyText: { fontSize: 14, color: "#222" },
  bodyMeta: { fontSize: 12, color: "#777" },
  closeButton: {
    backgroundColor: "#2563eb",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  closeButtonText: { color: "#fff", fontWeight: "600" },
});
