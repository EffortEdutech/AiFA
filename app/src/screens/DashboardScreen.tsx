import { categoryOptionsForDomain } from "@aifa/core/ai/capturePipeline";
import {
  getNotifications,
  type AiFaNotification,
} from "@aifa/core/ai/notificationEngine";
import { getAppSettings } from "@aifa/core/db/appSettingsRepository";
import {
  getCashPositionSummary,
  getOutstandingPayables,
  getOutstandingReceivables,
  type CashPositionSummary,
  type OutstandingItem,
} from "@aifa/core/db/financialSummaryRepository";
import React, { useCallback, useEffect, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ActivityFeed } from "@/components/ActivityFeed";
import { WhyButton } from "@/components/WhyButton";
import { getDb, getLocalBusinessId } from "@/db/client";
import { useRecentActivity } from "@/hooks/useRecentActivity";

/**
 * Mobile Dashboard — Vol 7_3. Sprint 4 scope per the sprint doc and Vol 0_1
 * §6's reduced launch set: cash position, a 30-day money in/out trend, and
 * the recent Business Events panel. Sprint 6 adds outstanding-invoices and
 * upcoming-bills lists (Vol 6_1 §5, Vol 6_2 §5) now that Sales/Purchase
 * capture exists. The AI CFO "one thing to look at today" recommendation
 * (Sprint 7, Vol 2_4) is surfaced on the AI Workspace tab, not here — this
 * screen shows financial state; Workspace is where CFO guidance and Q&A
 * live (Vol 7_2).
 *
 * Business language only — no ledger/account-code terms appear anywhere on
 * this screen (Vol 1_2, Vol 7_3 §3; Sprint 4 Definition of Done explicitly
 * bans "debit/credit/journal/ledger" here). Sprint 6's receivables/payables
 * sections are deliberately labelled "Outstanding invoices" / "Upcoming
 * bills" rather than "Receivables"/"Payables" for the same reason. Reads
 * local Financial Data only — no network round-trip to render (Vol 7_3
 * §4).
 *
 * Phase 1 is single-business per device (db/client.ts); the cash summary
 * is not scoped by business_id (only one exists), but the receivables/
 * payables queries do take the local business id since
 * financialSummaryRepository's per-domain queries are written to be
 * business-scoped from the start.
 *
 * Sprint 8 adds a "Needs your attention" panel at the top, backed by
 * ai/notificationEngine.ts (Vol 7_5) -- action-needed (overdue invoices)
 * and confirmation-request (unresolved drafts) items, capped and
 * quiet-hours-aware. This is Phase 1's honest substitute for OS push
 * notifications (no expo-notifications dependency added -- AGENTS.md: no
 * new production dependencies without approval): the owner sees it the
 * next time they open the app rather than being proactively pinged.
 */
export default function DashboardScreen() {
  const {
    activity,
    loadError: activityError,
    refreshing,
    pullToRefresh,
    resolveDraftOrClarify,
    correctConfirmed,
  } = useRecentActivity(10);

  const [summary, setSummary] = useState<CashPositionSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [receivables, setReceivables] = useState<OutstandingItem[]>([]);
  const [payables, setPayables] = useState<OutstandingItem[]>([]);
  const [notifications, setNotifications] = useState<AiFaNotification[]>([]);

  const loadSummary = useCallback(async () => {
    try {
      const db = await getDb();
      const businessId = await getLocalBusinessId();
      // Sprint 10: quiet hours and per-kind notification toggles are now
      // owner-configurable via Settings (appSettingsRepository.ts) rather
      // than notificationEngine.ts's own hardcoded Sprint 8 defaults --
      // read the saved settings once per load and pass them straight
      // through as this call's options.
      const settings = await getAppSettings(db, businessId);
      const [cashSummary, receivableItems, payableItems, notificationsResult] =
        await Promise.all([
          getCashPositionSummary(db),
          getOutstandingReceivables(db, businessId),
          getOutstandingPayables(db, businessId),
          getNotifications(db, businessId, {
            quietHoursEnabled: settings.quiet_hours_enabled,
            quietHoursStartHour: settings.quiet_hours_start_hour,
            quietHoursEndHour: settings.quiet_hours_end_hour,
            notifyActionNeeded: settings.notify_action_needed,
            notifyConfirmationRequest: settings.notify_confirmation_request,
          }),
        ]);
      setSummary(cashSummary);
      setReceivables(receivableItems);
      setPayables(payableItems);
      setNotifications(notificationsResult.notifications);
    } catch (err) {
      setSummaryError(
        err instanceof Error ? err.message : "Failed to load cash position.",
      );
    }
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  async function handleRefresh() {
    await Promise.all([pullToRefresh(), loadSummary()]);
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
      }
    >
      <Text style={styles.heading}>Dashboard</Text>

      {(activityError || summaryError) && (
        <Text style={styles.error}>{activityError || summaryError}</Text>
      )}

      {notifications.length > 0 && (
        <View style={styles.notificationsCard}>
          <Text style={styles.cardLabel}>Needs your attention</Text>
          {notifications.map((n) => (
            <View
              key={n.sourceBusinessEventId + n.kind}
              style={styles.notificationRowContainer}
            >
              <Text style={styles.notificationRow}>
                {n.kind === "confirmation_request" ? "Confirm: " : "Action: "}
                {n.message}
              </Text>
              <WhyButton businessEventId={n.sourceBusinessEventId} />
            </View>
          ))}
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Cash on hand</Text>
        <Text style={styles.cashValue}>
          {summary
            ? `${summary.currency} ${summary.cashPosition.toFixed(2)}`
            : "—"}
        </Text>
        <Text style={styles.cardHint}>
          Based on everything recorded so far. Grows more accurate as more
          activity is captured.
        </Text>
        <Text style={styles.cardWhyHint}>
          Why: the total of every confirmed money-in entry minus every confirmed
          money-out entry across your Cash/Bank activity. See "Recent activity"
          below for the individual events behind this figure.
        </Text>
      </View>

      <View style={styles.rowCards}>
        <View style={[styles.card, styles.halfCard]}>
          <Text style={styles.cardLabel}>
            Money in{summary ? ` (${summary.trendDays}d)` : ""}
          </Text>
          <Text style={styles.trendValueIn}>
            {summary
              ? `+${summary.currency} ${summary.moneyIn.toFixed(2)}`
              : "—"}
          </Text>
        </View>
        <View style={[styles.card, styles.halfCard]}>
          <Text style={styles.cardLabel}>
            Money out{summary ? ` (${summary.trendDays}d)` : ""}
          </Text>
          <Text style={styles.trendValueOut}>
            {summary
              ? `-${summary.currency} ${summary.moneyOut.toFixed(2)}`
              : "—"}
          </Text>
        </View>
      </View>

      {receivables.length > 0 && (
        <>
          <Text style={styles.sectionHeading}>
            Outstanding invoices (owed to you)
          </Text>
          <View style={styles.list}>
            {receivables.map((item) => (
              <OutstandingRow key={item.businessDataId} item={item} />
            ))}
          </View>
        </>
      )}

      {payables.length > 0 && (
        <>
          <Text style={styles.sectionHeading}>Upcoming bills (you owe)</Text>
          <View style={styles.list}>
            {payables.map((item) => (
              <OutstandingRow key={item.businessDataId} item={item} />
            ))}
          </View>
        </>
      )}

      <Text style={styles.sectionHeading}>Recent activity</Text>
      <ActivityFeed
        items={activity}
        categoryOptionsForDomain={categoryOptionsForDomain}
        onResolve={resolveDraftOrClarify}
        onCorrectConfirmed={correctConfirmed}
      />
    </ScrollView>
  );
}

/** Sprint 6 — one row of the outstanding-invoices/upcoming-bills lists (Vol 6_1 §5, Vol 6_2 §5). Read-only; resolving/paying these is Sprint 7 (Banking) scope. Sprint 11 adds a "Why?" drill-down since each row already carries its own businessEventId. */
function OutstandingRow({ item }: { item: OutstandingItem }) {
  return (
    <View style={styles.outstandingRow}>
      <View style={styles.outstandingInfo}>
        <Text style={styles.outstandingName}>
          {item.counterpartyName || item.description || "Untitled"}
        </Text>
        <WhyButton businessEventId={item.businessEventId} />
      </View>
      <Text style={styles.outstandingAmount}>
        {item.currency} {item.amount.toFixed(2)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  heading: { fontSize: 24, fontWeight: "600" },
  error: { color: "#c0392b", fontSize: 13 },
  card: { padding: 16, borderRadius: 12, backgroundColor: "#f2f2f2", gap: 4 },
  notificationsCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#fff6e5",
    borderWidth: 1,
    borderColor: "#f0d99a",
    gap: 6,
  },
  notificationRowContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  notificationRow: { fontSize: 13, color: "#5c4a1a", flexShrink: 1 },
  cardLabel: { fontSize: 13, color: "#666", fontWeight: "600" },
  cardHint: { fontSize: 12, color: "#767676" },
  cardWhyHint: { fontSize: 11, color: "#767676", fontStyle: "italic" },
  cashValue: { fontSize: 30, fontWeight: "700", color: "#222" },
  rowCards: { flexDirection: "row", gap: 12 },
  halfCard: { flex: 1 },
  trendValueIn: { fontSize: 18, fontWeight: "700", color: "#1a7d3a" },
  trendValueOut: { fontSize: 18, fontWeight: "700", color: "#a12626" },
  sectionHeading: { fontSize: 16, fontWeight: "600", marginTop: 8 },
  list: { gap: 6 },
  outstandingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 10,
    borderRadius: 8,
    backgroundColor: "#f8f8f8",
  },
  outstandingInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },
  outstandingName: { fontSize: 13, color: "#222", flexShrink: 1 },
  outstandingAmount: { fontSize: 13, fontWeight: "600", color: "#222" },
});
