/**
 * Professional Context Bundle assembly — Vol 3_1 §3-4, Vol 11_1 §6.
 *
 * Builds the minimal, task-scoped bundle sent to the AI model: only the
 * specific BusinessData fields relevant to this one classification task,
 * never the full PKA or full database (Vol 3_1 §2, §6 governance
 * enforcement — KRCE is "the single enforcement point" for that rule).
 *
 * Sprint 6: generalised from buildExpensePcb (Expense-only) to
 * buildCapturePcb, domain-parameterised across expense/sale/purchase —
 * this is the concrete Phase 1 implementation of Vol 6_0 §4's "shared
 * engine, domain-scoped rules" pattern. Which category list and PKA rules
 * get included is selected by `input.domain`; the shape of the bundle
 * itself does not change per domain.
 */
import type { CfoGuidance } from "./cfoGuidance";
import type {
  BusinessDomain,
  CapturePcbInput,
  ProfessionalContextBundle,
} from "./types";
import accountingRules from "../../pka/accounting_rules.json";

type CategoryEntry = {
  category: string;
  description: string;
  example_vendors: string[];
};

const CATEGORY_LISTS: Record<BusinessDomain, CategoryEntry[]> = {
  expense: accountingRules.expense_categories,
  sale: accountingRules.sales_categories,
  purchase: accountingRules.purchase_categories,
};

const DOMAIN_LABEL: Record<BusinessDomain, string> = {
  expense: "Expense",
  sale: "Sales",
  purchase: "Purchase",
};

export function categoriesForDomain(domain: BusinessDomain): CategoryEntry[] {
  return CATEGORY_LISTS[domain];
}

export function rulesForDomain(domain: BusinessDomain) {
  return accountingRules.rules.filter((rule) => rule.domain === domain);
}

export function buildCapturePcb(
  input: CapturePcbInput,
): ProfessionalContextBundle {
  const categories = categoriesForDomain(input.domain);
  const rules = rulesForDomain(input.domain);

  return {
    user_intent: `Classify this ${DOMAIN_LABEL[input.domain]}-domain Business Event into a Phase 1 chart-of-accounts category and propose a double-entry posting.`,
    relevant_rules: rules.map((rule) => rule.id),
    business_context: {
      description: input.description,
      counterparty_name: input.counterpartyName,
      amount: input.amount,
      currency: input.currency,
      payment_method: input.paymentMethod,
      candidate_categories: categories.map((entry) => entry.category),
      // Full category detail (description + example counterparty keywords),
      // not just names — lets any provider (including the local heuristic)
      // match against domain-scoped content without importing
      // accounting_rules.json itself. Keeps the PCB the single source of
      // domain context a provider needs (Vol 3_1 §2).
      candidate_category_details: categories,
    },
    financial_context: {
      chart_of_accounts: accountingRules.chart_of_accounts,
    },
    source_references: [input.businessEventId],
    pka_version: accountingRules.pka_version,
    limitations: accountingRules.limitations,
    // Phase 1 has no high-sensitivity domain wired into capture yet
    // (payroll, Vol 6_7, is unbuilt) -- every expense/sale/purchase
    // capture is correctly "standard" (Sprint 10 audit, Vol 8_2 Section 3).
    sensitivity_classification: "standard",
  };
}

/**
 * Sprint 7 — PCB for the AI Workspace's free-form Q&A (Vol 7_2 §3).
 * Scoped to exactly Vol 0_1 §6's reduced CFO guidance set (cash position,
 * money in/out trend, overdue receivables, upcoming payables, today's
 * recommendation) — nothing else is included, so a provider literally
 * cannot answer a question outside that scope even if asked, per the
 * Sprint 7 risk register's "keep it scoped ... not a general chatbot".
 * relevant_rules is empty: CFO guidance is deterministic app logic
 * (cfoGuidance.ts), not a PKA-governed classification rule the way
 * EXP/SALE/PUR/BANK rules are.
 */
export function buildWorkspacePcb(
  guidance: CfoGuidance,
): ProfessionalContextBundle {
  const sourceReferences = [
    ...guidance.overdueReceivables.map((r) => r.businessEventId),
    ...guidance.upcomingPayables.map((p) => p.businessEventId),
    ...(guidance.todayRecommendation
      ? [guidance.todayRecommendation.sourceBusinessEventId]
      : []),
  ];

  return {
    user_intent:
      "Answer a free-form owner question about their business finances, using ONLY the financial_context provided. If the question cannot be answered from this data, say so explicitly rather than guessing (Vol 1_4 §7).",
    relevant_rules: [],
    business_context: {},
    financial_context: {
      cash_position: guidance.cashPosition,
      overdue_receivables: guidance.overdueReceivables,
      upcoming_payables: guidance.upcomingPayables,
      today_recommendation: guidance.todayRecommendation,
    },
    source_references: [...new Set(sourceReferences)],
    pka_version: accountingRules.pka_version,
    limitations: [
      ...accountingRules.limitations,
      "The AI Workspace only reasons over cash position, money in/out trend, overdue receivables, and upcoming payables (Vol 0_1 §6) -- it cannot answer questions requiring KPI ratios, valuation, or multi-period comparison; those are Phase 2.",
    ],
    // CFO guidance draws only from cash/receivables/payables -- no
    // payroll or other high-sensitivity source is in scope (Sprint 10 audit).
    sensitivity_classification: "standard",
  };
}
