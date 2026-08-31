# AIFA — Business Data Architecture
## Volume 4_0 — Series 4: Data Architecture — Version 2.0

**Status:** Complete
**Applies ADR-001:** Yes (Business Event Layer terminology)

---

## 1. Purpose

This volume defines the Business Event Layer and Business Data — the first two runtime-owned data layers in the AIFA architecture, and the origin point for everything downstream.

## 2. Business Event

A Business Event is the authoritative record of what happened in the business, captured directly from the owner's single input.

```text
Business Event ID: BE-20260716-0001
Type: Expense Paid
Description: Office stationery purchased
Amount: RM250
Supplier: ABC Stationery
Payment Method: Cash
Receipt: receipt.jpg
Timestamp: 16 July 2026, 10:15
```

Per ADR-001 (Vol 4_0_0), the Business Event is canonical and immutable once captured; corrections are recorded as new linked events, not silent edits, preserving the audit trail.

## 3. Business Event Layer

The Business Event Layer is the capture and ingestion stage: it receives raw input (voice, text, image, PDF, message, import), timestamps it, assigns a Business Event ID, and produces the structured Business Event record shown above. This supersedes the earlier informal use of "Business Data" to describe this stage (ADR-001 terminology change).

## 4. Business Data

Business Data is the structured *operational* representation derived from a Business Event — e.g., a normalised sales record, an expense record, an inventory movement — ready for the Bookkeeping Intelligence Engine to interpret.

```text
Business Event
        ↓
Business Event Layer (capture, structuring, ID assignment)
        ↓
Business Data (operational representation: type, parties, amounts, references)
        ↓
Bookkeeping Intelligence Engine
```

## 5. What Business Data Contains

| Field group | Examples |
|---|---|
| Identity | Business Event ID, Business Data record ID |
| Classification | Event type (sale, purchase, expense, transfer, payroll, etc.) |
| Parties | Customer, supplier, employee reference |
| Value | Amount, currency, tax treatment flags |
| Evidence | Linked document/image references |
| Status | Draft, confirmed, superseded |

## 6. Everything Derives from the Business Event

```text
Business Event
├── Updates Business Data
├── Produces Financial Data
├── Updates Business Knowledge
├── Triggers bookkeeping
├── Feeds financial analysis
├── Supports AI CFO guidance
├── Supports reports and dashboards
└── Supports future workflow automation
```

## 7. Governance

Business Events are write-once and append-only. No component — including the AI — may retroactively alter a Business Event's original content. Corrections, cancellations, and adjustments are new, linked events.

## 8. Relationships to Other Volumes

- Vol 4_0_0 (ADR-001) is the authority for the terminology and canonical-truth principle here.
- Vol 2_2 (Bookkeeping Intelligence Engine) is the primary consumer of Business Data.
- Vol 4_1 (Financial Data Architecture) is the next layer downstream.
- Vol 7_1 (Business Event Capture Architecture) defines the mobile capture experience that populates this layer.

---

*End of Volume 4_0.*
