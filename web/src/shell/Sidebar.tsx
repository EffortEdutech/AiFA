/**
 * Hamburger + collapsible sidebar — Sprint 37 (Vol 12_2 §4.1, owner
 * requirement 3: "I prefer hamburger menu with sidebar for
 * navigation").
 *
 * A section with zero visible items collapses out of the sidebar
 * entirely (Vol 12_2 §4.4) rather than showing as a greyed-out dead
 * end — computed fresh on every render from AccessContext, never
 * cached (mirrors teamMembershipTransport.ts's own "never cache
 * effectiveAccessModel" rule, extended here to the visibility it
 * drives).
 */
import { SIDEBAR } from "./sidebarConfig";
import { useAccess } from "./AccessContext";

interface Props {
  collapsed: boolean;
  activeItemId: string;
  onSelect: (itemId: string) => void;
}

export function Sidebar({ collapsed, activeItemId, onSelect }: Props): JSX.Element {
  const { isDomainVisible } = useAccess();

  return (
    <nav
      className={`aifa-sidebar${collapsed ? " aifa-sidebar--collapsed" : ""}`}
      aria-label="Main navigation"
    >
      {SIDEBAR.map((section) => {
        const visibleItems = section.items.filter((item) => isDomainVisible(item.domain));
        if (visibleItems.length === 0) return null;
        return (
          <div key={section.id} className="aifa-sidebar-section">
            {!collapsed && <div className="aifa-sidebar-section-label">{section.label}</div>}
            {visibleItems.map((item) => (
              <button
                key={item.id}
                className={`aifa-sidebar-item${activeItemId === item.id ? " aifa-sidebar-item--active" : ""}`}
                onClick={() => onSelect(item.id)}
                title={collapsed ? item.label : undefined}
                aria-current={activeItemId === item.id ? "page" : undefined}
                aria-label={collapsed ? item.label : undefined}
              >
                {collapsed ? item.label.slice(0, 1) : item.label}
              </button>
            ))}
          </div>
        );
      })}
    </nav>
  );
}
