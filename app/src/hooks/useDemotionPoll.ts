/**
 * Sprint 17 (Vol 12_1 Section 6a.2/6a.3, DoD: "the demoted device
 * transitions to read-only within a reasonable poll interval"). Distinct
 * from useSyncResume.ts (Sprint 9/16), which only fires on mount and on
 * offline->online transitions -- a device that stays continuously online
 * (the common case) would otherwise never re-check the active-device
 * lock at all between those two triggers, so a same-session demotion
 * broadcast could go undetected indefinitely. This hook is the
 * additional timer-driven trigger that closes that gap, using the
 * lightweight refreshActiveDeviceLock (lock-cache only, not a full
 * push/pull cycle) so the added network cost stays small.
 *
 * Interval chosen per the Sprint 17 risk register's own acceptance of
 * "poll-based demotion notification feels laggy" as a known, deferred
 * trade-off (Realtime is Section 6.2's noted future optimisation, not
 * built here) -- 30s is a deliberate middle ground, short enough that a
 * demotion is noticed within roughly half a minute, long enough not to
 * be a meaningful battery/network cost. Sprint 20's pilot write-up is
 * where actual observed latency should be recorded, per that same risk
 * register entry.
 */
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { refreshActiveDeviceLock } from "@/db/syncService";

const POLL_INTERVAL_MS = 30_000;

export function useDemotionPoll(
  businessId: string | null,
  isOnline: boolean,
): void {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!businessId || !isOnline) return;

    intervalRef.current = setInterval(() => {
      // Only poll while the app is actually in the foreground -- a
      // background timer would just burn battery/network for a state the
      // owner isn't looking at; useSyncResume's own reconnect/foreground
      // triggers already cover catching up once they return.
      if (AppState.currentState !== "active") return;
      refreshActiveDeviceLock(businessId).catch(() => {
        // Best-effort, same posture as every other sync trigger in this
        // codebase (useAutoResume.ts, useSyncResume.ts) -- a failed poll
        // tick leaves the cached lock exactly as it was; the next tick
        // (or the next reconnect/mount cycle) tries again.
      });
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [businessId, isOnline]);
}
