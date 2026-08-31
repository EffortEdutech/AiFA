import type {
  BusinessEventStatus,
  DomainHint,
  RecentActivityItem,
} from "@aifa/core/db/businessEventRepository";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { WhyButton } from "@/components/WhyButton";

const STATUS_LABEL: Record<BusinessEventStatus, string> = {
  queued: "Queued",
  processing: "Interpreting…",
  needs_clarification: "Needs your answer",
  draft: "Draft — needs confirmation",
  confirmed: "Confirmed",
  superseded: "Superseded",
};

export type ResolveHandler = (
  item: RecentActivityItem,
  chosenCategory: string,
) => Promise<void> | void;

/**
 * Reverse-chronological activity feed — Vol 7_1 §3. Sprint 3 added inline
 * resolution of a 'draft' (accept/correct) or 'needs_clarification'
 * (answer) event. Sprint 4 adds a second, separate correction path for an
 * already-confirmed expense (Vol 4_1 §4 reversal-based correction) — kept
 * as a distinct prop/handler since it's a materially different operation
 * (posts a reversal instead of just finalising a first-time category).
 * Sprint 6: category chips are domain-aware — `categoryOptionsForDomain`
 * replaces the old flat `categoryOptions` array so a Sales draft shows
 * Sales categories and a Purchase draft shows Purchase categories, not
 * whatever domain happened to be passed in first (the actual
 * Expense-only assumption this sprint's plan warned about).
 */
export function ActivityFeed({
  items,
  categoryOptionsForDomain,
  onResolve,
  onCorrectConfirmed,
}: {
  items: RecentActivityItem[];
  categoryOptionsForDomain: (domain: DomainHint) => string[];
  onResolve: ResolveHandler;
  onCorrectConfirmed?: ResolveHandler;
}) {
  if (items.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>
          Nothing captured yet. Use the form above to log your first Business
          Event.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {items.map((item) => (
        <ActivityRow
          key={item.event.id}
          item={item}
          categoryOptionsForDomain={categoryOptionsForDomain}
          onResolve={onResolve}
          onCorrectConfirmed={onCorrectConfirmed}
        />
      ))}
    </View>
  );
}

const AI_INTERPRETED_DOMAINS: DomainHint[] = ["expense", "sale", "purchase"];

function ActivityRow({
  item,
  categoryOptionsForDomain,
  onResolve,
  onCorrectConfirmed,
}: {
  item: RecentActivityItem;
  categoryOptionsForDomain: (domain: DomainHint) => string[];
  onResolve: ResolveHandler;
  onCorrectConfirmed?: ResolveHandler;
}) {
  const { event, data, latestInterpretation } = item;
  const [resolving, setResolving] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const categoryOptions = categoryOptionsForDomain(event.domain_hint);
  const needsAction =
    event.status === "draft" || event.status === "needs_clarification";
  const canCorrect =
    !!onCorrectConfirmed &&
    event.status === "confirmed" &&
    AI_INTERPRETED_DOMAINS.includes(event.domain_hint) &&
    !event.superseded_by;

  async function handlePick(category: string) {
    setResolving(true);
    try {
      await onResolve(item, category);
    } finally {
      setResolving(false);
    }
  }

  async function handleCorrectPick(category: string) {
    if (!onCorrectConfirmed) return;
    setResolving(true);
    try {
      await onCorrectConfirmed(item, category);
      setCorrecting(false);
    } finally {
      setResolving(false);
    }
  }

  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowTitle}>
          {data.counterparty_name || event.raw_input_ref || "Untitled event"}
        </Text>
        <Text style={styles.rowAmount}>
          {data.currency} {data.amount.toFixed(2)}
        </Text>
      </View>
      <View style={styles.rowMetaRow}>
        <Text style={styles.rowMeta}>
          {event.domain_hint} · {new Date(event.captured_at).toLocaleString()} ·{" "}
          {event.superseded_by ? "Corrected" : STATUS_LABEL[event.status]}
        </Text>
        <WhyButton businessEventId={event.id} />
      </View>

      {data.category_guess && (
        <Text style={styles.rowCategory}>
          {data.category_guess}
          {data.confidence != null
            ? ` · ${Math.round(data.confidence * 100)}% confidence`
            : ""}
        </Text>
      )}

      {event.status === "needs_clarification" &&
        latestInterpretation?.clarifyingQuestion && (
          <Text style={styles.question}>
            {latestInterpretation.clarifyingQuestion}
          </Text>
        )}

      {needsAction && (
        <View style={styles.chipRow}>
          {categoryOptions.map((category) => (
            <Pressable
              key={category}
              style={styles.chip}
              onPress={() => handlePick(category)}
              disabled={resolving}
              accessibilityRole="button"
            >
              <Text style={styles.chipText}>
                {event.status === "draft" && category === data.category_guess
                  ? `Confirm: ${category}`
                  : category}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {canCorrect && !correcting && (
        <Pressable
          style={styles.correctLink}
          onPress={() => setCorrecting(true)}
          accessibilityRole="button"
        >
          <Text style={styles.correctLinkText}>Correct category</Text>
        </Pressable>
      )}

      {canCorrect && correcting && (
        <View style={styles.chipRow}>
          {categoryOptions
            .filter((category) => category !== data.category_guess)
            .map((category) => (
              <Pressable
                key={category}
                style={styles.chip}
                onPress={() => handleCorrectPick(category)}
                disabled={resolving}
                accessibilityRole="button"
              >
                <Text style={styles.chipText}>{category}</Text>
              </Pressable>
            ))}
          <Pressable
            style={styles.chip}
            onPress={() => setCorrecting(false)}
            disabled={resolving}
            accessibilityRole="button"
          >
            <Text style={styles.chipText}>Cancel</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  emptyState: { padding: 16, borderRadius: 12, backgroundColor: "#f2f2f2" },
  emptyText: { fontSize: 14, color: "#555" },
  row: { padding: 12, borderRadius: 10, backgroundColor: "#f8f8f8", gap: 4 },
  rowHeader: { flexDirection: "row", justifyContent: "space-between" },
  rowTitle: { fontSize: 15, fontWeight: "600", flexShrink: 1 },
  rowAmount: { fontSize: 15, fontWeight: "600" },
  rowMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  rowMeta: { fontSize: 12, color: "#777", flexShrink: 1 },
  rowCategory: { fontSize: 13, color: "#222", fontWeight: "500" },
  question: { fontSize: 13, color: "#8a5a00", fontStyle: "italic" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#222",
  },
  chipText: { fontSize: 12, color: "#222" },
  correctLink: { marginTop: 4, alignSelf: "flex-start" },
  correctLinkText: {
    fontSize: 12,
    color: "#555",
    textDecorationLine: "underline",
  },
});
