# AIFA — Platform Services Architecture
## Volume 8_0 — Series 8: Platform Services Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

This volume is the entry point to Series 8, defining the shared platform services that support every engine and mobile surface without being specific to any one business domain.

## 2. Service Composition

| Volume | Service |
|---|---|
| 8_1 | Identity & Access Management — who can access what |
| 8_2 | Security & Data Protection — encryption, storage protection |
| 8_3 | Integration & API — external system connectivity |
| 8_4 | Synchronisation & Cloud Services — backup and multi-device sync backend |
| 8_5 | Finance PKA Distribution & Update — how packages reach devices |
| 8_6 | Observability & Diagnostics — health, performance, and error visibility |

## 3. Platform Services Layer Position

```text
Presentation Layer (Series 7)
        ↓ uses
Intelligence Layer (Series 2, 5) + Retrieval Layer (Series 3) + Data Layer (Series 4)
        ↓ relies on
Platform Services Layer (Series 8)
```

Platform services are horizontal — every engine and surface depends on identity, security, and observability, but none of those services contain business or professional logic themselves.

## 4. Relationships to Other Volumes

- Vol 1_3 (Technology Architecture) Section 4 introduces this layer at the product-foundation level.
- Vol 8_1–8_6 detail each service named in Section 2.

---

*End of Volume 8_0.*
