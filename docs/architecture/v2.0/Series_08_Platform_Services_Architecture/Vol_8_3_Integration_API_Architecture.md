# AIFA — Integration & API Architecture
## Volume 8_3 — Series 8: Platform Services Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

This volume defines the principles for connecting AIFA to external systems (bank feeds, payment processors, e-commerce platforms, accountant tools) without compromising the local-first, governed-context architecture.

## 2. Integration Categories

| Category | Example |
|---|---|
| Bank feeds | Automatic import of transactions for Banking Operations (Vol 6_4) |
| Payment processors | Payment/receipt confirmations feeding Sales Operations (Vol 6_1) |
| E-commerce/POS | Sales event ingestion from a storefront or point-of-sale system |
| Accountant/export tools | Structured export of Financial Data for external accounting software |

## 3. Integration Principle

Every external integration produces or consumes Business Events (Vol 4_0) at the boundary — an integration is architecturally just another Business Event Layer input/output channel, not a parallel data model. This keeps ADR-001 intact regardless of how many external systems are connected.

## 4. Governance Boundary

External integrations never receive the Finance PKA or a raw PCB; where an integration needs AI-derived output (e.g., a categorisation suggestion), it receives only the finished, validated result — never the governed context that produced it.

## 5. API Design Neutrality

This volume states integration principles only; concrete API schemas and protocols are deferred to a future Series 11 (Implementation Specifications), consistent with the technology-neutral scope of this documentation set (Vol 0_0, Section 6).

## 6. Relationships to Other Volumes

- Vol 4_0 (Business Data Architecture) is the canonical model every integration maps to.
- Vol 6_4 (Banking Operations) and Vol 6_1 (Sales Operations) are the most common integration consumers.
- Vol 3_1 (KRCE) enforces the governance boundary in Section 4.

---

*End of Volume 8_3.*
