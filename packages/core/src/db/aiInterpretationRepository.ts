/**
 * AI interpretation record repository — explainability persistence
 * (Vol 5_3 principle) required concretely by two Sprint 3 Definition of
 * Done items: every AI decision has a traceable source_reference, and
 * cost-per-event is measured and logged. Not itself a Vol 11_1 schema
 * (added in Sprint 3 — see docs update in the same sprint).
 */
import type { SqlDb } from "./types";
import { assertSyncGateOk, enqueueSyncableWrite } from "../sync/syncHooks";

export type AiDecision = "auto_record" | "draft_confirm" | "clarify";

export interface AiInterpretation {
  id: string;
  business_event_id: string;
  business_data_id: string;
  requested_at: string;
  model: string;
  decision: AiDecision;
  category: string | null;
  confidence: number;
  reasoning: string;
  clarifying_question: string | null;
  matched_rule_ids: string; // JSON-encoded array of PKA rule IDs
  source_references: string; // JSON-encoded array of BusinessEvent ids
  pka_version: string;
  latency_ms: number;
  estimated_cost_usd: number | null;
}

export interface RecordAiInterpretationInput {
  businessEventId: string;
  businessDataId: string;
  model: string;
  decision: AiDecision;
  category: string | null;
  confidence: number;
  reasoning: string;
  clarifyingQuestion: string | null;
  matchedRuleIds: string[];
  sourceReferences: string[];
  pkaVersion: string;
  latencyMs: number;
  estimatedCostUsd: number | null;
}

export async function recordAiInterpretation(
  db: SqlDb,
  input: RecordAiInterpretationInput,
): Promise<AiInterpretation> {
  await assertSyncGateOk(db);
  const id = `AI-${input.businessDataId.replace(/^BD-/, "")}-${Date.now().toString(36)}`;
  const requestedAt = new Date().toISOString();
  const matchedRuleIdsJson = JSON.stringify(input.matchedRuleIds);
  const sourceReferencesJson = JSON.stringify(input.sourceReferences);

  await db.execute(
    `INSERT INTO ai_interpretations
       (id, business_event_id, business_data_id, requested_at, model, decision, category, confidence, reasoning, clarifying_question, matched_rule_ids, source_references, pka_version, latency_ms, estimated_cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      input.businessEventId,
      input.businessDataId,
      requestedAt,
      input.model,
      input.decision,
      input.category,
      input.confidence,
      input.reasoning,
      input.clarifyingQuestion,
      matchedRuleIdsJson,
      sourceReferencesJson,
      input.pkaVersion,
      input.latencyMs,
      input.estimatedCostUsd,
    ],
  );

  const record: AiInterpretation = {
    id,
    business_event_id: input.businessEventId,
    business_data_id: input.businessDataId,
    requested_at: requestedAt,
    model: input.model,
    decision: input.decision,
    category: input.category,
    confidence: input.confidence,
    reasoning: input.reasoning,
    clarifying_question: input.clarifyingQuestion,
    matched_rule_ids: matchedRuleIdsJson,
    source_references: sourceReferencesJson,
    pka_version: input.pkaVersion,
    latency_ms: input.latencyMs,
    estimated_cost_usd: input.estimatedCostUsd,
  };
  await enqueueSyncableWrite(db, "ai_interpretation", "insert", record);
  return record;
}

/**
 * Sprint 16 — applies a pulled `ai_interpretation` insert envelope.
 * recordAiInterpretation above cannot be reused directly for this: its id
 * embeds Date.now() at call time, so it can neither accept the
 * originating device's already-assigned id nor be idempotent under
 * replay. This function takes the full record as captured in the
 * envelope and applies it with INSERT OR IGNORE instead.
 */
export async function applyPulledAiInterpretation(
  db: SqlDb,
  record: AiInterpretation,
): Promise<void> {
  await db.execute(
    `INSERT OR IGNORE INTO ai_interpretations
       (id, business_event_id, business_data_id, requested_at, model, decision, category, confidence, reasoning, clarifying_question, matched_rule_ids, source_references, pka_version, latency_ms, estimated_cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      record.id,
      record.business_event_id,
      record.business_data_id,
      record.requested_at,
      record.model,
      record.decision,
      record.category,
      record.confidence,
      record.reasoning,
      record.clarifying_question,
      record.matched_rule_ids,
      record.source_references,
      record.pka_version,
      record.latency_ms,
      record.estimated_cost_usd,
    ],
  );
}

export async function listAiInterpretationsForEvent(
  db: SqlDb,
  businessEventId: string,
): Promise<AiInterpretation[]> {
  return db.queryAll<AiInterpretation>(
    `SELECT * FROM ai_interpretations WHERE business_event_id = ? ORDER BY requested_at ASC;`,
    [businessEventId],
  );
}
