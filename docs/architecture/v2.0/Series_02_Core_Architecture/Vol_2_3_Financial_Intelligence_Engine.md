# AIFA — Financial Intelligence Engine
## Volume 2_3 — Series 2: Core Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

This volume defines the Financial Intelligence Engine (FIE) — the component that answers "what do the financial results mean?" by turning posted Financial Data into meaningful analysis.

## 2. Position in the Flow

```text
Financial Data (journals, ledgers, statements)
        ↓
Financial Intelligence Engine
        ↓
Financial insight (trends, ratios, anomalies, forecasts)
        ↓
AI CFO Assistant Engine
```

## 3. Responsibilities

| Responsibility | Description |
|---|---|
| Trend analysis | Track revenue, expense, cash, and profit trends over time |
| Ratio and KPI computation | Compute standard and Finance-PKA-defined KPIs (from the PKA's KPI library) |
| Anomaly detection | Flag unusual transactions, sudden changes, or missing expected activity |
| Cash flow projection | Project near-term cash position from current obligations and history |
| Comparative analysis | Compare current performance to prior periods or, where available, governed benchmarks |
| Statement preparation | Assemble profit & loss, balance sheet, and cash flow views from Financial Data |

## 4. Inputs and Outputs

**Inputs:** Financial Data (ledger balances, statements), relevant PCB (KPI definitions, analytical models, valuation formulae from the Finance PKA), Business Knowledge Store context (organisation-specific patterns).

**Outputs:** Structured financial insight objects consumed by the AI CFO Assistant Engine — not yet owner-facing prose; that translation is CAE's job (Vol 2_4).

## 5. Governed Analytical Models

All formulae, ratios, and valuation models used by the FIE originate from the Finance PKA's `valuation_models/` and `KPI_library.json` components (Vol 3_0). The FIE does not invent financial formulae; it applies governed ones to the business's own Financial Data.

## 6. Relationship to Bookkeeping Intelligence

The FIE strictly consumes BIE output; it never writes back to Financial Data. This one-directional relationship keeps accounting truth (BIE's domain) separate from analytical interpretation (FIE's domain).

## 7. Relationships to Other Volumes

- Vol 2_2 (BIE) is the FIE's upstream data source.
- Vol 2_4 (AI CFO Assistant Engine) is the FIE's downstream consumer.
- Vol 3_0 (Finance PKA Architecture) defines the KPI and valuation model components the FIE applies.
- Vol 4_1 (Financial Data Architecture) defines the FIE's input schema.

---

*End of Volume 2_3.*
