import { useState } from "react";

import { askWorkspaceQuestion } from "@aifa/core/ai/workspacePipeline";
import type { AiProvider } from "@aifa/core/ai/types";
import type { SqlDb } from "@aifa/core/db/types";

import { Button, Card, Field } from "../ui";

interface Props {
  db: SqlDb;
  provider: AiProvider;
  businessId: string;
}

/** UI polish Phase 4: shared Card/Field/Button; behaviour unchanged. AI Workspace — Phase 2a "Yes" row (Vol 12_0 §4). Same three-state honesty model (real answer / outOfScope / noProviderConfigured) as mobile's WorkspaceScreen, via the identical @aifa/core askWorkspaceQuestion. */
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
    <Card
      title="Ask AiFA"
      description="Scoped to cash position, receivables, payables, and today's recommendation only — not a general chatbot."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && question.trim()) void handleAsk();
        }}
      >
        <div className="ui-inline-actions" style={{ alignItems: "flex-end" }}>
          <Field label="Your question">
            {(p) => (
              <input
                {...p}
                className="ui-input"
                placeholder="e.g. Can I afford to pay my supplier this week?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" icon="sparkles" loading={busy} disabled={!question.trim()}>
            {busy ? "Thinking…" : "Ask"}
          </Button>
        </div>
      </form>
      {error && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {error}
        </p>
      )}
      {answer && (
        <div className="ui-panel" role="status" style={{ marginTop: 12 }}>
          <p style={{ marginTop: 0 }}>{answer}</p>
          {sources.length > 0 && <p className="ui-muted">Sources: {sources.join(", ")}</p>}
        </div>
      )}
    </Card>
  );
}
