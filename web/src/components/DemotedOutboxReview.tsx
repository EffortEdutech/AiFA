import { useState } from "react";

import type { SqlDb } from "@aifa/core/db/types";

import {
  sendReviewedDemotedOutbox,
  type DemotedOutboxReview as DemotedOutboxReviewData,
} from "../lib/syncService";

/**
 * Web counterpart to app/src/components/DemotedOutboxReview.tsx — see
 * that file's header comment for the full Vol 12_1 Section 6a.4/Section 7
 * reasoning (identical here: Section 7.2's conflict is already resolved
 * by the time this renders; this is only the review-and-send half).
 */
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

interface Props {
  db: SqlDb;
  businessId: string;
  review: DemotedOutboxReviewData;
  onSent?: () => void;
}

export function DemotedOutboxReview({ db, businessId, review, onSent }: Props): JSX.Element | null {
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!review.hasContent || sent) return null;

  const handleSend = async () => {
    setIsSending(true);
    setError(null);
    try {
      await sendReviewedDemotedOutbox(db, businessId);
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
    <div
      role="alert"
      style={{
        background: "#eaf2ff",
        border: "1px solid #0a2a4a",
        borderRadius: 8,
        margin: 8,
        padding: 12,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 13, color: "#0a2a4a", marginBottom: 6 }}>
        This device was offline while another device took over
      </div>

      {review.resolvedConflicts.map((c) => (
        <p key={c.originalEventId} style={{ fontSize: 12, color: "#0a2a4a", margin: "4px 0" }}>
          A correction made on this device was already made on another device — this
          device's copy was discarded to avoid double-counting.
        </p>
      ))}

      {review.safeToSendItems.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <p style={{ fontSize: 12, color: "#0a2a4a", margin: "4px 0" }}>
            {review.safeToSendItems.length} item{review.safeToSendItems.length === 1 ? "" : "s"}{" "}
            captured on this device before it was deactivated — review, then send.
          </p>
          <button
            onClick={() => {
              handleSend().catch(() => {});
            }}
            disabled={isSending}
            style={{
              marginTop: 8,
              padding: "6px 12px",
              borderRadius: 4,
              background: "#0a2a4a",
              color: "#eaf2ff",
              border: "none",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {isSending ? "Sending…" : "Send now"}
          </button>
        </div>
      )}

      {review.provenanceNotes.map((note) => (
        <p key={`${note.entityType}-${note.entityId}`} style={{ fontSize: 11, color: "#4a5a70", margin: "4px 0" }}>
          {ENTITY_TYPE_LABELS[note.entityType] ?? note.entityType}: {note.note}
        </p>
      ))}

      {error && <p style={{ color: "#a3271d", fontSize: 11, marginTop: 6 }}>{error}</p>}
    </div>
  );
}
