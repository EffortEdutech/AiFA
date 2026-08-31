# AIFA — Sales Operations Architecture
## Volume 6_1 — Series 6: Business Operations Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

Defines how the sales domain instantiates the common operational pattern (Vol 6_0).

## 2. Business Event Types

| Event Type | Description |
|---|---|
| Invoice Issued | An invoice is created and sent to a customer |
| Payment Received | Full or partial payment against an invoice |
| Refund Issued | Money returned to a customer |
| Sale Cancelled | An invoiced sale is voided before payment |

## 3. Domain Flow

```text
Owner describes a sale ("Sold 10 units to ABC Trading, RM1,200, on credit")
        ↓
Business Event (Sale) captured
        ↓
Business Data: customer, items/value, payment terms, due date
        ↓
Bookkeeping Intelligence Engine: records receivable + revenue
        ↓
Financial Intelligence Engine: tracks revenue trend, receivables ageing
        ↓
AI CFO Assistant Engine: flags overdue invoices, suggests follow-up
```

## 4. Governed Rules Sourced from the Finance PKA

- Revenue recognition timing (invoice vs. payment basis, per business configuration)
- Tax treatment on sales (where applicable, per Vol 6_9)
- Discount and credit note handling

## 5. Key Outputs to Financial Intelligence

- Accounts receivable ageing
- Revenue trend and seasonality
- Customer-level sales concentration

## 6. Sprint 6 Concrete Implementation

Only **Invoice Issued** is implemented in Phase 1, as the general AI-interpreted "sale" capture (`app/src/ai/capturePipeline.ts`, domain-parameterised alongside Expense and Purchase). Payment Received requires the Banking domain's cash-side entry (Section 6.4 below, Vol 6_4) and is deferred to Sprint 7; Refund Issued and Sale Cancelled are not built at all yet, not even as manual entry.

Revenue recognition timing (Section 4) defaults to **invoice basis** — the Sales Revenue posting happens at capture time, not when payment is later received — since Phase 1 has no separate payment-received event to defer to. This is recorded as PKA rule `SALE-001` in `accounting_rules.json`, not an inline app assumption, per this sprint's own risk register.

Phase 1 has a single revenue category (Sales Revenue) — no sub-categorisation, tax treatment, or discount/credit-note handling (Section 4) yet. Accounts receivable ageing (Section 5) is approximated by a flat "still outstanding" list (`getOutstandingReceivables` in `app/src/db/financialSummaryRepository.ts`, surfaced on the Dashboard as "Outstanding invoices") — not sorted or bucketed by age, since Phase 1's BusinessData schema has no due-date field. Real ageing is a Financial Intelligence Engine capability (Phase 2/3).

## 7. Relationships to Other Volumes

- Vol 6_0 (Business Operations Architecture) defines the shared pattern this volume specialises.
- Vol 6_4 (Banking Operations) handles the payment-received cash-side entry.
- Vol 4_2 (Business Knowledge Store) accumulates customer payment behaviour patterns.

---

*End of Volume 6_1.*
