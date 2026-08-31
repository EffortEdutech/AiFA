/**
 * Deterministic test double for the AI Workspace's answerFinancialQuestion
 * (Sprint 7, Vol 7_2) -- kept separate from ScriptedCaptureProvider, same
 * reasoning as ScriptedVisionExpenseProvider's own comment: not every
 * provider needs this capability, and keeping the doubles separate makes
 * it obvious at a call site whether a test is exercising workspace
 * behaviour. classify() is intentionally not implemented -- this double is
 * workspace-only, and capturePipeline tests should use
 * ScriptedCaptureProvider instead.
 */
import type {
  AiProvider,
  ProfessionalContextBundle,
  WorkspaceAnswerResult,
} from "../types";

export class ScriptedWorkspaceProvider implements AiProvider {
  readonly name = "scripted-workspace-test-provider";

  constructor(
    private readonly answerScript: (input: {
      pcb: ProfessionalContextBundle;
      question: string;
    }) => WorkspaceAnswerResult,
  ) {}

  async classify(): Promise<never> {
    throw new Error(
      "ScriptedWorkspaceProvider does not implement classify() -- use ScriptedCaptureProvider for capture-pipeline tests.",
    );
  }

  async answerFinancialQuestion(input: {
    pcb: ProfessionalContextBundle;
    question: string;
  }) {
    return {
      result: this.answerScript(input),
      metrics: { latencyMs: 1, estimatedCostUsd: 0, model: this.name },
    };
  }
}
