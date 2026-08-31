# AIFA — AI Learning & Feedback Architecture
## Volume 5_4 — Series 5: AI Platform Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

This volume defines how owner feedback (corrections, confirmations, dismissals) is captured and routed — never back into the AI model's weights, but into the governed learning paths defined elsewhere in the architecture.

## 2. The Governing Rule (restated)

> The AI model does not permanently learn from the business.

All learning is mediated by governance:

```text
Owner feedback (correction / confirmation / dismissal)
        ↓
        ├── Organisation-specific pattern? → BKEE validation → Business Knowledge Store (Vol 4_2)
        └── Professional knowledge gap? → Flagged for Knowledge Factory review → future Finance PKA update (Vol 8_5)
```

## 3. Feedback Types

| Feedback Type | Example | Routed To |
|---|---|---|
| Correction | Owner reclassifies a proposed entry | BKEE (organisation pattern) + local re-training signal for classification confidence, not model weights |
| Confirmation | Owner accepts a proposed entry as-is | Reinforces confidence scoring for similar future events (locally) |
| Dismissal | Owner ignores or rejects a CFO recommendation | Logged to reduce recurrence of low-value recommendations for this business |
| Professional gap report | Owner flags "this rule doesn't apply to my situation" | Escalated toward Knowledge Factory as a candidate PKA improvement, subject to KF's own governance process |

## 4. What This Volume Does Not Do

It does not implement online fine-tuning of the shared AI model on individual business data. It does not permit business-specific corrections to silently alter the Finance PKA. Both restrictions preserve the boundaries in Vol 3_0, Section 6 and Vol 5_0, Section 2.

## 5. Local Confidence Adjustment

Within a single business's local environment, repeated confirmations can locally increase the confidence score AIFA assigns to similar future classifications (e.g., "this vendor is always Office Supplies") — this is Business Knowledge evolution (Vol 4_2), not model learning, and stays local to that business.

## 6. Relationships to Other Volumes

- Vol 4_2 (Business Knowledge Store) is the primary destination for validated organisation-specific feedback.
- Vol 8_5 (Finance PKA Distribution & Update Architecture) is the channel through which professional-gap reports could eventually influence a future PKA version.
- Vol 1_2 (UX Architecture) defines how feedback is collected from the owner in-product.

---

*End of Volume 5_4.*
