# AIFA — AI Platform Architecture
## Volume 5_0 — Series 5: AI Platform Architecture — Version 2.0

**Status:** Complete
**Realism correction applied:** Yes — see Vol 0_1, Sections 3.1 and 3.3 (offline scope; single-pipeline Phase 1 shape)

---

## 1. Purpose

This volume is the entry point to Series 5, defining how AIFA orchestrates AI models against governed context, and stating the platform-wide rule that governs everything in this series.

## 2. The Governing Rule

> The AI model does not permanently learn from the business.

Professional improvement happens through Knowledge Factory and updated Finance PKAs (Series 3). Organisation-specific learning happens through the Business Knowledge Evolution Engine (Vol 4_2). The AI model itself is stateless with respect to any individual business — it reasons over whatever PCB it is given, and retains nothing after the interaction.

## 3. Series 5 Composition

| Volume | Role |
|---|---|
| 5_0 | AI Platform Architecture (this volume) — overview and governing rule |
| 5_1 | AI Runtime Architecture — model selection, local vs. cloud execution |
| 5_2 | AI Agent Architecture — Professional Intelligence Agents (BIE, FIE, CAE as agent instances) |
| 5_3 | AI Context Management Architecture — PCB lifecycle within a conversation, safety and governance checks |
| 5_4 | AI Learning & Feedback Architecture — how owner feedback reaches BKEE and, indirectly, Knowledge Factory |

## 4. Platform Flow

```text
Task or Business Event
        ↓
AI Orchestration Layer (model + tool + validation path selection)
        ↓
AI Runtime (executes against selected model, local or cloud)
        ↓
Professional Intelligence Agent(s) reason over the PCB
        ↓
Validated output returned to the calling engine (BIE / FIE / CAE)
```

## 5. Model Independence

Because professional knowledge lives in the Finance PKA rather than in a model's weights (Vol 1_4, Vol 3_0), the AI Platform can route a task to different models — local, cloud, or a mix — without changing what the AI knows how to do. Model selection is an orchestration decision, not an architecture dependency.

**Phase 1 scope note:** local-vs-cloud *routing* is a Phase 2 capability. Phase 1 routes every interpretation and advisory task to a single cloud model; "model independence" in Phase 1 means the cloud vendor is swappable, not that local execution exists yet (Vol 0_1, Section 3.1; Vol 11_0, Section 4). Similarly, the four-agent shape in Section 4 above is the target production design — Phase 1 implements it as one orchestrated pipeline with the same logical role boundaries, not four independently coordinated agents (Vol 0_1, Section 3.3; Vol 5_2).

## 6. Relationships to Other Volumes

- Vol 5_1–5_4 detail each component in Section 3.
- Vol 3_1 (KRCE) supplies the PCB the AI Platform reasons over.
- Vol 1_4 (AI-First Design Principles) states the boundaries this platform enforces.

---

*End of Volume 5_0.*
