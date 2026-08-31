# AIFA — Business Event Capture Architecture
## Volume 7_1 — Series 7: Mobile Application Architecture — Version 2.0

**Status:** Complete
**Applies ADR-001:** Yes
**Concrete failure handling added:** Yes — see Section 5.1

---

## 1. Purpose

This volume defines the mobile capture experience that implements the "One Input" promise (Vol 1_0) — the entry point to the Business Event Layer (Vol 4_0).

## 2. Capture Modes

| Mode | Flow |
|---|---|
| Voice | Tap-and-speak → transcription → structuring |
| Text | Type a short natural-language note → structuring |
| Photo | Capture a receipt/invoice → OCR/vision extraction → structuring |
| Document import | Select a PDF/statement → extraction → structuring |
| Passive capture | Forwarded bank notification, email, or WhatsApp message → structuring |
| Bulk import | Existing transaction export file → batch structuring |

All modes converge on the same output: a structured Business Event (Vol 4_0, Section 2).

## 3. Capture Flow

```text
Owner triggers capture (any mode)
        ↓
Raw input received
        ↓
On-device or cloud AI structures the input into a Business Event candidate
        ↓
Confidence check: high confidence → auto-confirm draft; low confidence → clarifying question
        ↓
Business Event committed (Vol 4_0) — immutable, timestamped, ID-assigned
```

## 4. Always-Available Entry Point

Per Vol 7_0 Section 3, capture is reachable from anywhere in the app within one interaction — this is treated as the single most important UX guarantee in the product, since the entire value proposition depends on capture friction staying near zero.

## 5. Clarification UX

When the Business Event Layer cannot confidently structure the input (e.g., ambiguous supplier, unclear amount), the app asks a short, specific clarifying question rather than presenting a guess as fact — the mobile implementation of the principle from Vol 1_4, Section 7.

### 5.1 Concrete Capture Failure Handling

| Failure | Phase 1 Behaviour |
|---|---|
| OCR/vision extraction fails entirely | Owner sees the captured photo alongside a blank quick-entry form — never a fabricated guess |
| OCR partially succeeds (e.g., amount unreadable, vendor name unclear) | Pre-fill whatever was read correctly; highlight only the missing/uncertain field for manual entry, not the whole form |
| Voice transcription fails or is ambiguous | Falls back to text input, pre-filled with whatever was heard, for the owner to correct |
| No connectivity during capture | The event is stored locally with a "queued" state (Vol 7_4, Section 2); the owner can keep capturing more events immediately — nothing is lost or blocked |

These are the concrete behaviours referenced abstractly in this section; see Vol 0_1, Section 7 for the roadmap authority.

## 6. Relationships to Other Volumes

- Vol 0_1 (MVP & Phased Delivery Roadmap) Section 7 is the authority for the failure handling in Section 5.1.
- Vol 4_0 (Business Data Architecture) is the data layer this capture flow feeds.
- Vol 1_2 (UX Architecture) sets the interaction principles this volume implements.
- Vol 7_4 (Offline & Synchronisation Experience) details the "queued" state referenced in Section 5.1.
- Vol 7_6 (Document & Receipt Experience) covers evidence storage for photo/document capture.

---

*End of Volume 7_1.*
