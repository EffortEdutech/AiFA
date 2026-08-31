# AIFA — Business Operations Architecture
## Volume 6_0 — Series 6: Business Operations Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

This volume defines the common pattern every operational domain (Vol 6_1–6_9) follows, and introduces the domains themselves.

## 2. The Common Operational Pattern

```text
Business Operation
        ↓
Business Event
        ↓
Business Data
        ↓
Bookkeeping Intelligence
        ↓
Financial Intelligence
        ↓
AI CFO Guidance
```

Every domain below is a specialisation of this same chain; what differs between domains is the vocabulary of the Business Event, the classification rules applied by the Bookkeeping Intelligence Engine (sourced from the Finance PKA), and the KPIs the Financial Intelligence Engine computes.

## 3. Operational Domains

| Domain | Volume | Core Business Event Types |
|---|---|---|
| Sales | 6_1 | Invoice issued, payment received, refund issued |
| Purchases | 6_2 | Purchase order, goods/services received, supplier bill |
| Expenses | 6_3 | Expense paid, expense claimed, reimbursement |
| Banking | 6_4 | Deposit, withdrawal, transfer, bank fee, reconciliation |
| Inventory | 6_5 | Stock received, stock sold, stock adjustment, stock count |
| Assets | 6_6 | Asset acquired, depreciation, asset disposed |
| Payroll | 6_7 | Salary run, statutory contribution, bonus, leave payout |
| Projects | 6_8 | Project cost incurred, milestone billed, budget variance |
| Tax | 6_9 | Tax computation, tax filing, tax payment |

## 4. Domain Isolation, Shared Core

Each domain's rules live in the Finance PKA as scoped Knowledge Objects (Vol 3_0); the BIE, FIE, and CAE engines (Series 2) are shared across all domains. This means adding or refining a domain does not require new application engines — only new or updated governed knowledge.

## 5. Cross-Domain Consistency

Because every domain produces Business Events feeding the same canonical layer (Vol 4_0, ADR-001), cross-domain financial statements (e.g., a full P&L combining sales, expenses, and payroll) are naturally consistent — there is no reconciliation step between domain "silos" because there were never separate silos at the data layer.

## 6. Relationships to Other Volumes

- Vol 4_0_0 (ADR-001) is the canonical-truth principle every domain relies on.
- Series 2 (Core Architecture) supplies the shared engines every domain uses.
- Vol 6_1–6_9 detail each domain individually.

---

*End of Volume 6_0.*
