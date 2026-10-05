/**
 * Persistent top bar — Sprint 37 (Vol 12_2 §5.5).
 *
 * Hamburger toggle (left) · business name · AI Workspace slide-over
 * trigger · notifications bell (placeholder — no new notification
 * backend this sprint, per Vol 12_2 §4.3) · active-device indicator
 * (Vol 12_1 §8's "which device is active" made persistently visible,
 * not buried in Settings, per that volume's own requirement) · account
 * menu (sign out).
 *
 * UI polish Phase 2: shows the real business name, uses the in-house SVG
 * icons, and moves sign-out into an account menu that also shows who is
 * signed in. Same actions, same device-status disclosure.
 */
import { useEffect, useRef, useState } from "react";

import { signOut } from "../lib/auth";
import type { ActiveDeviceInfo } from "../lib/syncService";
import { Icon } from "../ui";

interface Props {
  onToggleSidebar: () => void;
  /** Whether the navigation is currently shown (drawer open, or desktop sidebar expanded). */
  navExpanded: boolean;
  businessLabel: string;
  userEmail?: string | null;
  activeDeviceInfo: ActiveDeviceInfo | null;
  onOpenWorkspace: () => void;
}

export function TopBar({
  onToggleSidebar,
  navExpanded,
  businessLabel,
  userEmail,
  activeDeviceInfo,
  onOpenWorkspace,
}: Props): JSX.Element {
  const isThisDeviceActive = activeDeviceInfo?.isActiveDevice ?? false;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <header className="aifa-topbar">
      <button
        type="button"
        className="aifa-topbar-btn aifa-topbar-btn--icon"
        aria-label="Toggle navigation"
        aria-controls="aifa-nav"
        aria-expanded={navExpanded}
        onClick={onToggleSidebar}
      >
        <Icon name="menu" size={20} />
      </button>
      <div className="aifa-brand">
        <span className="aifa-brand__mark" aria-hidden="true">
          A
        </span>
        <span className="aifa-brand__name" title={businessLabel}>
          {businessLabel}
        </span>
      </div>
      <div className="aifa-topbar-spacer" />
      <span
        className={`aifa-active-device-pill${isThisDeviceActive ? " aifa-active-device-pill--active" : ""}`}
        title={
          isThisDeviceActive
            ? "This device is the active (writing) device"
            : "This device is read-only — another device is active"
        }
      >
        {isThisDeviceActive ? "Active" : "Read-only"}
      </span>
      <button
        type="button"
        className="aifa-topbar-btn aifa-topbar-btn--icon"
        aria-label="Notifications"
        title="Notifications — not available yet"
        disabled
      >
        <Icon name="bell" size={18} />
      </button>
      <button
        type="button"
        className="aifa-topbar-btn"
        aria-label="AI Workspace"
        onClick={onOpenWorkspace}
        title="AI Workspace"
      >
        <Icon name="sparkles" size={18} />
        <span className="aifa-hide-sm">AI Workspace</span>
      </button>
      <div className="aifa-menu" ref={menuRef}>
        <button
          type="button"
          className="aifa-topbar-btn aifa-topbar-btn--icon"
          aria-label="Account menu"
          aria-haspopup="true"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Icon name="user" size={18} />
        </button>
        {menuOpen && (
          <div className="aifa-menu__panel" role="menu">
            {userEmail && <div className="aifa-menu__label">Signed in as {userEmail}</div>}
            <button
              type="button"
              role="menuitem"
              className="aifa-menu__item"
              onClick={() => {
                setMenuOpen(false);
                void signOut();
              }}
            >
              <Icon name="logout" size={16} />
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
