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
 *
 * UI polish Phase 2: three presentations of the same navigation —
 *   - expanded: section labels + text items (default, desktop);
 *   - icon rail (`collapsed`): one icon per section, jumping to its first
 *     visible item, with the section name as tooltip and accessible name;
 *   - drawer (`drawer`, below 768px): the expanded list as a slide-over
 *     that AppShell opens from the hamburger.
 */
import { Icon } from "../ui";
import { SIDEBAR } from "./sidebarConfig";
import { useAccess } from "./AccessContext";

interface Props {
  collapsed: boolean;
  activeItemId: string;
  onSelect: (itemId: string) => void;
  /** Render as a slide-over drawer (small screens). */
  drawer?: boolean;
  drawerOpen?: boolean;
}

export function Sidebar({ collapsed, activeItemId, onSelect, drawer = false, drawerOpen = false }: Props): JSX.Element {
  const { isDomainVisible } = useAccess();
  const rail = collapsed && !drawer;

  const sections = SIDEBAR.map((section) => ({
    section,
    items: section.items.filter((item) => isDomainVisible(item.domain)),
  })).filter((entry) => entry.items.length > 0);

  const classes = [
    "aifa-sidebar",
    rail ? "aifa-sidebar--collapsed" : "",
    drawer ? "aifa-sidebar--drawer" : "",
    drawer && drawerOpen ? "aifa-sidebar--open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <nav id="aifa-nav" className={classes} aria-label="Main navigation">
      {sections.map(({ section, items }) => {
        const sectionActive = items.some((item) => item.id === activeItemId);
        if (rail) {
          return (
            <button
              key={section.id}
              type="button"
              className={`aifa-rail-btn${sectionActive ? " aifa-rail-btn--active" : ""}`}
              title={section.label}
              aria-label={section.label}
              aria-current={sectionActive ? "page" : undefined}
              onClick={() => onSelect(items[0].id)}
            >
              <Icon name={section.icon} size={20} />
            </button>
          );
        }
        const labelId = `aifa-nav-${section.id}`;
        return (
          <div key={section.id} className="aifa-sidebar-section" role="group" aria-labelledby={labelId}>
            <div className="aifa-sidebar-section-label" id={labelId}>
              {section.label}
            </div>
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`aifa-sidebar-item${activeItemId === item.id ? " aifa-sidebar-item--active" : ""}`}
                onClick={() => onSelect(item.id)}
                aria-current={activeItemId === item.id ? "page" : undefined}
              >
                {item.label}
              </button>
            ))}
          </div>
        );
      })}
    </nav>
  );
}
