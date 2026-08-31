# AIFA — User Experience Architecture
## Volume 1_2 — Series 1: Product Foundation — Version 2.0

**Status:** Complete

---

## 1. Purpose

This volume defines the experience principles that govern how "One Input. AI Does the Rest." feels to the business owner in daily use.

## 2. Scope

UX Architecture covers interaction design principles at the product-foundation level. Concrete mobile screens and flows are specified in Series 7 (Mobile Application Architecture); this volume sets the rules those screens must obey.

## 3. Experience Principles

1. **Single-input-first.** Every core workflow must be completable from one natural input; multi-step forms are a fallback, not the default.
2. **Zero accounting vocabulary.** No screen in the primary experience uses "debit," "credit," "journal," or "ledger." Business terms only: money in, money out, owed to us, owed by us.
3. **Explain, don't just record.** Every AI action is accompanied by a plain-language explanation of what happened and why, tied back to the originating Business Event.
4. **Always reviewable.** The owner (or their accountant) can always see, and if necessary correct, what AI recorded.
5. **Confidence-aware responses.** When AIFA is not confident in its interpretation of an event, it asks a clarifying question rather than silently guessing (carried from Vol 1_0 Section 6).
6. **Offline-safe.** Every core capture and view flow must work without connectivity (see Vol 7_4).

## 4. Interaction Modes

| Mode | Example |
|---|---|
| Voice | Owner speaks a transaction description |
| Text | Owner types a short note |
| Image capture | Photo of a receipt or invoice |
| Document import | PDF statement or invoice |
| Passive capture | Bank notification or forwarded email/WhatsApp message |
| Bulk import | Existing transaction export |

All modes converge on the same target: a single Business Event (see Vol 7_1).

## 5. Trust and Explainability Surface

The UX must always answer, in the owner's language: *what did you record, why, and where did that come from?* This traces every displayed figure back to a Business Event ID and (where applicable) the Finance PKA rule that governed its interpretation. This is a hard UX requirement, not a nice-to-have, because AIFA's advisory value depends on the owner trusting the numbers.

## 6. Advisory Presentation

CFO-level guidance (from the AI CFO Assistant Engine, Vol 2_4) is presented as short, prioritised, plain-language observations and suggestions — never as raw financial-statement dumps. Detailed statements remain available on demand for owners or accountants who want them.

## 7. Sprint 11 Concrete Implementation

Section 5's "what did you record, why, and where did that come from?" is built as `app/src/components/WhyButton.tsx`, a shared "Why?" drill-down wired onto every Business-Event-backed figure across the app (Dashboard's activity feed, outstanding invoices/bills, and notifications; Workspace's recommendation card and Q&A sources) — see Vol 5_3 Section 6 for the underlying data model. Section 5 is satisfied for the two genuine aggregate figures (cash position, money in/out trend) via a plain-language explanation sentence rather than a drill-down, since there is no single Business Event those two numbers trace back to.

This sprint's polish pass also re-affirmed Section 2's "zero accounting vocabulary" rule in a concrete way: the "why" drill-down for outstanding invoices/bills and ledger-backed activity items never surfaces "debit," "credit," "ledger," or "journal" — it shows the originating description, amount, AI's plain-language reasoning, and the Finance PKA rule id, satisfying the checklist item "why drill-down for ledger entries" entirely in Business Event language, since this app deliberately has no raw ledger-entry-level UI to begin with.

## 8. Sprint 12 Concrete Implementation

Section 1's "single-input-first" principle extends naturally to first-run setup: `app/src/components/OnboardingFlow.tsx` is deliberately a 3-step flow (welcome/explain → optional business name+industry → done), not a multi-screen wizard, and its business-profile step is optional by design — `onboardingValidation.ts`'s `canProceedFromProfileStep` gates whether the name gets saved, but never blocks the owner from moving on without one, matching Settings' own optionality for the same fields. The flow is gated on a device-level flag (`aifa_onboarding_complete` in SecureStore, `db/client.ts`) rather than a business-data row, since "has this device seen onboarding" has no `business_id` to key on before the very first launch.

## 9. Relationships to Other Volumes

- Vol 1_0 (Product Vision) Section 6 and 9 are the source of Sections 3 and 5 here.
- Vol 7_0–7_7 (Mobile Application Architecture) implement these principles as concrete screens and flows.
- Vol 5_3 (AI Context Management) supports Section 5's traceability requirement, and Section 6 there is the Sprint 11 data-model note for the drill-down this volume requires.

---

*End of Volume 1_2.*
