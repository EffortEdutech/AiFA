/**
 * Connectivity detection — Sprint 9 (Vol 7_4 §3). Deliberately NOT built
 * on a native connectivity library (e.g. `expo-network` or
 * `@react-native-community/netinfo`) — neither is an existing project
 * dependency, and AGENTS.md requires approval before adding a new
 * production dependency. Instead this is a lightweight, dependency-free
 * reachability probe: a `fetch` with a short timeout against the
 * configured Supabase URL (the one real network endpoint this app already
 * talks to for anything beyond AI calls).
 *
 * Trade-off, stated plainly: this is a POLLING approximation, not a true
 * OS-level connectivity event stream. It will not notice a dropped
 * connection instantly the way NetInfo would — only on the next poll tick
 * or app-foreground check. That is an accepted Phase 1 limitation, not an
 * oversight; if real-time transition events are needed later, that is the
 * point at which to bring `expo-network` to the user for approval.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_POLL_INTERVAL_MS = 15000;

function reachabilityUrl(): string | null {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  return url ? url : null;
}

/**
 * One-shot reachability check. Returns `true` if the configured Supabase
 * URL responds at all (any HTTP status counts as "reachable" — we only
 * care about network-level connectivity here, not whether the request
 * succeeded on its own terms). If Supabase isn't configured at all (env
 * missing), this optimistically returns `true` rather than false — an
 * unconfigured backend isn't the same problem as "no network", and the
 * real Supabase calls elsewhere will surface their own clear error either
 * way (see supabaseClient.ts).
 */
export async function checkConnectivity(
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<boolean> {
  const url = reachabilityUrl();
  if (!url) return true;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(url, { method: "HEAD", signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export interface ConnectivityState {
  isOnline: boolean;
  lastCheckedAt: Date | null;
}

/**
 * React hook wrapping `checkConnectivity` with polling (every
 * `pollIntervalMs`) and a re-check whenever the app returns to the
 * foreground (via `AppState`, already part of React Native — no new
 * dependency) — this is what actually covers the "app killed mid-queue,
 * relaunched later" scenario from the Sprint 9 risk register, since a
 * relaunch/foreground is exactly when this hook re-checks rather than
 * waiting out a full poll interval.
 *
 * Starts optimistic (`isOnline: true`) so the UI doesn't flash an offline
 * banner before the first check completes.
 */
export function useConnectivity(
  pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
): ConnectivityState {
  const [state, setState] = useState<ConnectivityState>({
    isOnline: true,
    lastCheckedAt: null,
  });
  const mounted = useRef(true);

  const runCheck = useCallback(async () => {
    const isOnline = await checkConnectivity();
    if (mounted.current) {
      setState({ isOnline, lastCheckedAt: new Date() });
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    runCheck();

    const interval = setInterval(runCheck, pollIntervalMs);
    const subscription = AppState.addEventListener(
      "change",
      (next: AppStateStatus) => {
        if (next === "active") runCheck();
      },
    );

    return () => {
      mounted.current = false;
      clearInterval(interval);
      subscription.remove();
    };
  }, [runCheck, pollIntervalMs]);

  return state;
}
