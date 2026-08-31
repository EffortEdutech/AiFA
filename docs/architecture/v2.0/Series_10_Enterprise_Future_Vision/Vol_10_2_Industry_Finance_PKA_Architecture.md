# AIFA — Industry Finance PKA Architecture
## Volume 10_2 — Series 10: Enterprise & Future Vision — Version 2.0

**Status:** Complete
**Resolves conversation inconsistency 14.6 (source record):** Yes — see Section 3.

---

## 1. Purpose

This volume defines how industry-specific professional intelligence (e.g., Construction, Retail, Manufacturing Finance PKAs) relates to the base Finance PKA, resolving an open question flagged in the source conversation record.

## 2. Industry PKA Examples

- Construction Finance PKA — job-costing, retention, progress billing rules
- Retail Finance PKA — inventory turnover, POS-specific categorisation
- Manufacturing Finance PKA — bill-of-materials costing, work-in-progress valuation

## 3. Composition Model (resolved)

Industry Finance PKAs are **extension packages composed with the base Finance PKA** — not standalone replacements, not required dependencies for the base product, and not a separate application. A device may run the base Finance PKA alone (industry-neutral, per Vol 1_0 Section 3) or install one or more compatible industry extensions on top.

```text
Base Finance PKA (industry-neutral, always present)
        + 
Industry Finance PKA Extension(s) (optional, composed)
        ↓
PKA Runtime Engine resolves retrieval across all installed, compatible packages (Vol 2_1, Section 6)
        ↓
KRCE returns a single, coherent PCB — the AI never sees "which package" a rule came from,
only the governed content itself
```

## 4. Governance of Industry Extensions

Industry extensions are manufactured and versioned by Knowledge Factory under the same governance discipline as the base package (Vol 3_0) — they are not third-party extensions in the Series 9 sense. They are distributed via the same channel as the base PKA (Vol 8_5).

## 5. Selecting an Industry Extension

The business's declared industry (set in Vol 7_7, Business Profile) drives a recommended industry extension, but installation remains an explicit owner choice, consistent with the base product remaining industry-neutral by default (Vol 1_0, Section 3).

## 6. Relationships to Other Volumes

- Vol 3_0 (Finance PKA Architecture) defines the base package this volume extends.
- Vol 2_1 (PKA Runtime Engine) Section 6 defines the multi-package resolution mechanism used here.
- Vol 8_5 (Finance PKA Distribution & Update) distributes industry extensions.
- Vol 4_0_0 (ADR Register) Section 5 records this as the resolution of the source record's open composition question.

---

*End of Volume 10_2.*
