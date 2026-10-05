/**
 * Sprint 63 (Architecture §2.1) — shown between sign-in and the shell
 * when a login has an ACTIVE business_membership in more than one
 * Client Business. Lists each by `legal_name`; picking one enters it and
 * remembers the choice on this device only (workspaceSelection.ts).
 *
 * Deliberately minimal for this sprint — no rename/leave/create actions
 * here (creating a further business is still BusinessCreatePage's own
 * flow, reachable once inside a Workspace via Business Settings in a
 * later sprint if the owner wants a "+ New business" entry point; not
 * part of Sprint 63's DoD).
 *
 * UI polish Phase 2: presentation only — same props, same callbacks.
 */
import type { MyBusinessSummary } from "@aifa/core/sync/teamMembershipTransport";

import { Icon } from "../ui";
import { AuthLayout } from "../shell/AuthLayout";

interface Props {
  businesses: MyBusinessSummary[];
  onSelect: (businessId: string) => void;
}

export function WorkspaceSwitcher({ businesses, onSelect }: Props): JSX.Element {
  return (
    <AuthLayout
      title="Choose a workspace"
      description="You belong to more than one Client Business. Pick which one to open."
    >
      <ul className="aifa-choice-list">
        {businesses.map((b) => (
          <li key={b.businessId}>
            <button type="button" className="aifa-choice" onClick={() => onSelect(b.businessId)}>
              <span className="aifa-choice__icon" aria-hidden="true">
                <Icon name="briefcase" size={18} />
              </span>
              <span className="aifa-choice__name">{b.legalName ?? `Business #${b.businessId.slice(0, 8)}`}</span>
            </button>
          </li>
        ))}
      </ul>
    </AuthLayout>
  );
}
