# AIFA — AI-First Design Principles
## Volume 1_4 — Series 1: Product Foundation — Version 2.0

**Status:** Complete

---

## 1. Purpose

This volume states what "AI-first" concretely means for AIFA, and draws the line between AI responsibilities and knowledge-governance responsibilities that recurs throughout the architecture.

## 2. What AI-First Means Here

AI-first does **not** mean the AI model is the source of professional knowledge, nor that it operates without governance. It means the AI is the *primary interaction and reasoning layer* the owner experiences, while professional correctness is guaranteed by a separate, governed knowledge supply chain (Series 3).

## 3. AI Responsibilities

The AI:

- Understands the owner's intent from natural input
- Reasons over the Professional Context Bundle it is given
- Explains outcomes in plain language
- Communicates with the owner conversationally
- Generates structured proposals (e.g., a proposed bookkeeping entry) for validation

## 4. What AI Does Not Do

The AI does not:

- Govern professional knowledge (that is Knowledge Factory's role, Series 3)
- Own or silently rewrite business knowledge (that requires BKEE validation, Vol 3_2/4_2)
- Modify the Finance PKA
- Replace a verified financial record without an auditable trail
- Make final, unreviewable business decisions on the owner's behalf

## 5. Explainability and Trust

Every AI output must be traceable to: (a) the Business Event that triggered it, and (b) the Finance PKA rule or Knowledge Object that governed the interpretation. An AI answer with no traceable source is treated as low-confidence and must be flagged as such to the owner (carried into Vol 5_3, AI Context Management, and Vol 1_2 Section 5).

## 6. Model Independence as a Design Principle

Because professional intelligence lives in the governed Finance PKA rather than in model weights, AIFA can change or combine underlying AI models without re-deriving its financial reasoning. This is treated as a first-class design principle, not an implementation detail, because it protects the product from vendor lock-in and model drift.

## 7. Failure Mode Handling

When the AI lacks sufficient governed context to answer reliably, the required behaviour is to say so and ask a clarifying question — never to fabricate a plausible-sounding but ungoverned answer. This is the direct implementation of the boundary stated in Vol 1_0 Section 6.

## 8. Relationships to Other Volumes

- Vol 1_0 (Product Vision) Section 6 is the origin of this volume.
- Vol 2_0 (AIFA System Architecture) shows where these principles are enforced structurally.
- Vol 5_3 (AI Context Management) and Vol 5_4 (AI Learning & Feedback) implement Sections 5 and 7.
- Series 3 (Finance PKA) is the governed knowledge source referenced throughout.

---

*End of Volume 1_4.*
