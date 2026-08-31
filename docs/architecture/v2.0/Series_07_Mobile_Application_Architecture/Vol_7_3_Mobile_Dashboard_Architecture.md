# AIFA — Mobile Dashboard Architecture
## Volume 7_3 — Series 7: Mobile Application Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

This volume defines the at-a-glance business state view — the surface that answers "how is my business doing right now?" without requiring a conversation.

## 2. Dashboard Composition

| Panel | Sourced From |
|---|---|
| Cash position | Vol 6_4 (Banking Operations) via Financial Intelligence Engine |
| Money in / money out trend | Vol 2_3 (Financial Intelligence Engine) |
| Outstanding receivables/payables | Vol 6_1 (Sales) / Vol 6_2 (Purchase) |
| Top priorities today | Vol 2_4 (AI CFO Assistant Engine) prioritised recommendations |
| Recent Business Events | Vol 4_0 (Business Event Layer), most recent entries |

## 3. Presentation Principle

Consistent with Vol 1_2, the dashboard uses business language (cash, profit, owed to us, owed by us) exclusively — no ledger or account-code terminology appears here, even for power users; a separate detailed/accountant view (linked from Settings, Vol 7_7) is available for those who want raw statements.

## 4. Refresh Behaviour

The dashboard reads from local Financial Data (Vol 4_1) and updates immediately as new Business Events are processed — it does not require a network round-trip, consistent with the offline-first principle (Vol 1_3, Vol 4_4).

## 5. Relationships to Other Volumes

- Vol 2_3 (Financial Intelligence Engine) and Vol 2_4 (AI CFO Assistant Engine) supply this dashboard's content.
- Vol 1_2 (UX Architecture) sets the language and trust principles applied here.
- Vol 7_7 (Settings & Business Configuration) links to the detailed accountant view.

---

*End of Volume 7_3.*
