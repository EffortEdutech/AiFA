# AIFA — Inventory Operations Architecture
## Volume 6_5 — Series 6: Business Operations Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

Defines how the inventory domain instantiates the common operational pattern (Vol 6_0).

## 2. Business Event Types

| Event Type | Description |
|---|---|
| Stock Received | Inventory added, typically triggered by a fulfilled purchase (Vol 6_2) |
| Stock Sold | Inventory reduced, typically triggered by a sale (Vol 6_1) |
| Stock Adjustment | Manual correction (damage, loss, shrinkage) |
| Stock Count | Physical count reconciled against recorded quantities |

## 3. Domain Flow

```text
Purchase fulfilled or sale completed (or owner reports a stock change directly)
        ↓
Business Event (Inventory) captured
        ↓
Business Data: item, quantity, unit cost/value, location (if tracked)
        ↓
Bookkeeping Intelligence Engine: updates inventory asset value, cost of goods sold
        ↓
Financial Intelligence Engine: tracks stock turnover, slow-moving items, margin by item
        ↓
AI CFO Assistant Engine: reorder suggestions, dead-stock warnings
```

## 4. Governed Rules Sourced from the Finance PKA

- Costing method (weighted average, FIFO, or business-configured method)
- Cost of goods sold recognition timing

## 5. Key Outputs to Financial Intelligence

- Inventory valuation
- Turnover ratio and days-on-hand
- Margin by product/service line

## 6. Relationships to Other Volumes

- Vol 6_0 (Business Operations Architecture) defines the shared pattern this volume specialises.
- Vol 6_1 (Sales) and Vol 6_2 (Purchase) are the primary triggers for inventory movement events.

---

*End of Volume 6_5.*
