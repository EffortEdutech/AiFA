/**
 * AI CFO Assistant Engine — Phase 1 ("CFO Guidance v1"), Vol 2_4, Vol 0_1
 * §6's deliberately reduced launch scope. Deterministic, rule-based —
 * no AI provider call is needed here (unlike Expense/Sale/Purchase
 * classification, there is no ambiguous category to guess: "is this
 * receivable overdue" and "what's the single thing to flag today" are
 * plain computations over already-recorded Financial Data, consistent
 * with Vol 2_4 §3's "Translation" and "Prioritisation" responsibilities).
 * Reuses Sprint 4's cash position and Sprint 6's outstanding receivables/
 * payables queries rather than re-deriving them — this module only adds
 * the "overdue" business rule and the single-recommendation prioritisation
 * on top.
 */
import {
  getCashPositionSummary,
  getOutstandingPayables,
  getOutstandingReceivables,
  type CashPositionSummary,
  type OutstandingItem,
} from "../db/financialSummaryRepository";
import type { SqlDb } from "../db/types";

/**
 * Phase 1 has no real invoice due date (Vol 11_1 §3's BusinessData schema
 * has no due-date field) -- "overdue" here is a captured_at-age threshold,
 * a documented proxy, not true days-past-due. Vol 0_1 §5 already
 * establishes the precedent that Phase 1 thresholds are "a starting
 * configuration ... not derived from a formal model at launch"; this is
 * the same kind of choice, applied here.
 */
export const OVERDUE_THRESHOLD_DAYS = 30;

export interface OverdueReceivable extends OutstandingItem {
  daysOutstanding: number;
}

export interface CfoRecommendation {
  kind: "overdue_receivable";
  message: string;
  sourceBusinessEventId: string;
  amount: number;
  currency: string;
}

export interface CfoGuidance {
  cashPosition: CashPositionSummary;
  overdueReceivables: OverdueReceivable[];
  totalOverdueAmount: number;
  /** Vol 0_1 §6's "upcoming payables list" -- honestly just the full outstanding-payables list (see getOutstandingPayables's own comment): Phase 1 has no due-date data to determine genuine "upcoming" vs "not yet due", so nothing here is age-filtered the way receivables are. */
  upcomingPayables: OutstandingItem[];
  totalUpcomingPayableAmount: number;
  /** At most one, per Vol 0_1 §6 ("surfaced once per day, at most") -- honestly null when nothing qualifies, never a manufactured recommendation. */
  todayRecommendation: CfoRecommendation | null;
}

function daysBetween(earlier: Date, later: Date): number {
  return Math.floor(
    (later.getTime() - earlier.getTime()) / (1000 * 60 * 60 * 24),
  );
}

function buildTodayRecommendation(
  overdueReceivables: OverdueReceivable[],
): CfoRecommendation | null {
  if (overdueReceivables.length === 0) return null;
  // Prioritisation (Vol 2_4 §3): surface the single most-overdue item,
  // not the largest amount or the full list -- "the thing that matters
  // most right now" for a cash-collection nudge is age, not size.
  const top = overdueReceivables[0];
  const who = top.counterpartyName || top.description || "a customer";
  return {
    kind: "overdue_receivable",
    message: `Follow up with ${who} — ${top.currency} ${top.amount.toFixed(2)} has been outstanding for ${top.daysOutstanding} days.`,
    sourceBusinessEventId: top.businessEventId,
    amount: top.amount,
    currency: top.currency,
  };
}

export async function getCfoGuidance(
  db: SqlDb,
  businessId: string,
  options?: { now?: Date; trendDays?: number; overdueThresholdDays?: number },
): Promise<CfoGuidance> {
  const now = options?.now ?? new Date();
  const overdueThresholdDays =
    options?.overdueThresholdDays ?? OVERDUE_THRESHOLD_DAYS;

  const [cashPosition, receivables, payables] = await Promise.all([
    getCashPositionSummary(db, { trendDays: options?.trendDays }),
    getOutstandingReceivables(db, businessId),
    getOutstandingPayables(db, businessId),
  ]);

  const overdueReceivables: OverdueReceivable[] = receivables
    .map((item) => ({
      ...item,
      daysOutstanding: daysBetween(new Date(item.capturedAt), now),
    }))
    .filter((item) => item.daysOutstanding >= overdueThresholdDays)
    // Oldest (most overdue) first -- matches buildTodayRecommendation's
    // choice of overdueReceivables[0] as "the" top priority.
    .sort((a, b) => b.daysOutstanding - a.daysOutstanding);

  return {
    cashPosition,
    overdueReceivables,
    totalOverdueAmount: overdueReceivables.reduce(
      (sum, r) => sum + r.amount,
      0,
    ),
    upcomingPayables: payables,
    totalUpcomingPayableAmount: payables.reduce((sum, p) => sum + p.amount, 0),
    todayRecommendation: buildTodayRecommendation(overdueReceivables),
  };
}
