import { useState } from "react";

import { askWorkspaceQuestion } from "@aifa/core/ai/workspacePipeline";
import type { AiProvider } from "@aifa/core/ai/types";
import type { SqlDb } from "@aifa/core/db/types";

interface Props {
  db: SqlDb;
  provider: AiProvider;
  businessId: string;
}

/** AI Workspace — Phase 2a "Yes" row (Vol 12_0 §4). Same three-state honesty model (real answer / outOfScope / noProviderConfigured) as mobile's WorkspaceScreen, via the identical @aifa/core askWorkspaceQuestion. */
export function Workspace({ db, provider, businessId }: Props): JSX.Element {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleAsk(): Promise<void> {
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await askWorkspaceQuestion(db, provider, {
        businessId,
        question: question.trim(),
      });
      setAnswer(result.answer);
      setSources(result.sources);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong asking that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: 16, marginTop: 0 }}>Ask AiFA</h2>
      <p className="muted">
        Scoped to cash position, receivables, payables, and today's
        recommendation only — not a general chatbot.
      </p>
      <div className="row">
        <input
          placeholder="e.g. Can I afford to pay my supplier this week?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          style={{ flex: 1, minWidth: 240, padding: 8 }}
          onKeyDown={(e) => e.key === "Enter" && void handleAsk()}
        />
        <button onClick={() => void handleAsk()} disabled={busy || !question.trim()}>
          {busy ? "Thinking…" : "Ask"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {answer && (
        <div style={{ marginTop: 12, borderTop: "1px solid #e2e2e5", paddingTop: 12 }}>
          <p>{answer}</p>
          {sources.length > 0 && (
            <p className="muted">Sources: {sources.join(", ")}</p>
          )}
        </div>
      )}
    </div>
  );
}
