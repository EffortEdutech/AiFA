# AIFA — Mobile Application Architecture
## Volume 7_0 — Series 7: Mobile Application Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

This volume is the entry point to Series 7, translating the UX Architecture principles (Vol 1_2) and platform direction (Vol 1_3) into the concrete mobile application structure.

## 2. Application Composition

| Volume | Surface |
|---|---|
| 7_0 | Mobile Application Architecture (this volume) — overall structure |
| 7_1 | Business Event Capture Architecture — the single-input entry point |
| 7_2 | AI Workspace Architecture — conversational interaction surface |
| 7_3 | Mobile Dashboard Architecture — at-a-glance business state |
| 7_4 | Offline & Synchronisation Experience Architecture — connectivity handling |
| 7_5 | Notification & AI Recommendation Architecture — proactive guidance delivery |
| 7_6 | Document & Receipt Experience Architecture — evidence capture and management |
| 7_7 | Settings & Business Configuration Architecture — owner-controlled policy |

## 3. Top-Level Navigation Model

```text
App Shell
├── Capture (Vol 7_1) — always one tap/voice command away
├── AI Workspace (Vol 7_2) — conversational hub
├── Dashboard (Vol 7_3) — business state at a glance
├── Documents (Vol 7_6) — receipts, invoices, statements
└── Settings (Vol 7_7) — configuration, permissions, autonomy level
```

Notifications (Vol 7_5) are cross-cutting and surface across any screen; offline state (Vol 7_4) is a persistent background concern, not a separate screen.

## 4. Design Constraints Inherited from Series 1

- Zero accounting vocabulary in the primary experience (Vol 1_2)
- Always-reviewable AI output (Vol 1_2, Vol 5_3)
- Fully functional offline for the core loop (Vol 1_3, Vol 4_4)
- Traceability from every displayed figure to its Business Event (Vol 1_2, Vol 5_3)

## 5. Relationships to Other Volumes

- Vol 1_2 (UX Architecture) is the principle source for this entire series.
- Vol 7_1–7_7 detail each surface named in Section 2.

---

*End of Volume 7_0.*
