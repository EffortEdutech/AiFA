/**
 * Sprint 20 (Vol 12_1 Section 6a.4, Section 7) — the owner-facing half of
 * the offline-demoted-device backstop: "N items captured on this device
 * before it was deactivated — review before sending."
 *
 * Section 7.2's conflict (a status transition this device made offline
 * that lost the race to another device's) is ALREADY resolved by the
 * time this component ever renders anything — reconciliation.ts runs
 * automatically inside the sync cycle that discovered the demotion, not
 * on a button press here (see that module's header comment on why: a
 * data-safety correction to this device's own local view shouldn't wait
 * on the owner noticing a screen). This component has two, simpler jobs:
 * tell the owner when a conflict WAS found and resolved on their behalf
 * (`resolvedConflicts`), and let them review and send whatever remains
 * (`safeToSendItems`) — which, per Section 7.1/7.3, is already safe to
 * send exactly as any other queued write.
 */
import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { DemotedOutboxReview as DemotedOutboxReviewData } from "@/db/syncService";
import { sendReviewedDemotedOutbox } from "@/db/syncService";

const ENTITY_TYPE_LABELS: Record<string, string> = {
  business_event: "A captured item",
  business_data: "Capture details",
  ledger_entry: "A bookkeeping entry",
  document: "A receipt/document",
  ai_interpretation: "An AI categorisation",
  business_event_status_transition: "A confirmation/correction",
  business_knowledge_entry: "A vendor category update",
  app_settings: "A settings change",
};

export interface DemotedOutboxReviewProps {
  businessId: string;
  review: DemotedOutboxReviewData;
  onSent?: () => void;
}

export function DemotedOutboxReview({
  businessId,
  review,
  onSent,
}: DemotedOutboxReviewProps) {
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!review.hasContent || sent) return null;

  const handleSend = async () => {
    setIsSending(true);
    setError(null);
    try {
      await sendReviewedDemotedOutbox(businessId);
      setSent(true);
      onSent?.();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not send these items — try again once you're back online.",
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <View style={styles.card} accessibilityRole="alert">
      <Text style={styles.title}>
        This device was offline while another device took over
      </Text>

      {review.resolvedConflicts.length > 0 && (
        <View style={styles.section}>
          {review.resolvedConflicts.map((c) => (
            <Text key={c.originalEventId} style={styles.body}>
              A correction made on this device was already made on another
              device — this device's copy was discarded to avoid
              double-counting.
            </Text>
          ))}
        </View>
      )}

      {review.safeToSendItems.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.body}>
            {review.safeToSendItems.length} item
            {review.safeToSendItems.length === 1 ? "" : "s"} captured on this
            device before it was deactivated — review, then send.
          </Text>
          <Pressable
            onPress={() => {
              handleSend().catch(() => {});
            }}
            disabled={isSending}
            style={styles.button}
            accessibilityRole="button"
          >
            {isSending ? (
              <ActivityIndicator size="small" color="#0a2a4a" />
            ) : (
              <Text style={styles.buttonText}>Send now</Text>
            )}
          </Pressable>
        </View>
      )}

      {review.provenanceNotes.map((note) => (
        <Text
          key={`${note.entityType}-${note.entityId}`}
          style={styles.provenance}
        >
          {ENTITY_TYPE_LABELS[note.entityType] ?? note.entityType}: {note.note}
        </Text>
      ))}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#eaf2ff",
    borderColor: "#0a2a4a",
    borderWidth: 1,
    borderRadius: 8,
    margin: 8,
    padding: 12,
  },
  title: {
    fontWeight: "700",
    fontSize: 13,
    color: "#0a2a4a",
    marginBottom: 6,
  },
  section: {
    marginTop: 4,
  },
  body: {
    fontSize: 12,
    color: "#0a2a4a",
  },
  provenance: {
    fontSize: 11,
    color: "#4a5a70",
    marginTop: 4,
  },
  button: {
    marginTop: 8,
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 4,
    backgroundColor: "#0a2a4a",
  },
  buttonText: {
    color: "#eaf2ff",
    fontSize: 12,
    fontWeight: "600",
  },
  error: {
    color: "#a3271d",
    fontSize: 11,
    marginTop: 6,
  },
});
