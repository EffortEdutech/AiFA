/**
 * "Why" drill-down data — Vol 5_3 Section 4 (explainability enforcement),
 * Vol 1_2 Section 5 ("what did you record, why, and where did that come
 * from?"). Sprint 11. Assembles everything a single owner-facing figure's
 * drill-down needs from data every AI-interpreted capture has been
 * quietly storing since Sprint 3 (`ai_interpretations`) — this module
 * does no new capture, it only reads and interprets what already exists.
 *
 * One shared confidence-state classification (`WhyConfidenceState`) is
 * used everywhere this data is shown (ActivityFeed, Dashboard outstanding
 * lists/notifications, Workspace recommendation card) so a low-confidence
 * or not-yet-interpreted item is never visually indistinguishable from a
 * confident one, per Vol 5_3 Section 3's explicit requirement.
 */
import {
  listAiInterpretationsForEvent,
  type AiInterpretation,
} from "../db/aiInterpretationRepository";
import {
  getActivityItemByEventId,
  getBusinessEventById,
  type BusinessData,
  type BusinessEvent,
} from "../db/businessEventRepository";
import type { SqlDb } from "../db/types";

export type WhyConfidenceState =
  /** AI classified it and the owner never had to intervene (auto_record). */
  | "confirmed_high_confidence"
  /** AI proposed a category (draft_confirm or clarify) and the owner picked/confirmed one themselves. */
  | "confirmed_after_review"
  /** Still sitting as a draft, awaiting the owner's confirmation. */
  | "needs_review_low_confidence"
  /** AI could not confidently classify it; a clarifying question is outstanding. */
  | "awaiting_clarification"
  /** Captured but not yet reached by AI at all (offline/queued, or mid-flight). */
  | "queued_not_yet_interpreted"
  /** Banking (or any other non-AI-interpreted domain) — deterministic, no AI ever involved (Vol 6_4). */
  | "manual_no_ai";

export interface WhyDetail {
  event: BusinessEvent;
  data: BusinessData | null;
  /** Full interpretation history for this event, oldest first — a resumed/retried event can have more than one row. */
  interpretations: AiInterpretation[];
  /** Convenience — interpretations[interpretations.length - 1], or null. */
  latest: AiInterpretation | null;
  confidenceState: WhyConfidenceState;
  /** True when this event was later corrected (Vol 4_1 §4 reversal-based correction) — shown as a note regardless of confidenceState. */
  wasCorrected: boolean;
}

const AI_INTERPRETED_DOMAINS = new Set(["expense", "sale", "purchase"]);

function deriveConfidenceState(
  event: BusinessEvent,
  latest: AiInterpretation | null,
): WhyConfidenceState {
  if (!AI_INTERPRETED_DOMAINS.has(event.domain_hint)) {
    return "manual_no_ai";
  }
  switch (event.status) {
    case "queued":
    case "processing":
      return "queued_not_yet_interpreted";
    case "needs_clarification":
      return "awaiting_clarification";
    case "draft":
      return "needs_review_low_confidence";
    case "confirmed":
    case "superseded":
      if (latest?.decision === "auto_record") {
        return "confirmed_high_confidence";
      }
      // Reached 'confirmed' with no auto_record interpretation (or none at
      // all) means an owner action finalised it -- confirmCategory on a
      // draft/clarify, or a correction's brand-new confirmed event.
      return "confirmed_after_review";
    default:
      return "queued_not_yet_interpreted";
  }
}

/**
 * Fetches everything the "why" drill-down needs for one Business Event.
 * Returns null when the id doesn't resolve to a real event -- callers
 * (e.g. a Workspace Q&A turn's `sources`, which can be a descriptive
 * string like "cash_position" rather than a real event id) must treat
 * null as "no further detail available," not an error.
 */
export async function getWhyDetailForEvent(
  db: SqlDb,
  businessEventId: string,
): Promise<WhyDetail | null> {
  const event = await getBusinessEventById(db, businessEventId);
  if (!event) return null;

  const [activityItem, interpretations] = await Promise.all([
    getActivityItemByEventId(db, businessEventId),
    listAiInterpretationsForEvent(db, businessEventId),
  ]);

  const latest = interpretations[interpretations.length - 1] ?? null;

  return {
    event,
    data: activityItem?.data ?? null,
    interpretations,
    latest,
    confidenceState: deriveConfidenceState(event, latest),
    wasCorrected: !!event.superseded_by,
  };
}
