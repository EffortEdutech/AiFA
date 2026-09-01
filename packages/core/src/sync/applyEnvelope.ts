/**
 * Pull-side envelope application — Vol 12_1 Section 6.2/6.3, Sprint 16.
 *
 * "Applying a pulled envelope must go through the same validation/
 * construction logic as a local write... not a separate deserialisation
 * path that could drift from it." Concretely: every branch below calls
 * the SAME repository module that owns that entity's local write path
 * (ledgerRepository.createLedgerEntries, appSettingsRepository.writeSettings,
 * etc.) — either the exact same exported function (where the existing
 * function was already id-deterministic/idempotent), or a small sibling
 * function added in Sprint 16 living in that same file, for the narrow
 * set of entities whose local-write function mints its own id and so
 * cannot accept the envelope's already-assigned one (see each
 * applyPulled* function's own doc for why).
 *
 * Wrapped in runAsPulledEnvelopeApplication (syncContext.ts) so none of
 * these calls re-triggers the write gate or re-queues into this device's
 * own outbox — see that module's doc for why both would be wrong here.
 */
import type { SqlDb } from "../db/types";
import { applyPulledAiInterpretation } from "../db/aiInterpretationRepository";
import { writeSettings, type AppSettings } from "../db/appSettingsRepository";
import {
  applyPulledBusinessData,
  applyPulledBusinessEvent,
  setBusinessEventStatus,
  setSupersededBy,
  type BusinessData,
  type BusinessEvent,
} from "../db/businessEventRepository";
import {
  applyPulledBusinessKnowledgeEntry,
  type BusinessKnowledgeEntry,
} from "../db/businessKnowledgeRepository";
import { saveDocument, type DocumentRecord, type DocumentBlob } from "../db/documentRepository";
import { applyPulledLedgerEntry, type LedgerEntry } from "../db/ledgerRepository";
import type { AiInterpretation } from "../db/aiInterpretationRepository";
import { decryptEnvelopePayload } from "./dek";
import { decodeEnvelopePayload } from "./outbox";
import { runAsPulledEnvelopeApplication } from "./syncContext";
import type { WireEnvelope } from "./envelope";

interface StatusTransitionPayload {
  eventId?: string;
  status?: BusinessEvent["status"];
  originalEventId?: string;
  correctingEventId?: string;
}

/**
 * Decrypts and applies one pulled envelope. Safe to call twice for the
 * same envelope (Section 6.3) — every branch below is idempotent by
 * construction (see the imported functions' own docs).
 */
export async function applyPulledEnvelope(
  db: SqlDb,
  envelope: WireEnvelope,
  dek: Uint8Array,
): Promise<void> {
  await runAsPulledEnvelopeApplication(async () => {
    switch (envelope.entityType) {
      case "business_event": {
        const event = decodeEnvelopePayload<BusinessEvent>(
          dek,
          envelope.payloadCiphertext,
          envelope.payloadIv,
          decryptEnvelopePayload,
        );
        await applyPulledBusinessEvent(db, event);
        return;
      }
      case "business_data": {
        const data = decodeEnvelopePayload<BusinessData>(
          dek,
          envelope.payloadCiphertext,
          envelope.payloadIv,
          decryptEnvelopePayload,
        );
        await applyPulledBusinessData(db, data);
        return;
      }
      case "business_event_status_transition": {
        const payload = decodeEnvelopePayload<StatusTransitionPayload>(
          dek,
          envelope.payloadCiphertext,
          envelope.payloadIv,
          decryptEnvelopePayload,
        );
        if (payload.eventId && payload.status) {
          await setBusinessEventStatus(db, payload.eventId, payload.status);
        } else if (payload.originalEventId && payload.correctingEventId) {
          // The migration-4 immutability trigger is what actually
          // arbitrates a genuine conflict here (Vol 12_1 Section 7.2):
          // if this business event was already superseded locally (e.g.
          // by this device's own not-yet-pushed queued correction, the
          // Section 6a.4 backstop case), the trigger rejects the second
          // linkage attempt and this throws. That is the correct,
          // intentional behaviour — callers (syncClient.ts) must not
          // treat it as a fatal sync error, only as "this particular
          // transition lost the race," matching Vol 12_1 Section 7.2's
          // "whichever transition reaches the trigger second is
          // rejected."
          await setSupersededBy(db, payload.originalEventId, payload.correctingEventId);
        }
        return;
      }
      case "ledger_entry": {
        const entry = decodeEnvelopePayload<LedgerEntry>(
          dek,
          envelope.payloadCiphertext,
          envelope.payloadIv,
          decryptEnvelopePayload,
        );
        await applyPulledLedgerEntry(db, entry);
        return;
      }
      case "document": {
        const payload = decodeEnvelopePayload<{ document: DocumentRecord; blob: DocumentBlob }>(
          dek,
          envelope.payloadCiphertext,
          envelope.payloadIv,
          decryptEnvelopePayload,
        );
        await saveDocument(db, {
          businessEventId: payload.document.business_event_id,
          type: payload.document.type,
          extractionStatus: payload.document.extraction_status,
          mimeType: payload.blob.mime_type,
          base64Data: payload.blob.base64_data,
        });
        return;
      }
      case "ai_interpretation": {
        const record = decodeEnvelopePayload<AiInterpretation>(
          dek,
          envelope.payloadCiphertext,
          envelope.payloadIv,
          decryptEnvelopePayload,
        );
        await applyPulledAiInterpretation(db, record);
        return;
      }
      case "business_knowledge_entry": {
        const entry = decodeEnvelopePayload<BusinessKnowledgeEntry>(
          dek,
          envelope.payloadCiphertext,
          envelope.payloadIv,
          decryptEnvelopePayload,
        );
        await applyPulledBusinessKnowledgeEntry(db, entry);
        return;
      }
      case "app_settings": {
        const settings = decodeEnvelopePayload<AppSettings>(
          dek,
          envelope.payloadCiphertext,
          envelope.payloadIv,
          decryptEnvelopePayload,
        );
        await writeSettings(db, settings);
        return;
      }
      default: {
        const exhaustiveCheck: never = envelope.entityType;
        throw new Error(`applyPulledEnvelope: unhandled entity_type ${String(exhaustiveCheck)}`);
      }
    }
  });
}
