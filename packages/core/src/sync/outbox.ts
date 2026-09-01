/**
 * Local outbox — Vol 12_1 Section 6.1, Sprint 16.
 *
 * Reuses Sprint 9's offline-queue discipline (queue locally, flush on
 * reconnect) rather than inventing a new one — the only new piece is that
 * the queued unit is a SyncEnvelope instead of an AI-interpretation
 * request.
 */
import type { SqlDb } from "../db/types";
import { encryptEnvelopePayload } from "./dek";
import { base64ToBytes, bytesToBase64 } from "./base64";
import { buildEnvelopeId, type OutboxEnvelope, type SyncEntityType, type SyncOp } from "./envelope";
import { claimNextDeviceSeq, getCachedLock } from "./localState";

export interface EnqueueInput {
  businessId: string;
  deviceId: string;
  dek: Uint8Array;
  entityType: SyncEntityType;
  op: SyncOp;
  /** The plain (pre-encryption) row payload — JSON-serialisable. */
  payload: unknown;
}

/**
 * Builds a SyncEnvelope for one local mutation, encrypts its payload with
 * the Business DEK (Sprint 14), and appends it to sync_outbox. Returns the
 * envelope_id so callers/tests can trace a specific write through to its
 * envelope.
 */
export async function enqueueOutboxEnvelope(
  db: SqlDb,
  input: EnqueueInput,
): Promise<string> {
  const deviceSeq = await claimNextDeviceSeq(db, input.businessId, input.deviceId);
  const envelopeId = buildEnvelopeId(input.businessId, input.deviceId, deviceSeq);
  const plaintext = new TextEncoder().encode(JSON.stringify(input.payload));
  const { ciphertext, iv } = encryptEnvelopePayload(input.dek, plaintext);
  const createdAt = new Date().toISOString();

  // Section 6a.4's review-list backstop needs to know which device this
  // write believed was active AT WRITE TIME -- read from the cache as it
  // stands right now, not re-derived later.
  const cachedLock = await getCachedLock(db, input.businessId);
  const writtenAsActiveDeviceId = cachedLock ? cachedLock.activeDeviceId : null;

  await db.execute(
    `INSERT INTO sync_outbox
       (envelope_id, business_id, device_id, device_seq, entity_type, op, payload_ciphertext, payload_iv, created_at, written_as_active_device_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      envelopeId,
      input.businessId,
      input.deviceId,
      deviceSeq,
      input.entityType,
      input.op,
      bytesToBase64(ciphertext),
      bytesToBase64(iv),
      createdAt,
      writtenAsActiveDeviceId,
    ],
  );

  return envelopeId;
}

interface OutboxRow {
  envelope_id: string;
  business_id: string;
  device_id: string;
  device_seq: number;
  entity_type: SyncEntityType;
  op: SyncOp;
  payload_ciphertext: string;
  payload_iv: string;
  created_at: string;
  written_as_active_device_id: string | null;
}

function rowToOutboxEnvelope(row: OutboxRow): OutboxEnvelope {
  return {
    envelopeId: row.envelope_id,
    businessId: row.business_id,
    deviceId: row.device_id,
    deviceSeq: row.device_seq,
    entityType: row.entity_type,
    op: row.op,
    payloadCiphertext: row.payload_ciphertext,
    payloadIv: row.payload_iv,
    createdAt: row.created_at,
    writtenAsActiveDeviceId: row.written_as_active_device_id,
  };
}

/** Pending envelopes, oldest first (push order must match device_seq order). */
export async function listPendingOutbox(
  db: SqlDb,
  businessId: string,
): Promise<OutboxEnvelope[]> {
  const rows = await db.queryAll<OutboxRow>(
    `SELECT * FROM sync_outbox WHERE business_id = ? ORDER BY device_seq ASC;`,
    [businessId],
  );
  return rows.map(rowToOutboxEnvelope);
}

export async function countPendingOutbox(
  db: SqlDb,
  businessId: string,
): Promise<number> {
  const rows = await db.queryAll<{ count: number }>(
    `SELECT COUNT(*) as count FROM sync_outbox WHERE business_id = ?;`,
    [businessId],
  );
  return rows[0]?.count ?? 0;
}

/** Removes an outbox row once its push has been acknowledged (Section 6.1). */
export async function removeOutboxEnvelope(
  db: SqlDb,
  envelopeId: string,
): Promise<void> {
  await db.execute(`DELETE FROM sync_outbox WHERE envelope_id = ?;`, [envelopeId]);
}

/** Decrypts an outbox (or wire) envelope's payload back to its plain JS value. Exported for tests/diagnostics. */
export function decodeEnvelopePayload<T = unknown>(
  dek: Uint8Array,
  payloadCiphertextBase64: string,
  payloadIvBase64: string,
  decryptFn: (dek: Uint8Array, ciphertext: Uint8Array, iv: Uint8Array) => Uint8Array,
): T {
  const ciphertext = base64ToBytes(payloadCiphertextBase64);
  const iv = base64ToBytes(payloadIvBase64);
  const plaintextBytes = decryptFn(dek, ciphertext, iv);
  return JSON.parse(new TextDecoder().decode(plaintextBytes)) as T;
}
