# AIFA — Developer & Extension Architecture
## Volume 9_0 — Series 9: Developer & Extension Architecture — Version 2.0

**Status:** Complete (reconstructed — no document body existed in the source conversation record; drafted fresh for this Version 2.0 set)
**Phase:** 3 — deferred until real third-party developer demand exists (Vol 0_1, Section 4). Nothing in Series 9 is scheduled for the initial build.

---

## 1. Purpose

This volume is the entry point to Series 9, defining how AIFA can be safely extended by third-party developers without compromising the governance boundaries established in Series 2 and 3.

## 2. Why Extensibility Exists

SMEs have long-tail, business-specific needs (a custom report format, a niche integration, a specialised workflow) that should not require Knowledge Factory to author a new PKA for every case, nor require AIFA's core team to build every possible feature. Series 9 defines a sandboxed extension model instead.

## 3. Series Composition

| Volume | Role |
|---|---|
| 9_0 | Developer & Extension Architecture (this volume) — overview and philosophy |
| 9_1 | Extension SDK Architecture — what developers build against |
| 9_2 | Plugin Runtime Architecture — how extensions execute safely |
| 9_3 | Workflow Extension Architecture — custom automation workflows |
| 9_4 | Integration Extension Architecture — custom external connectors |
| 9_5 | Testing & Validation Architecture — extension quality gates |
| 9_6 | Deployment & DevOps Architecture — how AIFA itself is built and shipped |
| 9_7 | Extension Marketplace Architecture — discovery and distribution of extensions |

## 4. Extensibility Principle

> Extensions may add capability. They may never bypass governance.

Concretely: an extension can add a new workflow, report, or integration, but it cannot modify the Finance PKA, cannot gain unmediated AI model access outside the PCB contract (Vol 3_1), and cannot access another business's data.

## 5. Extension Categories

| Category | Governing Volume |
|---|---|
| Workflow extensions | Vol 9_3 |
| Integration extensions | Vol 9_4 |
| (Reporting/template extensions are treated as a workflow extension sub-type) | Vol 9_3 |

## 6. Relationships to Other Volumes

- Vol 3_0 (Finance PKA Architecture) Section 6 states the boundary extensions must never cross.
- Vol 9_1 and 9_2 detail the concrete SDK and runtime that enforce Section 4.
- Vol 9_7 (Extension Marketplace) governs how extensions reach businesses.

---

*End of Volume 9_0.*
