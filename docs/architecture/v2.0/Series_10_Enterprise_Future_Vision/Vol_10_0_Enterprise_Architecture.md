# AIFA — Enterprise Architecture
## Volume 10_0 — Series 10: Enterprise & Future Vision — Version 2.0

**Status:** Complete
**Phase:** 3 — deferred until AIFA has real multi-entity/enterprise demand (Vol 0_1, Section 4). Nothing in Series 10 is scheduled for the initial build.

---

## 1. Purpose

This volume defines how the SME-focused core architecture (Series 1–9) extends toward larger, more complex organisations without requiring a rewrite.

## 2. What Changes at Enterprise Scale

| Concern | SME | Enterprise |
|---|---|---|
| Entities | Single business | Potentially multiple related entities/subsidiaries (Vol 10_1) |
| Team size | Owner + a few staff/bookkeeper | Larger teams with layered roles (Vol 8_1 extended) |
| Finance PKA scope | Base + optionally one industry extension | Multiple industry/jurisdiction extensions composed together (Vol 10_2) |
| Deployment | Individual device-centric | Centralised administration with device-level local-first execution preserved |

## 3. What Does Not Change

The core promise ("One Input. AI Does the Rest."), the local-first/PCB-mediated AI boundary (Vol 3_1, Vol 4_4), the canonical Business Event principle (ADR-001), and the non-negotiable governance boundaries (Vol 0_0, Section 4) all hold unchanged at enterprise scale. Enterprise architecture adds administrative and multi-entity layers on top; it does not relax any governance boundary established for SMEs.

## 4. Growth Path

```text
Single SME device
        ↓
Multiple devices, same business (Vol 4_4 sync)
        ↓
Multiple team members, scoped access (Vol 8_1)
        ↓
Multiple related entities, tenant-isolated (Vol 10_1)
        ↓
Multiple industries/jurisdictions composed (Vol 10_2)
```

## 5. Relationships to Other Volumes

- Vol 1_5 (referenced conceptually) growth path was stated in Vol 1_0, Section 7 — this volume is its realisation.
- Vol 10_1–10_2 detail the specific enterprise extensions.
- Vol 8_1 (Identity & Access Management) is extended, not replaced, for enterprise team structures.

---

*End of Volume 10_0.*
