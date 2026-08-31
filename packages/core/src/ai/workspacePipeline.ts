/**
 * AI Workspace orchestration — Vol 7_2 (AI Workspace Architecture), Sprint
 * 7. Assembles the reduced-scope PCB (buildWorkspacePcb, pcb.ts) from
 * cfoGuidance.ts's deterministic computation, then delegates the actual
 * free-form reasoning to the AiProvider — this module does not itself
 * interpret the question text (that's the provider's job, same separation
 * of concerns as capturePipeline.ts/classifyAndRoute not doing its own
 * category matching).
 */
import { getCfoGuidance } from "./cfoGuidance";
import { buildWorkspacePcb } from "./pcb";
import type { AiProvider } from "./types";

import type { SqlDb } from "../db/types";

export interface AskWorkspaceQuestionInput {
  businessId: string;
  question: string;
}

export interface WorkspaceAnswer {
  answer: string;
  sources: string[];
  /** A capable provider evaluated the question and honestly declined it (Vol 1_4 §7) -- distinct from noProviderConfigured below. */
  outOfScope: boolean;
  /** True when the configured AiProvider has no answerFinancialQuestion method at all -- an honest "no reasoning capability available" state, not a fabricated answer or a silent no-op. */
  noProviderConfigured: boolean;
}

/**
 * Answers a free-form owner question, scoped to Vol 0_1 §6's reduced CFO
 * guidance set. Never calls the provider's classify() -- this is a
 * separate reasoning task with its own PCB and its own optional provider
 * method (Vol 5_2 §4.1 still applies: one orchestrated call per task, not
 * a multi-agent chain).
 */
export async function askWorkspaceQuestion(
  db: SqlDb,
  provider: AiProvider,
  input: AskWorkspaceQuestionInput,
): Promise<WorkspaceAnswer> {
  const guidance = await getCfoGuidance(db, input.businessId);
  const pcb = buildWorkspacePcb(guidance);

  if (!provider.answerFinancialQuestion) {
    return {
      answer:
        "No AI model is configured, so I can't answer free-form questions yet. Set EXPO_PUBLIC_AI_API_KEY to enable the AI Workspace, or check the Dashboard for cash position, overdue invoices, and upcoming bills directly.",
      sources: [],
      outOfScope: true,
      noProviderConfigured: true,
    };
  }

  const { result } = await provider.answerFinancialQuestion({
    pcb,
    question: input.question,
  });

  return {
    answer: result.answer,
    sources: result.sources,
    outOfScope: result.out_of_scope,
    noProviderConfigured: false,
  };
}
