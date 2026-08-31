# AIFA — Project Operations Architecture
## Volume 6_8 — Series 6: Business Operations Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

Defines how the project/job-costing domain instantiates the common operational pattern (Vol 6_0), for SMEs that track profitability by project or job.

## 2. Business Event Types

| Event Type | Description |
|---|---|
| Project Cost Incurred | An expense, purchase, or payroll cost attributed to a specific project |
| Milestone Billed | An invoice issued against project progress |
| Budget Variance Detected | Actual cost diverges from planned budget beyond a threshold |
| Project Closed | Final reconciliation of a completed project |

## 3. Domain Flow

```text
A sales, purchase, expense, or payroll Business Event is tagged to a project
        ↓
Business Data inherits the project reference
        ↓
Bookkeeping Intelligence Engine: allocates cost/revenue to the project
        ↓
Financial Intelligence Engine: computes project-level margin, budget variance
        ↓
AI CFO Assistant Engine: flags at-risk projects, margin erosion warnings
```

## 4. Relationship to Other Domains

Project Operations is a cross-cutting tag applied to events from Sales (6_1), Purchases (6_2), Expenses (6_3), and Payroll (6_7) rather than a separate event-capture pathway — it reuses those domains' Business Events with an added project reference, keeping the canonical-event principle (ADR-001) intact.

## 5. Governed Rules Sourced from the Finance PKA

- Project cost allocation methodology (direct vs. overhead allocation)
- Percentage-of-completion revenue recognition, where applicable

## 6. Key Outputs to Financial Intelligence

- Project-level profit & loss
- Budget vs. actual variance
- Portfolio-level project margin comparison

## 7. Relationships to Other Volumes

- Vol 6_0 (Business Operations Architecture) defines the shared pattern this volume specialises.
- Vol 6_1, 6_2, 6_3, 6_7 supply the underlying tagged events.

---

*End of Volume 6_8.*
