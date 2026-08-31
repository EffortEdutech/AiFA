/**
 * Local placeholder provider — NOT real AI reasoning. Used only when no
 * EXPO_PUBLIC_AI_API_KEY is configured (see ai/client.ts's factory), so the
 * capture -> interpret -> route -> ledger pipeline is runnable and
 * demoable end to end before a real model key is supplied.
 *
 * Deliberately capped below the auto-record threshold (Vol 2_2 §4.1) no
 * matter how strong the keyword match is — this keeps a human in the
 * confirm loop until AnthropicExpenseProvider (or another real provider)
 * is actually wired in with a key. Matching is plain keyword overlap
 * against the PCB's own candidate_category_details (Sprint 6: reads this
 * from the PCB itself rather than importing accounting_rules.json
 * directly, so this provider works unmodified for whichever domain
 * — expense, sale, or purchase — buildCapturePcb was asked to build for;
 * it does not call any network service and costs nothing.
 */
import type {
  AiProvider,
  CategoryClassificationResult,
  ProfessionalContextBundle,
  WorkspaceAnswerResult,
} from "../types";

const MAX_HEURISTIC_CONFIDENCE = 0.85; // strictly below auto_record_min (0.90)

type CandidateCategoryDetail = {
  category: string;
  description: string;
  example_vendors: string[];
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3);
}

export class LocalHeuristicExpenseProvider implements AiProvider {
  readonly name = "local-heuristic-placeholder";

  async classify(pcb: ProfessionalContextBundle) {
    const startedAt = Date.now();
    const description = String(pcb.business_context.description ?? "");
    const counterparty = String(pcb.business_context.counterparty_name ?? "");
    const inputTokens = new Set(tokenize(`${description} ${counterparty}`));

    const candidateDetails = (pcb.business_context.candidate_category_details ??
      []) as CandidateCategoryDetail[];

    let best: { category: string; score: number } | null = null;
    for (const entry of candidateDetails) {
      const haystack = tokenize(
        `${entry.description} ${entry.example_vendors.join(" ")}`,
      );
      const score = haystack.filter((word) => inputTokens.has(word)).length;
      if (score > 0 && (!best || score > best.score)) {
        best = { category: entry.category, score };
      }
    }

    const latencyMs = Date.now() - startedAt;
    let result: CategoryClassificationResult;

    if (!best) {
      result = {
        category: null,
        confidence: 0.3,
        reasoning:
          "Local placeholder heuristic found no keyword match against this domain's Phase 1 categories. This is not real AI reasoning; a configured model would classify this directly.",
        clarifying_question: `Which category does "${description}" belong to?`,
        matched_rule_ids: [],
      };
    } else {
      const confidence = Math.min(
        MAX_HEURISTIC_CONFIDENCE,
        0.5 + best.score * 0.15,
      );
      result = {
        category: best.category,
        confidence,
        reasoning: `Local placeholder heuristic matched keywords in the description/counterparty against '${best.category}'. This is a placeholder, not real AI reasoning -- set EXPO_PUBLIC_AI_API_KEY to use a real provider.`,
        clarifying_question: null,
        // The PCB already scopes relevant_rules to the correct domain
        // (Sprint 6) -- reuse it rather than hardcoding an Expense-only
        // rule id.
        matched_rule_ids: [...pcb.relevant_rules],
      };
    }

    return {
      result,
      metrics: { latencyMs, estimatedCostUsd: 0, model: this.name },
    };
  }

  /**
   * Sprint 7 — a small, honest keyword-router, NOT real reasoning. Covers
   * exactly the Vol 0_1 §6 reduced set the PCB carries (cash position,
   * overdue receivables, upcoming payables, today's recommendation);
   * anything else is out_of_scope rather than guessed, same discipline as
   * the classification path above.
   */
  async answerFinancialQuestion({
    pcb,
    question,
  }: {
    pcb: ProfessionalContextBundle;
    question: string;
  }) {
    const startedAt = Date.now();
    const q = question.toLowerCase();
    const fc = pcb.financial_context as {
      cash_position: { cashPosition: number; currency: string };
      overdue_receivables: {
        counterpartyName: string | null;
        description: string | null;
        amount: number;
        currency: string;
        daysOutstanding: number;
        businessEventId: string;
      }[];
      upcoming_payables: {
        counterpartyName: string | null;
        description: string | null;
        amount: number;
        currency: string;
        businessEventId: string;
      }[];
      today_recommendation: {
        message: string;
        sourceBusinessEventId: string;
      } | null;
    };

    let result: WorkspaceAnswerResult;

    if (/\b(cash|balance|on hand)\b/.test(q)) {
      const cp = fc.cash_position;
      result = {
        answer: `Your cash position is ${cp.currency} ${cp.cashPosition.toFixed(2)}.`,
        sources: ["cash_position"],
        out_of_scope: false,
      };
    } else if (/\b(overdue|owe you|receivable)\b/.test(q)) {
      const list = fc.overdue_receivables;
      result =
        list.length === 0
          ? {
              answer: "Nothing is currently overdue.",
              sources: [],
              out_of_scope: false,
            }
          : {
              answer: list
                .map(
                  (r) =>
                    `${r.counterpartyName || r.description || "A customer"} owes ${r.currency} ${r.amount.toFixed(2)}, outstanding ${r.daysOutstanding} days.`,
                )
                .join(" "),
              sources: list.map((r) => r.businessEventId),
              out_of_scope: false,
            };
    } else if (/\b(payable|bill|owe\b(?!.*you))\b/.test(q)) {
      const list = fc.upcoming_payables;
      result =
        list.length === 0
          ? {
              answer: "You have no outstanding bills right now.",
              sources: [],
              out_of_scope: false,
            }
          : {
              answer: list
                .map(
                  (p) =>
                    `${p.counterpartyName || p.description || "A supplier"}: ${p.currency} ${p.amount.toFixed(2)}.`,
                )
                .join(" "),
              sources: list.map((p) => p.businessEventId),
              out_of_scope: false,
            };
    } else if (/\b(today|priority|focus|look at)\b/.test(q)) {
      const rec = fc.today_recommendation;
      result = rec
        ? {
            answer: rec.message,
            sources: [rec.sourceBusinessEventId],
            out_of_scope: false,
          }
        : {
            answer: "Nothing needs your attention today.",
            sources: [],
            out_of_scope: false,
          };
    } else {
      result = {
        answer:
          "I can only answer questions about cash position, overdue invoices, upcoming bills, or today's priority in this local placeholder mode -- set EXPO_PUBLIC_AI_API_KEY for open-ended questions.",
        sources: [],
        out_of_scope: true,
      };
    }

    return {
      result,
      metrics: {
        latencyMs: Date.now() - startedAt,
        estimatedCostUsd: 0,
        model: this.name,
      },
    };
  }
}
