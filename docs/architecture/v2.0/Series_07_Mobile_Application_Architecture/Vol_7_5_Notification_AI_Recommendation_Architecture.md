# AIFA — Notification & AI Recommendation Architecture
## Volume 7_5 — Series 7: Mobile Application Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

This volume defines how the AI CFO Assistant Engine's guidance (Vol 2_4) reaches the owner proactively, rather than only on request.

## 2. Notification Categories

| Category | Example | Urgency |
|---|---|---|
| Action needed | "Invoice #204 is 15 days overdue" | High |
| Awareness | "Your expenses this month are 12% above your 3-month average" | Medium |
| Confirmation request | "I recorded a RM250 expense — confirm the category?" | High (blocks accurate bookkeeping until resolved) |
| Positive insight | "Cash position is at a 6-month high" | Low |

## 3. Prioritisation Principle

Consistent with Vol 1_2 Section 6, notifications are prioritised and limited — the CAE (Vol 2_4) selects the two or three most important items rather than surfacing every possible observation, to avoid notification fatigue that would erode trust and engagement.

## 4. Delivery Flow

```text
Financial Intelligence Engine detects a noteworthy condition
        ↓
AI CFO Assistant Engine evaluates priority and drafts plain-language message
        ↓
Notification & Recommendation layer schedules delivery (respecting owner-configured quiet hours, Vol 7_7)
        ↓
Owner taps through to AI Workspace (Vol 7_2) for full context and action
```

## 5. Sprint 8 Concrete Implementation

Two of the four categories in Section 2 are implemented — Action needed and Confirmation request, both "High" urgency — matching the sprint's own scope; Awareness and Positive insight are not built. `app/src/ai/notificationEngine.ts`'s `getNotifications` is the concrete Section 4 pipeline collapsed into one function (Phase 1 has no separate scheduling/delivery layer — computed fresh per call, same choice `cfoGuidance.ts` made): Action-needed items come from every entry in `CfoGuidance.overdueReceivables` (Vol 2_4 §7), not just the single "today" recommendation; Confirmation-request items come from any `draft`/`needs_clarification` Business Event across all three AI-interpreted domains.

Section 3's "two or three most important items" is a fixed `NOTIFICATION_DAILY_CAP = 3`, enforced by construction (a `.slice(0, dailyCap)` after prioritisation), not by a rate-limit check after the fact. Prioritisation between the two High-urgency categories is a documented tie-break: Confirmation requests are ordered ahead of Action-needed items, because only Confirmation requests "block accurate bookkeeping until resolved" per Section 2's own table — Action-needed items are important but don't block a specific record.

Section 4's "respecting owner-configured quiet hours" is implemented as a basic on/off with a hardcoded default window (9pm-8am) per this sprint's own "Safe to Carry Over" note — when active, it suppresses the notification computation entirely for that call (an all-or-nothing gate, not a per-item filter, and with no urgent-item bypass). Owner-configurable quiet hours are Vol 7_7 / Sprint 10 scope, not built yet. There is also no OS-level push delivery in Phase 1 — no `expo-notifications` or similar dependency was added (AGENTS.md: no new production dependencies without approval) — so "delivery" concretely means a panel on the Dashboard the owner sees on next app open, not a proactive push. This is a real gap against Section 1's "reaches the owner proactively, rather than only on request," carried forward honestly rather than hidden.

## 6. Relationships to Other Volumes

- Vol 2_4 (AI CFO Assistant Engine) is the source of every recommendation delivered here.
- Vol 7_2 (AI Workspace Architecture) is the destination for notification follow-through.
- Vol 7_7 (Settings & Business Configuration) governs notification preferences and quiet hours.

---

*End of Volume 7_5.*
