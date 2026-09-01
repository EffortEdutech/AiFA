/**
 * Offline-Demoted-Device Reconciliation — Vol 12_1 Section 7, Sprint 20.
 *
 * The narrow backstop case Section 6a.4 describes: a device queued local
 * writes while offline, unaware it had already been demoted, and now
 * needs those writes reconciled per Section 7's entity-by-entity table
 * before any of them can safely be sent (or, for the one genuine
 * conflict case, before they can safely be discarded).
 *
 * Split in two, matching Section 7's own split between "mechanical,
 * automatic" and "owner needs to see this before it goes anywhere":
 *
 *  - Section 7.2's status_transition conflict is resolved HERE,
 *    automatically, the moment a demotion is detected (runSyncCycle
 *    calls this right after its pull) — correcting this device's own
 *    local view to match the server-canonical winner is a data-safety
 *    fix, not something that should wait on the owner noticing a review
 *    screen. It is exactly what Section 7.2 already specifies: "the
 *    transition that reaches the trigger second is rejected."
 *  - Section 7.1 (append-only, never conflicting) and Section 7.3
 *    (low-stakes upserts) genuinely need no correction at all, only
 *    review — Section 6a.4's "N items captured on this device before it
 *    was deactivated — review before sending" list. Whatever remains in
 *    the outbox once this module has removed the one genuine conflict
 *    case is, by Section 7's own reasoning, already safe to send exactly
 *    as any other queued write. `reviewDemotedOutbox`'s job is only to
 *    describe that remainder for the owner, not to further gate it.
 */
import {
  deleteDiscardedCorrectionEventAndData,
  forceResetSupersededByForReconciliation,
  getBusinessDataByEventId,
  getBusinessEventById,
  setSupersededBy,
  type BusinessEvent,
} from "../db/businessEventRepository";
import { deleteLedgerEntriesForBusinessData } from "../db/ledgerRepository";
import type { SqlDb } from "../db/types";
import { decryptEnvelopePayload } from "./dek";
import type { SyncEntityType, WireEnvelope } from "./envelope";
import { decodeEnvelopePayload, listPendingOutbox, removeOutboxEnvelope } from "./outbox";
import { runAsPulledEnvelopeApplication } from "./syncContext";

interface StatusTransitionPayload {
  eventId?: string;
  status?: BusinessEvent["status"];
  originalEventId?: string;
  correctingEventId?: string;
}

/** One conflict Section 7.2 resolved this call — surfaced for the owner's review list. */
export interface ResolvedConflict {
  originalEventId: string;
  /** This device's own correcting event id — discarded, never sent. */
  discardedCorrectingEventId: string;
  /** The correcting event id that reached the server first and now canonically stands. */
  winningCorrectingEventId: string;
}

/** Section 7.3 — informational only; the item is still safe to send. */
export interface ProvenanceNote {
  entityType: SyncEntityType;
  entityId: string;
  note: string;
}

/**
 * Runs Section 7.2's automatic conflict resolution against this device's
 * own pending outbox, using the WireEnvelopes this sync cycle's pull just
 * could not apply (PullResult.failedEnvelopes). Safe to call even when
 * there is nothing to reconcile (returns an empty list); safe to call
 * more than once (a bundle already discarded simply has nothing left to
 * match against on a second call).
 *
 * For each pending business_event_status_transition envelope whose
 * (originalEventId) matches a failed pulled envelope's
 * (originalEventId): this device's own correction lost the race. Its
 * local view (which still shows ITS OWN correction as the winner — see
 * this module's header and applyEnvelope.ts's comment on why the pulled
 * envelope was the one rejected, backwards from the server-canonical
 * truth) is corrected to match the winner, this device's own
 * now-orphaned correction rows are deleted, and every outbox envelope
 * belonging to that losing correction bundle (the status_transition
 * itself, plus the correction's own business_event/business_data/
 * ledger_entry inserts — never its reversal entries, which are already
 * harmlessly idempotent with the winner's own reversal via their shared
 * `{id}-REV` deterministic id) is removed so none of it is ever sent.
 */
export async function resolveStatusTransitionConflicts(
  db: SqlDb,
  businessId: string,
  dek: Uint8Array,
  failedEnvelopes: WireEnvelope[],
): Promise<ResolvedConflict[]> {
  const failedTransitions = failedEnvelopes.filter(
    (e) => e.entityType === "business_event_status_transition",
  );
  if (failedTransitions.length === 0) return [];

  const pending = await listPendingOutbox(db, businessId);
  const resolved: ResolvedConflict[] = [];

  for (const failed of failedTransitions) {
    const winnerPayload = decodeEnvelopePayload<StatusTransitionPayload>(
      dek,
      failed.payloadCiphertext,
      failed.payloadIv,
      decryptEnvelopePayload,
    );
    if (!winnerPayload.originalEventId || !winnerPayload.correctingEventId) continue;

    const myTransition = pending.find((e) => {
      if (e.entityType !== "business_event_status_transition") return false;
      const p = decodeEnvelopePayload<StatusTransitionPayload>(
        dek,
        e.payloadCiphertext,
        e.payloadIv,
        decryptEnvelopePayload,
      );
      return p.originalEventId === winnerPayload.originalEventId;
    });
    if (!myTransition) continue; // not my conflict -- some other device's history, nothing local to fix

    const myPayload = decodeEnvelopePayload<StatusTransitionPayload>(
      dek,
      myTransition.payloadCiphertext,
      myTransition.payloadIv,
      decryptEnvelopePayload,
    );
    const myCorrectingEventId = myPayload.correctingEventId as string;
    const originalEventId = winnerPayload.originalEventId;
    const winningCorrectingEventId = winnerPayload.correctingEventId;

    if (myCorrectingEventId === winningCorrectingEventId) {
      // Same envelope content, somehow both delivered and both "failed" --
      // not a real conflict (most likely an idempotent replay). Leave it
      // alone rather than discarding a non-conflicting write.
      continue;
    }

    const original = await getBusinessEventById(db, originalEventId);
    if (!original || original.superseded_by !== myCorrectingEventId) {
      // Local state isn't in the exact shape this resolution assumes --
      // conservatively skip rather than risk touching the wrong row.
      // Left in the outbox for manual owner review instead.
      continue;
    }

    const myData = await getBusinessDataByEventId(db, myCorrectingEventId);

    await runAsPulledEnvelopeApplication(async () => {
      if (myData) {
        await deleteLedgerEntriesForBusinessData(db, myData.id);
        await deleteDiscardedCorrectionEventAndData(db, myCorrectingEventId, myData.id);
      }
      await forceResetSupersededByForReconciliation(db, originalEventId, null);
      await setSupersededBy(db, originalEventId, winningCorrectingEventId);
    });

    // Remove every outbox envelope belonging to the discarded bundle: the
    // status_transition itself, plus the correction's own inserts
    // (matched by decoded payload id, not by guessing this repository's
    // id-derivation scheme -- keeps this module decoupled from
    // businessEventRepository/ledgerRepository's internal id formats).
    const stillPending = await listPendingOutbox(db, businessId);
    for (const envelope of stillPending) {
      if (envelope.entityType === "business_event_status_transition") {
        const p = decodeEnvelopePayload<StatusTransitionPayload>(
          dek,
          envelope.payloadCiphertext,
          envelope.payloadIv,
          decryptEnvelopePayload,
        );
        // Matches either shape applyEnvelope.ts's status_transition case
        // decodes: the supersede transition on the ORIGINAL event
        // (originalEventId/correctingEventId), or the discarded
        // correction's own "confirm myself" transition (eventId/status,
        // from finalizeCategory's setBusinessEventStatus call) -- both
        // belong to the same discarded bundle and reference an id that
        // no longer exists locally once the rows above are deleted.
        const belongsToDiscardedBundle =
          (p.originalEventId === originalEventId && p.correctingEventId === myCorrectingEventId) ||
          p.eventId === myCorrectingEventId;
        if (belongsToDiscardedBundle) {
          await removeOutboxEnvelope(db, envelope.envelopeId);
        }
        continue;
      }
      if (envelope.entityType === "business_event" || envelope.entityType === "business_data") {
        const p = decodeEnvelopePayload<{ id?: string }>(
          dek,
          envelope.payloadCiphertext,
          envelope.payloadIv,
          decryptEnvelopePayload,
        );
        if (p.id === myCorrectingEventId || (myData && p.id === myData.id)) {
          await removeOutboxEnvelope(db, envelope.envelopeId);
        }
        continue;
      }
      if (envelope.entityType === "ledger_entry") {
        const p = decodeEnvelopePayload<{ business_data_id?: string; reversal_of?: string | null }>(
          dek,
          envelope.payloadCiphertext,
          envelope.payloadIv,
          decryptEnvelopePayload,
        );
        // Only the correction's OWN new entries (reversal_of === null) --
        // its reversal entries stay queued and are safe to send (header
        // comment above).
        if (myData && p.business_data_id === myData.id && !p.reversal_of) {
          await removeOutboxEnvelope(db, envelope.envelopeId);
        }
      }
    }

    resolved.push({
      originalEventId,
      discardedCorrectingEventId: myCorrectingEventId,
      winningCorrectingEventId,
    });
  }

  return resolved;
}

/** Reads the id a given upsert entity's envelope payload is keyed by — business_knowledge_entry uses `id`, app_settings uses `business_id` (Phase 1's single-row-per-business design, appSettingsRepository.ts). */
function upsertEntityId(dek: Uint8Array, envelope: WireEnvelope | { payloadCiphertext: string; payloadIv: string }): string | undefined {
  const p = decodeEnvelopePayload<{ id?: string; business_id?: string }>(
    dek,
    envelope.payloadCiphertext,
    envelope.payloadIv,
    decryptEnvelopePayload,
  );
  return p.id ?? p.business_id;
}

/** Section 7.3 — cross-references this device's still-pending upserts against what this pull just applied, for an owner-facing provenance note. Purely informational; never removes anything. */
export function buildProvenanceNotes(
  dek: Uint8Array,
  pendingUpsertEnvelopes: { entityType: SyncEntityType; entityId: string }[],
  appliedEnvelopes: WireEnvelope[],
): ProvenanceNote[] {
  const notes: ProvenanceNote[] = [];
  const upsertKinds: SyncEntityType[] = ["business_knowledge_entry", "app_settings"];
  const appliedUpserts = appliedEnvelopes.filter((e) => upsertKinds.includes(e.entityType));

  for (const pending of pendingUpsertEnvelopes) {
    const collision = appliedUpserts.find(
      (e) =>
        e.entityType === pending.entityType &&
        upsertEntityId(dek, e) === pending.entityId,
    );
    if (!collision) continue;
    notes.push({
      entityType: pending.entityType,
      entityId: pending.entityId,
      note: `Also updated on another device on ${collision.createdAt.slice(0, 10)} — the most recently sent change will apply.`,
    });
  }
  return notes;
}

export interface DemotedOutboxReviewItem {
  envelopeId: string;
  entityType: SyncEntityType;
  createdAt: string;
}

export interface DemotedOutboxReview {
  /** True once there is anything at all worth showing the owner (queued items, or a resolved-conflict notice). */
  hasContent: boolean;
  resolvedConflicts: ResolvedConflict[];
  /** Everything left in the outbox after conflict resolution — safe to send exactly as any other queued write (Section 7.1/7.3). */
  safeToSendItems: DemotedOutboxReviewItem[];
  provenanceNotes: ProvenanceNote[];
}

/**
 * The full Section 6a.4 review-list builder: resolves Section 7.2's
 * conflicts (mutating local state as described above), then describes
 * whatever safely remains for the owner's "N items captured on this
 * device before it was deactivated" screen. Call once per demotion
 * discovery (runSyncCycle.ts wires this in); safe to call again on a
 * later cycle if the owner hasn't reviewed yet — already-resolved
 * conflicts simply find nothing left to match.
 */
export async function reconcileAndReviewDemotedOutbox(
  db: SqlDb,
  businessId: string,
  dek: Uint8Array,
  failedEnvelopes: WireEnvelope[],
  appliedEnvelopes: WireEnvelope[],
): Promise<DemotedOutboxReview> {
  const resolvedConflicts = await resolveStatusTransitionConflicts(
    db,
    businessId,
    dek,
    failedEnvelopes,
  );

  const remaining = await listPendingOutbox(db, businessId);
  const safeToSendItems: DemotedOutboxReviewItem[] = remaining.map((e) => ({
    envelopeId: e.envelopeId,
    entityType: e.entityType,
    createdAt: e.createdAt,
  }));

  const upsertKinds: SyncEntityType[] = ["business_knowledge_entry", "app_settings"];
  const pendingUpserts = remaining
    .filter((e) => upsertKinds.includes(e.entityType))
    .map((e) => ({
      entityType: e.entityType,
      entityId: upsertEntityId(dek, e) ?? e.envelopeId,
    }));
  const provenanceNotes = buildProvenanceNotes(dek, pendingUpserts, appliedEnvelopes);

  return {
    hasContent: resolvedConflicts.length > 0 || safeToSendItems.length > 0,
    resolvedConflicts,
    safeToSendItems,
    provenanceNotes,
  };
}
