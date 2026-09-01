/**
 * Ambient sync context — Sprint 16, a deliberate design decision.
 *
 * Vol 12_1 Section 6a.3 requires the write gate to sit at the data-layer
 * boundary, not the UI ("a UI that hides the Save button but leaves the
 * underlying write function callable is not read-only enforcement"). The
 * repository functions in db/*.ts are the only real boundary every write
 * path already passes through — but they are plain functions taking only
 * `(db, ...)`, called from many places across @aifa/core and app/src
 * (ai/capturePipeline.ts, ai/expensePipeline.ts, bankingRepository.ts,
 * screens, etc.). Threading businessId/deviceId/DEK through every one of
 * those call sites would be a much larger, riskier change than this
 * sprint's own scope (Sprint 13's own risk mitigation: don't let an
 * extraction turn into a bigger rewrite than planned) and is unnecessary:
 * Phase 1 already assumes one business, one device, one DEK per running
 * app instance (db/client.ts's getLocalBusinessId).
 *
 * So: a small ambient context, set once at app startup (after the device
 * is registered and the DEK is available) and read by the repository
 * functions themselves via db/syncHooks.ts. Deliberately permissive when
 * unset — no context means "this device hasn't set up sync yet" (Phase 1
 * offline-only usage, or any test that constructs a bare db and calls a
 * repository function directly, exactly as every pre-Sprint-16 test in
 * this codebase does) and every write proceeds exactly as before,
 * ungated and unqueued. This keeps 100% of Sprint 1-15's existing
 * behaviour and tests unchanged (Sprint 13's own regression discipline)
 * while making the gate and the outbox both fully real, not optional,
 * once a context IS set — which a test can do explicitly to exercise the
 * "write blocked at the code level" requirement without touching any UI.
 */
export interface SyncContext {
  businessId: string;
  deviceId: string;
  /** Business DEK (Sprint 14) — required to encrypt outbox payloads. */
  dek: Uint8Array;
}

let currentContext: SyncContext | null = null;

export function setSyncContext(ctx: SyncContext | null): void {
  currentContext = ctx;
}

export function getSyncContext(): SyncContext | null {
  return currentContext;
}

/**
 * Sprint 16 — a second ambient flag, set only while applyEnvelope.ts is
 * applying a PULLED envelope through a repository write function. Pulled
 * writes must always apply regardless of this device's own active/
 * read-only state (Section 6.2's pull step is unconditional — a
 * read-only device still "keeps pulling normally," Section 6a.3), and
 * must NEVER be re-queued into this device's own outbox (that would
 * create an infinite relay loop, each device re-broadcasting what it
 * just received as if it were a new local write). guardAndEnqueueSyncableWrite
 * (syncHooks.ts) checks this flag and no-ops when it is set, for exactly
 * the same reason it no-ops when no SyncContext is set at all.
 */
let isApplyingPulledEnvelope = false;

export function isApplyingPulledEnvelopeNow(): boolean {
  return isApplyingPulledEnvelope;
}

export async function runAsPulledEnvelopeApplication<T>(
  fn: () => Promise<T>,
): Promise<T> {
  const previous = isApplyingPulledEnvelope;
  isApplyingPulledEnvelope = true;
  try {
    return await fn();
  } finally {
    isApplyingPulledEnvelope = previous;
  }
}
