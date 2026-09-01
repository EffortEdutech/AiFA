import { useEffect, useRef, useState } from "react";

import type { SqlDb } from "@aifa/core/db/types";

import {
  getActiveDeviceInfo,
  refreshActiveDeviceLock,
  runWebSyncCycle,
  type ActiveDeviceInfo,
  type DemotedOutboxReview,
} from "../lib/syncService";

const DEMOTION_POLL_INTERVAL_MS = 30_000;

export interface UseWebSyncResult {
  isOnline: boolean;
  activeDeviceInfo: ActiveDeviceInfo | null;
  refreshActiveDeviceInfo: () => void;
  /** Sprint 20 (Vol 12_1 Section 6a.4) — see app/src/hooks/useSyncResume.ts's own doc on this field for the full reasoning; identical here. */
  demotedOutboxReview: DemotedOutboxReview | null;
}

/**
 * Sprint 19 — the web counterpart to mobile's three sync hooks
 * (useSyncResume.ts, useDemotionPoll.ts, useActiveDeviceInfo.ts),
 * deliberately consolidated into ONE hook rather than three files. Web's
 * App.tsx is a single small root component (unlike mobile's App.tsx +
 * AppNavigator split), and web has no equivalent of React Native's
 * AppState — foreground/background is `document.visibilityState`
 * instead, and reconnect is the browser's `online`/`offline` events
 * instead of Sprint 9's useConnectivity (NetInfo-based, mobile-only).
 * Behaviourally identical to the three mobile hooks combined: a sync
 * cycle on mount and on every offline→online transition; a 30s
 * foreground-only poll that refreshes the active-device lock (closing
 * the same "continuously-online device never re-checks between triggers"
 * gap Sprint 17's useDemotionPoll.ts documents); and the live
 * ActiveDeviceInfo the ReadOnlyBanner needs to render, refreshed on the
 * same schedule plus an explicit `refreshActiveDeviceInfo()` bump.
 *
 * A no-op, harmlessly, until `db`/businessId/deviceId/dek are all
 * non-null (this browser hasn't completed setup yet, or sync isn't
 * initialised) — same safe-default posture as every other sync trigger
 * in this codebase.
 */
export function useWebSync(
  db: SqlDb | null,
  businessId: string | null,
  deviceId: string | null,
  dek: Uint8Array | null,
): UseWebSyncResult {
  const [isOnline, setIsOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [activeDeviceInfo, setActiveDeviceInfo] = useState<ActiveDeviceInfo | null>(null);
  const [demotedOutboxReview, setDemotedOutboxReview] =
    useState<DemotedOutboxReview | null>(null);
  const [bumpCount, setBumpCount] = useState(0);
  const wasOnline = useRef<boolean | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Track online/offline via the browser's own events.
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Sync cycle: on mount (once online) and on every offline->online transition.
  useEffect(() => {
    const justCameOnline = isOnline && wasOnline.current === false;
    const firstRunOnline = isOnline && wasOnline.current === null;

    if ((justCameOnline || firstRunOnline) && db && businessId && deviceId && dek) {
      runWebSyncCycle(db, businessId, deviceId, dek)
        .then((review) => setDemotedOutboxReview(review))
        .catch(() => {
          // Best-effort, same posture as mobile's useSyncResume.ts -- a
          // failed cycle leaves the outbox/checkpoint exactly as they
          // already were; the next trigger tries again.
        });
    }

    wasOnline.current = isOnline;
  }, [isOnline, db, businessId, deviceId, dek]);

  // Active-device info: fetch on mount/change/bump, refreshed on the same poll cadence.
  useEffect(() => {
    if (!businessId || !deviceId) {
      setActiveDeviceInfo(null);
      return;
    }
    let isMounted = true;
    getActiveDeviceInfo(businessId, deviceId)
      .then((info) => {
        if (isMounted) setActiveDeviceInfo(info);
      })
      .catch(() => {
        // Best-effort -- leave the last-known info on screen.
      });
    return () => {
      isMounted = false;
    };
  }, [businessId, deviceId, isOnline, bumpCount]);

  // 30s foreground-only poll: refresh the local lock cache + bump active-device info.
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (!db || !businessId || !isOnline) return;

    intervalRef.current = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      refreshActiveDeviceLock(db, businessId).catch(() => {});
      setBumpCount((c) => c + 1);
    }, DEMOTION_POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [db, businessId, isOnline]);

  return {
    isOnline,
    activeDeviceInfo,
    demotedOutboxReview,
    refreshActiveDeviceInfo: () => setBumpCount((c) => c + 1),
  };
}
