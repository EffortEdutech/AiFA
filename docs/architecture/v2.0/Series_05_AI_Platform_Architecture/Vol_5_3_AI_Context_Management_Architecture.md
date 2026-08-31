# AIFA — AI Context Management Architecture
## Volume 5_3 — Series 5: AI Platform Architecture — Version 2.0

**Status:** Complete
**Incorporates:** AI Safety & Governance boundary enforcement within conversations

---

## 1. Purpose

This volume defines how the Professional Context Bundle and Runtime Memory are managed across a multi-turn AI conversation, and how safety/governance checks are applied to every AI output before it reaches the owner.

## 2. Context Lifecycle Within a Conversation

```text
Turn 1: Owner input → PCB assembled (Vol 3_1) → AI response → validated → shown
Turn 2: Owner follow-up → Runtime Memory (Vol 4_3) + refreshed/extended PCB → AI response → validated → shown
...
Session ends → Runtime Memory expires per policy
```

Context is re-scoped, not simply appended without bound — KRCE re-evaluates what is actually relevant at each turn to keep the PCB minimal (Vol 3_1, Section 6).

## 3. Governance Checks Applied to Every AI Output

| Check | Purpose |
|---|---|
| Source traceability | Every claim must trace to a Business Event, Financial Data record, or PKA Knowledge Object |
| Scope conformance | Output must stay within the governed Finance PKA's scope |
| Confidence thresholding | Low-confidence outputs are flagged or routed to clarification, not presented as certain |
| Action gating | Any proposed action with real-world effect requires human approval (Vol 2_4, Section 6) |
| PII/sensitivity handling | Sensitive fields are handled per the business's configured privacy policy |

## 4. Explainability Enforcement

This volume is the enforcement point for the explainability principle stated in Vol 1_4, Section 5: no AI response is delivered to the owner without an attached traceability record (Business Event ID, PKA rule reference, or explicit "insufficient context" flag).

## 5. Failure and Clarification Handling

When context is insufficient or conflicting, the AI Context Management layer routes to a clarification turn rather than allowing an agent to guess. This directly implements Vol 1_4, Section 7.

## 6. Sprint 11 Concrete Implementation

Section 4's "no AI response is delivered... without an attached traceability record" is now a real, tappable UI surface, not just a stored field: `app/src/ai/whyDetail.ts`'s `getWhyDetailForEvent` reads a Business Event's full `ai_interpretations` history (persisted since Sprint 3) and classifies it into one of six `WhyConfidenceState` values; `app/src/components/WhyButton.tsx` is the "Why?" link + modal that renders it, wired onto every owner-facing figure that traces back to a single Business Event — `ActivityFeed.tsx` rows (Dashboard and Capture), Dashboard's outstanding-invoices/bills rows and notifications panel, and Workspace's "Today" recommendation card and each Q&A turn's source. The two genuine aggregate figures with no single source event (cash position, money in/out) get a plain-language explanation sentence instead, since there is no one event to open — consistent with this section's own traceability requirement being about "a Business Event ID... or an explicit insufficient-context flag," not a drill-down for every conceivable number.

Section 3's "confidence thresholding... flagged... not presented as certain" (Section 5's clarification-routing behaviour was already implemented since Sprint 3) now has a corresponding VISUAL requirement satisfied: `WhyConfidenceState`'s six values render as differently-coloured badges (green for confident/owner-reviewed, amber for low-confidence/awaiting-clarification, grey for not-yet-interpreted/manual-no-AI) — a low-confidence or insufficient-context item is structurally never styled identically to a confident one, since all call sites share the one `WhyButton` component rather than each screen re-implementing its own presentation.

## 7. Relationships to Other Volumes

- Vol 3_1 (KRCE) is the PCB source this volume manages across turns.
- Vol 4_3 (Runtime Memory) is the temporary store this volume governs.
- Vol 5_2 (AI Agent Architecture) supplies the agent outputs validated here.
- Vol 1_2 (UX Architecture) defines how flagged/low-confidence output is presented to the owner.
- Vol 8_6 (Observability & Diagnostics) Section 5 is the Sprint 11 implementation note for the crash/error-logging half of this codebase's observability; this volume covers the explainability half.

---

*End of Volume 5_3.*
