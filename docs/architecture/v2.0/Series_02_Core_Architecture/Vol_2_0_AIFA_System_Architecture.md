# AIFA — System Architecture
## Volume 2_0 — Series 2: Core Architecture — Version 2.0

**Status:** Complete
**Applies ADR-001:** Yes

---

## 1. Purpose

This volume defines the complete internal engine topology of AIFA — the "how" that implements the "why" of Series 1.

## 2. Full System Flow

```text
Knowledge Factory
        ↓
Finance Professional Knowledge Asset (Finance PKA)
        ↓
AIFA PKA Runtime Engine (PRE)
        ↓
Knowledge Retrieval & Context Engine (KRCE)
        ↓
Professional Context Bundle (PCB)
        ↓
AI Orchestration Layer
        ↓
AI Model
        ↓
Bookkeeping Intelligence Engine (BIE)
        ↓
Financial Intelligence Engine (FIE)
        ↓
AI CFO Assistant Engine (CAE)
        ↓
Mobile Business Experience
```

## 3. Parallel Runtime-Owned Data Layers

```text
Business Event Layer
        ↓
Business Data
        ↓
Financial Data
        ↓
Business Knowledge Store
        ↓
Runtime Memory
```

These layers are owned by the AIFA runtime (not by Knowledge Factory) and are detailed in Series 4.

## 4. Engine Responsibilities

| Engine | Primary Question It Answers |
|---|---|
| PKA Runtime Engine (PRE) | How is governed professional intelligence executed? |
| Knowledge Retrieval & Context Engine (KRCE) | Which professional and business context is required right now? |
| Bookkeeping Intelligence Engine (BIE) | What accounting happened? |
| Financial Intelligence Engine (FIE) | What do the financial results mean? |
| AI CFO Assistant Engine (CAE) | What should the business consider doing next? |
| Business Knowledge Evolution Engine (BKEE) | What has this organisation learned? |
| AI Orchestration Layer | Which context, model, tools, and validation path are required for this task? |

## 5. Central Composition (Series 2 view)

```text
PKA Runtime Engine
├── Bookkeeping Intelligence Engine
├── Financial Intelligence Engine
├── AI CFO Assistant Engine
├── Knowledge Retrieval & Context Engine
└── Workflow and runtime services
```

## 6. Data-First Discipline

Per ADR-001, the Business Event Layer is the entry point for every engine interaction. No engine acts on ungrounded input; every action traces back to a Business Event ID, which in turn traces to the raw owner input that created it.

## 7. Governance Enforcement Points

| Boundary | Enforced By |
|---|---|
| PKA cannot be modified by AIFA | PRE package integrity validation |
| AI never receives full PKA/database | KRCE + PCB construction |
| Business Events are canonical | Business Event Layer write-once discipline |
| Runtime Memory expires | Runtime Memory policy engine (Vol 4_3) |
| Business Knowledge only updates via validated learning | BKEE (Vol 3_2 / Vol 4_2) |

## 8. Relationships to Other Volumes

- Vol 2_1–2_4 detail each engine named in Section 4.
- Series 3 details the Finance PKA, KRCE, and PCB.
- Series 4 details the parallel data layers in Section 3.
- Series 5 details AI Orchestration and the AI model boundary.

---

*End of Volume 2_0.*
