# AIFA — MVP Data Schema
## Volume 11_1 — Series 11: Implementation Foundations — Version 2.0

**Status:** Complete
**Applies:** Vol 0_1 (MVP & Phased Delivery Roadmap), Vol 11_0 (Technology Stack Decisions)

---

## 1. Purpose

This volume gives field-level schema for the four Phase 1 data structures referenced abstractly across Series 4: Business Event, Business Data, Financial Data, and the Professional Context Bundle. This is the concrete artefact sprint planning and engineering tickets should reference instead of re-deriving structure from prose.

## 2. Business Event (Vol 4_0)

```text
BusinessEvent
├── id                  string, unique, format "BE-YYYYMMDD-NNNN"
├── business_id         string, foreign key
├── captured_at         timestamp
├── capture_mode        enum: voice | text | photo | document | manual
├── raw_input_ref       string, pointer to stored raw input (audio/image/text/file)
├── status              enum: queued | processing | needs_clarification | draft | confirmed | superseded
├── superseded_by       string, nullable, id of a correcting event
└── domain_hint         enum: sale | purchase | expense | banking | unclassified
```

**Sprint 3 addition:** `draft` was added to the status enum. The Vol 2_2 §4.1 confidence routing needs three distinct non-final states — `processing` (AI call in flight), `draft` (60-89% confidence, recorded but awaiting a one-tap owner confirm/correct), and `needs_clarification` (<60%, no draft recorded, owner asked a specific question) — and the original enum only had room for two. In SQLite this required a table-rebuild migration (CHECK constraints can't be altered in place); see `app/src/db/migrations.ts` migration 3 for the mechanics.

Immutable once `status = confirmed`. Corrections create a new event with `superseded_by` pointing forward; the original is never edited or deleted (Vol 4_0, Section 7). BusinessData rows are made immutable transitively: the AI pipeline always finalises BusinessData (category_guess, confidence) and posts LedgerEntry rows *before* setting the parent BusinessEvent to `confirmed` — the DB trigger only guards `business_events`, so this statement ordering is what actually protects `business_data` from drifting after confirmation (see `app/src/ai/expensePipeline.ts`, `finalizeExpenseCategory`).

**Sprint 4 addition:** setting `superseded_by` on an already-confirmed event is itself a write to an "immutable" row, which the Sprint 3 trigger did not account for — it blocked every field, including the one this section's own correction model requires. Migration 4 (`app/src/db/migrations.ts`) replaces the trigger with one that permits exactly this single transition (`superseded_by` NULL → a value, nothing else different) and still rejects everything else, including a second supersede of the same row.

## 3. Business Data (Vol 4_0)

```text
BusinessData
├── id                  string, unique
├── business_event_id   string, foreign key → BusinessEvent
├── type                enum: sale | purchase | expense | bank_transaction
├── counterparty_name   string, nullable
├── amount              decimal
├── currency             string, ISO 4217 code
├── payment_method      enum: cash | bank_transfer | card | other | unspecified
├── category_guess      string, nullable — Bookkeeping Intelligence Engine's proposed category
├── confidence          decimal, 0.00–1.00 (see Vol 0_1, Section 5 for thresholds)
├── document_refs        array of document IDs (Section 5)
└── created_at          timestamp
```

## 4. Financial Data (Vol 4_1) — Phase 1 Minimal Form

Phase 1 does not need a full general ledger engine; it needs a correct, auditable record of money movement per account bucket.

```text
LedgerEntry
├── id                  string, unique
├── business_data_id    string, foreign key → BusinessData
├── account             string, from a fixed Phase 1 chart-of-accounts subset (Section 4.1)
├── direction            enum: debit | credit
├── amount              decimal
├── currency             string
├── posted_at           timestamp
└── reversal_of         string, nullable, id of the entry this reverses (corrections only)
```

### 4.1 Phase 1 Chart-of-Accounts Subset

A deliberately small starter set, expanded only as real usage demands it:

```text
Cash / Bank
Accounts Receivable
Accounts Payable
Sales Revenue
Cost of Goods Sold (if applicable)
Operating Expenses (with owner-visible sub-categories: e.g. Supplies, Rent, Utilities, Marketing, Other)
Owner's Equity / Drawings
```

## 5. Document

```text
Document
├── id                  string, unique
├── business_event_id   string, foreign key
├── file_ref            string, pointer to encrypted local/backed-up file
├── type                enum: receipt | invoice | statement | other
├── extraction_status   enum: not_attempted | partial | complete | failed
└── created_at          timestamp
```

## 6. Professional Context Bundle (Vol 3_1) — Phase 1 Minimal Form

The full PCB contract in Vol 3_1 Section 4 remains the target shape; Phase 1 implements a reduced but honest subset — every field below is still required, just simpler in content:

```text
PCB (Phase 1)
├── user_intent          short structured description of the current task
├── relevant_rules       the specific Finance PKA rule(s) matched for this task (by ID)
├── business_context     the specific BusinessData/Document fields relevant to this task only
├── financial_context     the specific LedgerEntry balances relevant to this task only
├── source_references     BusinessEvent id(s) underlying this task
├── pka_version           version string of the Finance PKA bundle in use
└── limitations           plain-text statement of what this bundle does not cover
```

Governance metadata, security classification, and token-budget enforcement (full Vol 3_1 contract) remain required — they are cheap to implement and directly support the explainability principle (Vol 1_4, Section 5); nothing here is skipped for being hard, only for being premature (e.g., multi-package source attribution, which doesn't apply until Series 10's industry PKAs exist).

**Sprint 10 correction:** the code implementation had actually omitted "security classification" from this diagram's field list entirely until this sprint's security audit caught it (Vol 8_2 Section 6) — `ProfessionalContextBundle` (`app/src/ai/types.ts`) now includes `sensitivity_classification: "standard" | "high"`, populated as `"standard"` everywhere in Phase 1 (no high-sensitivity domain is wired into capture yet). This diagram's field list above is now accurate to the actual PCB shape; it was aspirational, not implemented, before Sprint 10.

## 7. Business Knowledge Store — Phase 1 Minimal Form

```text
BusinessKnowledgeEntry
├── id                   string, unique
├── business_id          string
├── pattern_type         enum: vendor_category_mapping | customer_payment_behaviour | other
├── key                  string (e.g., vendor name)
├── value                string (e.g., category)
├── confirmation_count   integer
└── confirmed_at         timestamp, last confirmation
```

Promoted to "trusted" (used to raise BIE confidence, Vol 0_1 Section 5) once `confirmation_count >= 3`, per the Phase 1 heuristic in Vol 0_1 Section 3.4.

## 8. AI Interpretation Record — Phase 1 (Sprint 3 addition)

Not originally named as a schema in this volume, but required to make two Sprint 3 Definition of Done items concrete: every AI decision must have a traceable source_reference persisted, and cost-per-event must be measured and logged. This is the persistence layer for the explainability principle (Vol 5_3) as it applies to the Expense pipeline.

```text
AiInterpretation
├── id                     string, unique
├── business_event_id      string, foreign key → BusinessEvent
├── business_data_id       string, foreign key → BusinessData
├── requested_at           timestamp
├── model                  string, the specific model/provider that produced this result
├── decision               enum: auto_record | draft_confirm | clarify
├── category               string, nullable — null when decision = clarify
├── confidence             decimal, 0.00-1.00
├── reasoning              string, the model's stated reasoning
├── clarifying_question    string, nullable — populated only when decision = clarify
├── matched_rule_ids       array of Finance PKA rule IDs (Section 6's relevant_rules, persisted)
├── source_references      array of BusinessEvent ids (Section 6's source_references, persisted)
├── pka_version             string
├── latency_ms              integer
└── estimated_cost_usd      decimal, nullable — null when the provider doesn't return token usage (e.g. the Phase 1 local placeholder provider)
```

One row is written per AI classification call, regardless of which band it routes to — this is what makes the "why" view possible later (Vol 5_3; the UI itself is Sprint 11).

## 9. Relationships to Other Volumes

- Vol 4_0/4_1/4_2/3_1 are the architecture-level descriptions this volume makes concrete.
- Vol 11_0 (Technology Stack Decisions) defines the database this schema runs on.
- Vol 0_1 (MVP & Phased Delivery Roadmap) Section 5 supplies the confidence thresholds referenced in Section 3 above.

---

*End of Volume 11_1.*
