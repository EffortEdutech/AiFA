# AIFA — Payroll Operations Architecture
## Volume 6_7 — Series 6: Business Operations Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

Defines how the payroll domain instantiates the common operational pattern (Vol 6_0).

## 2. Business Event Types

| Event Type | Description |
|---|---|
| Salary Run | Periodic payroll disbursement to employees |
| Statutory Contribution | Employer/employee statutory deductions (jurisdiction-governed) |
| Bonus / Commission Paid | One-off or periodic variable pay |
| Leave Payout | Payment for accrued but unused leave |

## 3. Domain Flow

```text
Owner initiates or confirms a payroll run
        ↓
Business Event (Payroll) captured per employee or as a batch
        ↓
Business Data: employee, gross pay, deductions, net pay, period
        ↓
Bookkeeping Intelligence Engine: records payroll expense, statutory liabilities
        ↓
Financial Intelligence Engine: tracks payroll cost trend, headcount cost ratio
        ↓
AI CFO Assistant Engine: payroll cash timing alerts, cost-ratio observations
```

## 4. Governed Rules Sourced from the Finance PKA

- Statutory contribution rates and thresholds (jurisdiction-specific, versioned in the Finance PKA)
- Payroll expense categorisation

## 5. Sensitivity Note

Payroll data (individual compensation) is treated as high-sensitivity Business Data; access and any AI reasoning over it are subject to the stricter classification defined in Vol 8_1 (Identity & Access Management) and Vol 8_2 (Security & Data Protection).

## 6. Key Outputs to Financial Intelligence

- Payroll cost trend
- Statutory liability schedule
- Headcount cost as a percentage of revenue

## 7. Relationships to Other Volumes

- Vol 6_0 (Business Operations Architecture) defines the shared pattern this volume specialises.
- Vol 6_9 (Tax Operations) covers statutory filing obligations tied to payroll.
- Vol 8_1/8_2 govern access to sensitive payroll data.

---

*End of Volume 6_7.*
