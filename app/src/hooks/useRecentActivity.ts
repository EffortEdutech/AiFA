/**
 * Shared activity-feed data hook — used by both CaptureScreen (Sprint 2/3)
 * and DashboardScreen (Sprint 4) so the fetch/refresh/resolve logic exists
 * in exactly one place instead of being copy-pasted per screen.
 */

import {
  confirmCategory,
  correctConfirmedCapture,
} from "@aifa/core/ai/capturePipeline";
import {
  listRecentActivity,
  type RecentActivityItem,
} from "@aifa/core/db/businessEventRepository";
import { useCallback, useEffect, useState } from "react";

import { getDb, getLocalBusinessId } from "@/db/client";

export function useRecentActivity(limit = 50) {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [activity, setActivity] = useState<RecentActivityItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(
    async (idOverride?: string) => {
      const id = idOverride ?? businessId;
      if (!id) return;
      const db = await getDb();
      setActivity(await listRecentActivity(db, id, limit));
    },
    [businessId, limit],
  );

  useEffect(() => {
    (async () => {
      try {
        const id = await getLocalBusinessId();
        setBusinessId(id);
        await refresh(id);
      } catch (err) {
        setLoadError(
          err instanceof Error ? err.message : "Failed to load activity.",
        );
      }
    })();
    // Only run once on mount — `refresh` intentionally omitted from deps
    // here since it would otherwise re-run this effect on every id change,
    // which pullToRefresh below already covers explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolveDraftOrClarify = useCallback(
    async (item: RecentActivityItem, chosenCategory: string) => {
      const db = await getDb();
      await confirmCategory(
        db,
        item.event,
        item.data,
        chosenCategory,
        item.data.payment_method,
      );
      await refresh();
    },
    [refresh],
  );

  const correctConfirmed = useCallback(
    async (item: RecentActivityItem, chosenCategory: string) => {
      const db = await getDb();
      await correctConfirmedCapture(db, item.event.id, chosenCategory);
      await refresh();
    },
    [refresh],
  );

  const pullToRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  return {
    businessId,
    activity,
    loadError,
    refreshing,
    refresh,
    pullToRefresh,
    resolveDraftOrClarify,
    correctConfirmed,
  };
}
