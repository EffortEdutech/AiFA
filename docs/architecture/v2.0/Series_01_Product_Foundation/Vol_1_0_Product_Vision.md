# AIFA — Product Vision
## Volume 1_0 — Series 1: Product Foundation — Version 2.0

**Status:** Complete
**Applies ADR-001:** Yes (Business Event Layer terminology)
**Realism correction applied:** Yes — see Vol 0_1, Section 3.1 (offline scope)

---

## 1. Purpose

This volume defines why AIFA exists, who it serves, and the permanent product principles that all later architecture must honour.

## 2. The Core Promise

> **AIFA — AI Financial Assistant. One Input. AI Does the Rest.**

A business owner provides a single natural input describing something that happened in the business — voice, text, a receipt photo, an invoice image, a PDF, a bank notification, a WhatsApp message, an email, or an imported transaction. AIFA interprets that input, produces professional double-entry accounting records internally, updates the business's records, and returns plain-language financial guidance. The owner never has to think in debits, credits, journals, ledgers, trial balances, or chart-of-account codes.

## 3. Target Market

AIFA targets **all Small and Medium Enterprises**. The platform core is industry-neutral; industry-specific professional intelligence is added through governed Finance PKA extensions (see Vol 10_2), not by hard-coding industry logic into the app.

## 4. Product Philosophy

AIFA is **AI-first**, not a bookkeeping application with AI bolted on. The AI is the primary interaction layer: the owner talks to AIFA the way they would talk to a competent bookkeeper or junior CFO, and the structured accounting machinery operates underneath, invisibly.

## 5. What the Owner Sees vs. What AIFA Maintains

| Owner-facing concepts | Internally maintained records |
|---|---|
| Money in / money out | Journals |
| Customers, suppliers | Debits and credits |
| Invoices, payments | Ledgers |
| Cash position | Trial balance |
| Profit | Financial statements |
| Obligations owed/owing | Audit trail |

Full double-entry bookkeeping runs internally at all times; it is simply never surfaced as the primary interaction.

## 6. The AI's Role

AIFA acts as a **CFO assistant operating within the scope of governed Knowledge Assets** (see Series 3). This boundary exists specifically to prevent sideways reasoning and hallucination: when information is incomplete, or a question falls outside the governed professional scope, AIFA asks for clarification or states plainly that it cannot give a reliable answer, rather than guessing.

## 7. Platform Direction

- Mobile-first, Android and iOS, with tablet support
- Web dashboard as a later addition, not the initial platform
- Offline-first **capture and record-keeping**: the owner can always log a Business Event and view existing data with no connection
- Local encrypted storage as the primary data home
- Encrypted cloud backup
- Cloud AI **required** for interpretation and advisory reasoning in Phase 1 (queued and processed once connectivity returns if offline); local-model reasoning is a Phase 2 goal, not a Phase 1 claim (see Vol 4_4, Vol 5_1, and Vol 0_1 Section 3.1)
- A defined growth path into enterprise deployments (Series 10, Phase 3)

## 8. Operational Truth (ADR-001)

Per Architecture Decision Record ADR-001 (Vol 4_0_0), **Business Events are the canonical source of truth** for everything AIFA does. The owner's single input becomes a Business Event; every downstream artefact — Business Data, Financial Data, Business Knowledge, reports, dashboards, and AI CFO guidance — is derived from that event. The product promise "One Input. AI Does the Rest." is, architecturally, the statement that one Business Event is sufficient to drive the entire chain in Section 9 below.

## 9. End-to-End Flow

```text
Owner describes a Business Event (voice, text, photo, PDF, message)
        ↓
Business Event Layer captures and timestamps the event
        ↓
Bookkeeping Intelligence Engine interprets and records it
        ↓
Financial Data (journals, ledgers, statements) updates
        ↓
Financial Intelligence Engine analyses the impact
        ↓
AI CFO Assistant Engine explains it and recommends next steps
```

## 10. Product Name

The working name is fixed as **AIFA — AI Financial Assistant**. A commercial/brand name may be chosen separately later; this does not affect the architecture.

## 11. Relationships to Other Volumes

- Vol 1_1 (Business Architecture) operationalises this vision into business capabilities.
- Vol 1_4 (AI-First Design Principles) expands Section 6 into concrete design rules.
- Vol 4_0_0 (ADR Register) holds ADR-001, referenced in Section 8.
- Vol 6_0 (Business Operations Architecture) shows Section 9's flow applied per operational domain.

---

*End of Volume 1_0.*
