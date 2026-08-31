# AIFA — Finance Professional Knowledge Asset Architecture
## Volume 3_0 — Series 3: Finance Professional Knowledge Asset — Version 2.0

**Status:** Complete — target design; Phase 1 implements a simplified form (see Section 4.1)
**Realism correction applied:** Yes — see Vol 0_1, Section 3.2

---

## 1. Purpose

This volume defines the Finance PKA: what it is, what it contains, and the formal boundary between Knowledge Factory (manufacturer) and AIFA (runtime consumer). Sections 2–3 and 6–7 describe the target architecture and hold from day one. Section 4's full manufacturing/signing supply chain is the Phase 2+ target; Section 4.1 states what actually exists at Phase 1.

## 2. What a PKA Is — and Is Not

> A PKA is not a graph. A graph is one technology used inside a PKA. A PKA is a packaged body of professional intelligence.

A Finance PKA combines capabilities comparable to:

- A skill/instruction file — behaviour and role definition
- A knowledge graph — connected concepts and relationships
- A RAG knowledge base — searchable reference information
- An expert system — rules and decision logic
- Templates and workflows — repeatable execution patterns

## 3. Package Anatomy

```text
Finance PKA
├── role_definition.md        — behaviour, tone, scope of the professional role
├── finance_ontology.graph    — connected financial concepts and relationships
├── accounting_rules.json     — governed rules for classifying and recording events
├── KPI_library.json          — standard and industry KPI definitions
├── valuation_models/         — analytical and valuation formulae
├── report_templates/         — structured output templates
├── case_studies/             — worked examples for grounding reasoning
├── regulations/              — jurisdictional and compliance references
└── expert_knowledge/         — additional professional knowledge objects
```

## 4. Formal Supply Chain

```text
Professional Experts
        ↓
Knowledge Factory
        ↓
Governed Finance PKA Package (structured, versioned, validated, signed)
        ↓
AIFA PKA Runtime Engine
        ↓
Business Data + Business Context
        ↓
Knowledge Retrieval & Context Engine
        ↓
Professional Context Bundle
        ↓
AI Reasoning
        ↓
Bookkeeping, Analysis, Guidance, and User Experience
```

## 4.1 Phase 1 Reality

Knowledge Factory, as an independently governed organisation with signing infrastructure and a formal publication process, does not exist at Phase 1 — it is the same team building AIFA. Building that ceremony now would be solving a distribution problem AIFA doesn't have yet (Vol 0_1, Section 3.2).

What Phase 1 actually does, while preserving the *boundary* that matters:

- The Finance PKA's content (`role_definition.md`, `accounting_rules.json`, etc., per Section 3) exists as version-controlled files in the application repository, reviewed like code, not scattered inline through application logic.
- "Manufacturing" the PKA in Phase 1 means editing these files through a reviewed pull request — no signing, no independent distribution service, no rollback infrastructure (that is Vol 8_5, explicitly Phase 2).
- The non-negotiable boundary in Section 6 still holds in full: application code still must not embed ad hoc, unreviewed accounting judgement outside these governed files, and client business data still never gets written into them.
- This becomes the full Section 4 supply chain only when there is a real second consumer product or an external content team to govern against — not on a fixed timeline.

## 5. Responsibility Mapping

| Knowledge Factory Term | AIFA Term / Meaning |
|---|---|
| Professional Knowledge Asset / PKA Package | Finance PKA Package |
| Knowledge Object | Small governed knowledge unit inside the PKA |
| Knowledge Asset Component | Rule, workflow, template, formula, prompt, case, ontology slice |
| PKA Runtime boundary | AIFA PKA Runtime Engine (Vol 2_1) |
| Runtime data/context | Business records, transactions, documents, AI memory |
| KF output | Approved PKA package or PKA update |
| AIFA output | Bookkeeping, analysis, guidance, workflows, user experience |

## 6. Non-Negotiable Boundary

AIFA must not:

- Manufacture the Finance PKA
- Modify the published Finance PKA
- Treat the AI model as the source of professional knowledge
- Embed client data inside the shared Finance PKA
- Allow ungoverned prompts to replace professional intelligence
- Allow the AI to access the whole Finance PKA directly

## 7. Governance Metadata

Every PKA package carries governance metadata: version, publisher signature, validation status, effective date, and compatibility range. The PRE (Vol 2_1) checks this metadata before activation; KRCE (Vol 3_1) includes relevant governance metadata in every PCB it assembles, so the AI model always knows the provenance and authority level of the knowledge it is reasoning over. In Phase 1 (Section 4.1), "governance metadata" reduces to a simple version string tied to the reviewed file bundle; publisher signature and compatibility-range checks activate once Vol 8_5's distribution model is built.

## 8. Relationships to Other Volumes

- Vol 0_1 (MVP & Phased Delivery Roadmap) Section 3.2 is the authority for the Phase 1 simplification in Section 4.1.
- Vol 2_1 (PKA Runtime Engine) executes the package defined here.
- Vol 3_1 (KRCE) retrieves from this package and builds the PCB.
- Vol 8_5 (Finance PKA Distribution & Update Architecture, Phase 2) delivers and updates packages once this becomes a real distribution problem.
- Vol 10_2 (Industry Finance PKA Architecture, Phase 3) defines extension packages composed with this base package.

---

*End of Volume 3_0.*
