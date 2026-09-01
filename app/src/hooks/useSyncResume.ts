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
import { useEffect, useRef } from "react";

import { runMobileSyncCycle } from "@/db/syncService";
import { useConnectivity } from "@/lib/connectivity";

export function useSyncResume(
  businessId: string | null,
  deviceId: string | null,
  dek: Uint8Array | null,
): { isOnline: boolean } {
  const { isOnline } = useConnectivity();
  const wasOnline = useRef<boolean | null>(null);

  useEffect(() => {
    const justCameOnline = isOnline && wasOnline.current === false;
    const firstRunOnline = isOnline && wasOnline.current === null;

    if ((justCameOnline || firstRunOnline) && businessId && deviceId && dek) {
      (async () => {
        try {
          await runMobileSyncCycle(businessId, deviceId, dek);
        } catch {
          // Best-effort, same as useAutoResume.ts: a failed sync cycle
          // leaves the outbox/checkpoint exactly as they already were --
          // nothing regresses, and the next trigger tries again.
        }
      })();
    }

    wasOnline.current = isOnline;
  }, [isOnline, businessId, deviceId, dek]);

  return { isOnline };
}
