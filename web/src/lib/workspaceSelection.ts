/**
 * Sprint 63 (Architecture §2.1) — remembers which Workspace (Client
 * Business) a multi-business login last chose on THIS device, so a
 * returning User skips the Workspace Switcher. Deliberately local-only
 * (browser localStorage), never synced anywhere — a different device is
 * always asked again, per Architecture §2.1's own wording ("Remember the
 * last-selected Workspace locally per device only (never synced)").
 *
 * Keyed by the signed-in login's own user id so a shared browser signing
 * in as a different login doesn't inherit the wrong remembered choice.
 */
const STORAGE_PREFIX = "aifa.lastWorkspace.";

export function getLastSelectedWorkspace(userId: string): string | null {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + userId);
  } catch {
    // Best-effort only — a private window or blocked storage just means
    // the Workspace Switcher is asked again every time, never a crash.
    return null;
  }
}

export function setLastSelectedWorkspace(userId: string, businessId: string): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + userId, businessId);
  } catch {
    // Best-effort — see getLastSelectedWorkspace.
  }
}
