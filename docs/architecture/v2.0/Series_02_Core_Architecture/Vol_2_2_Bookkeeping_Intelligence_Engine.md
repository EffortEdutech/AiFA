# AIFA — Bookkeeping Intelligence Engine
## Volume 2_2 — Series 2: Core Architecture — Version 2.0

**Status:** Complete
**Applies ADR-001:** Yes (Business Event Layer terminology)
**Concrete thresholds added:** Yes — see Section 4.1

---

## 1. Purpose

This volume defines the Bookkeeping Intelligence Engine (BIE) — the component that answers "what accounting happened?" by turning a Business Event into compliant double-entry accounting records.

## 2. Position in the Flow (ADR-001 applied)

```text
Business Event Layer
        ↓
Business Data (structured operational representation)
        ↓
Bookkeeping Intelligence Engine
        ↓
Journal
        ↓
Ledger
        ↓
Financial Statements
```

The BIE consumes Business Data — the structured form of a Business Event — never the raw owner input directly; interpretation of raw input into structured data happens in the Business Event Layer (Vol 4_0, Vol 7_1).

## 3. Responsibilities

| Responsibility | Description |
|---|---|
| Classification | Determine the accounting nature of a Business Event (e.g., expense, sale, transfer) |
| Rule application | Apply Finance PKA accounting rules (via KRCE-supplied PCB) to the event |
| Entry generation | Produce a proposed double-entry journal entry |
| Chart-of-account mapping | Map the event to the correct accounts without exposing account codes to the owner |
| Validation | Check the proposed entry against double-entry balance and governed rules before posting |
| Audit trail | Preserve a traceable link from journal entry back to the originating Business Event |

## 4. Confidence and Review

Every BIE-generated entry carries a confidence level. Low-confidence entries are routed to the owner (or reviewing accountant) for confirmation before posting, per the UX trust principles in Vol 1_2. High-confidence, rule-clear entries may post automatically, subject to the business's configured autonomy settings (Vol 7_7).

### 4.1 Phase 1 Thresholds (concrete)

Abstract "confidence levels" are not enough to build against. Phase 1 ships with the following starting configuration (Vol 0_1, Section 5):

| Confidence | Behaviour |
|---|---|
| ≥ 90% | Auto-recorded; appears in the activity feed immediately, remains editable |
| 60–89% | Recorded as a draft; owner sees a one-tap confirm/correct prompt before it counts toward reports or the dashboard |
| < 60% | Not recorded as a draft; owner is asked a specific clarifying question instead (e.g., "Is this an expense, or inventory for resale?") |

These numbers are a starting point, expected to be tuned against real confirm/correct rates once the app has usage data — they are not derived from a formal statistical model at launch, and should be treated as a config value, not a hardcoded constant.

### 4.2 Sprint 8 Concrete Implementation — Business Knowledge Confidence Boost

Section 5's "prior similar events from Business Knowledge Store" input is implemented as a single, narrow rule in `app/src/ai/capturePipeline.ts`'s `classifyAndRoute`: when the counterparty on a capture has a trusted vendor-category mapping (Vol 4_2 §3.1, `confirmation_count >= 3`) AND the AI provider's own independently-returned category agrees with that mapping, confidence is raised to a fixed floor (`TRUSTED_MAPPING_CONFIDENCE_FLOOR = 0.95`) — high enough to reliably cross the auto_record_min threshold in 4.1 without being indistinguishable from actual owner certainty (which is recorded as exactly 1.0).

This is deliberately an agreement-required boost, not an override: when the trusted mapping and the AI's guess disagree, or when the AI recognises no category at all, nothing from Business Knowledge is applied and the AI's own (unboosted) confidence routes as normal per 4.1. An earlier, simpler design — let a trusted mapping decide the category outright once trusted, without requiring AI agreement — was rejected specifically because it would let a stale or wrong historical pattern silently override a materially different transaction from the same vendor, which is the concrete form Section 6's "never invent accounting treatment outside what the PCB supports" boundary takes here: Business Knowledge reinforces a treatment the model itself proposed, it does not supply one the model didn't.

## 5. Inputs and Outputs

**Inputs:** Business Data record, relevant Professional Context Bundle (accounting rules, chart-of-account mapping guidance, prior similar events from Business Knowledge Store).

**Outputs:** Proposed or posted journal entry; updated ledger balances; an audit-trail record linking the entry to its Business Event.

## 6. Non-Negotiable Boundaries

- The BIE never invents accounting treatment outside what the PCB supports; unsupported cases are flagged for clarification, not guessed.
- Every posted entry must balance (debits = credits) before acceptance.
- No entry exists without a traceable parent Business Event.

## 7. Relationships to Other Volumes

- Vol 0_1 (MVP & Phased Delivery Roadmap) Section 5 is the authority for the thresholds in Section 4.1.
- Vol 4_0 (Business Data Architecture) defines the BIE's primary input.
- Vol 4_1 (Financial Data Architecture) defines the BIE's primary output.
- Vol 3_1 (KRCE) supplies the PCB the BIE reasons over.
- Vol 6_0–6_9 (Business Operations Architecture) show domain-specific BIE behaviour.
- Vol 4_2 (Business Knowledge Store Architecture) Section 3.1/8 is the source of the confidence booster in Section 4.2.

---

*End of Volume 2_2.*
