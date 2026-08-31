# AIFA — AI Agent Architecture
## Volume 5_2 — Series 5: AI Platform Architecture — Version 2.0

**Status:** Complete — target design; Phase 1 implements the same logical boundaries as one orchestrated pipeline (see Section 4.1)
**Realism correction applied:** Yes — see Vol 0_1, Section 3.3

---

## 1. Purpose

This volume defines the Professional Intelligence Agent model: how the Bookkeeping, Financial, and CFO Assistant engines are realised as specialised, governed reasoning components rather than one undifferentiated AI. This is the Phase 2+ production shape. Phase 1 achieves the same *logical* separation of concerns without the coordination overhead of genuinely independent agents — see Section 4.1.

## 2. Definition

> Professional Intelligence Agent: a specialised governed reasoning component, not unrestricted autonomous software.

Each agent is scoped to a specific responsibility, receives only the PCB relevant to that responsibility, and operates within explicit boundaries defined by its governing engine volume.

## 3. Agent Roster

| Agent | Governing Engine Volume | Scope |
|---|---|---|
| Bookkeeping Agent | Vol 2_2 (BIE) | Classify and record Business Events as accounting entries |
| Financial Analysis Agent | Vol 2_3 (FIE) | Compute insight from Financial Data |
| CFO Advisory Agent | Vol 2_4 (CAE) | Translate insight into prioritised, plain-language guidance |
| Retrieval Agent | Vol 3_1 (KRCE) | Assemble the PCB for a given task |

## 4. What Makes These "Agents" Rather Than a Single Model Call

Each agent has a bounded task, a bounded input (its specific PCB slice), a bounded output schema, and a validation step before its output is trusted downstream. This decomposition is what allows the explainability requirement (Vol 1_4, Section 5) to hold: a failure or low-confidence result can be attributed to a specific agent and a specific missing piece of context, not a black box.

## 4.1 Phase 1 Reality

Four independently coordinated agents is premature decomposition before real usage has shown where the seams actually need to be. Phase 1 builds **one orchestrated pipeline** — a single call chain (classify → record → analyse → advise) — that produces the same four categories of output described in Section 3, using role-scoped prompting within that chain rather than four separately deployed agents.

What is preserved from day one: each stage still has a bounded input, a bounded output schema, and a validation step (Section 4); a failure is still attributable to a specific stage (retrieval, classification, analysis, or advisory), not a black box. What is deferred: independent deployment, independent scaling, and cross-agent coordination logic (Section 6) — there is nothing to coordinate yet when it's one pipeline.

The trigger to split into genuinely separate agents is a real reliability or scaling need observed in production (e.g., classification needs to run far more often than advisory generation), not a fixed roadmap date.

## 5. Non-Autonomy Boundary

Agents do not chain into open-ended autonomous action. Any agent output that would trigger a real-world effect (posting an entry, sending a communication, initiating a payment) passes through the human-in-the-loop checkpoint defined in Vol 2_4, Section 6, unless the business has explicitly configured autonomous posting for high-confidence, low-risk cases (Vol 7_7).

## 6. Multi-Agent Coordination

```text
Retrieval Agent → PCB
        ↓
Bookkeeping Agent (if a new Business Event) → Financial Data update
        ↓
Financial Analysis Agent (on relevant schedule or trigger) → insight
        ↓
CFO Advisory Agent → owner-facing guidance
```

Coordination is orchestrated by the AI Orchestration Layer (Vol 5_0), not by agents calling each other directly and unsupervised.

## 7. Relationships to Other Volumes

- Vol 0_1 (MVP & Phased Delivery Roadmap) Section 3.3 is the authority for the Phase 1 simplification in Section 4.1.
- Series 2 (Core Architecture) defines the engines each agent/pipeline-stage belongs to.
- Vol 3_1 (KRCE) supplies every stage's context.
- Vol 5_3 (AI Context Management) governs how outputs are validated and tracked across a conversation.

---

*End of Volume 5_2.*
