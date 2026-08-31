/**
 * Sprint 9 (Vol 7_4 §4 "Sync Resumption Flow") — calls
 * `resumeQueuedWork` (ai/capturePipeline.ts) whenever it's plausible that
 * something got un-stuck: once on mount (covers "app was killed mid-queue
 * and relaunched" from the Sprint 9 risk register — a relaunch always
 * mounts fresh), and again on every offline -> online transition reported
 * by `useConnectivity`. Deliberately does NOT re-run just because the app
 * stays online continuously — only transitions and mount trigger it, so a
 * healthy connection doesn't re-attempt already-resolved events on every
 * poll tick.
 */
import { resumeQueuedWork } from "@aifa/core/ai/capturePipeline";
import { useEffect, useRef } from "react";

import { getDefaultExpenseProvider } from "@/ai/client";
import { getDb, getLocalBusinessId } from "@/db/client";
import { useConnectivity } from "@/lib/connectivity";

export function useAutoResume(): { isOnline: boolean } {
  const { isOnline } = useConnectivity();
  const wasOnline = useRef<boolean | null>(null);

  useEffect(() => {
    const justCameOnline = isOnline && wasOnline.current === false;
    const firstRunOnline = isOnline && wasOnline.current === null;

    if (justCameOnline || firstRunOnline) {
      (async () => {
        try {
          const db = await getDb();
          const businessId = await getLocalBusinessId();
          await resumeQueuedWork(db, getDefaultExpenseProvider(), businessId);
        } catch {
          // Best-effort: a failed resume attempt leaves events exactly as
          // queued as they already were -- nothing regresses, and the next
          // trigger (next foreground, next reconnect) tries again.
        }
      })();
    }

    wasOnline.current = isOnline;
  }, [isOnline]);

  return { isOnline };
}
