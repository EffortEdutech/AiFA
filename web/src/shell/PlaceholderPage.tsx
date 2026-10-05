/**
 * Placeholder for a sidebar item whose real page is a later Phase 4
 * sprint's own scope (Vol 12_2 §9) — Sprint 37 ships every module item
 * as this placeholder except the three items an existing Phase 1/2
 * component already covers (Overview, Devices, Business Settings; see
 * sidebarConfig.ts's `status` field).
 */
import { PageHeader } from "../ui";
import type { SidebarItem } from "./sidebarConfig";

export function PlaceholderPage({ item }: { item: SidebarItem }): JSX.Element {
  return (
    <div className="aifa-page">
      <PageHeader
        title={item.label}
        description={`Sprint ${item.sprint} builds this page (see the Phase 4 sprint plan). No backend work is needed — the RPCs this page will call already exist and are verified.`}
      />
    </div>
  );
}
