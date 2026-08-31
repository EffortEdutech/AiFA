# AIFA — Purchase Operations Architecture
## Volume 6_2 — Series 6: Business Operations Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

Defines how the purchasing domain instantiates the common operational pattern (Vol 6_0).

## 2. Business Event Types

| Event Type | Description |
|---|---|
| Purchase Order Raised | Owner commits to buying goods/services from a supplier |
| Goods/Services Received | Confirmation that a purchase was fulfilled |
| Supplier Bill Received | Invoice from a supplier requiring payment |
| Purchase Returned | Goods returned to a supplier |

## 3. Domain Flow

```text
Owner describes a purchase ("Ordered raw materials from XYZ Supplies, RM3,000")
        ↓
Business Event (Purchase) captured
        ↓
Business Data: supplier, items/value, payment terms
        ↓
Bookkeeping Intelligence Engine: records payable + expense or inventory asset
        ↓
Financial Intelligence Engine: tracks payables ageing, spend trend by supplier
        ↓
AI CFO Assistant Engine: flags upcoming payment obligations, supplier concentration risk
```

## 4. Governed Rules Sourced from the Finance PKA

- Capitalisation vs. expense classification (inventory/asset vs. immediate expense)
- Supplier payment terms interpretation
- Purchase tax treatment (where applicable, per Vol 6_9)

## 5. Key Outputs to Financial Intelligence

- Accounts payable ageing
- Supplier spend concentration
- Purchase-to-inventory linkage (see Vol 6_5)

## 6. Sprint 6 Concrete Implementation

Only **Supplier Bill Received / Goods Received** is implemented in Phase 1, as the general AI-interpreted "purchase" capture (`app/src/ai/capturePipeline.ts`). Purchase Order Raised is a commitment, not yet a financial/ledger event, and is not built; Purchase Returned is explicitly deferred (this sprint's own "Safe to Carry Over" item), not even as manual entry.

Capitalisation-vs-expense classification (Section 4) is approximated by a flat category match against `purchase_categories` in `accounting_rules.json` (PKA rules `PUR-001`/`PUR-002`): Cost of Goods Sold for goods purchased for resale, or one of the existing Operating Expenses sub-categories otherwise. There is no formal inventory/asset ledger yet (Vol 6_5, Phase 3) — Cost of Goods Sold here is a placeholder account, not a real inventory valuation system.

Accounts payable ageing (Section 5) is approximated the same way as Sales' receivables (Vol 6_1 §6): a flat "still outstanding" list (`getOutstandingPayables`, surfaced on the Dashboard as "Upcoming bills" despite not actually being due-date sorted — Phase 1 has no due-date field). Payment of an outstanding payable (settling via Banking, Vol 6_4) is Sprint 7 scope.

## 7. Relationships to Other Volumes

- Vol 6_0 (Business Operations Architecture) defines the shared pattern this volume specialises.
- Vol 6_5 (Inventory Operations) receives stock-in events triggered by fulfilled purchases.
- Vol 6_4 (Banking Operations) handles the cash-side payment of supplier bills.

---

*End of Volume 6_2.*
