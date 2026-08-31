# AIFA — AI Runtime Architecture
## Volume 5_1 — Series 5: AI Platform Architecture — Version 2.0

**Status:** Complete — Phase 1 is cloud-only (see below); the hybrid model is Phase 2
**Realism correction applied:** Yes — see Vol 0_1, Section 3.1

---

## 1. Purpose

This volume defines how AI models are actually invoked. The founding question — *if the PKA and business database are local, but advanced AI requires an online engine, how does AIFA work technically?* — is answered here for Phase 1 honestly: it works because interpretation and advisory reasoning **require connectivity** in Phase 1, and the local-first guarantee applies to data, not to reasoning. The hybrid local/cloud model described below is the Phase 2+ target, not the Phase 1 build.

## 2. Execution Model by Phase

**Phase 1 (cloud-only):** every interpretation and advisory task is sent, as a minimal PCB, to a single configured cloud AI model (Vol 11_0, Section 4). There is no on-device reasoning model. When offline, tasks queue (Vol 4_4, Section 7) rather than falling back to a local model that doesn't exist yet.

**Phase 2 (hybrid, future):** on-device models handle basic classification and offline operation for privacy-sensitive or connectivity-constrained cases; cloud models remain the vehicle for complex advisory reasoning. This phase begins only once a specific accuracy bar for local classification has been validated against Phase 1 cloud results — not on a fixed timeline.

## 3. Model Selection Criteria (Phase 2 target — not built in Phase 1)

| Criterion | Effect |
|---|---|
| Connectivity | Offline forces local model execution or deferred cloud reasoning |
| Task complexity | Complex advisory reasoning may prefer a cloud model; simple classification may use a local model |
| Sensitivity/governance policy | Highly sensitive tasks may be restricted to local-only execution by business configuration (Vol 7_7) |
| Cost and latency policy | Configurable per deployment; enterprise settings may differ from individual SME defaults |
| Model availability | Falls back gracefully if a preferred model is unreachable |

## 4. Execution Flow (Phase 1 — the only flow that ships at launch)

```text
Local runtime interprets request
        ↓
KRCE builds minimal PCB (Vol 3_1)
        ↓
AI Runtime sends PCB only to selected cloud AI model
        ↓
Cloud model returns reasoning/response
        ↓
AI Runtime validates response against governance rules
        ↓
Approved result stored locally
```

## 5. Execution Flow (Local Case — Phase 2, not yet built)

```text
Local runtime interprets request
        ↓
KRCE builds minimal PCB
        ↓
AI Runtime executes against on-device model
        ↓
Result validated and stored locally — no network round-trip required
```

This flow is documented here as the Phase 2 target shape so Series 5 stays internally consistent; it is explicitly not part of the Phase 1 build (Vol 0_1, Section 3.1).

## 6. Statelessness Guarantee

Per Vol 5_0's governing rule, no AI Runtime invocation — local or cloud — persists business-specific learning inside the model itself. All persistence happens through the governed Business Knowledge Store (Vol 4_2) or, for professional knowledge, through Knowledge Factory (Series 3).

## 7. Relationships to Other Volumes

- Vol 0_1 (MVP & Phased Delivery Roadmap) Section 3.1 is the authority for the Phase 1/Phase 2 split in this volume.
- Vol 11_0 (Technology Stack Decisions) names the actual Phase 1 cloud model configuration.
- Vol 3_1 (KRCE) is the upstream supplier of every PCB the AI Runtime consumes.
- Vol 4_4 (Local-First Storage & Synchronisation) defines the local/cloud data boundary this volume operates within.
- Vol 5_2 (AI Agent Architecture) defines what runs inside a given model invocation.
- Vol 8_2 (Security & Data Protection) governs transmission security for the cloud case.

---

*End of Volume 5_1.*
