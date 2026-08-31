# AIFA — MVP & Phased Delivery Roadmap
## Volume 0_1 — Version 2.0 (Realism & Scope Pass)

**Status:** Complete
**Purpose:** This volume exists because Vol 0_0–10_5 describe AIFA's *full target architecture*, and a 62-volume enterprise-governance model is not what gets built in a first sprint. This document is the bridge between that target state and a buildable, honest MVP. It is the required reading before any sprint plan is derived from this documentation set.

---

## 1. Why This Volume Exists

The Version 2.0 architecture set is internally consistent, but internal consistency is not the same as buildability. Read end to end, it describes: a governed knowledge-manufacturing organisation (Knowledge Factory), a signed multi-package runtime, four separately-governed AI agents, a formal knowledge-evolution engine, a sandboxed third-party extension marketplace, and multi-tenant enterprise deployment — before a single business owner has recorded a single receipt.

None of that is wrong as a *destination*. Most of it is wrong as a *starting point*. This volume draws the line.

## 2. Phase Definitions

| Phase | Definition | Rough Horizon |
|---|---|---|
| **Phase 1 — MVP** | The smallest system that delivers the core promise ("One Input. AI Does the Rest.") for a single business owner, honestly and safely, and can be validated with real users | First build |
| **Phase 2 — Growth** | Features that matter once Phase 1 has real usage: richer domains, local AI, formal knowledge evolution, team access | Post-validation |
| **Phase 3 — Platform** | Features that only matter once AIFA has scale: extension marketplace, multi-tenant enterprise, industry PKA composition, ecosystem participation | Post-product-market-fit |

A volume being Phase 2 or 3 does not mean it was wrong to design now — it means building it now would be building for a scale problem you don't have yet, at the cost of not shipping the thing that proves you need it.

## 3. Headline Realism Corrections

These are the changes that actually alter claims made earlier in the set, not just scope deferrals. Each is also applied as an edit to its source volume(s).

### 3.1 "Offline-first" overstated AI capability

**The problem:** Vol 1_0, 1_3, 4_4, 5_0/5_1, and 7_4 implied that AI *reasoning* — bookkeeping interpretation and CFO-level advisory — works fully offline via a local model. This is not realistic in Phase 1. On-device models small enough to run acceptably on a mid-range phone cannot reliably do governed financial classification and advisory reasoning at the quality bar this product needs; that requires a capable cloud model.

**The correction:** Offline-first now means *capture and record-keeping* are fully offline (the owner can always log a Business Event, take a photo, view their existing dashboard and Financial Data — Vol 4_0 data is always available locally). AI interpretation and advisory reasoning require connectivity in Phase 1; when offline, captured events queue with a clear "will process when back online" state rather than silently pretending to have understood them. Local-model-based classification (not full advisory reasoning) is a legitimate Phase 2 goal once a specific accuracy bar is validated against cloud results.

**Volumes corrected:** Vol 1_0, Vol 1_3, Vol 4_4, Vol 5_0, Vol 5_1, Vol 7_4.

### 3.2 Knowledge Factory overbuilt for one team

**The problem:** Series 3 describes Knowledge Factory as if it were an external, independently governed organisation shipping signed packages through a formal supply chain. For an MVP built by one team, this is the same team wearing two hats, and the "signing infrastructure, multi-package resolution, rollback" model is solving a distribution problem that doesn't exist yet.

**The correction:** In Phase 1, the "Finance PKA" is an internal, version-controlled bundle of rules, prompts, and templates (plain files in the app's repo, reviewed like code) maintained by the same team building AIFA. The *architectural boundary* still matters and is kept (application code must not hardcode accounting judgement inline with unrelated business logic — it stays in the governed bundle) but the ceremony (cryptographic signing, independent distribution service, multi-package composition) is deferred until there is a real second consumer or a real external content team to govern against.

**Volumes corrected:** Vol 3_0, Vol 3_1 (notes added; Vol 8_5 and Series 10 remain explicitly Phase 2/3 as already scoped).

### 3.3 Four-agent model overbuilt for MVP

**The problem:** Vol 5_2 formalises Bookkeeping, Financial Analysis, CFO Advisory, and Retrieval as four separately governed "Professional Intelligence Agents." That's a reasonable production shape; it is not what you build first. Building four coordinated agents before you know if a single well-prompted pipeline gets you 80% of the value is premature decomposition.

**The correction:** Phase 1 implements this as **one orchestrated AI pipeline** with role-scoped prompting (a single call chain: classify → record → analyse → advise) that produces the same outputs the architecture describes, without the coordination and validation overhead of four independent agents. The boundaries in Vol 5_2 (what each responsibility must and must not do) still hold as *logical* boundaries inside that pipeline. Splitting into genuinely separate agents is a Phase 2 refactor, motivated by real scaling or reliability needs, not a Phase 1 requirement.

**Volumes corrected:** Vol 5_2.

### 3.4 Business Knowledge Evolution Engine overbuilt for MVP

**The problem:** Vol 4_2 describes BKEE as a formal pattern-validation engine. At MVP scale (one business, low event volume), that's more machinery than the problem needs.

**The correction:** Phase 1 BKEE is a small set of explicit heuristics (e.g., "same vendor confirmed the same category 3 times in a row → remember the mapping") implemented directly, not a general-purpose validation engine. The *governance rule* — nothing becomes permanent Business Knowledge without repeated confirmation — is unchanged and enforced from day one; only the sophistication of "how a pattern earns trust" is simplified.

**Volumes corrected:** Vol 4_2.

## 4. Full Volume Phase Map

### Series 0 — Master & Roadmap
| Volume | Phase |
|---|---|
| 0_0 Master Documentation Index | Phase 1 (living reference) |
| 0_1 MVP & Phased Delivery Roadmap (this volume) | Phase 1 (living reference) |

### Series 1 — Product Foundation
| Volume | Phase | Note |
|---|---|---|
| 1_0 Product Vision | Phase 1 | Corrected per 3.1 |
| 1_1 Business Architecture | Phase 1 | |
| 1_2 User Experience Architecture | Phase 1 | |
| 1_3 Technology Architecture | Phase 1 | Corrected per 3.1 |
| 1_4 AI-First Design Principles | Phase 1 | |

### Series 2 — Core Architecture
| Volume | Phase | Note |
|---|---|---|
| 2_0 AIFA System Architecture | Phase 1 | Read as the single-pipeline shape per 3.3 |
| 2_1 PKA Runtime Engine | Phase 1 (simplified) | No signing/rollback machinery yet — see 3.2 |
| 2_2 Bookkeeping Intelligence Engine | Phase 1 | Confidence thresholds added, see Section 5 |
| 2_3 Financial Intelligence Engine | Phase 1 | Reduced KPI set for launch — see Section 6 |
| 2_4 AI CFO Assistant Engine | Phase 1 | Reduced recommendation set for launch |

### Series 3 — Finance PKA
| Volume | Phase | Note |
|---|---|---|
| 3_0 Finance PKA Architecture | Phase 1 (simplified) | Internal config bundle, not signed packages — see 3.2 |
| 3_1 Knowledge Retrieval & Context Engine | Phase 1 (simplified) | Retrieval logic yes; formal PCB governance ceremony light |

### Series 4 — Data Architecture
| Volume | Phase | Note |
|---|---|---|
| 4_0_0 ADR Register | Phase 1 (living reference) | |
| 4_0 Business Data Architecture | Phase 1 | Concrete schema in Vol 11_1 |
| 4_1 Financial Data Architecture | Phase 1 | Concrete schema in Vol 11_1 |
| 4_2 Business Knowledge Store | Phase 1 (simplified) | Heuristics not engine — see 3.4 |
| 4_3 Runtime Memory | Phase 1 | |
| 4_4 Local-First Storage & Sync | Phase 1 | Corrected per 3.1; single-device sync only in Phase 1, multi-device in Phase 2 |

### Series 5 — AI Platform Architecture
| Volume | Phase | Note |
|---|---|---|
| 5_0 AI Platform Architecture | Phase 1 | Corrected per 3.1 |
| 5_1 AI Runtime Architecture | Phase 1 (cloud-only) | Local model execution is Phase 2 |
| 5_2 AI Agent Architecture | Phase 1 (simplified) | Single pipeline, not 4 agents — see 3.3 |
| 5_3 AI Context Management | Phase 1 | Core traceability required from day one |
| 5_4 AI Learning & Feedback | Phase 2 | Basic confirm/correct capture is Phase 1; the routing framework is Phase 2 |

### Series 6 — Business Operations Architecture
| Volume | Phase | Note |
|---|---|---|
| 6_0 Business Operations Architecture | Phase 1 | |
| 6_1 Sales Operations | Phase 1 | Launch domain |
| 6_2 Purchase Operations | Phase 1 | Launch domain |
| 6_3 Expense Operations | Phase 1 | Launch domain — primary MVP wedge |
| 6_4 Banking Operations | Phase 1 | Manual entry Phase 1; bank feed integration Phase 2 |
| 6_5 Inventory Operations | Phase 2 | Not needed for a service-based SME pilot |
| 6_6 Asset Operations | Phase 2 | Low event frequency; can be a manual expense category initially |
| 6_7 Payroll Operations | Phase 2 | High compliance risk; needs dedicated validation before launch |
| 6_8 Project Operations | Phase 2 | Cross-cutting tag layer — valuable once core domains are proven |
| 6_9 Tax Operations | Phase 2 (informational only) | Liability tracking yes; filing support later, with legal review |

### Series 7 — Mobile Application Architecture
| Volume | Phase | Note |
|---|---|---|
| 7_0 Mobile Application Architecture | Phase 1 | |
| 7_1 Business Event Capture | Phase 1 | OCR fallback added, see Section 7 |
| 7_2 AI Workspace | Phase 1 | |
| 7_3 Mobile Dashboard | Phase 1 | |
| 7_4 Offline & Sync Experience | Phase 1 | Corrected per 3.1 |
| 7_5 Notification & AI Recommendation | Phase 1 (basic) | Rich prioritisation logic is Phase 2 |
| 7_6 Document & Receipt Experience | Phase 1 | |
| 7_7 Settings & Business Configuration | Phase 1 (basic) | Autonomy levels and team access are Phase 2 |

### Series 8 — Platform Services Architecture
| Volume | Phase | Note |
|---|---|---|
| 8_0 Platform Services Architecture | Phase 1 | |
| 8_1 Identity & Access Management | Phase 1 (single-user) | Team roles are Phase 2 |
| 8_2 Security & Data Protection | Phase 1 | Non-negotiable from day one |
| 8_3 Integration & API | Phase 2 | No third-party integrations at MVP launch |
| 8_4 Synchronisation & Cloud Services | Phase 1 (backup only) | Multi-device sync is Phase 2 |
| 8_5 Finance PKA Distribution & Update | Phase 2 | App-store-bundled updates suffice for Phase 1 — see 3.2 |
| 8_6 Observability & Diagnostics | Phase 1 (minimal) | Basic crash/error logging only; full dashboard is Phase 2 |

### Series 9 — Developer & Extension Architecture
| Volume | Phase | Note |
|---|---|---|
| 9_0–9_7 (all) | **Phase 3** | No third-party developers exist yet; this entire series is deferred until there is external demand to build against |

### Series 10 — Enterprise & Future Vision
| Volume | Phase | Note |
|---|---|---|
| 10_0–10_5 (all) | **Phase 3** | Enterprise, multi-tenant, and ecosystem concerns are explicitly post-PMF |

### Series 11 — Implementation Foundations (new)
| Volume | Phase | Note |
|---|---|---|
| 11_0 Technology Stack Decisions | Phase 1 | Required input to sprint planning |
| 11_1 MVP Data Schema | Phase 1 | Required input to sprint planning |

## 5. Bookkeeping Confidence Thresholds (fills a gap in Vol 2_2)

Phase 1 ships with concrete, not abstract, thresholds:

| Confidence | Behaviour |
|---|---|
| ≥ 90% | Auto-record; shown in the activity feed, editable after the fact |
| 60–89% | Recorded as a draft; owner sees a one-tap confirm/correct prompt before it counts in reports |
| < 60% | Not recorded; owner is asked a specific clarifying question (e.g., "Is this an expense or a purchase for resale?") |

These thresholds are a starting configuration, expected to be tuned against real usage data — they are not derived from a formal model at launch.

## 6. Reduced Launch Scope for Financial Intelligence / CFO Guidance

Vol 2_3 and 2_4 describe a broad analytical and advisory surface. Phase 1 ships with a deliberately small, high-confidence set:

- Cash position (today's balance, computed from recorded events)
- Money in / money out trend (rolling 30/90 day)
- Overdue receivables list
- Upcoming payables list
- One prioritised "thing to look at" surfaced per day, at most

Ratio libraries, valuation models, and multi-period comparative analysis (Vol 2_3, Section 3) are Phase 2 — they need enough historical data per business to be meaningful anyway.

## 7. Capture Failure Handling (fills a gap in Vol 7_1)

| Failure | Phase 1 Behaviour |
|---|---|
| OCR/vision extraction fails entirely | Owner is shown the photo and a blank quick-entry form — never a fabricated guess |
| OCR partially succeeds (e.g., amount unreadable) | Pre-fill what was read; highlight the missing field for manual entry |
| Voice transcription fails or is ambiguous | Fall back to text input with what was heard shown for correction |
| No connectivity during capture | Event is stored locally with a "queued" state; owner can keep capturing; nothing is lost |

## 8. What "Solid & Realistic" Means for This Set Going Forward

1. Every Phase 1 volume must describe something a small team can actually build and test with real business owners within a normal sprint cadence.
2. Every Phase 2/3 volume remains valid *design intent* — it is not deleted, because rebuilding this thinking later would cost more than maintaining it now — but it is explicitly out of the sprint-planning conversation until its phase arrives.
3. Any future revision that blurs a Phase 1 volume back toward its full-architecture ambition should be treated as a scope-creep risk, not a quality improvement, unless justified by real usage evidence.

## 9. Relationships to Other Volumes

- Vol 0_0 (Master Documentation Index) now references this volume as required pre-reading.
- Vol 11_0/11_1 (Implementation Foundations) turn Phase 1 volumes into concrete, buildable specifications.
- This volume is the direct input to the sprint plan and checklist that follow this documentation pass.

---

*End of Volume 0_1.*
