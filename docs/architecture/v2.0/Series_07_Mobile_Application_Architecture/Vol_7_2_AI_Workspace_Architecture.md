# AIFA — AI Workspace Architecture
## Volume 7_2 — Series 7: Mobile Application Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

This volume defines the conversational workspace where the owner interacts with the AI CFO Assistant Engine (Vol 2_4) beyond single-event capture — asking questions, reviewing guidance, and exploring financial insight.

## 2. Workspace Capabilities

| Capability | Description |
|---|---|
| Conversational Q&A | Owner asks free-form questions about their business finances |
| Guided review | AI proactively surfaces items needing owner attention |
| Explanation drill-down | Owner can ask "why" on any figure or recommendation |
| Action approval | Owner approves or declines proposed actions (Vol 2_4, Section 6) |

## 3. Session Flow

```text
Owner opens AI Workspace or receives a proactive prompt
        ↓
AI Context Management (Vol 5_3) assembles/refreshes the relevant PCB
        ↓
CFO Advisory Agent (Vol 5_2) responds with plain-language guidance
        ↓
Owner drills down, asks follow-up, or approves/declines a proposed action
        ↓
Runtime Memory (Vol 4_3) holds the session; expires per policy after the session ends
```

## 4. Explainability Surface

Every response in the workspace carries a visible link back to its source (a Business Event, a Financial Data figure, or a PKA rule), consistent with Vol 5_3 Section 4. The owner can always tap through to see exactly where a number came from.

## 5. Sprint 7 Concrete Implementation

Conversational Q&A (Section 2) is implemented end-to-end: `app/src/ai/workspacePipeline.ts`'s `askWorkspaceQuestion` assembles the CFO Guidance PCB (Vol 2_4 §7) and forwards the owner's free-form question to the configured AI provider's `answerFinancialQuestion` method. Guided review (Section 2) is the same today-recommendation card described in Vol 2_4 §7, rendered at the top of `WorkspaceScreen.tsx` on open, satisfying Section 3's "AI proactively surfaces items needing owner attention" without a separate proactive-push mechanism (that's Vol 7_5, not yet built).

**Three-state honesty model**, the concrete Phase 1 shape of the Explainability Surface (Section 4) and the Advisory Boundary (Vol 2_4 §4): every answer is exactly one of — a real answer with a non-empty `sources` array (Business Event ids the owner can trace back to, rendered as a "Source: ..." line); `outOfScope` (a capable provider evaluated the question against the scoped PCB and explicitly declined, since the data needed isn't in scope — see Vol 2_4 §7's structural scoping); or `noProviderConfigured` (the configured provider has no `answerFinancialQuestion` method at all, distinct from a provider that has one and declines). These are never collapsed into a single generic "can't answer," per this sprint's own risk register item on not becoming "a general chatbot" by accident (declining loudly and specifically, not vaguely).

Action approval (Section 2) and explanation drill-down (Section 4, "tap through to see exactly where a number came from") remain unimplemented in Phase 1 beyond the inline `sources` line — no separate drill-down UI, and no proposed-action approval flow, since CFO Guidance v1 produces informational recommendations only, not actionable drafts (Vol 2_4 §6 remains Phase 2/3 for Workspace). Q&A turns are also not persisted to `ai_interpretations` (Vol 11_1 §8) — session-only for now, a documented gap.

## 6. Relationships to Other Volumes

- Vol 2_4 (AI CFO Assistant Engine) is the reasoning component behind this workspace.
- Vol 5_3 (AI Context Management) governs the conversation lifecycle here.
- Vol 7_5 (Notification & AI Recommendation Architecture) is how the workspace is proactively surfaced.

---

*End of Volume 7_2.*
