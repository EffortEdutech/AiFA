/**
 * Sync Envelope shape and transport contract — Vol 12_1 Section 3, Sprint 16.
 *
 * `SyncTransport` is the one seam between this platform-agnostic sync
 * engine and whatever actually talks to Supabase (a real HTTP/RPC client
 * on mobile, per Sprint 13's DataAdapter-style split: the engine here
 * knows nothing about op-sqlite, Supabase, or React Native). Tests supply
 * an in-memory fake transport; app/src/db/syncService.ts supplies the real
 * one.
 */

export type SyncEntityType =
  | "business_event"
  | "business_data"
  | "ledger_entry"
  | "document"
  | "ai_interpretation"
  | "business_event_status_transition"
  | "business_knowledge_entry"
  | "app_settings";

export type SyncOp = "insert" | "status_transition" | "upsert";

/** Deterministic, globally-unique per Vol 12_1 Section 3. */
export function buildEnvelopeId(
  businessId: string,
  deviceId: string,
  deviceSeq: number,
): string {
  return `${businessId}:${deviceId}:${deviceSeq}`;
}

/** An envelope as it sits locally, pending push (sync_outbox row). */
export interface OutboxEnvelope {
  envelopeId: string;
  businessId: string;
  deviceId: string;
  deviceSeq: number;
  entityType: SyncEntityType;
  op: SyncOp;
  payloadCiphertext: string; // base64
  payloadIv: string; // base64
  createdAt: string;
  writtenAsActiveDeviceId: string | null;
}

/** An envelope as pushed to, or pulled from, the server. */
export interface WireEnvelope {
  envelopeId: string;
  businessId: string;
  deviceId: string;
  deviceSeq: number;
  serverSeq: number | null;
  entityType: SyncEntityType;
  op: SyncOp;
  payloadCiphertext: string; // base64
  payloadIv: string; // base64
  createdAt: string;
}

export interface ActiveDeviceLockSnapshot {
  businessId: string;
  activeDeviceId: string;
  lockToken: string;
  acquiredAt: string;
}

/**
 * The one seam to the network. Implementations are free to use HTTP,
 * Supabase's client SDK, or anything else — this engine only depends on
 * this interface (same DataAdapter discipline Sprint 13 established for
 * SqlDb).
 */
export interface SyncTransport {
  /**
   * Pushes one envelope. Must be safe to call twice for the same
   * envelope_id (Vol 12_1 Section 6.3 — server-side `ON CONFLICT DO
   * NOTHING` on envelope_id, matching Sprint 15's `sync_envelopes` schema)
   * — implementations should treat "already exists" as success, not an
   * error, so a retried push after a dropped response is a safe no-op.
   */
  pushEnvelope(envelope: OutboxEnvelope): Promise<{ serverSeq: number }>;

  /** Envelopes with server_seq strictly greater than `sinceServerSeq`, ascending. */
  pullEnvelopesSince(
    businessId: string,
    sinceServerSeq: number,
  ): Promise<WireEnvelope[]>;

  /** Current active-device lock state for this business, or null if none exists yet. */
  fetchActiveDeviceLock(
    businessId: string,
  ): Promise<ActiveDeviceLockSnapshot | null>;
}
