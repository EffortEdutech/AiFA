/**
 * Active-device handoff decision logic — Vol 12_1 Section 6a.1, 6a.5,
 * Sprint 17. Deliberately platform-agnostic and pure (no RPC calls, no
 * React Native, no Supabase) so it is testable without a UI harness and
 * reusable by the web client Sprint 18/19 will build against the same
 * `@aifa/core` package -- the confirmation-prompt rules are protocol,
 * not mobile-specific UI, per this project's Sprint 13-established
 * "shared engine, thin platform glue" discipline.
 *
 * The actual `Alert.alert`/UI call lives in app/src (and later the web
 * equivalent); this module only decides WHICH prompt, if any, applies.
 */

/**
 * "The last few minutes" (Vol 12_1 Section 6a.1's trigger condition,
 * Section 6a.5's "genuinely in use" language) -- not specified as an
 * exact number in the architecture doc, so a concrete threshold is
 * chosen here and documented, matching this project's established
 * practice of writing down deliberately-simplified Phase 1/2 choices
 * rather than leaving them implicit (e.g. Sprint 4's OVERDUE_THRESHOLD_DAYS).
 */
export const ACTIVE_DEVICE_IN_USE_THRESHOLD_MS = 5 * 60 * 1000;

export function isDeviceLikelyInUse(
  lastSeenAt: string,
  now: Date = new Date(),
): boolean {
  const lastSeenMs = Date.parse(lastSeenAt);
  if (Number.isNaN(lastSeenMs)) return false;
  return now.getTime() - lastSeenMs <= ACTIVE_DEVICE_IN_USE_THRESHOLD_MS;
}

export type ActivationConfirmationKind = "none" | "caution" | "lightweight";

export interface ActivationConfirmation {
  kind: ActivationConfirmationKind;
  title: string;
  message: string;
  confirmLabel: string;
}

export interface ResolveActivationConfirmationInput {
  /** Is the device REQUESTING activation the owner-designated primary? */
  requestingIsPrimary: boolean;
  requestingDeviceId: string;
  /** The device currently holding the active lock, per this device's freshest pull. */
  activeDeviceId: string | null;
  activeDeviceLabel: string | null;
  /** ISO timestamp, from public.devices.last_seen_at for the current active device. */
  activeDeviceLastSeenAt: string | null;
  now?: Date;
}

/**
 * Vol 12_1 Section 6a.5's exact rule set, translated into UI terms:
 *
 * - Already active: nothing to confirm.
 * - Primary device requesting: ALWAYS the lightweight single-tap
 *   confirmation, regardless of whether the current active device looks
 *   in-use -- "no read-then-decide detail," but never zero confirmation
 *   either (the 2026-08-31 amendment this project's memory records).
 * - Non-primary device requesting, current active device looks in-use
 *   (Section 6a.1's trigger condition): the fuller caution prompt naming
 *   the device and its apparent in-use state.
 * - Non-primary device requesting, current active device does NOT look
 *   in-use (or its last-seen time is unknown): no prompt -- the DoD's
 *   own wording only requires the caution prompt "when the current
 *   active device is in-use," so an idle/unknown device does not block
 *   the ordinary handoff with an unnecessary confirmation.
 */
export function resolveActivationConfirmation(
  input: ResolveActivationConfirmationInput,
): ActivationConfirmation {
  const now = input.now ?? new Date();

  if (input.activeDeviceId === input.requestingDeviceId) {
    return {
      kind: "none",
      title: "",
      message: "",
      confirmLabel: "",
    };
  }

  if (input.requestingIsPrimary) {
    return {
      kind: "lightweight",
      title: "Take over as active device now?",
      message: "",
      confirmLabel: "Confirm",
    };
  }

  const inUse =
    input.activeDeviceLastSeenAt !== null &&
    isDeviceLikelyInUse(input.activeDeviceLastSeenAt, now);

  if (inUse) {
    const label = input.activeDeviceLabel ?? "The current device";
    return {
      kind: "caution",
      title: "Take over anyway?",
      message: `${label} appears to be in use right now — take over anyway?`,
      confirmLabel: "Take over anyway",
    };
  }

  return {
    kind: "none",
    title: "",
    message: "",
    confirmLabel: "",
  };
}

/**
 * Vol 12_1 Section 6a.5's "the demoted device is told why" requirement.
 * No dedicated reason-code column was added to active_device_lock for
 * this (a real design choice, not an oversight -- see the Sprint 17
 * runbook): the demoted device already has to look up the newly-active
 * device's label for the ordinary banner text, and that same lookup's
 * `is_primary` flag is a sufficient, free signal for which message to
 * show, without a schema migration or a Realtime broadcast payload
 * change.
 */
export function describeReadOnlyReason(input: {
  activeDeviceLabel: string | null;
  activeDeviceIsPrimary: boolean;
}): string {
  const label = input.activeDeviceLabel ?? "Another device";
  if (input.activeDeviceIsPrimary) {
    return `${label} took over as the active device — this device is read-only.`;
  }
  return `${label} is currently active — this device is read-only.`;
}
