/**
 * Document repository — Vol 11_1 §5, Vol 7_6 (Document & Receipt
 * Experience). The image bytes live in `document_blobs` (base64, inside
 * this SQLCipher-encrypted database — see migration 5's comment in
 * migrations.ts for why); `documents` is the linked metadata row.
 */
import type { SqlDb } from "./types";
import { assertSyncGateOk, enqueueSyncableWrite } from "../sync/syncHooks";

export type DocumentType = "receipt" | "invoice" | "statement" | "other";
export type ExtractionStatus =
  "not_attempted" | "partial" | "complete" | "failed";

export interface DocumentRecord {
  id: string;
  business_event_id: string;
  file_ref: string; // document_blobs.id
  type: DocumentType;
  extraction_status: ExtractionStatus;
  created_at: string;
}

export interface DocumentBlob {
  id: string;
  mime_type: string;
  base64_data: string;
  byte_size: number;
  created_at: string;
}

export interface SaveDocumentInput {
  businessEventId: string;
  type: DocumentType;
  extractionStatus: ExtractionStatus;
  mimeType: string;
  base64Data: string;
}

function documentId(businessEventId: string): string {
  return `DOC-${businessEventId.replace(/^BE-/, "")}`;
}

/**
 * Persists a captured image (as a blob row) and its linking Document
 * metadata row together. One document per BusinessEvent in Phase 1 (a
 * receipt-in-hand capture produces exactly one photo); a future sprint
 * that supports multi-page receipts would need a per-event sequence in
 * the id instead of this 1:1 assumption.
 */
export async function saveDocument(
  db: SqlDb,
  input: SaveDocumentInput,
): Promise<{ document: DocumentRecord; blob: DocumentBlob }> {
  await assertSyncGateOk(db);
  const now = new Date().toISOString();
  const docId = documentId(input.businessEventId);
  const blobId = `${docId}-BLOB`;
  const byteSize = Math.ceil((input.base64Data.length * 3) / 4); // approx decoded size

  // Sprint 16: switched to OR IGNORE (was a plain INSERT) so this
  // function is safe to call twice with the same deterministic
  // (businessEventId-derived) id -- required for pulled-envelope replay
  // idempotency (Vol 12_1 Section 6.3); harmless for the pre-existing
  // local-capture call path, which never legitimately calls this twice
  // for the same event.
  await db.execute(
    `INSERT OR IGNORE INTO document_blobs (id, mime_type, base64_data, byte_size, created_at)
     VALUES (?, ?, ?, ?, ?);`,
    [blobId, input.mimeType, input.base64Data, byteSize, now],
  );

  await db.execute(
    `INSERT OR IGNORE INTO documents (id, business_event_id, file_ref, type, extraction_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?);`,
    [
      docId,
      input.businessEventId,
      blobId,
      input.type,
      input.extractionStatus,
      now,
    ],
  );

  const document: DocumentRecord = {
    id: docId,
    business_event_id: input.businessEventId,
    file_ref: blobId,
    type: input.type,
    extraction_status: input.extractionStatus,
    created_at: now,
  };
  const blob: DocumentBlob = {
    id: blobId,
    mime_type: input.mimeType,
    base64_data: input.base64Data,
    byte_size: byteSize,
    created_at: now,
  };
  await enqueueSyncableWrite(db, "document", "insert", { document, blob });
  return { document, blob };
}

export async function updateExtractionStatus(
  db: SqlDb,
  documentId: string,
  status: ExtractionStatus,
): Promise<void> {
  await db.execute(`UPDATE documents SET extraction_status = ? WHERE id = ?;`, [
    status,
    documentId,
  ]);
}

export async function listDocumentsForEvent(
  db: SqlDb,
  businessEventId: string,
): Promise<DocumentRecord[]> {
  return db.queryAll<DocumentRecord>(
    `SELECT * FROM documents WHERE business_event_id = ? ORDER BY created_at ASC;`,
    [businessEventId],
  );
}

/**
 * Basic browsable document library (Vol 7_6 §3) — functional access, not
 * yet the polished search/filter UX (explicitly safe to carry over per the
 * Sprint 5 plan). Joins in the owning BusinessEvent's captured_at/
 * counterparty context via business_data so the library can show something
 * more useful than a bare id.
 */
export interface DocumentLibraryItem {
  document: DocumentRecord;
  eventCapturedAt: string;
  counterpartyName: string | null;
  amount: number | null;
  currency: string | null;
}

export async function listDocumentLibrary(
  db: SqlDb,
  businessId: string,
  limit = 100,
): Promise<DocumentLibraryItem[]> {
  const rows = await db.queryAll<{
    id: string;
    business_event_id: string;
    file_ref: string;
    type: DocumentType;
    extraction_status: ExtractionStatus;
    created_at: string;
    event_captured_at: string;
    counterparty_name: string | null;
    amount: number | null;
    currency: string | null;
  }>(
    `SELECT
       d.id as id, d.business_event_id as business_event_id, d.file_ref as file_ref,
       d.type as type, d.extraction_status as extraction_status, d.created_at as created_at,
       be.captured_at as event_captured_at,
       bd.counterparty_name as counterparty_name, bd.amount as amount, bd.currency as currency
     FROM documents d
     JOIN business_events be ON be.id = d.business_event_id
     LEFT JOIN business_data bd ON bd.business_event_id = be.id
     WHERE be.business_id = ?
     ORDER BY d.created_at DESC
     LIMIT ?;`,
    [businessId, limit],
  );

  return rows.map((row) => ({
    document: {
      id: row.id,
      business_event_id: row.business_event_id,
      file_ref: row.file_ref,
      type: row.type,
      extraction_status: row.extraction_status,
      created_at: row.created_at,
    },
    eventCapturedAt: row.event_captured_at,
    counterpartyName: row.counterparty_name,
    amount: row.amount,
    currency: row.currency,
  }));
}

export async function getDocumentBlob(
  db: SqlDb,
  blobId: string,
): Promise<DocumentBlob | null> {
  const rows = await db.queryAll<DocumentBlob>(
    `SELECT * FROM document_blobs WHERE id = ?;`,
    [blobId],
  );
  return rows[0] ?? null;
}
