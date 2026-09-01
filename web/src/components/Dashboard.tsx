import { useEffect, useState } from "react";

import type { CfoGuidance } from "@aifa/core/ai/cfoGuidance";
import { getCfoGuidance } from "@aifa/core/ai/cfoGuidance";
import type { NotificationsResult } from "@aifa/core/ai/notificationEngine";
import { getNotifications } from "@aifa/core/ai/notificationEngine";
import type { SqlDb } from "@aifa/core/db/types";

interface Props {
  db: SqlDb;
  businessId: string;
  refreshToken: number;
}

/** Dashboard — Phase 2a "Yes" row (Vol 12_0 §4): cash position, receivables/payables, notifications. Same @aifa/core reads the mobile DashboardScreen uses. */
export function Dashboard({ db, businessId, refreshToken }: Props): JSX.Element {
  const [guidance, setGuidance] = useState<CfoGuidance | null>(null);
  const [notifications, setNotifications] = useState<NotificationsResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getCfoGuidance(db, businessId),
      getNotifications(db, businessId),
    ]).then(([g, n]) => {
      if (cancelled) return;
      setGuidance(g);
      setNotifications(n);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [db, businessId, refreshToken]);

  if (loading || !guidance) {
    return <p className="muted">Loading…</p>;
  }

  return (
    <div>
      <div className="card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Cash position</h2>
        <p style={{ fontSize: 28, margin: "4px 0" }}>
          {guidance.cashPosition.currency} {guidance.cashPosition.cashPosition.toFixed(2)}
        </p>
        <p className="muted">
          Last {guidance.cashPosition.trendDays} days: +{guidance.cashPosition.moneyIn.toFixed(2)} in
          / -{guidance.cashPosition.moneyOut.toFixed(2)} out
        </p>
      </div>

      <div className="row">
        <div className="card" style={{ flex: 1, minWidth: 240 }}>
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Outstanding invoices</h2>
          {guidance.overdueReceivables.length === 0 ? (
            <p className="muted">Nothing overdue.</p>
          ) : (
            <ul>
              {guidance.overdueReceivables.map((item) => (
                <li key={item.businessDataId}>
                  {item.counterpartyName ?? "Unnamed"} — {item.currency} {item.amount.toFixed(2)} (
                  {item.daysOutstanding}d)
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card" style={{ flex: 1, minWidth: 240 }}>
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Upcoming bills</h2>
          {guidance.upcomingPayables.length === 0 ? (
            <p className="muted">Nothing outstanding.</p>
          ) : (
            <ul>
              {guidance.upcomingPayables.map((item) => (
                <li key={item.businessDataId}>
                  {item.counterpartyName ?? "Unnamed"} — {item.currency} {item.amount.toFixed(2)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Needs your attention</h2>
        {notifications?.suppressedByQuietHours ? (
          <p className="muted">Quiet hours — notifications suppressed.</p>
        ) : notifications && notifications.notifications.length > 0 ? (
          <ul>
            {notifications.notifications.map((n, i) => (
              <li key={i}>
                <span className="muted">[{n.kind === "action_needed" ? "Action" : "Confirm"}]</span>{" "}
                {n.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Nothing needs attention right now.</p>
        )}
      </div>

      {guidance.todayRecommendation && (
        <div className="card">
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Today</h2>
          <p>{guidance.todayRecommendation.message}</p>
        </div>
      )}
    </div>
  );
}
