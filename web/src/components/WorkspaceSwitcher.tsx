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
 */
import type { MyBusinessSummary } from "@aifa/core/sync/teamMembershipTransport";

interface Props {
  businesses: MyBusinessSummary[];
  onSelect: (businessId: string) => void;
}

export function WorkspaceSwitcher({ businesses, onSelect }: Props): JSX.Element {
  return (
    <div style={{ maxWidth: 420, margin: "48px auto", padding: 16 }}>
      <div className="card">
        <h1 style={{ fontSize: 18, marginTop: 0 }}>Choose a workspace</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          You belong to more than one Client Business. Pick which one to open.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          {businesses.map((b) => (
            <button
              key={b.businessId}
              onClick={() => onSelect(b.businessId)}
              style={{ textAlign: "left", padding: "10px 12px" }}
            >
              {b.legalName ?? `Business #${b.businessId.slice(0, 8)}`}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
