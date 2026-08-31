# AIFA — Deployment & DevOps Architecture
## Volume 9_6 — Series 9: Developer & Extension Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

This volume defines, at a technology-neutral level, how AIFA itself (mobile app, platform services) is built, validated, and released — distinct from Vol 8_5, which covers Finance PKA package distribution specifically.

## 2. Release Pipeline (conceptual)

```text
Code change
        ↓
Automated validation (Vol 9_5)
        ↓
Staged rollout (internal → limited beta → general availability)
        ↓
Monitored release (Vol 8_6 observability signals gate rollout progression)
        ↓
Rollback capability retained at every stage
```

## 3. Separation of Release Trains

The mobile/platform release train (this volume) and the Finance PKA release train (Vol 8_5) are deliberately independent: a PKA update should not require an app store release, and an app update should not require re-certifying the Finance PKA. This separation is what allows Knowledge Factory to ship professional-knowledge improvements on its own cadence.

## 4. Environment Parity

Development, staging, and production environments maintain parity in their governance enforcement (PCB minimisation, PKA validation, sandboxing) — these are not relaxed in lower environments, since governance behaviour is part of what must be tested before release, not a production-only concern.

## 5. Relationships to Other Volumes

- Vol 9_5 (Testing & Validation Architecture) is the gate feeding this pipeline.
- Vol 8_5 (Finance PKA Distribution & Update Architecture) is the parallel, independent release train for professional knowledge.
- Vol 8_6 (Observability & Diagnostics) supplies the signals gating staged rollout.

---

*End of Volume 9_6.*
