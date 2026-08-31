/**
 * Local error/crash log — Phase 1 minimal Observability (Vol 8_6, Sprint
 * 11). Dependency-free by design: no remote crash-reporting SaaS (Sentry,
 * Bugsnag, etc.) is wired up here, since adding one is both a new
 * production dependency and a third-party data-sharing decision, neither
 * of which this codebase adds without the user's explicit approval
 * (AGENTS.md) -- same posture Sprints 8-10 took for notifications,
 * connectivity, encryption, and file sharing. This table + the Settings
 * Diagnostics section (Vol 8_6 Section 4) are Phase 1's honest "basic
 * crash reporting and API error logging" (Vol 11_0 Section 5).
 *
 * Per Vol 8_6 Section 3 ("privacy-respecting diagnostics"), entries here
 * are operational signals only -- an error message, a stack trace, and a
 * small free-form context object (e.g. a business_event_id or domain) --
 * never raw business content like amounts, counterparty names, or
 * captured descriptions. Callers are responsible for keeping `context`
 * to identifiers, not business data; see capturePipeline.ts's call sites
 * for the intended shape.
 */
import type { SqlDb } from "./types";

export type AppErrorType =
  "unhandled_exception" | "ai_call_error" | "workspace_call_error";

export interface AppErrorLogEntry {
  id: string;
  occurred_at: string;
  error_type: AppErrorType;
  message: string;
  stack: string | null;
  context: string | null; // JSON-encoded, small and identifier-only -- see module comment
}

export interface LogAppErrorInput {
  errorType: AppErrorType;
  message: string;
  stack?: string | null;
  /** Plain object -- JSON-stringified before storage. Keep to identifiers (business_event_id, domain, screen name), never business content. */
  context?: Record<string, unknown> | null;
}

/**
 * A message/stack can be arbitrarily long (some JS engines produce huge
 * stack traces) -- truncated defensively so one bad error can't bloat the
 * local database meaningfully; the diagnostics view only ever needs
 * enough to identify what happened, not a full forensic dump.
 */
const MAX_MESSAGE_LENGTH = 2000;
const MAX_STACK_LENGTH = 4000;

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

export async function logAppError(
  db: SqlDb,
  input: LogAppErrorInput,
  now: Date = new Date(),
): Promise<AppErrorLogEntry> {
  const id = `ERR-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const occurredAt = now.toISOString();
  const message = truncate(input.message, MAX_MESSAGE_LENGTH);
  const stack = input.stack ? truncate(input.stack, MAX_STACK_LENGTH) : null;
  const context = input.context ? JSON.stringify(input.context) : null;

  await db.execute(
    `INSERT INTO app_error_log (id, occurred_at, error_type, message, stack, context)
     VALUES (?, ?, ?, ?, ?, ?);`,
    [id, occurredAt, input.errorType, message, stack, context],
  );

  return {
    id,
    occurred_at: occurredAt,
    error_type: input.errorType,
    message,
    stack,
    context,
  };
}

/** Most recent errors first — for a "recent errors" list in the diagnostics view. */
export async function listRecentAppErrors(
  db: SqlDb,
  limit = 20,
): Promise<AppErrorLogEntry[]> {
  return db.queryAll<AppErrorLogEntry>(
    `SELECT * FROM app_error_log ORDER BY occurred_at DESC LIMIT ?;`,
    [limit],
  );
}

/** Count of errors at or after `sinceIso` — backs the diagnostics summary's "N errors in the last 24h" figure. */
export async function countAppErrorsSince(
  db: SqlDb,
  sinceIso: string,
): Promise<number> {
  const rows = await db.queryAll<{ n: number }>(
    `SELECT COUNT(*) as n FROM app_error_log WHERE occurred_at >= ?;`,
    [sinceIso],
  );
  return rows[0]?.n ?? 0;
}
