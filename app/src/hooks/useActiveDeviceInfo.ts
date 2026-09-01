/**
 * Sprint 17 — feeds ReadOnlyBanner.tsx the live active-device info it
 * needs to render at all (isActiveDevice, activeDeviceLabel/isPrimary/
 * lastSeenAt, requestingIsPrimary). Distinct from useDemotionPoll.ts:
 * that hook refreshes the LOCAL write-gate cache every repository write
 * actually reads (sync_lock_cache) and never touches the UI directly;
 * this hook is purely for what the banner displays and the confirmation
 * prompt decides with (@aifa/core/sync/handoff.ts). Kept as two small
 * hooks with one responsibility each rather than one hook doing both, on
 * the same "shared engine, thin platform glue" reasoning this sprint's
 * other modules already follow.
 *
 * Same 30s foreground-only polling cadence as useDemotionPoll.ts, plus
 * refresh on mount/reconnect and an explicit `bump()` the caller can
 * invoke right after a successful activation so the banner updates
 * immediately rather than waiting for the next tick.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { getActiveDeviceInfo, type ActiveDeviceInfo } from "@/db/syncService";

const POLL_INTERVAL_MS = 30_000;

export interface UseActiveDeviceInfoResult {
  info: ActiveDeviceInfo | null;
  refresh: () => void;
}

export function useActiveDeviceInfo(
  businessId: string | null,
  deviceId: string | null,
  isOnline: boolean,
): UseActiveDeviceInfoResult {
  const [info, setInfo] = useState<ActiveDeviceInfo | null>(null);
  const [bumpCount, setBumpCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(() => setBumpCount((c) => c + 1), []);

  useEffect(() => {
    if (!businessId || !deviceId) {
      setInfo(null);
      return;
    }

    let isMounted = true;
    getActiveDeviceInfo(businessId, deviceId)
      .then((result) => {
        if (isMounted) setInfo(result);
      })
      .catch(() => {
        // Best-effort, same posture as every other sync trigger in this
        // codebase -- a failed fetch leaves the last-known info on
        // screen rather than clearing it out from under the owner.
      });

    return () => {
      isMounted = false;
    };
  }, [businessId, deviceId, isOnline, bumpCount]);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!businessId || !deviceId || !isOnline) return;

    intervalRef.current = setInterval(() => {
      if (AppState.currentState !== "active") return;
      refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [businessId, deviceId, isOnline, refresh]);

  return { info, refresh };
}
