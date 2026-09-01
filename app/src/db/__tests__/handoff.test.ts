/**
 * Sprint 17 — Active-Device Handoff & Primary Override UX. Pure
 * decision-logic tests for @aifa/core/sync/handoff.ts (Vol 12_1 Section
 * 6a.1, 6a.5). No RN/Alert involved deliberately — see that module's own
 * doc for why the confirmation-prompt RULES are kept separate from the
 * UI call that shows them.
 */
import {
  ACTIVE_DEVICE_IN_USE_THRESHOLD_MS,
  describeReadOnlyReason,
  isDeviceLikelyInUse,
  resolveActivationConfirmation,
} from "@aifa/core/sync/handoff";

const NOW = new Date("2026-09-01T12:00:00.000Z");
const DEVICE_A = "device-a";
const DEVICE_B = "device-b";

describe("isDeviceLikelyInUse", () => {
  it("is true for a last_seen_at inside the threshold", () => {
    const lastSeenAt = new Date(
      NOW.getTime() - ACTIVE_DEVICE_IN_USE_THRESHOLD_MS / 2,
    ).toISOString();
    expect(isDeviceLikelyInUse(lastSeenAt, NOW)).toBe(true);
  });

  it("is false for a last_seen_at outside the threshold", () => {
    const lastSeenAt = new Date(
      NOW.getTime() - ACTIVE_DEVICE_IN_USE_THRESHOLD_MS * 2,
    ).toISOString();
    expect(isDeviceLikelyInUse(lastSeenAt, NOW)).toBe(false);
  });

  it("is false (not thrown) for an unparseable timestamp", () => {
    expect(isDeviceLikelyInUse("not-a-date", NOW)).toBe(false);
  });
});

describe("resolveActivationConfirmation (Vol 12_1 Section 6a.5)", () => {
  it("requires no confirmation when the requesting device is already active", () => {
    const result = resolveActivationConfirmation({
      requestingIsPrimary: false,
      requestingDeviceId: DEVICE_A,
      activeDeviceId: DEVICE_A,
      activeDeviceLabel: "This phone",
      activeDeviceLastSeenAt: NOW.toISOString(),
      now: NOW,
    });
    expect(result.kind).toBe("none");
  });

  it("primary device requesting ALWAYS gets the lightweight prompt, even when the current active device looks in-use", () => {
    const result = resolveActivationConfirmation({
      requestingIsPrimary: true,
      requestingDeviceId: DEVICE_A,
      activeDeviceId: DEVICE_B,
      activeDeviceLabel: "Owner's tablet",
      activeDeviceLastSeenAt: NOW.toISOString(), // just seen -- "in use"
      now: NOW,
    });
    expect(result.kind).toBe("lightweight");
    expect(result.title).toBe("Take over as active device now?");
    // The DoD/architecture doc's own point: no read-then-decide detail line.
    expect(result.message).toBe("");
  });

  it("primary device requesting still gets the lightweight prompt when the active device looks idle", () => {
    const staleTimestamp = new Date(
      NOW.getTime() - ACTIVE_DEVICE_IN_USE_THRESHOLD_MS * 10,
    ).toISOString();
    const result = resolveActivationConfirmation({
      requestingIsPrimary: true,
      requestingDeviceId: DEVICE_A,
      activeDeviceId: DEVICE_B,
      activeDeviceLabel: "Owner's tablet",
      activeDeviceLastSeenAt: staleTimestamp,
      now: NOW,
    });
    expect(result.kind).toBe("lightweight");
  });

  it("non-primary device requesting gets the fuller caution prompt when the active device looks in-use", () => {
    const result = resolveActivationConfirmation({
      requestingIsPrimary: false,
      requestingDeviceId: DEVICE_A,
      activeDeviceId: DEVICE_B,
      activeDeviceLabel: "Owner's tablet",
      activeDeviceLastSeenAt: NOW.toISOString(),
      now: NOW,
    });
    expect(result.kind).toBe("caution");
    expect(result.message).toContain("Owner's tablet");
    expect(result.message).toContain("in use right now");
  });

  it("non-primary device requesting gets no prompt when the active device looks idle", () => {
    const staleTimestamp = new Date(
      NOW.getTime() - ACTIVE_DEVICE_IN_USE_THRESHOLD_MS * 10,
    ).toISOString();
    const result = resolveActivationConfirmation({
      requestingIsPrimary: false,
      requestingDeviceId: DEVICE_A,
      activeDeviceId: DEVICE_B,
      activeDeviceLabel: "Owner's tablet",
      activeDeviceLastSeenAt: staleTimestamp,
      now: NOW,
    });
    expect(result.kind).toBe("none");
  });

  it("non-primary device requesting gets no prompt when the active device's last_seen_at is unknown", () => {
    const result = resolveActivationConfirmation({
      requestingIsPrimary: false,
      requestingDeviceId: DEVICE_A,
      activeDeviceId: DEVICE_B,
      activeDeviceLabel: null,
      activeDeviceLastSeenAt: null,
      now: NOW,
    });
    expect(result.kind).toBe("none");
  });
});

describe("describeReadOnlyReason (Vol 12_1 Section 6a.5 -- 'the demoted device is told why')", () => {
  it("names a primary-device takeover distinctly from an ordinary handoff", () => {
    const primaryReason = describeReadOnlyReason({
      activeDeviceLabel: "Owner's iPhone",
      activeDeviceIsPrimary: true,
    });
    expect(primaryReason).toContain("Owner's iPhone");
    expect(primaryReason).toContain("took over");

    const ordinaryReason = describeReadOnlyReason({
      activeDeviceLabel: "Owner's iPhone",
      activeDeviceIsPrimary: false,
    });
    expect(ordinaryReason).toContain("Owner's iPhone");
    expect(ordinaryReason).not.toContain("took over");
    expect(ordinaryReason).toContain("currently active");
  });

  it("falls back to a generic label when the active device's label is unknown", () => {
    const reason = describeReadOnlyReason({
      activeDeviceLabel: null,
      activeDeviceIsPrimary: false,
    });
    expect(reason).toContain("Another device");
  });
});
