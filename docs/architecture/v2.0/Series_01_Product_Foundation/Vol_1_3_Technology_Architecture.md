# AIFA — Technology Architecture
## Volume 1_3 — Series 1: Product Foundation — Version 2.0

**Status:** Complete
**Realism correction applied:** Yes — see Vol 0_1, Section 3.1 (offline scope)

---

## 1. Purpose

This volume states the technology-neutral platform principles that constrain every later engineering decision. Concrete framework, database, and vendor choices for Phase 1 are made in Series 11 (Implementation Foundations), which supersedes the "future Series 11" placeholder originally referenced here.

## 2. Platform Direction (binding)

- Mobile-first: Android and iOS as primary targets, tablet as a supported form factor
- Web dashboard as a secondary, later surface
- Offline-first for capture, record-keeping, and viewing existing data — the app must be fully usable for logging a Business Event and reviewing the dashboard without network access
- AI interpretation and advisory reasoning require connectivity in Phase 1 (see Section 3 correction below); this is a scope statement, not a contradiction of offline-first — capture never blocks on the network, reasoning does
- Local encrypted storage as the system of record on-device
- Encrypted cloud backup for durability and multi-device continuity
- An enterprise growth path (Series 10, Phase 3) without a rewrite of the core architecture

## 3. Local-First, Cloud-Assisted Principle

> **Knowledge stays with the owner. Intelligence may be borrowed when authorised.**

The Finance PKA, Business Events, Business Data, Financial Data, Business Knowledge Store, documents, and runtime configuration all live locally on the device. Cloud AI is consulted only through a minimal, governed payload (the Professional Context Bundle — see Vol 3_1); the full PKA and the full business database are never uploaded (see Vol 4_4). In Phase 1, cloud AI is a required dependency for interpretation and advisory tasks specifically (not for data ownership or storage, which remain local-first without exception) — see Vol 0_1, Section 3.1 for why "optional online AI" was an overstatement of near-term reality.

## 4. Layered Technology View

```text
Presentation Layer        — Mobile app, (later) web dashboard
Orchestration Layer       — AI Orchestration, PKA Runtime Engine
Intelligence Layer        — Bookkeeping / Financial Intelligence, AI CFO Engines
Retrieval Layer           — Knowledge Retrieval & Context Engine
Data Layer                — Business Events, Business Data, Financial Data,
                             Business Knowledge Store, Runtime Memory
Platform Services Layer   — Identity, Security, Sync, Integration, Observability
```

Each layer is detailed in its corresponding series (2, 3, 4, 5, 8).

## 5. Model Independence

AIFA is not architecturally bound to a single AI model or vendor. In Phase 1 this means the cloud model provider is a build-time configuration choice, not a hardcoded dependency (Vol 11_0, Section 4); local-vs-cloud *routing* (Vol 5_0) is a Phase 2 capability once local model quality is validated. Professional knowledge lives in the Finance PKA, not in any specific model's weights, so a model swap does not require re-authoring professional intelligence.

## 6. Non-Negotiable Technology Boundaries

1. The Finance PKA is never manufactured or modified by AIFA — only installed and executed.
2. No AI call transmits the full PKA or full business database — only a minimal PCB.
3. Local storage is encrypted at rest; cloud backup is encrypted in transit and at rest.
4. All engines are independently addressable components, not an undifferentiated monolith (Series 2).
5. Extension points (Series 9) are sandboxed and cannot bypass governance boundaries.

## 7. Relationships to Other Volumes

- Vol 0_1 (MVP & Phased Delivery Roadmap) is the scope authority for the Phase 1 corrections in Sections 2, 3, and 5.
- Vol 11_0 (Technology Stack Decisions) makes this volume's principles concrete with named tools.
- Vol 4_4 (Local-First Storage & Synchronisation) details Section 3.
- Vol 5_0 (AI Platform Architecture) details Section 5.
- Series 2 (Core Architecture) details Section 4's Intelligence Layer.
- Series 8 (Platform Services Architecture) details Section 4's Platform Services Layer.
- Series 9 (Developer & Extension Architecture, Phase 3) details Section 6, point 5.

---

*End of Volume 1_3.*
