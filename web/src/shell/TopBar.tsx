/**
 * Persistent top bar — Sprint 37 (Vol 12_2 §5.5).
 *
 * Hamburger toggle (left) · business name · AI Workspace slide-over
 * trigger · notifications bell (placeholder — no new notification
 * backend this sprint, per Vol 12_2 §4.3) · active-device indicator
 * (Vol 12_1 §8's "which device is active" made persistently visible,
 * not buried in Settings, per that volume's own requirement) · account
 * menu (sign out).
 */
import { signOut } from "../lib/auth";
import type { ActiveDeviceInfo } from "../lib/syncService";

interface Props {
  onToggleSidebar: () => void;
  businessLabel: string;
  activeDeviceInfo: ActiveDeviceInfo | null;
  onOpenWorkspace: () => void;
}

export function TopBar({
  onToggleSidebar,
  businessLabel,
  activeDeviceInfo,
  onOpenWorkspace,
}: Props): JSX.Element {
  const isThisDeviceActive = activeDeviceInfo?.isActiveDevice ?? false;

  return (
    <header className="aifa-topbar">
      <button
        className="aifa-hamburger"
        aria-label="Toggle navigation"
        onClick={onToggleSidebar}
      >
        ☰
      </button>
      <div className="aifa-topbar-title">{businessLabel}</div>
      <div className="aifa-topbar-spacer" />
      <span
        className={`aifa-active-device-pill${isThisDeviceActive ? " aifa-active-device-pill--active" : ""}`}
        title={
          isThisDeviceActive
            ? "This device is the active (writing) device"
            : "This device is read-only — another device is active"
        }
      >
        {isThisDeviceActive ? "● Active" : "○ Read-only"}
      </span>
      <button className="aifa-topbar-icon-btn" aria-label="Notifications" title="Notifications (placeholder — Sprint 37 does not add a notification backend)">
        🔔
      </button>
      <button className="aifa-topbar-icon-btn" aria-label="AI Workspace" onClick={onOpenWorkspace} title="AI Workspace">
        AI
      </button>
      <button
        className="aifa-topbar-icon-btn"
        aria-label="Sign out"
        title="Sign out"
        onClick={() => void signOut()}
      >
        ⏻
      </button>
    </header>
  );
}
