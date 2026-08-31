# AIFA — Asset Operations Architecture
## Volume 6_6 — Series 6: Business Operations Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

Defines how the fixed-asset domain instantiates the common operational pattern (Vol 6_0).

## 2. Business Event Types

| Event Type | Description |
|---|---|
| Asset Acquired | Purchase of equipment, vehicles, furniture, or other long-lived items |
| Depreciation Recorded | Periodic value reduction per governed depreciation rules |
| Asset Disposed | Sale, write-off, or retirement of an asset |
| Asset Revalued | Adjustment to recorded value (where applicable/permitted) |

## 3. Domain Flow

```text
Owner records an asset purchase ("Bought a delivery van, RM45,000")
        ↓
Business Event (Asset) captured
        ↓
Business Data: asset description, cost, acquisition date, useful life estimate
        ↓
Bookkeeping Intelligence Engine: capitalises the asset, schedules depreciation
        ↓
Financial Intelligence Engine: tracks asset base value, depreciation trend
        ↓
AI CFO Assistant Engine: replacement timing suggestions, capex trend observations
```

## 4. Governed Rules Sourced from the Finance PKA

- Capitalisation threshold (expense vs. asset)
- Depreciation method and useful-life guidance by asset category

## 5. Key Outputs to Financial Intelligence

- Net book value of asset base
- Depreciation expense trend
- Capex-to-revenue ratio

## 6. Relationships to Other Volumes

- Vol 6_0 (Business Operations Architecture) defines the shared pattern this volume specialises.
- Vol 6_2 (Purchase Operations) is the common trigger for an Asset Acquired event.

---

*End of Volume 6_6.*
