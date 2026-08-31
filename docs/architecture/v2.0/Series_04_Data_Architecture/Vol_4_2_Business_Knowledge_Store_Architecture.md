# AIFA — Business Knowledge Store Architecture
## Volume 4_2 — Series 4: Data Architecture — Version 2.0

**Status:** Complete — target design; Phase 1 implements BKEE as simple heuristics, not a formal engine (see Section 3.1)
**Incorporates:** Business Knowledge Evolution Engine (BKEE) responsibilities
**Realism correction applied:** Yes — see Vol 0_1, Section 3.4

---

## 1. Purpose

This volume defines the Business Knowledge Store — persistent, organisation-specific knowledge accumulated through AIFA usage — and the Business Knowledge Evolution Engine (BKEE) that governs how it grows.

## 2. What Business Knowledge Is (and Is Not)

Business Knowledge is organisation-specific: customer payment patterns, supplier behaviour, seasonal trends, internal preferences, and operational decisions this particular business has demonstrated over time. It is owned by the business, not by Knowledge Factory, and it is never written into the shared Finance PKA (Vol 3_0, Section 6).

| Knowledge Domain | Meaning | Owner / Governor |
|---|---|---|
| Finance PKA | Governed professional financial intelligence | Knowledge Factory |
| Business Knowledge | Organisation-specific accumulated knowledge | The business |
| Business Data | Operational facts and records | The business |
| Financial Data | Accounting representation derived from Business Events | The business |
| Runtime Memory | Temporary task and conversation context | AIFA runtime |

## 3. Business Knowledge Evolution Engine (BKEE)

The BKEE is the governance layer that decides what graduates from observed pattern to stored Business Knowledge. It answers: *what has this organisation learned?*

```text
Repeated Business Events / outcomes / owner feedback
        ↓
BKEE pattern detection and validation
        ↓
Business Knowledge Store (persistent)
```

Nothing enters the Business Knowledge Store automatically from a single observation; the BKEE requires a validated pattern (sufficient repetition, confirmed outcome, or explicit owner confirmation) before persisting knowledge, preventing noisy or one-off events from polluting long-term memory.

### 3.1 Phase 1 Reality

At MVP scale, a general-purpose pattern-validation engine is more machinery than the data volume justifies. Phase 1 implements BKEE as a small, explicit set of heuristics rather than a configurable engine — concretely, the rule in Vol 11_1 Section 7: a vendor-to-category mapping is promoted to trusted Business Knowledge once it has been confirmed three times in a row (`confirmation_count >= 3`). The *governance rule* — nothing persists on a single unconfirmed observation — is non-negotiable from day one and unchanged by this simplification; only the sophistication of "how a pattern earns trust" is reduced. A configurable, general-purpose validation engine is a Phase 2 evolution once more pattern types (beyond vendor-category mapping) are needed.

## 4. Example Business Knowledge Entries

- "This supplier is reliably paid net-30 without issue."
- "Q4 typically sees a 20% sales increase for this business."
- "This customer has disputed two invoices in the past six months."

## 5. Relationship to Runtime Memory

Business Knowledge is persistent and survives across sessions; Runtime Memory (Vol 4_3) is temporary and expires. The BKEE is the only path by which something observed in Runtime Memory can become permanent Business Knowledge, and only after validation.

## 6. Use by Other Engines

- The AI CFO Assistant Engine (Vol 2_4) draws on Business Knowledge to make recommendations feel informed by this specific business's history.
- The Bookkeeping Intelligence Engine (Vol 2_2) uses Business Knowledge (e.g., "this vendor is always classified as Office Supplies") to increase classification confidence.
- KRCE (Vol 3_1) includes relevant Business Knowledge as part of the "Business context" field of the PCB.

## 7. Governance and Portability

Business Knowledge is owned by the business and must be portable: exportable, deletable, and not entangled with the Finance PKA's governed content. This preserves the boundary in Vol 3_0 Section 6 and avoids the ownership ambiguity flagged in Vol 4_0_0 Section 5.

## 8. Sprint 8 Concrete Implementation

The Section 3.1 heuristic is implemented exactly as scoped — one pattern type, `vendor_category_mapping` — in `app/src/db/businessKnowledgeRepository.ts` (migration 7, `business_knowledge_entries`). `customer_payment_behaviour` and `other` (Section 4's other example entries) exist in the schema's CHECK constraint per Vol 11_1 §7 but have no producing code; nothing writes them yet, consistent with "just this one heuristic, implemented directly."

The governance rule in Section 3 ("nothing enters ... from a single observation") is enforced by WHICH call sites are allowed to write here, not by a runtime validation layer: `recordVendorCategoryConfirmation` is only ever called from `confirmCategory` and `correctConfirmedCapture` in `app/src/ai/capturePipeline.ts` — both represent explicit owner certainty (confidence 1.0), never an AI guess the owner didn't act on. Concretely, an `auto_record` decision the owner never touched does NOT call this function, even though it is itself high-confidence — high AI confidence is not "explicit owner confirmation." "Sufficient repetition" (Section 3) is implemented as `TRUSTED_CONFIRMATION_THRESHOLD = 3` CONSECUTIVE confirmations of the same value for a given vendor; a differing confirmation resets the streak to 1 under the new value rather than accumulating toward the old one or averaging the two — a mapping cannot become "trusted" by mixing agreement and disagreement.

Use by Other Engines (Section 6): the Bookkeeping Intelligence Engine example ("this vendor is always classified as Office Supplies") is implemented in `classifyAndRoute` (Vol 2_2 §4.2) as a confidence booster, not a category override — see that section for why agreement with the AI's own guess is required before the trust is applied. The AI CFO Assistant Engine and KRCE uses described in Section 6 (recommendations informed by history, PCB business_context inclusion) are not yet built — Phase 1's CFO Guidance (Vol 2_4 §7) and Workspace PCB (Vol 7_2 §5) do not read from Business Knowledge at all yet, a gap carried forward.

Portability (Section 7): export/delete tooling for this table is not built in Phase 1 — the governance principle is upheld structurally (a separate table from the PKA bundle, owned per business_id) but no UI or API exposes it yet; that is Sprint 10's data-rights scope.

## 9. Relationships to Other Volumes

- Vol 0_1 (MVP & Phased Delivery Roadmap) Section 3.4 is the authority for the Phase 1 simplification in Section 3.1.
- Vol 11_1 (MVP Data Schema) Section 7 is the concrete Phase 1 schema and threshold for BKEE.
- Vol 4_0_0 (ADR Register) Section 5 resolves the earlier BKA terminology confusion this volume supersedes.
- Vol 3_0 (Finance PKA Architecture) is the governed counterpart this store must never merge with.
- Vol 4_3 (Runtime Memory Architecture) is the temporary layer BKEE promotes validated patterns from.
- Vol 5_4 (AI Learning & Feedback Architecture) details how owner feedback feeds BKEE validation.
- Vol 2_2 (Bookkeeping Intelligence Engine) Section 4.2 is where the trusted mapping is consumed as a confidence booster.

---

*End of Volume 4_2.*
