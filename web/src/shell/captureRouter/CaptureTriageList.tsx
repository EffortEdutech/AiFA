/**
 * Shared Unclassified Triage table — Sprint 54 extraction, identical
 * to what Sprint 53 shipped, now rendered by both capture screens
 * (they share the same underlying `capture_triage` rows regardless of
 * which channel filed them, since the table has no channel column).
 */
import type { useCaptureRouterCore } from "./useCaptureRouterCore";

type CaptureRouterCore = ReturnType<typeof useCaptureRouterCore>;

export function CaptureTriageList({ core }: { core: CaptureRouterCore }): JSX.Element {
  return (
    <>
      <h2 style={{ marginTop: 24 }}>Unclassified Triage</h2>
      {core.triage.length === 0 ? (
        <p className="muted">Nothing waiting on manual triage.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Captured text</th>
              <th>Heuristic guess</th>
              <th>Captured</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {core.triage.map((item) => (
              <tr key={item.id}>
                <td>{item.rawText}</td>
                <td>{item.detectedDomain ?? "—"}</td>
                <td>{new Date(item.createdAt).toLocaleString()}</td>
                <td>
                  <button onClick={() => core.handleResolveTriage(item.id, "resolved")} style={{ marginRight: 6 }}>
                    Mark handled
                  </button>
                  <button onClick={() => core.handleResolveTriage(item.id, "dismissed")}>Dismiss</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
