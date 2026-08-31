# AIFA — Master Documentation Index
## Volume 0_0 — Version 2.0

**Project:** AIFA — AI Financial Assistant
**Core promise:** One Input. AI Does the Rest.
**Document type:** Master volume register and canonical entry point
**Status:** Version 2.0 — Complete, with a realism/feasibility pass applied (1 August 2026, second revision)
**Prepared:** 1 August 2026
**Source of authority:** `docs/ideas/AIFA_Conversation_Architecture_Record_V2.md` (conversation record) and this Version 2.0 documentation set, which supersedes the abbreviated/missing volumes identified in that record's Section 14 and completes the freeze actions in its Section 16.

---

## 0. Start Here

Read **Vol 0_1 — MVP & Phased Delivery Roadmap** before treating any volume below as a build instruction. This full set describes AIFA's target architecture; Vol 0_1 marks which parts are Phase 1 (buildable now), Phase 2, or Phase 3, and documents several corrections made to the original draft where it overstated near-term capability (most notably: full offline AI reasoning is not realistic in Phase 1 — see Vol 0_1, Section 3.1). Series 11 — Implementation Foundations turns the Phase 1 scope into concrete technology and schema decisions.

## 1. Purpose

This index is the single canonical entry point into the AIFA Version 2.0 architecture documentation. It replaces informal tracking of "drafted / abbreviated / missing" status. Every volume listed below is written to full form. Where the conversation record left a volume abbreviated or unwritten (Vol 9_0–9_2, Vol 10_3–10_5, and the shortened Series 6–9 volumes), that gap is closed here. Where the resulting first draft was internally consistent but not realistic as a build plan, Vol 0_1 and targeted edits across the set (marked "Realism correction applied" in affected volume headers) closed that gap too.

## 2. How to Read This Set

Each volume follows a common structure: Purpose, Scope, Architecture, Key Components, Data/Information Flow, Governance & Boundaries, Relationships to Other Volumes, and (where relevant) Open Items. Diagrams use plain text flow blocks so they render identically in any viewer.

## 3. Canonical Terminology (authoritative)

| Term | Meaning |
|---|---|
| AIFA | AI Financial Assistant |
| KF | Knowledge Factory |
| PKA | Professional Knowledge Asset |
| Finance PKA | Governed professional finance intelligence package manufactured by KF |
| Knowledge Object | Small governed unit of professional knowledge inside a PKA |
| PKA Runtime Engine (PRE) | Executes installed PKAs within AIFA |
| KRCE | Knowledge Retrieval & Context Engine |
| PCB | Professional Context Bundle — the only payload sent to an AI model |
| BIE | Bookkeeping Intelligence Engine |
| FIE | Financial Intelligence Engine |
| CAE | AI CFO Assistant Engine |
| BKEE | Business Knowledge Evolution Engine |
| Business Event | Canonical record of something that happened in the business (source of truth, ADR-001) |
| Business Event Layer | The capture/ingestion stage that produces Business Events (supersedes the earlier "Business Data" label at this stage, per ADR-001) |
| Business Data | Structured operational data derived from Business Events |
| Financial Data | Accounting representation (journals, ledgers, statements) derived from Business Events |
| Business Knowledge Store | Persistent organisation-specific knowledge, evolved by BKEE |
| Runtime Memory | Temporary task/conversation context, expires per policy |
| Professional Intelligence Agent | Specialised governed reasoning component — not an unrestricted autonomous agent |
| Local-first | The device is the primary operational environment |
| Cloud-assisted | Cloud provides optional AI, backup, sync, and collaboration |

This table is binding across all volumes. Any document that would introduce conflicting terminology must instead raise a new ADR in Vol 4_0_0.

## 4. Non-Negotiable Boundaries (binding on all volumes)

1. AIFA never manufactures or modifies the Finance PKA — only Knowledge Factory does.
2. The AI model never receives the full PKA or the full business database — only the minimal, locally-assembled PCB.
3. Business Events are canonical; all other records are derived.
4. Business-specific knowledge is separate from, and never written back into, the shared Finance PKA.
5. Runtime Memory is temporary; nothing becomes permanent knowledge without passing through Knowledge Factory (Finance PKA) or BKEE (Business Knowledge Store).

## 5. Volume Register

### Series 0 — Master & Roadmap
| Vol | Title | Status |
|---|---|---|
| 0_0 | Master Documentation Index (this file) | Complete, living reference |
| 0_1 | MVP & Phased Delivery Roadmap | Complete, living reference — **read first** |

### Series 1 — Product Foundation
| Vol | Title | Status |
|---|---|---|
| 1_0 | Product Vision | Complete, V2.0 |
| 1_1 | Business Architecture | Complete, V2.0 |
| 1_2 | User Experience Architecture | Complete, V2.0 |
| 1_3 | Technology Architecture | Complete, V2.0 |
| 1_4 | AI-First Design Principles | Complete, V2.0 |

### Series 2 — Core Architecture
| Vol | Title | Status |
|---|---|---|
| 2_0 | AIFA System Architecture | Complete, V2.0 |
| 2_1 | PKA Runtime Engine Architecture | Complete, V2.0 |
| 2_2 | Bookkeeping Intelligence Engine | Complete, V2.0 |
| 2_3 | Financial Intelligence Engine | Complete, V2.0 |
| 2_4 | AI CFO Assistant Engine | Complete, V2.0 |

### Series 3 — Finance Professional Knowledge Asset
| Vol | Title | Status |
|---|---|---|
| 3_0 | Finance PKA Architecture | Complete, V2.0 |
| 3_1 | Knowledge Retrieval & Context Engine | Complete, V2.0 |

### Series 4 — Data Architecture
| Vol | Title | Status |
|---|---|---|
| 4_0_0 | Architecture Refinement & ADR Register | Complete, V1.1 (living register) |
| 4_0 | Business Data Architecture | Complete, V2.0 |
| 4_1 | Financial Data Architecture | Complete, V2.0 |
| 4_2 | Business Knowledge Store Architecture | Complete, V2.0 |
| 4_3 | Runtime Memory Architecture | Complete, V2.0 |
| 4_4 | Local-First Storage & Synchronisation Architecture | Complete, V2.0 |

### Series 5 — AI Platform Architecture
| Vol | Title | Status |
|---|---|---|
| 5_0 | AI Platform Architecture | Complete, V2.0 |
| 5_1 | AI Runtime Architecture | Complete, V2.0 |
| 5_2 | AI Agent Architecture | Complete, V2.0 |
| 5_3 | AI Context Management Architecture | Complete, V2.0 |
| 5_4 | AI Learning & Feedback Architecture | Complete, V2.0 |

### Series 6 — Business Operations Architecture
| Vol | Title | Status |
|---|---|---|
| 6_0 | Business Operations Architecture | Complete, V2.0 |
| 6_1 | Sales Operations Architecture | Complete, V2.0 |
| 6_2 | Purchase Operations Architecture | Complete, V2.0 |
| 6_3 | Expense Operations Architecture | Complete, V2.0 |
| 6_4 | Banking Operations Architecture | Complete, V2.0 |
| 6_5 | Inventory Operations Architecture | Complete, V2.0 |
| 6_6 | Asset Operations Architecture | Complete, V2.0 |
| 6_7 | Payroll Operations Architecture | Complete, V2.0 |
| 6_8 | Project Operations Architecture | Complete, V2.0 |
| 6_9 | Tax Operations Architecture | Complete, V2.0 |

### Series 7 — Mobile Application Architecture
| Vol | Title | Status |
|---|---|---|
| 7_0 | Mobile Application Architecture | Complete, V2.0 |
| 7_1 | Business Event Capture Architecture | Complete, V2.0 |
| 7_2 | AI Workspace Architecture | Complete, V2.0 |
| 7_3 | Mobile Dashboard Architecture | Complete, V2.0 |
| 7_4 | Offline & Synchronisation Experience Architecture | Complete, V2.0 |
| 7_5 | Notification & AI Recommendation Architecture | Complete, V2.0 |
| 7_6 | Document & Receipt Experience Architecture | Complete, V2.0 |
| 7_7 | Settings & Business Configuration Architecture | Complete, V2.0 |

### Series 8 — Platform Services Architecture
| Vol | Title | Status |
|---|---|---|
| 8_0 | Platform Services Architecture | Complete, V2.0 |
| 8_1 | Identity & Access Management Architecture | Complete, V2.0 |
| 8_2 | Security & Data Protection Architecture | Complete, V2.0 |
| 8_3 | Integration & API Architecture | Complete, V2.0 |
| 8_4 | Synchronisation & Cloud Services Architecture | Complete, V2.0 |
| 8_5 | Finance PKA Distribution & Update Architecture | Complete, V2.0 |
| 8_6 | Observability & Diagnostics Architecture | Complete, V2.0 |

### Series 9 — Developer & Extension Architecture
| Vol | Title | Status |
|---|---|---|
| 9_0 | Developer & Extension Architecture | Complete, V2.0 (reconstructed — no body existed in the conversation record) |
| 9_1 | Extension SDK Architecture | Complete, V2.0 (reconstructed) |
| 9_2 | Plugin Runtime Architecture | Complete, V2.0 (reconstructed) |
| 9_3 | Workflow Extension Architecture | Complete, V2.0 |
| 9_4 | Integration Extension Architecture | Complete, V2.0 |
| 9_5 | Testing & Validation Architecture | Complete, V2.0 |
| 9_6 | Deployment & DevOps Architecture | Complete, V2.0 |
| 9_7 | Extension Marketplace Architecture | Complete, V2.0 |

### Series 10 — Enterprise & Future Vision
| Vol | Title | Status |
|---|---|---|
| 10_0 | Enterprise Architecture | Complete, V2.0 |
| 10_1 | Multi-Tenant Architecture | Complete, V2.0 |
| 10_2 | Industry Finance PKA Architecture | Complete, V2.0 |
| 10_3 | AI Evolution Roadmap | Complete, V2.0 (reconstructed — no body existed in the conversation record) |
| 10_4 | Knowledge Factory Ecosystem Architecture | Complete, V2.0 (reconstructed) |
| 10_5 | AIFA Future Vision | Complete, V2.0 (reconstructed) |

### Series 11 — Implementation Foundations
| Vol | Title | Status |
|---|---|---|
| 11_0 | Technology Stack Decisions | Complete, V2.0 — new, fills freeze action 16.7 |
| 11_1 | MVP Data Schema | Complete, V2.0 — new, fills freeze action 16.7 |

### Series 12 — Web Platform Architecture (Proposed)
| Vol | Title | Status |
|---|---|---|
| 12_0 | Web Platform Architecture | Proposed, V1.0 — not yet implemented |
| 12_1 | Cross-Platform Data Synchronisation Architecture | Proposed, V1.3 — single active-device write lock (ADR-003) + primary-device forced takeover with lightweight confirmation (ADR-004); not yet implemented |

## 6. Freeze Actions Applied in This Version

This documentation set fulfils the freeze actions from the conversation record's Section 16:

- **16.1** — This file is the definitive master volume register.
- **16.2** — Vol 9_0–9_2 and Vol 10_3–10_5 are drafted in full (marked "reconstructed" above since no prior body existed to revise).
- **16.3** — All previously abbreviated volumes (Series 6_2–6_7, all of Series 7 and 8, Vol 9_3–9_5, Vol 10_1–10_2) are expanded to full form.
- **16.4** — ADR-001 terminology ("Business Event Layer") is applied throughout Series 1, 2, and 4.
- **16.5** — The PCB contract is standardised in Vol 3_1 and referenced consistently elsewhere.
- **16.6** — Engine boundaries (PRE, KRCE, BIE, FIE, CAE, BKEE, AI Orchestration) are stated consistently per Vol 2_0.
- **16.7** — Series 1–10 remain technology-neutral by design; Series 11 — Implementation Foundations (Vol 11_0, 11_1) now provides the concrete technology and schema decisions that freeze action 16.7 deferred, scoped to Phase 1.

## 7. Realism Pass (New — Second Revision)

Following user review, the set was audited for buildability, not just internal consistency, against Vol 0_1's Phase 1/2/3 model. Headline findings, each corrected in its source volume(s) and summarised in Vol 0_1, Section 3:

1. **Offline-first overstated AI capability** — corrected in Vol 1_0, 1_3, 4_4, 5_0, 5_1, 7_4. AI interpretation/advisory requires connectivity in Phase 1; only capture and viewing are truly offline.
2. **Knowledge Factory overbuilt for one team** — corrected in Vol 3_0, 3_1. Phase 1 PKA is an internal versioned file bundle, not signed/distributed packages.
3. **Four-agent AI model overbuilt for MVP** — corrected in Vol 5_0, 5_2. Phase 1 is one orchestrated pipeline with the same logical boundaries.
4. **BKEE overbuilt for MVP data volume** — corrected in Vol 4_2. Phase 1 uses explicit heuristics, not a general validation engine.
5. **Series 9 (Developer & Extension) and Series 10 (Enterprise & Future Vision)** are confirmed Phase 3 in full — no volume in either series is part of the initial build (Vol 9_0, Vol 10_0 flagged accordingly).
6. **Concrete gaps filled**: BIE confidence thresholds (Vol 2_2), capture failure handling (Vol 7_1), sync conflict default policy (Vol 4_4), and a full Phase 1 data schema (Vol 11_1) — previously abstract statements now have actionable specifics.

## 8. Known Items Still Open

- **Industry PKA composition model** (record Section 14.6): Vol 10_2 defines Industry Finance PKAs as *extension packages composed with the base Finance PKA*, not standalone replacements. This resolves the ambiguity but remains subject to Knowledge Factory ratification, and is Phase 3 regardless.
- **Commercial/legal ownership language** (record Section 14.5): all volumes in this set describe governance and technical ownership only; commercial licensing terms are explicitly out of scope and flagged wherever the topic arises.
- **Phase 2 sync conflict policy**: a default (last-confirmed-write-wins, surfaced not silently resolved) was proposed in Vol 4_4, Section 6; ADR-002 (Vol 4_0_0) now adopts it as a firm decision and Vol 12_1 gives the full entity-by-entity design, pending actual implementation and validation once live multi-device sync is built.
- **Web platform**: Series 12 (Vol 12_0, Vol 12_1) is a proposed design for a web client and the live mobile-web data synchronisation it requires — not yet implemented, not yet approved to build. Read Vol 12_1 before treating any Phase 1 volume's "backup, not live sync" statements (Vol 4_4, Vol 8_4) as still the whole picture once web work begins.
- **Phase 2 (Web & Sync) sprint plan drafted**: `docs/sprint-plan/Phase_2_Web_And_Sync/` (Sprints 13-20, plus `Checklist_Master.md`) turns Series 12 into a sequenced execution plan, mirroring the Phase 1 sprint plan's format. Planning only — build does not start until the owner gives explicit go-ahead, and Sprint 13 itself opens with a design sign-off checkpoint before any schema work ships.
- **Single active-device write lock (ADR-003)**: only one registered device may write at a time; switching requires the newly-active device to sync first, and every other device is stalled read-only. This is the current sync model for Series 12 — see Vol 12_1 Section 5a-8.
- **Primary device forced takeover (ADR-004)**: one owner-designated device can always reclaim active status unconditionally; amended 2026-08-31 to show a lightweight single-tap confirmation rather than none — see Vol 12_1 Section 5a.4, 6a.5.

---

*End of Master Documentation Index.*
