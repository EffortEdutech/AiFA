# AIFA — Integration Extension Architecture
## Volume 9_4 — Series 9: Developer & Extension Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

This volume defines extensions that connect AIFA to external systems beyond the platform-provided integrations in Vol 8_3 — e.g., a niche point-of-sale system, a regional payment gateway, or an industry-specific supplier portal.

## 2. Integration Extension Structure

```text
External system event or scheduled poll
        ↓
Integration extension receives/fetches data within its declared, approved scope
        ↓
Extension maps external data into a Business Event candidate (Vol 4_0 structure)
        ↓
Standard Business Event Layer confidence/clarification flow applies (Vol 7_1)
```

Integration extensions produce Business Event *candidates*, not finished ledger entries — they feed the same canonical pipeline as native capture, preserving ADR-001 regardless of the extension's data source.

## 3. Outbound Integration Extensions

Some integration extensions instead push AIFA data outward (e.g., to a specialised accountant tool). These read from Financial Data (Vol 4_1) within their declared scope and never receive the Finance PKA or raw PCB content (Vol 9_1, Section 3).

## 4. Approval and Trust

Because integration extensions can introduce third-party data into the canonical Business Event stream, they carry a distinct trust marker in the UI — the owner can always see that a given Business Event originated from an integration extension rather than direct capture, preserving the traceability principle (Vol 1_2, Section 5).

## 5. Relationships to Other Volumes

- Vol 8_3 (Integration & API Architecture) covers first-party/platform-provided integrations; this volume covers third-party extensions.
- Vol 4_0 (Business Data Architecture) defines the target structure integration extensions must map into.
- Vol 9_1/9_2 define the SDK and sandboxing these extensions run under.

---

*End of Volume 9_4.*
