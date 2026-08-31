/**
 * Minimal crash reporting — Vol 8_6 (Observability & Diagnostics), Sprint
 * 11. Installs a global JS error handler via React Native's built-in
 * `ErrorUtils` (no new dependency — this is part of the RN runtime
 * itself, not a package). Deliberately NOT wired to a remote
 * crash-reporting SaaS (Sentry, Bugsnag, etc.): that would be both a new
 * production dependency and a third-party account/data-sharing decision,
 * neither of which this codebase adds without the user's explicit
 * approval (AGENTS.md) — the same posture taken for notifications
 * (Sprint 8), connectivity (Sprint 9), and encryption/sharing (Sprint 9-10).
 *
 * This ADDS visibility on top of React Native's own fatal-error handling —
 * it does not replace or suppress it. The previously-registered global
 * handler (RN's own, which shows the red screen in dev / triggers the
 * native crash in production) is always still called after logging, so
 * installing this can only make errors MORE visible, never less.
 */
import { logAppError } from "@aifa/core/db/errorLogRepository";

import { getDb, getLocalBusinessId } from "@/db/client";

type ErrorHandler = (error: Error, isFatal?: boolean) => void;

interface GlobalErrorUtils {
  getGlobalHandler: () => ErrorHandler;
  setGlobalHandler: (handler: ErrorHandler) => void;
}

let installed = false;

/** Idempotent — safe to call more than once (e.g. Fast Refresh in dev); only installs once per JS runtime instance. */
export function installCrashReporting(): void {
  if (installed) return;
  installed = true;

  const errorUtils = (global as unknown as { ErrorUtils?: GlobalErrorUtils })
    .ErrorUtils;
  // No RN runtime present (e.g. this module imported under Jest/Node) --
  // nothing to install, and nothing to fail loudly about either.
  if (!errorUtils) return;

  const previousHandler = errorUtils.getGlobalHandler();

  errorUtils.setGlobalHandler((error, isFatal) => {
    // Fire-and-forget, best-effort: logging must never throw, block, or
    // delay the previous handler -- an observability feature must never
    // become a NEW way to hide or worsen a crash.
    (async () => {
      try {
        const db = await getDb();
        const businessId = await getLocalBusinessId();
        await logAppError(db, {
          errorType: "unhandled_exception",
          message: error?.message ?? "Unknown error",
          stack: error?.stack ?? null,
          context: { isFatal: !!isFatal, businessId },
        });
      } catch {
        // Swallow -- see module comment. The previous handler below still
        // runs regardless of whether logging itself succeeded.
      }
    })();

    previousHandler(error, isFatal);
  });
}
