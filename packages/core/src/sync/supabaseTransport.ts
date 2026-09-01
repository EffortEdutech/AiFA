/**
 * Supabase-backed SyncTransport + device-registry glue, shared between
 * mobile and web — Sprint 19 (Vol 12_1 Section 6/8).
 *
 * Sprint 16 built the SyncTransport implementation talking to Supabase's
 * `sync_envelopes`/`active_device_lock` tables directly inside
 * app/src/db/syncService.ts, bound to that file's own module-level
 * `supabase` client import. Sprint 18 then needed the identical logic for
 * web, against web's OWN Supabase client instance (same backend, same
 * schema, different `SupabaseClient` object) — this sprint's own Task
 * Breakdown is explicit that porting this "should mostly be reuse
 * through @aifa/core, not a parallel implementation." So this file is
 * that logic, extracted and parameterised by an injected client rather
 * than a hardcoded import — both `app/src/db/syncService.ts` and
 * `web/src/lib/syncService.ts` now call `createSupabaseSyncTransport`/
 * `createSupabaseDevicesTransport` with their own client, instead of each
 * re-deriving the same row-shape mapping and query strings independently
 * (this sprint's own risk register: "device labels/platform strings
 * inconsistent between what mobile and web write... agree a small shared
 * format in @aifa/core rather than each platform inventing its own").
 *
 * The injected client is typed as `SupabaseClientLike` below, NOT the
 * real `SupabaseClient` from `@supabase/supabase-js` — a real, disclosed
 * build-time gotcha found while wiring this up: `packages/core` has no
 * `dependencies` field of its own (established precedent — see this
 * repo's own package.json, `@noble/hashes`/`@noble/ciphers` aren't listed
 * there either despite being genuinely imported), and this monorepo has
 * no workspace-level dependency hoisting, so `app/` and `web/` each
 * install their OWN separate copy of `@supabase/supabase-js`. Both
 * copies are the same published version, but `SupabaseClient` (and the
 * postgrest query-builder classes it returns) carry protected members,
 * which makes TypeScript treat two separately-installed-but-structurally-
 * identical copies as INCOMPATIBLE types — passing app/'s `supabase`
 * client into a function typed against web's copy of the class (or vice
 * versa, since packages/core's own module resolution picks up whichever
 * consumer is compiling it) fails to type-check even though it is
 * correct and safe at runtime. `SupabaseClientLike` is a small,
 * hand-written structural interface covering only the two methods this
 * file actually calls (`.rpc`, `.from`) — real duck typing, so it accepts
 * either installed copy identically. The trade-off, disclosed rather than
 * silently absorbed: `.from()`'s query-builder chain is typed `any`
 * inside this file, so its own `as DeviceRow`/`as SyncEnvelopeRow` casts
 * (already present throughout, unchanged) are what keeps the mapped
 * output typed, not the chain syntax itself.
 */

/** See this file's own header comment for why this exists instead of importing `SupabaseClient` from `@supabase/supabase-js` directly. */
export interface SupabaseClientLike {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see header comment: the postgrest query-builder chain is deliberately untyped here, call sites cast their own results.
  from(table: string): any;
}

import type { SyncEntityType, SyncOp } from "./envelope";
import type {
  ActiveDeviceLockSnapshot,
  OutboxEnvelope,
  SyncTransport,
  WireEnvelope,
} from "./syncClient";

/** Row shape of public.sync_envelopes (Sprint 14, Vol 12_1 §4). */
interface SyncEnvelopeRow {
  envelope_id: string;
  business_id: string;
  device_id: string;
  device_seq: number;
  server_seq: number;
  entity_type: SyncEntityType;
  op: SyncOp;
  payload_ciphertext: string;
  payload_iv: string;
}

interface ActiveDeviceLockRow {
  business_id: string;
  active_device_id: string;
  lock_token: string;
  acquired_at: string;
}

/** Row shape of public.devices (Sprint 15, Vol 12_1 §5a.3). */
export interface DeviceRow {
  device_id: string;
  business_id: string;
  device_label: string;
  platform: "ios" | "android" | "web";
  registered_at: string;
  last_seen_at: string;
  last_synced_server_seq: number;
  is_primary: boolean;
  revoked_at: string | null;
}

export interface RegisteredDevice {
  deviceId: string;
  deviceLabel: string;
  platform: "ios" | "android" | "web";
  registeredAt: string;
  lastSeenAt: string;
  lastSyncedServerSeq: number;
  isPrimary: boolean;
  revokedAt: string | null;
}

export function toRegisteredDevice(row: DeviceRow): RegisteredDevice {
  return {
    deviceId: row.device_id,
    deviceLabel: row.device_label,
    platform: row.platform,
    registeredAt: row.registered_at,
    lastSeenAt: row.last_seen_at,
    lastSyncedServerSeq: row.last_synced_server_seq,
    isPrimary: row.is_primary,
    revokedAt: row.revoked_at,
  };
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
    createdAt: "",
  };
}

function toLockSnapshot(row: ActiveDeviceLockRow): ActiveDeviceLockSnapshot {
  return {
    businessId: row.business_id,
    activeDeviceId: row.active_device_id,
    lockToken: row.lock_token,
    acquiredAt: row.acquired_at,
  };
}

/** Builds a SyncTransport (push/pull/lock-fetch, Sprint 16) against the given Supabase client — identical query shape regardless of which platform's client is passed in. */
export function createSupabaseSyncTransport(
  client: SupabaseClientLike,
): SyncTransport {
  return {
    async pushEnvelope(envelope: OutboxEnvelope): Promise<{ serverSeq: number }> {
      const { data, error } = await client
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
        const { data: existing, error: fetchError } = await client
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
      const { data, error } = await client
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
      const { data, error } = await client
        .from("active_device_lock")
        .select("*")
        .eq("business_id", businessId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return toLockSnapshot(data as ActiveDeviceLockRow);
    },
  };
}

export interface ActiveDeviceInfo {
  isActiveDevice: boolean;
  activeDeviceId: string | null;
  activeDeviceLabel: string | null;
  activeDeviceIsPrimary: boolean;
  activeDeviceLastSeenAt: string | null;
  requestingIsPrimary: boolean;
}

/**
 * Device-registry RPC/query glue shared between platforms (register,
 * rename, revoke, primary/activation actions, the Devices panel's own
 * reads) — everything in `public.devices`/`active_device_lock` that
 * ISN'T the envelope push/pull transport above. Grouped as one object
 * (mirroring SyncTransport's shape) rather than loose exports so each
 * platform's own service file has one thing to construct and re-export.
 */
export interface SupabaseDevicesTransport {
  registerDevice(
    deviceId: string,
    platform: "ios" | "android" | "web",
    deviceLabel: string,
  ): Promise<RegisteredDevice>;
  renameDevice(deviceId: string, newLabel: string): Promise<RegisteredDevice>;
  revokeDevice(
    deviceId: string,
    options?: { newActiveDeviceId?: string; newPrimaryDeviceId?: string },
  ): Promise<RegisteredDevice>;
  requestActivation(
    deviceId: string,
    lastAppliedServerSeq: number,
    expectedLockToken: string | null,
  ): Promise<ActiveDeviceLockSnapshot>;
  requestPrimaryTakeover(
    deviceId: string,
    lastAppliedServerSeq: number,
  ): Promise<ActiveDeviceLockSnapshot>;
  setPrimaryDevice(newPrimaryDeviceId: string): Promise<RegisteredDevice>;
  touchDeviceHeartbeat(
    deviceId: string,
    lastSyncedServerSeq: number,
  ): Promise<RegisteredDevice>;
  getRegisteredDevices(businessId: string): Promise<RegisteredDevice[]>;
  /** Sprint 19 (Vol 12_1 §8, Devices panel) -- EVERY non-deleted device, including revoked ones (Status column can read "Revoked"). getRegisteredDevices() above stays revoked-filtered since it also backs action pickers (primary/activation targets, revoke's own replacement-device args) where a revoked device must never be selectable. */
  getAllDevices(businessId: string): Promise<RegisteredDevice[]>;
  getActiveDeviceInfo(
    businessId: string,
    deviceId: string,
  ): Promise<ActiveDeviceInfo>;
  /** Current true max server_seq for the business — the "Sync state" column's basis (Vol 12_1 §8: "N changes behind" is this minus a device's own last_synced_server_seq). A plain read, no RPC needed (RLS already scopes SELECT to auth.uid()=business_id). */
  getMaxServerSeq(businessId: string): Promise<number>;
}

export function createSupabaseDevicesTransport(
  client: SupabaseClientLike,
): SupabaseDevicesTransport {
  return {
    async registerDevice(deviceId, platform, deviceLabel) {
      const { data, error } = await client.rpc("register_device", {
        p_device_id: deviceId,
        p_platform: platform,
        p_device_label: deviceLabel,
      });
      if (error) throw error;
      return toRegisteredDevice(data as DeviceRow);
    },

    async renameDevice(deviceId, newLabel) {
      const { data, error } = await client.rpc("rename_device", {
        p_device_id: deviceId,
        p_new_device_label: newLabel,
      });
      if (error) throw error;
      return toRegisteredDevice(data as DeviceRow);
    },

    async revokeDevice(deviceId, options) {
      const { data, error } = await client.rpc("revoke_device", {
        p_device_id: deviceId,
        p_new_active_device_id: options?.newActiveDeviceId ?? null,
        p_new_primary_device_id: options?.newPrimaryDeviceId ?? null,
      });
      if (error) throw error;
      return toRegisteredDevice(data as DeviceRow);
    },

    async requestActivation(deviceId, lastAppliedServerSeq, expectedLockToken) {
      const { data, error } = await client.rpc("request_activation", {
        p_device_id: deviceId,
        p_last_applied_server_seq: lastAppliedServerSeq,
        p_expected_lock_token: expectedLockToken,
      });
      if (error) throw error;
      return toLockSnapshot(data as ActiveDeviceLockRow);
    },

    async requestPrimaryTakeover(deviceId, lastAppliedServerSeq) {
      const { data, error } = await client.rpc("request_primary_takeover", {
        p_device_id: deviceId,
        p_last_applied_server_seq: lastAppliedServerSeq,
      });
      if (error) throw error;
      return toLockSnapshot(data as ActiveDeviceLockRow);
    },

    async setPrimaryDevice(newPrimaryDeviceId) {
      const { data, error } = await client.rpc("set_primary_device", {
        p_new_primary_device_id: newPrimaryDeviceId,
      });
      if (error) throw error;
      return toRegisteredDevice(data as DeviceRow);
    },

    async touchDeviceHeartbeat(deviceId, lastSyncedServerSeq) {
      const { data, error } = await client.rpc("touch_device_heartbeat", {
        p_device_id: deviceId,
        p_last_synced_server_seq: lastSyncedServerSeq,
      });
      if (error) throw error;
      return toRegisteredDevice(data as DeviceRow);
    },

    async getRegisteredDevices(businessId) {
      const { data, error } = await client
        .from("devices")
        .select("*")
        .eq("business_id", businessId)
        .is("revoked_at", null)
        .order("registered_at", { ascending: true });
      if (error) throw error;
      return (data as DeviceRow[]).map(toRegisteredDevice);
    },

    async getAllDevices(businessId) {
      const { data, error } = await client
        .from("devices")
        .select("*")
        .eq("business_id", businessId)
        .order("registered_at", { ascending: true });
      if (error) throw error;
      return (data as DeviceRow[]).map(toRegisteredDevice);
    },

    async getActiveDeviceInfo(businessId, deviceId) {
      const { data: lockData, error: lockError } = await client
        .from("active_device_lock")
        .select("*")
        .eq("business_id", businessId)
        .maybeSingle();
      if (lockError) throw lockError;

      const { data: devicesData, error: devicesError } = await client
        .from("devices")
        .select("*")
        .eq("business_id", businessId)
        .is("revoked_at", null);
      if (devicesError) throw devicesError;

      const devices = (devicesData as DeviceRow[]) ?? [];
      const requesting = devices.find((d) => d.device_id === deviceId);
      const lock = lockData as ActiveDeviceLockRow | null;
      const active = lock ? devices.find((d) => d.device_id === lock.active_device_id) : undefined;

      return {
        isActiveDevice: lock?.active_device_id === deviceId,
        activeDeviceId: lock?.active_device_id ?? null,
        activeDeviceLabel: active?.device_label ?? null,
        activeDeviceIsPrimary: active?.is_primary ?? false,
        activeDeviceLastSeenAt: active?.last_seen_at ?? null,
        requestingIsPrimary: requesting?.is_primary ?? false,
      };
    },

    async getMaxServerSeq(businessId) {
      const { data, error } = await client
        .from("sync_envelopes")
        .select("server_seq")
        .eq("business_id", businessId)
        .order("server_seq", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as { server_seq: number } | null)?.server_seq ?? 0;
    },
  };
}
