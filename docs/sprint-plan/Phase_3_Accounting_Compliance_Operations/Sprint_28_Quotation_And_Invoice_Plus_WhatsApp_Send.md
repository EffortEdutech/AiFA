# Sprint 28 — Quotation & Invoice + WhatsApp Send

**Duration:** Weeks 15–16 (of Phase 3)
**Architecture references:** Vol 13_0 §4 (Invois & Quotation), §4.1 (WhatsApp send)

---

## Theme

The first real module built on the full Sprint 21–27 foundation, and the first true end-to-end proof of the whole Series 13 design: AI drafts a quotation from a plain input, routes through the real (not synthetic) `ApprovalTask` engine, and — on approval — sends via WhatsApp per the mechanism the owner chose in Sprint 21.

## Objectives

An owner (or an appropriately-permissioned team member) can say "quote ABC Trading 10 units Product X, stokis price, 30 days credit," get an AI-drafted `Quotation`, approve it through the real engine, send it via WhatsApp, and convert it to an `Invoice` on acceptance.

## Task Breakdown

### Schema
- `public.quotations` / `public.quotation_lines`, `public.invoices` / `public.invoice_lines` per Vol 13_0 §4
- Domain-specific RLS policies (Sprint 23's pattern) for the `sales` domain

### AI Drafting
- Extend the existing capture pipeline (domain-parameterised per Vol 6_1 §6) to draft a `Quotation` with line items, resolving price via Sprint 27's `PRICE-001` rule and credit term via `Party.credit_terms_days`
- Wire capture through Sprint 25's role-gated capture check and `captured_by_membership_id` attribution

### Approval & Send
- Wire `Quotation` creation through the real `ApprovalTask` engine (`domain = sales`, `next_action = "send WhatsApp"`) — this is the sprint's core verification of Sprint 25's engine against real data, not synthetic
- Implement the owner's Sprint-21-chosen WhatsApp mechanism (Business Platform template send, or click-to-chat with generated PDF/link)
- Quotation → Invoice conversion on acceptance, correctly setting `Invoice.due_date` from `Party.credit_terms_days`, `Invoice.source_quotation_id`

## Definition of Done

- [ ] A full quotation drafted, approved (through the real engine, with role/SoD/delegation all exercised at least once), and sent via WhatsApp end to end
- [ ] Quotation → Invoice conversion correct, including due date
- [ ] Segregation-of-duties exclusion verified with two real distinct memberships (not synthetic), per this plan's exit criterion §5.2
- [ ] `e_invoice_status` field present on `Invoice` and defaulted to `not_applicable` (Sprint 33 wires it up later)

## Dependencies

Sprints 25, 26, 27 all complete.

## Risks

| Risk | Mitigation |
|---|---|
| WhatsApp Business Platform template approval (if that mechanism was chosen) takes longer than the sprint | Build against click-to-chat first as a working fallback if template approval isn't back in time; swap once approved, without blocking the rest of the sprint |
| First real exercise of the `ApprovalTask` engine surfaces a schema gap Sprint 25's synthetic tests missed | Expected and acceptable per Sprint 25's own risk note — log as an ad-hoc fix against Sprint 25's output, fix it here, don't treat it as scope failure |

## Safe to Carry Over

Refund/Cancel event types (Vol 6_1 §2, still not built even in Vol 13_0's design) remain out of scope for this sprint and this whole plan unless explicitly added later.

---

*End of Sprint 28.*
