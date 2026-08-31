# AIFA — Extension Marketplace Architecture
## Volume 9_7 — Series 9: Developer & Extension Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

This volume defines how validated extensions (Series 9) are discovered, installed, and managed by business owners.

## 2. Marketplace Flow

```text
Developer submits extension
        ↓
Testing & Validation gate (Vol 9_5)
        ↓
Marketplace listing (capability summary, declared permissions, publisher identity)
        ↓
Owner reviews declared permissions and installs (via Vol 7_7 Settings)
        ↓
Plugin Runtime activates the extension in its sandbox (Vol 9_2)
```

## 3. Trust Signals Shown to the Owner

- Publisher identity and verification status
- Declared data scope and external endpoints, in plain language (not raw permission strings)
- Whether the extension has passed the current validation gate (Vol 9_5)
- Categories: Workflow (Vol 9_3) or Integration (Vol 9_4)

## 4. Industry Bundling

For businesses using an Industry Finance PKA extension (Vol 10_2), the marketplace can surface complementary extensions curated for that industry — this is a discovery convenience only; it does not change the underlying installation, permission, or sandboxing model.

## 5. Relationships to Other Volumes

- Vol 9_5 (Testing & Validation Architecture) is the gate every listed extension has passed.
- Vol 9_1/9_2 define the permission and sandbox model surfaced to the owner here.
- Vol 7_7 (Settings & Business Configuration) is the on-device installation and management surface.

---

*End of Volume 9_7.*
