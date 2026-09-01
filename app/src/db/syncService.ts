/**
 * Mobile sync client wiring — Sprint 16 (Vol 12_1 Section 6). This is the
 * one file in this sprint that talks to Supabase for the sync_envelopes/
 * active_device_lock tables (Sprint 14/15's schema) and to op-sqlite's
 * SqlDb; everything else (push/pull orchestration, idempotency, the write
 * gate) lives in @aifa/core's platform-agnostic sync engine and is fully
 * unit-tested there (packages/core/src/sync, app/src/db/__tests__/
 * sync.test.ts) — this file is the SyncTransport implementation Sprint
 * 13's DataAdapter split calls for, plus the small amount of glue needed
 * to set @aifa/core's ambient SyncContext.
 *
 * IMPORTANT — sandbox/build note, same class of limitation as
 * backupService.ts and auth.ts (Sprint 9/10): a real Supabase project and
 * a real device/simulator are both required to exercise this file. It is
 * code-complete against the documented Supabase client and Sprint 14/15
 * schema/RPCs, but has NOT been exercised against a live project. Verify
 * on your own machine before relying on it.
 *
 * IMPORTANT — a real dependency this sprint does NOT close: nothing in
 * this codebase yet calls Sprint 15's `register_device` RPC or wires a
 * recovery-code-entry screen that derives and holds the Business DEK in
 * memory for the running app session (Vol 12_1 Section 5/Section 9). That
 * is real, separate UI/auth work this sprint's own scope does not cover
 * (see the Sprint 16 runbook's "What is NOT covered" section) — until it
 * exists, `initMobileSync` below has nothing to be called with, and this
 * device's SyncContext is simply never set, which is the same safe,
 * fully-backward-compatible "no context" state every existing Phase 1
 * screen already runs in today (syncContext.ts's own doc explains why
 * that is deliberate, not a bug).
 */
import type { SqlDb } from "@aifa/core/db/types";
import type { SyncEntityType, SyncOp } from "@aifa/core/sync/envelope";
import {
  getCachedLock,
  getLastAppliedServerSeq,
  setCachedLock,
} from "@aifa/core/sync/localState";
import {
  runSyncCycle,
  type SyncTransport,
  type OutboxEnvelope,
  type WireEnvelope,
  type ActiveDeviceLockSnapshot,
} from "@aifa/core/sync/syncClient";
import { pullEnvelopes } from "@aifa/core/sync/syncClient";
import { setSyncContext } from "@aifa/core/sync/syncContext";

import { getDb } from "./client";

import { supabase } from "@/lib/supabaseClient";

/** Row shape of public.sync_envelopes (Sprint 14, Vol 12_1 Section 4). */
interface SyncEnvelopeRow {
  envelope_id: string;
  business_id: string;
  device_id: string;
  device_seq: number;
  server_seq: number;
  entity_type: SyncEntityType;
  op: SyncOp;
  payload_ciphertext: string; // base64, stored as bytea server-side; Supabase's client returns bytea as a base64-ish string depending on encoding config — see the runbook's open item on this.
  payload_iv: string;
}

interface ActiveDeviceLockRow {
  business_id: string;
  active_device_id: string;
  lock_token: string;
  acquired_at: string;
}

function toWireEnvelope(row: SyncEnvelopeRow): WireEnvelope {
  return {
    envelopeId: row.envelope_id,
    businessId: row.business_id,
    deviceId: row.device_id,
    deviceSeq: row.device_seq,
    serverSeq: row.server_seq,
    entityType: row.entity_type,
    op: row.op,
    payloadCiphertext: row.payload_ciphertext,
    payloadIv: row.payload_iv,
    createdAt: "", // not needed client-side; server_received_at is the authoritative timestamp
  };
}

/** SyncTransport implementation talking to Supabase (Sprint 14's `sync_envelopes`, Sprint 15's `active_device_lock`). */
export const supabaseSyncTransport: SyncTransport = {
  async pushEnvelope(envelope: OutboxEnvelope): Promise<{ serverSeq: number }> {
    // ON CONFLICT DO NOTHING semantics (Vol 12_1 Section 6.3) -- upsert on
    // the envelope_id primary key, ignoring a duplicate rather than
    // erroring, so a retried push is a safe no-op.
    const { data, error } = await supabase
      .from("sync_envelopes")
      .upsert(
        {
          envelope_id: envelope.envelopeId,
          business_id: envelope.businessId,
          device_id: envelope.deviceId,
          device_seq: envelope.deviceSeq,
          entity_type: envelope.entityType,
          op: envelope.op,
          payload_ciphertext: envelope.payloadCiphertext,
          payload_iv: envelope.payloadIv,
        },
        { onConflict: "envelope_id", ignoreDuplicates: true },
      )
      .select("server_seq")
      .single();

    if (error) {
      // ignoreDuplicates makes .select() return no row on a conflict --
      // that's a successful no-op, not a failure; re-fetch the existing
      // row's server_seq in that case instead of treating it as an error.
      const { data: existing, error: fetchError } = await supabase
        .from("sync_envelopes")
        .select("server_seq")
        .eq("envelope_id", envelope.envelopeId)
        .single();
      if (fetchError || !existing) throw error;
      return { serverSeq: existing.server_seq as number };
    }
    return { serverSeq: (data as { server_seq: number }).server_seq };
  },

  async pullEnvelopesSince(
    businessId: string,
    sinceServerSeq: number,
  ): Promise<WireEnvelope[]> {
    const { data, error } = await supabase
      .from("sync_envelopes")
      .select("*")
      .eq("business_id", businessId)
      .gt("server_seq", sinceServerSeq)
      .order("server_seq", { ascending: true });
    if (error) throw error;
    return (data as SyncEnvelopeRow[]).map(toWireEnvelope);
  },

  async fetchActiveDeviceLock(
    businessId: string,
  ): Promise<ActiveDeviceLockSnapshot | null> {
    const { data, error } = await supabase
      .from("active_device_lock")
      .select("*")
      .eq("business_id", businessId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as ActiveDeviceLockRow;
    return {
      businessId: row.business_id,
      activeDeviceId: row.active_device_id,
      lockToken: row.lock_token,
      acquiredAt: row.acquired_at,
    };
  },
};

/**
 * Sets this device's ambient SyncContext (@aifa/core/sync/syncContext) so
 * every repository write from this point on is gated and queued for sync.
 * Call once at app startup, after device registration/DEK derivation
 * exist (see this file's own top-of-file note — that step is not built
 * yet). Safe to call with the same values more than once.
 */
export function initMobileSync(
  businessId: string,
  deviceId: string,
  dek: Uint8Array,
): void {
  setSyncContext({ businessId, deviceId, dek });
}

/** Runs one push+pull cycle against the real Supabase transport, using this device's real local database. */
export async function runMobileSyncCycle(
  businessId: string,
  deviceId: string,
  dek: Uint8Array,
): Promise<void> {
  const db: SqlDb = await getDb();
  await runSyncCycle(db, supabaseSyncTransport, businessId, dek, deviceId);
}

export class ActivationRejectedError extends Error {}

/**
 * Sprint 16 (Vol 12_1 Section 6a.1-6a.2, minimal wiring). Requests that
 * THIS device become the active device — a device can only ever request
 * activation for itself (never "push" another device active, per Section
 * 6a.1). Always pulls to catch-up first ("switching requires sync" is
 * enforced server-side too, Section 6a.2, but pulling first here avoids a
 * doomed request when this device is simply behind).
 *
 * This wires the RPC call itself and the local lock-cache update on
 * success; it deliberately does NOT implement the fuller caution-prompt
 * UX (Section 6a.5 — "[Device Y] appears to be in use right now") or the
 * primary-device takeover path (request_primary_takeover) — those are
 * Sprint 17's "handoff/primary-override UX" per the Sprint 15 runbook's
 * own scoping, not this sprint's DoD.
 */
export async function requestActivation(
  businessId: string,
  deviceId: string,
  dek: Uint8Array,
): Promise<void> {
  const db: SqlDb = await getDb();
  await pullEnvelopes(db, supabaseSyncTransport, businessId, dek, deviceId);

  const expectedLockToken =
    (await getCachedLock(db, businessId))?.lockToken ?? null;
  const lastAppliedServerSeq = await getLastAppliedServerSeq(db, businessId);

  const { data, error } = await supabase.rpc("request_activation", {
    p_device_id: deviceId,
    p_last_applied_server_seq: lastAppliedServerSeq,
    p_expected_lock_token: expectedLockToken,
  });
  if (error) {
    throw new ActivationRejectedError(error.message);
  }

  const row = data as ActiveDeviceLockRow;
  await setCachedLock(db, {
    businessId: row.business_id,
    activeDeviceId: row.active_device_id,
    lockToken: row.lock_token,
    acquiredAt: row.acquired_at,
  });
}

/** Convenience read for the read-only banner (ReadOnlyBanner.tsx): is this device currently the active device, and who is, if not. */
export async function getWriteAccessState(
  businessId: string,
  deviceId: string,
): Promise<{ isActiveDevice: boolean; activeDeviceId: string | null }> {
  const db: SqlDb = await getDb();
  const lock = await getCachedLock(db, businessId);
  if (!lock) return { isActiveDevice: true, activeDeviceId: null }; // no lock ever seen -- see writeGate.ts's own doc for why this defaults open
  return {
    isActiveDevice: lock.activeDeviceId === deviceId,
    activeDeviceId: lock.activeDeviceId,
  };
}
