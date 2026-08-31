# Sprint 6 — Sales & Purchase Domains

**Duration:** Weeks 11–12
**Architecture references:** Vol 6_1 (Sales Operations), Vol 6_2 (Purchase Operations)

---

## Theme

The pipeline built in Sprints 3–5 was deliberately proven on one domain (Expense) first. This sprint replicates it across Sales and Purchase — the point where the architecture's "shared engine, domain-scoped rules" design (Vol 6_0 §4) either pays off or reveals hidden Expense-specific assumptions that need fixing.

## Objectives

An owner can capture a sale (invoice issued, payment received) or a purchase (order, bill received) through the same capture flow, correctly classified and recorded, with receivables and payables reflected on the dashboard.

## Task Breakdown

### Finance PKA Content Expansion
- Extend `accounting_rules.json` (Vol 3_0 §4.1) with Sales and Purchase domain rules per Vol 6_1 §4 and Vol 6_2 §4
- Add domain-specific event types: Invoice Issued, Payment Received, Refund Issued (Sales); Purchase Order, Goods Received, Supplier Bill, Purchase Returned (Purchase)

### Pipeline Reuse Validation
- Run the Sprint 3 pipeline against Sales/Purchase events; fix any hardcoded Expense-only assumptions found in classification, PCB assembly, or ledger mapping
- Extend the Phase 1 chart-of-accounts subset if needed (Accounts Receivable, Accounts Payable, Sales Revenue are already listed in Vol 11_1 §4.1 — confirm they're wired correctly)

### Dashboard Extension
- Outstanding receivables list (Vol 6_1 §5, Vol 0_1 §6)
- Upcoming payables list (Vol 6_2 §5, Vol 0_1 §6)

### Capture UX
- Domain hint selection or inference at capture time (the `domain_hint` field from Vol 11_1 §2) so classification has a head start

## Definition of Done

- [ ] A captured sale correctly produces a receivable + revenue ledger entry (or cash + revenue, if paid immediately)
- [ ] A captured purchase correctly produces a payable + expense/inventory-placeholder ledger entry
- [ ] Receivables and payables lists on the dashboard match the underlying ledger exactly
- [ ] No Expense-only assumption from Sprints 3–5 silently miscategorises a Sales or Purchase event

## Dependencies

Sprints 3–5's full capture-to-ledger pipeline, now exercised across new domains rather than rebuilt.

## Risks

| Risk | Mitigation |
|---|---|
| Hidden Expense-specific logic breaks on Sales/Purchase | Budget real time in this sprint for exactly this kind of fix — it's expected, not a sign of prior sprints being wrong |
| Revenue recognition timing ambiguity (invoice vs. payment basis) | Pick one default (invoice basis is simplest for Phase 1) and document it as a PKA rule, not an inline app assumption |

## Safe to Carry Over

Refund and Purchase Return flows can be simplified to manual-only entry this sprint if time is tight, with full AI interpretation added once core Sales/Purchase are solid.

---

*End of Sprint 6.*
