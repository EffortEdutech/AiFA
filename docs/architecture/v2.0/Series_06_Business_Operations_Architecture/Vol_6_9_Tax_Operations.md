# AIFA — Tax Operations Architecture
## Volume 6_9 — Series 6: Business Operations Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

Defines how the tax domain instantiates the common operational pattern (Vol 6_0), and states the boundary between AIFA's tax *support* and formal tax *advice*.

## 2. Business Event Types

| Event Type | Description |
|---|---|
| Tax Computation | Periodic calculation of tax liability from Financial Data |
| Tax Filing | Preparation (and, where integrated, submission) of a statutory return |
| Tax Payment | Payment of a computed tax liability |
| Tax Adjustment | Correction to a prior computation or filing |

## 3. Domain Flow

```text
Financial Data reaches a filing period boundary
        ↓
Business Event (Tax Computation) generated from period Financial Data
        ↓
Bookkeeping Intelligence Engine: applies jurisdictional tax rules from the Finance PKA
        ↓
Financial Intelligence Engine: computes liability, effective rate, comparison to prior periods
        ↓
AI CFO Assistant Engine: filing deadline reminders, liability-trend observations
```

## 4. Governed Rules Sourced from the Finance PKA

Tax rules are jurisdiction-specific, versioned Knowledge Objects within `regulations/` (Vol 3_0). AIFA supports whatever jurisdictions have a validated Finance PKA tax rule set installed; unsupported jurisdictions are explicitly flagged as out of scope rather than guessed at.

## 5. Advice Boundary

AIFA computes and organises tax-relevant figures and flags obligations; it does not replace a licensed tax professional's formal advice or filing responsibility. This is a direct application of the CAE scope-discipline principle (Vol 2_4, Section 4) and is stated explicitly in-product, not just architecturally.

## 6. Key Outputs to Financial Intelligence

- Tax liability schedule and due dates
- Effective tax rate trend
- Filing readiness status

## 7. Relationships to Other Volumes

- Vol 6_0 (Business Operations Architecture) defines the shared pattern this volume specialises.
- Vol 4_1 (Financial Data Architecture) is the primary input to tax computation.
- Vol 2_4 (AI CFO Assistant Engine) enforces the advice boundary in Section 5.

---

*End of Volume 6_9.*
