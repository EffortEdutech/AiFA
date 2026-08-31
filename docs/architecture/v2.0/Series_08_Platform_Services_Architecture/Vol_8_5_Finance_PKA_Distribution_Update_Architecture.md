# AIFA — Finance PKA Distribution & Update Architecture
## Volume 8_5 — Series 8: Platform Services Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

This volume defines how a governed Finance PKA package travels from Knowledge Factory to an installed, active package on an owner's device (Vol 2_1, Vol 3_0).

## 2. Distribution Flow

```text
Knowledge Factory publishes a signed, versioned Finance PKA package
        ↓
AIFA Distribution Service hosts the package for retrieval
        ↓
Device checks for available updates (per Vol 7_7 "Finance PKA Management")
        ↓
Package downloaded and passed to the PKA Runtime Engine (Vol 2_1)
        ↓
PRE validates signature and integrity before activation
        ↓
Package becomes active; prior version retained until successful activation is confirmed
```

## 3. Update Safety

Updates never apply mid-task destructively — an in-progress bookkeeping or advisory task completes against the package version it started with, and the new version activates for subsequent tasks. This avoids inconsistent reasoning within a single interaction.

## 4. Rollback

If a newly installed package fails validation or causes a detected functional regression, the device can roll back to the last known-good signed version. Business data is never affected by a PKA rollback, since business data lives in a separate layer (Series 4) from the PKA itself.

## 5. Industry Extension Distribution

Industry Finance PKA extension packages (Vol 10_2) follow the same distribution mechanism, installed alongside the base Finance PKA rather than replacing it (Vol 2_1, Section 6).

## 6. Relationships to Other Volumes

- Vol 2_1 (PKA Runtime Engine) is the on-device consumer of distributed packages.
- Vol 3_0 (Finance PKA Architecture) defines package integrity requirements enforced here.
- Vol 7_7 (Settings & Business Configuration) exposes update status to the owner.
- Vol 10_2 (Industry Finance PKA Architecture) extends this distribution model.

---

*End of Volume 8_5.*
