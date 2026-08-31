# AIFA — Knowledge Retrieval & Context Engine
## Volume 3_1 — Series 3: Finance Professional Knowledge Asset — Version 2.0

**Status:** Complete and rewritten to align with official Knowledge Factory documents ("PKA Anatomy and Runtime Boundary"; "PKA Retrieval and Context Engine for App Developers")
**Applies freeze action 16.5:** Yes — this volume is the standardised PCB contract.
**Phase 1 note:** The retrieval logic and PCB contract below apply from day one — this is the actual mechanism, not aspirational. See Vol 11_1, Section 6 for the Phase 1 minimal-field implementation of the same contract.

---

## 1. Purpose

This volume defines the Knowledge Retrieval & Context Engine (KRCE): the component that decides *which* professional and business context is required for a given task, retrieves it locally, and assembles the minimal Professional Context Bundle (PCB) sent to the AI model.

## 2. Core Principle

> Retrieval occurs locally. The cloud model does not need the whole graph or PKA. The AI is a reasoning engine, not a knowledge repository. The runtime controls what leaves the device.

## 3. Retrieval Flow

```text
Finance PKA (installed, local)
        ↓
Knowledge Retrieval & Context Engine
        ↓
Professional Context Bundle (minimal, governed)
        ↓
Cloud or Local AI
        ↓
Reasoning and communication
```

Step by step:

1. Interpret the user's request or the triggering Business Event.
2. Search the local Finance PKA for relevant Knowledge Objects.
3. Retrieve relevant Business and Financial context from local data layers (Series 4).
4. Apply governance and permission checks.
5. Build a small, governed context payload — the PCB.
6. Send only that payload to the selected AI model (local or cloud, per Vol 5_1).
7. Receive the AI's response.
8. Validate the response against governance rules.
9. Store approved results locally (Business Data, Financial Data, or Business Knowledge Store, as appropriate).

## 4. Professional Context Bundle — Standardised Contract

```text
Professional Context Bundle
├── User intent
├── Relevant Knowledge Objects
├── Ontology concepts
├── Graph relationships
├── Professional rules
├── Workflows
├── Formulae
├── Templates
├── Business context
├── Financial context
├── Source references
├── Governance metadata
├── Runtime instructions
└── Limitations
```

| PCB Field Group | Required / Optional | Notes |
|---|---|---|
| User intent | Required | Structured interpretation of the request |
| Relevant Knowledge Objects | Required | Only the objects retrieved as relevant — never the full PKA |
| Ontology concepts / Graph relationships | Optional | Included when relational context materially improves reasoning |
| Professional rules / Workflows / Formulae / Templates | Required where applicable | Drawn from the Finance PKA, scoped to the task |
| Business context / Financial context | Required | Minimal relevant slice of Business Data / Financial Data (Series 4) |
| Source references | Required | Traceability back to PKA Knowledge Objects and Business Events |
| Governance metadata | Required | PKA version, validation status, applicable boundaries |
| Runtime instructions | Required | Task framing for the AI Orchestration Layer |
| Limitations | Required | Explicit statement of what the bundle does *not* cover |
| Security classification | Required | Sensitivity level governing what may leave the device |
| Token / size budget | Required | Enforced cap keeping the bundle minimal |
| Validation state | Required | Whether the bundle passed governance checks pre-send |

## 5. Analogy (retained from the founding discussion)

```text
YOUR COMPUTER
├── Source Code
├── Local Knowledge Index
├── Local graph.json / graph.db
├── Retrieval Interface (MCP-style)
└── AI Client
        ↓
Only retrieved context is sent
        ↓
Cloud LLM produces the answer
```

This mirrors how a developer tool like a local code index retrieves only relevant snippets before calling a cloud model — KRCE performs the equivalent role for financial professional knowledge.

## 6. Governance Enforcement

KRCE is the single enforcement point for the rule "the AI never receives the full PKA or full database." Any retrieval request that would exceed the governed size/scope budget is rejected or re-scoped before a PCB is built — it is not silently truncated in a way that could distort meaning.

## 7. Relationships to Other Volumes

- Vol 11_1 (MVP Data Schema) Section 6 is the concrete Phase 1 implementation of the contract in Section 4 above.
- Vol 3_0 (Finance PKA Architecture) defines the source material KRCE retrieves from.
- Vol 2_1 (PKA Runtime Engine) is KRCE's retrieval interface into the installed PKA.
- Series 4 (Data Architecture) defines the business/financial context KRCE draws from.
- Vol 5_0 (AI Orchestration) is KRCE's downstream consumer.
- Vol 5_3 (AI Context Management) governs how PCBs are used within a conversation.

---

*End of Volume 3_1.*
