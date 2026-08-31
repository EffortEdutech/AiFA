# AIFA — Financial Data Architecture
## Volume 4_1 — Series 4: Data Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

This volume defines Financial Data: the accounting representation derived from Business Events via the Bookkeeping Intelligence Engine, and the layer the Financial Intelligence Engine analyses.

## 2. Position in the Data Chain

```text
Business Event
        ↓
Business Data
        ↓
Bookkeeping Intelligence Engine
        ↓
Financial Data (journals, ledgers, trial balance, statements)
        ↓
Financial Intelligence Engine
```

## 3. Financial Data Components

| Component | Description |
|---|---|
| Journal | Chronological record of double-entry postings |
| Ledger | Account-by-account accumulation of journal postings |
| Trial Balance | Aggregate check that debits equal credits across all accounts |
| Financial Statements | Profit & loss, balance sheet, cash flow statement |
| Audit Trail | Traceable links from every posting back to its Business Event |

## 4. Immutability and Correction

Posted Financial Data is not edited in place. Corrections are made through reversing or adjusting entries, each traceable to its own triggering event (either a correction Business Event or an explicit accountant action), preserving a complete, honest audit history.

**Sprint 4 concrete implementation:** correcting an already-confirmed Expense posts the exact opposite of each original `LedgerEntry` (same account/amount, flipped direction, `reversal_of` pointing at the original), then posts a fresh pair under the corrected category — the original entries are never updated or deleted. The correction is carried by a brand-new `BusinessEvent`/`BusinessData`, with the original event's `superseded_by` set to point at it (Vol 4_0 §7). Because reversal entries flow through the same ledger table with an ordinary direction value, any aggregate query (e.g. cash position) nets them out automatically without special-casing.

## 5. Access Pattern

Financial Data is never shown to the owner in raw accounting form as the primary experience (Vol 1_2); it is the substrate the Financial Intelligence Engine reads to produce insight, and it is available in full detail on demand for accountants or export purposes.

## 6. Multi-Currency and Multi-Entity Considerations

Financial Data structures account for multi-currency transactions (currency of record vs. functional currency) and, where applicable in later enterprise deployments, multi-entity segregation (see Vol 10_1, Multi-Tenant Architecture) — without those concerns leaking into the SME-facing product experience.

## 7. Relationships to Other Volumes

- Vol 2_2 (Bookkeeping Intelligence Engine) produces Financial Data.
- Vol 2_3 (Financial Intelligence Engine) consumes Financial Data.
- Vol 4_0 (Business Data Architecture) is the upstream layer.
- Vol 6_9 (Tax Operations Architecture) relies on Financial Data for compliance reporting.

---

*End of Volume 4_1.*
