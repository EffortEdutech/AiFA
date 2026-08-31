/**
 * Deterministic test double covering both AiProvider methods — lets Sprint
 * 5's tests exercise all three Vol 7_1 §5.1 failure modes (and the success
 * path) without a real vision call. Distinct from ScriptedCaptureProvider
 * (text-only, Sprint 6 rename of ScriptedExpenseProvider) since not every
 * provider needs vision, and keeping them separate makes it obvious at a
 * call site whether a test is exercising vision behaviour.
 */
import type {
  AiProvider,
  CategoryClassificationResult,
  ProfessionalContextBundle,
  VisionExtractionInput,
  VisionExtractionResult,
} from "../types";

export class ScriptedVisionExpenseProvider implements AiProvider {
  readonly name = "scripted-vision-test-provider";

  constructor(
    private readonly classifyScript: (
      pcb: ProfessionalContextBundle,
    ) => CategoryClassificationResult,
    private readonly visionScript: (
      input: VisionExtractionInput,
    ) => VisionExtractionResult,
  ) {}

  async classify(pcb: ProfessionalContextBundle) {
    return {
      result: this.classifyScript(pcb),
      metrics: { latencyMs: 1, estimatedCostUsd: 0, model: this.name },
    };
  }

  async extractExpenseFromImage(input: VisionExtractionInput) {
    return {
      result: this.visionScript(input),
      metrics: { latencyMs: 1, estimatedCostUsd: 0, model: this.name },
    };
  }
}
