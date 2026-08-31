/**
 * Deterministic test double for AiProvider — the AI-pipeline equivalent of
 * db/testAdapter.ts's role for SqlDb. Lets the routing/ledger tests
 * exercise the full pipeline (Expense since Sprint 3; Sale and Purchase
 * too as of Sprint 6) without a network call or a real API key, mirroring
 * the same test-adapter pattern established in Sprint 2. Renamed from
 * ScriptedExpenseProvider to ScriptedCaptureProvider in Sprint 6 since it
 * is no longer Expense-specific.
 */
import type {
  AiProvider,
  CategoryClassificationResult,
  ProfessionalContextBundle,
} from "../types";

export class ScriptedCaptureProvider implements AiProvider {
  readonly name = "scripted-test-provider";

  constructor(
    private readonly script: (
      pcb: ProfessionalContextBundle,
    ) => CategoryClassificationResult,
  ) {}

  async classify(pcb: ProfessionalContextBundle) {
    const result = this.script(pcb);
    return {
      result,
      metrics: {
        latencyMs: 1,
        estimatedCostUsd: 0,
        model: this.name,
      },
    };
  }
}
