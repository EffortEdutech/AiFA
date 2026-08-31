# AIFA — Business Architecture
## Volume 1_1 — Series 1: Product Foundation — Version 2.0

**Status:** Complete
**Applies ADR-001:** Yes (Business Event Layer terminology)

---

## 1. Purpose

This volume defines the business capabilities AIFA must provide to deliver the Product Vision (Vol 1_0), independent of any specific technology.

## 2. Scope

Business Architecture covers what AIFA does for the business owner — not how it is built. It is the bridge between Vol 1_0 (why) and Series 2 (how, at the engine level).

## 3. Core Business Capabilities

| Capability | Description |
|---|---|
| Event Capture | Accept a Business Event in any natural input form |
| Interpretation | Turn the raw input into a structured, classified event |
| Bookkeeping | Convert the event into compliant double-entry accounting records |
| Financial Analysis | Turn accounting records into meaningful financial insight |
| Advisory | Offer plain-language, governed CFO-level guidance |
| Knowledge Retention | Learn organisation-specific patterns over time (see Vol 4_2) |
| Compliance Support | Maintain records suitable for tax and statutory reporting (see Vol 6_9) |

## 4. Business-First vs. Accounting-First

Traditional bookkeeping software starts from the accounting model and asks the owner to conform to it:

```text
Journal Entry → Ledger → Report
```

AIFA inverts this. The owner describes a business fact; accounting is a downstream, invisible consequence:

```text
Business Event → Business Data → Bookkeeping Intelligence → Journal → Ledger
    → Financial Statements → Financial Intelligence → AI CFO Guidance
```

This is the defining structural decision of AIFA's business architecture and is binding on every operational domain in Series 6.

## 5. Business Domains Covered

AIFA's business scope spans the operational areas an SME actually runs, detailed individually in Series 6:

- Sales
- Purchases
- Expenses
- Banking
- Inventory
- Assets
- Payroll
- Projects
- Tax

Each domain follows the same Business Event → guidance chain; only the interpretation rules differ, and those rules live in the Finance PKA (Series 3), not in the application code.

## 6. Roles Recognised by the Business Architecture

| Role | Relationship to AIFA |
|---|---|
| Business Owner / Operator | Primary user; provides Business Events, receives guidance |
| Bookkeeper / Accountant (optional) | May review, correct, or approve AI-proposed entries |
| Knowledge Factory | Supplies governed professional intelligence (Finance PKA) |
| AIFA Platform | Executes the PKA against the owner's business context |

## 7. Governance Principle

The business architecture does not permit AIFA to make unilateral, unreviewable changes to a business's official financial position. All AI-proposed bookkeeping entries are traceable to the originating Business Event and remain open to owner or accountant review (see Vol 5_3, AI Safety & Governance boundaries carried into AI Context Management).

## 8. Relationships to Other Volumes

- Vol 1_0 (Product Vision) states the promise this volume operationalises.
- Vol 2_2 (Bookkeeping Intelligence Engine) implements Section 4's flow.
- Vol 6_0–6_9 (Business Operations Architecture) detail each domain in Section 5.
- Vol 4_0_0 (ADR-001) grounds the Business Event as canonical truth.

---

*End of Volume 1_1.*
