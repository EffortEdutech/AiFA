# AIFA — Expense Operations Architecture
## Volume 6_3 — Series 6: Business Operations Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

Defines how the expense domain instantiates the common operational pattern (Vol 6_0). This is the domain used as the running example throughout the founding conversation record (e.g., "Office stationery purchased, RM250").

## 2. Business Event Types

| Event Type | Description |
|---|---|
| Expense Paid | Direct business expense paid by cash, card, or transfer |
| Expense Claimed | Employee/owner claims reimbursement for a personal outlay on business's behalf |
| Reimbursement Processed | The business pays back a claimed expense |
| Recurring Expense | A subscription or fixed periodic cost |

## 3. Domain Flow

```text
Owner captures a receipt photo
        ↓
Business Event (Expense) captured, receipt image linked as evidence
        ↓
Business Data: category, amount, supplier, payment method
        ↓
Bookkeeping Intelligence Engine: records the expense against the correct account
        ↓
Financial Intelligence Engine: tracks expense-category trends, spend anomalies
        ↓
AI CFO Assistant Engine: flags unusual spend, suggests cost-saving observations
```

## 4. Governed Rules Sourced from the Finance PKA

- Expense category mapping heuristics
- Deductibility/tax treatment guidance (informational only — not tax advice; see Vol 6_9)
- Recurring expense detection patterns

## 5. Key Outputs to Financial Intelligence

- Expense trend by category
- Anomaly flags (e.g., an unusually large one-off expense)
- Recurring cost baseline for cash flow forecasting

## 6. Relationships to Other Volumes

- Vol 6_0 (Business Operations Architecture) defines the shared pattern this volume specialises.
- Vol 7_6 (Document & Receipt Experience Architecture) covers the capture UX for receipts referenced here.
- Vol 4_2 (Business Knowledge Store) accumulates vendor-to-category classification patterns.

---

*End of Volume 6_3.*
