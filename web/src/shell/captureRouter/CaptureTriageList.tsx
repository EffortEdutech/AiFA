/**
 * Shared Unclassified Triage table — Sprint 54 extraction, identical
 * to what Sprint 53 shipped, now rendered by both capture screens
 * (they share the same underlying `capture_triage` rows regardless of
 * which channel filed them, since the table has no channel column).
 *
 * UI polish Phase 4: shared Card + DataTable; same rows and actions.
 */
import { Button, Card, DataTable, type Column } from "../../ui";
import type { useCaptureRouterCore } from "./useCaptureRouterCore";

type CaptureRouterCore = ReturnType<typeof useCaptureRouterCore>;

type TriageRow = CaptureRouterCore["triage"][number];

export function CaptureTriageList({ core }: { core: CaptureRouterCore }): JSX.Element {
  const columns: Column<TriageRow>[] = [
    { key: "text", header: "Captured text", render: (item) => item.rawText },
    { key: "guess", header: "Heuristic guess", render: (item) => item.detectedDomain ?? "—" },
    { key: "at", header: "Captured", render: (item) => new Date(item.createdAt).toLocaleString() },
    {
      key: "actions",
      header: "",
      render: (item) => (
        <span className="ui-inline-actions">
          <Button size="sm" variant="secondary" onClick={() => core.handleResolveTriage(item.id, "resolved")}>
            Mark handled
          </Button>
          <Button size="sm" variant="ghost" onClick={() => core.handleResolveTriage(item.id, "dismissed")}>
            Dismiss
          </Button>
        </span>
      ),
    },
  ];
  return (
    <Card title="Unclassified Triage" description="Captures AI could not place — handle them manually.">
      <DataTable
        caption="Unclassified captures"
        columns={columns}
        rows={core.triage}
        rowKey={(item) => item.id}
        empty={<div className="ui-table-state">Nothing waiting on manual triage.</div>}
      />
    </Card>
  );
}
