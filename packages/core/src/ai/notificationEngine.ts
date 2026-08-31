/**
 * Notification & AI Recommendation layer — Phase 1 ("Notifications,
 * Basic"), Vol 7_5, Vol 0_1 §4. Computes what should be surfaced to the
 * owner right now; delivery is in-app only in Phase 1 (no OS push
 * integration — that would be a new production dependency, e.g.
 * expo-notifications, not approved per AGENTS.md, and is Sprint 10+
 * territory per Vol 7_7). Reuses the Sprint 7 CFO Guidance triggers
 * (overdue receivables) as the "action needed" source (Vol 7_5 §1 —
 * "how the CAE's guidance reaches the owner"), and adds
 * "confirmation request" from any still-unresolved draft/needs_clarification
 * capture across all three AI-interpreted domains.
 *
 * Deliberately narrow, matching the Sprint 8 doc's own scope: only the two
 * "High" urgency categories from Vol 7_5 §2 (Action needed, Confirmation
 * request) are implemented — Awareness and Positive insight notifications
 * are not built (no false sense of a richer notification system than
 * exists).
 */
import { getCfoGuidance } from "./cfoGuidance";

import {
  listRecentActivity,
  type RecentActivityItem,
} from "../db/businessEventRepository";
import type { SqlDb } from "../db/types";

export type NotificationKind = "action_needed" | "confirmation_request";

export interface AiFaNotification {
  kind: NotificationKind;
  message: string;
  sourceBusinessEventId: string;
}

export interface NotificationsResult {
  notifications: AiFaNotification[];
  /** True when nothing was computed/returned because quiet hours suppressed delivery entirely (Phase 1 basic on/off — see isWithinQuietHours). */
  suppressedByQuietHours: boolean;
}

/**
 * Vol 7_5 §3's "two or three most important items" -- a fixed daily cap,
 * not optional polish (Sprint 8 Definition of Done treats this as
 * required, not a nice-to-have, to avoid notification fatigue).
 */
export const NOTIFICATION_DAILY_CAP = 3;

/**
 * Sprint 8's own "Safe to Carry Over" note: a hardcoded default window is
 * fine this sprint; full owner-configurable quiet hours land in Sprint 10
 * (Vol 7_7, Settings & Business Configuration).
 */
const DEFAULT_QUIET_HOURS_START_HOUR = 21; // 9pm
const DEFAULT_QUIET_HOURS_END_HOUR = 8; // 8am

function isWithinQuietHours(
  now: Date,
  startHour: number,
  endHour: number,
): boolean {
  if (startHour === endHour) return false; // a zero-width window never suppresses
  const hour = now.getHours();
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }
  // Window wraps past midnight (the default 21 -> 8 case).
  return hour >= startHour || hour < endHour;
}

function buildConfirmationMessage(item: RecentActivityItem): string {
  const { data, event, latestInterpretation } = item;
  if (
    event.status === "needs_clarification" &&
    latestInterpretation?.clarifyingQuestion
  ) {
    return latestInterpretation.clarifyingQuestion;
  }
  const amountText = `${data.currency} ${data.amount.toFixed(2)}`;
  const categoryText = data.category_guess
    ? ` as "${data.category_guess}"`
    : "";
  return `I recorded ${amountText}${categoryText} — confirm the category?`;
}

export interface GetNotificationsOptions {
  now?: Date;
  /** Sprint 10: now owner-configurable via Settings (appSettingsRepository.ts), not just a hardcoded default — this option still defaults to on when the caller omits it (e.g. a test), matching Sprint 8's original hardcoded-default behaviour. */
  quietHoursEnabled?: boolean;
  quietHoursStartHour?: number;
  quietHoursEndHour?: number;
  /** Sprint 10 per-kind toggles (Vol 7_7 Notifications domain) — default true each, so omitting them reproduces Sprint 8's behaviour exactly. */
  notifyActionNeeded?: boolean;
  notifyConfirmationRequest?: boolean;
  dailyCap?: number;
  /** How many recent activity rows to scan for unresolved drafts/clarifications — Phase 1 single-device volume makes a generous limit cheap; see listRecentActivity's own comment on this being sufficient at Phase 1 scale. */
  activityScanLimit?: number;
}

/**
 * Computes the notification set for right now. Never mutates or persists
 * anything (Phase 1 has no notification/delivery-log table — this mirrors
 * cfoGuidance.ts's own choice to compute fresh each call rather than cache
 * stale state).
 */
export async function getNotifications(
  db: SqlDb,
  businessId: string,
  options?: GetNotificationsOptions,
): Promise<NotificationsResult> {
  const now = options?.now ?? new Date();
  const quietHoursEnabled = options?.quietHoursEnabled ?? true;

  if (
    quietHoursEnabled &&
    isWithinQuietHours(
      now,
      options?.quietHoursStartHour ?? DEFAULT_QUIET_HOURS_START_HOUR,
      options?.quietHoursEndHour ?? DEFAULT_QUIET_HOURS_END_HOUR,
    )
  ) {
    return { notifications: [], suppressedByQuietHours: true };
  }

  const dailyCap = options?.dailyCap ?? NOTIFICATION_DAILY_CAP;
  const notifyActionNeeded = options?.notifyActionNeeded ?? true;
  const notifyConfirmationRequest = options?.notifyConfirmationRequest ?? true;

  const [guidance, activity] = await Promise.all([
    getCfoGuidance(db, businessId, { now }),
    listRecentActivity(db, businessId, options?.activityScanLimit ?? 200),
  ]);

  const actionNeeded: AiFaNotification[] = notifyActionNeeded
    ? guidance.overdueReceivables.map((r) => ({
        kind: "action_needed" as const,
        message: `${r.counterpartyName || r.description || "A customer"} owes ${r.currency} ${r.amount.toFixed(2)} — ${r.daysOutstanding} days overdue.`,
        sourceBusinessEventId: r.businessEventId,
      }))
    : [];

  const confirmationRequests: AiFaNotification[] = notifyConfirmationRequest
    ? activity
        .filter(
          (item) =>
            item.event.status === "draft" ||
            item.event.status === "needs_clarification",
        )
        // Oldest first -- the longest-blocked record gets surfaced first,
        // consistent with Vol 7_5 §2's "blocks accurate bookkeeping until
        // resolved" framing for this category.
        .sort((a, b) => a.event.captured_at.localeCompare(b.event.captured_at))
        .map((item) => ({
          kind: "confirmation_request" as const,
          message: buildConfirmationMessage(item),
          sourceBusinessEventId: item.event.id,
        }))
    : [];

  // Confirmation requests are prioritised ahead of action-needed items:
  // both are "High" urgency per Vol 7_5 §2, but only confirmation
  // requests actively block accurate bookkeeping until resolved -- a
  // documented tie-break, not an arbitrary one.
  const prioritised = [...confirmationRequests, ...actionNeeded].slice(
    0,
    dailyCap,
  );

  return { notifications: prioritised, suppressedByQuietHours: false };
}
