# AIFA — Testing & Validation Architecture
## Volume 9_5 — Series 9: Developer & Extension Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

This volume defines the quality and safety gates applied to extensions (Series 9) and to core engine changes before they reach an owner's device.

## 2. Extension Validation Gate

| Check | Purpose |
|---|---|
| Manifest/permission audit | Confirms declared scope matches actual behaviour |
| Sandbox conformance test | Confirms the extension cannot access data or capability outside its declared scope |
| Governance boundary test | Confirms no path exists to modify the Finance PKA or bypass PCB-mediated AI access |
| Output schema validation | Confirms extension output conforms to expected types before it reaches a business surface |
| Resource/stability test | Confirms the extension respects the Plugin Runtime's execution limits (Vol 9_2, Section 4) |

## 3. Core Engine Validation

Changes to core engines (Series 2, 3, 5) are validated against a regression suite grounded in real Business Event scenarios per operational domain (Series 6), specifically checking that: double-entry balance always holds (Vol 2_2), the PCB minimisation contract is respected (Vol 3_1), and explainability/traceability is preserved (Vol 5_3).

## 4. Finance PKA Package Validation

Though PKA authoring belongs to Knowledge Factory, the PKA Runtime Engine's package validation logic (Vol 2_1, Section 3) is itself tested here — signature verification, structural integrity, and compatibility-range checks.

## 5. Relationships to Other Volumes

- Vol 9_2 (Plugin Runtime Architecture) supplies the sandbox this volume's tests validate.
- Vol 2_1 (PKA Runtime Engine) supplies the package validation logic tested in Section 4.
- Vol 9_6 (Deployment & DevOps Architecture) is where validated changes are promoted to release.

---

*End of Volume 9_5.*
