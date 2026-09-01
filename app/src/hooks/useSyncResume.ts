/**
 * Sprint 16 — same trigger discipline as useAutoResume.ts (Sprint 9):
 * runs a sync cycle once on mount and again on every offline->online
 * transition, never just because the connection stays healthy. Reuses
 * useConnectivity (Sprint 9) rather than a second polling mechanism.
 *
 * A no-op, harmlessly, until this device has a SyncContext set
 * (syncService.ts's initMobileSync — not wired into app startup yet, see
 * that file's own note); calling runMobileSyncCycle before that just
 * means pushOutbox/pullEnvelopes both see "no context" and do nothing,
 * matching every other syncable write's same safe default.
 */
import { useEffect, useRef, useState } from "react";

import { runMobileSyncCycle, type DemotedOutboxReview } from "@/db/syncService";
import { useConnectivity } from "@/lib/connectivity";

export function useSyncResume(
  businessId: string | null,
  deviceId: string | null,
  dek: Uint8Array | null,
): {
  isOnline: boolean;
  /**
   * Sprint 20 (Vol 12_1 Section 6a.4) — the latest demotion review this
   * hook's own sync cycle turned up, or null once there is nothing left
   * (never demoted, or the owner already sent everything safe and there
   * were no conflicts left to report). Cleared to null on every cycle
   * that finds nothing, so a stale review never lingers past the point
   * it stopped being true.
   */
  demotedOutboxReview: DemotedOutboxReview | null;
} {
  const { isOnline } = useConnectivity();
  const wasOnline = useRef<boolean | null>(null);
  const [demotedOutboxReview, setDemotedOutboxReview] =
    useState<DemotedOutboxReview | null>(null);

  useEffect(() => {
    const justCameOnline = isOnline && wasOnline.current === false;
    const firstRunOnline = isOnline && wasOnline.current === null;

    if ((justCameOnline || firstRunOnline) && businessId && deviceId && dek) {
      (async () => {
        try {
          const review = await runMobileSyncCycle(businessId, deviceId, dek);
          setDemotedOutboxReview(review);
        } catch {
          // Best-effort, same as useAutoResume.ts: a failed sync cycle
          // leaves the outbox/checkpoint exactly as they already were --
          // nothing regresses, and the next trigger tries again.
        }
      })();
    }

    wasOnline.current = isOnline;
  }, [isOnline, businessId, deviceId, dek]);

  return { isOnline, demotedOutboxReview };
}
