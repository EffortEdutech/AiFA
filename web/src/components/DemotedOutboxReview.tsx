import { useState } from "react";

import type { SqlDb } from "@aifa/core/db/types";

import {
  sendReviewedDemotedOutbox,
  type DemotedOutboxReview as DemotedOutboxReviewData,
} from "../lib/syncService";
import { Button } from "../ui";

/**
 * Web counterpart to app/src/components/DemotedOutboxReview.tsx — see
 * that file's header comment for the full Vol 12_1 Section 6a.4/Section 7
 * reasoning (identical here: Section 7.2's conflict is already resolved
 * by the time this renders; this is only the review-and-send half).
 *
 * UI polish Phase 2: restyled as a notice bar; wording and behaviour
 * unchanged.
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
    <div role="alert" className="aifa-banner aifa-banner--info aifa-banner--stack">
      <strong>This device was offline while another device took over</strong>

      {review.resolvedConflicts.map((c) => (
        <p key={c.originalEventId} className="aifa-banner__line">
          A correction made on this device was already made on another device — this
          device's copy was discarded to avoid double-counting.
        </p>
      ))}

      {review.safeToSendItems.length > 0 && (
        <div className="aifa-banner__line">
          <p style={{ margin: "0 0 8px" }}>
            {review.safeToSendItems.length} item{review.safeToSendItems.length === 1 ? "" : "s"}{" "}
            captured on this device before it was deactivated — review, then send.
          </p>
          <Button
            size="sm"
            variant="primary"
            loading={isSending}
            onClick={() => {
              handleSend().catch(() => {});
            }}
          >
            {isSending ? "Sending…" : "Send now"}
          </Button>
        </div>
      )}

      {review.provenanceNotes.map((note) => (
        <p key={`${note.entityType}-${note.entityId}`} className="aifa-banner__line aifa-banner__note">
          {ENTITY_TYPE_LABELS[note.entityType] ?? note.entityType}: {note.note}
        </p>
      ))}

      {error && <p className="aifa-banner__error">{error}</p>}
    </div>
  );
}
