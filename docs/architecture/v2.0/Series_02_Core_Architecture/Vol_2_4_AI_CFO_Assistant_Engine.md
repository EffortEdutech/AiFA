# AIFA — AI CFO Assistant Engine
## Volume 2_4 — Series 2: Core Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

This volume defines the AI CFO Assistant Engine (CAE) — the component that answers "what should the business consider doing next?" It is the final translation step from financial insight to owner-facing guidance.

## 2. Position in the Flow

```text
Financial Intelligence Engine output (structured insight)
        ↓
AI CFO Assistant Engine
        ↓
Plain-language guidance, prioritised and explainable
        ↓
Mobile Business Experience
```

## 3. Responsibilities

| Responsibility | Description |
|---|---|
| Translation | Convert structured financial insight into plain business language |
| Prioritisation | Surface the two or three things that matter most right now, not everything at once |
| Recommendation | Suggest concrete next actions (e.g., "follow up on this overdue invoice") |
| Explanation | Justify every recommendation with a traceable link to the underlying data and PKA rule |
| Scope discipline | Decline to advise outside governed Finance PKA scope; ask for clarification instead |

## 4. Advisory Boundary (carried from Vol 1_0, Vol 1_4)

The CAE operates strictly within the scope of the installed Finance PKA. It does not offer legal, tax-filing, or investment advice beyond what the governed PKA content supports. Where a question falls outside that scope, the CAE states this limitation explicitly rather than improvising an answer — this is the direct implementation of the "CFO assistant within governed scope" principle from Vol 1_0.

## 5. Inputs and Outputs

**Inputs:** FIE structured insight, relevant PCB (advisory templates, case studies, governed reasoning patterns from the Finance PKA), Business Knowledge Store (this organisation's history and preferences), Runtime Memory (current conversation context).

**Outputs:** Owner-facing guidance text/cards, prioritised recommendation list, optional proposed actions (e.g., draft a payment reminder) that require owner approval before execution.

## 6. Human-in-the-Loop Requirement

The CAE proposes; it does not execute irreversible business or financial actions unilaterally. Any action with real-world effect (sending a message, initiating a payment, filing a return) requires explicit owner approval, consistent with the boundary in Vol 1_4 Section 4.

## 7. Sprint 7 Concrete Implementation (CFO Guidance v1)

Phase 1 implements a deliberately small slice of Sections 3-4, matching Vol 0_1 §6's "Reduced Launch Scope for Financial Intelligence / CFO Guidance": `app/src/ai/cfoGuidance.ts`'s `getCfoGuidance` computes exactly cash position, a list of overdue receivables, a list of upcoming payables, and at most one "today" recommendation — no ratio libraries, valuation, or multi-period comparison (all explicitly Phase 2).

Prioritisation (Section 3) is implemented as literally "at most one" recommendation per call, picked as the single oldest overdue receivable (if any exist) and `null` otherwise — never manufactured to fill the slot, honouring Section 3's "not everything at once" and the broader "don't guess" principle (Vol 1_4 §7). "Overdue" itself is a `captured_at`-age proxy (`OVERDUE_THRESHOLD_DAYS = 30`), not real due-date ageing, since Phase 1's BusinessData schema has no due-date field (Vol 11_1 §3) — the same class of documented simplification as Vol 6_1/6_2's flat outstanding lists.

Explanation (Section 3) is satisfied by every `CfoRecommendation` carrying a `sourceBusinessEventId`, surfaced to the owner as a "Source: ..." line in the Workspace UI (Vol 7_2 §4) rather than a generic assertion.

Scope discipline (Section 3) and the Advisory Boundary (Section 4) are enforced structurally, not just by instruction: the PCB an AI provider receives for free-form Q&A (`buildWorkspacePcb`, `app/src/ai/pcb.ts`) contains ONLY this reduced CFO-guidance set in `financial_context` — a provider cannot answer outside that scope even if asked, because the data simply isn't in the bundle it received. See Vol 7_2 §5 for the three-state honesty model this produces.

## 8. Relationships to Other Volumes

- Vol 2_3 (FIE) is the CAE's upstream data source.
- Vol 1_2 (UX Architecture) governs how CAE output is presented.
- Vol 5_2 (AI Agent Architecture) defines the CAE as a Professional Intelligence Agent instance.
- Vol 7_5 (Notification & AI Recommendation Architecture) delivers CAE output on mobile.

---

*End of Volume 2_4.*
