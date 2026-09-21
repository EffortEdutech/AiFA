# Sprint 61 — Cross-Domain Approval Chaining & Confidence Trust

**Duration:** Weeks 17-18 (of Phase 5)
**Architecture references:** Vol_5_5 §8 (the channel × domain confidence table, generalized here from its original Sprint 57 form), §9 (the chaining rule, generalized here from Sprint 58's single PO proof)

**Origin note (14 September 2026):** This sprint did not exist under this number before the 14 September 2026 revision. Its content is not new invention — it is the original Sprint 57's "Channel × Domain Confidence & Approval Routing" scope, moved here unchanged in mechanism, plus a generalized form of Sprint 58's PO chaining rule, both widened to cover every domain Sprints 58-60 shipped instead of just the original 3-5 domains. This sprint is sequenced after 58-60 deliberately, so there is more than one domain-bridge sprint's worth of real behaviour to generalize from — generalizing a pattern from a single example (as the original Sprint 57 would have, sequenced right after just one or two channels) risks baking in accidental one-off assumptions.

---

## Theme

Closes the gap between "a domain-bridge sprint can draft into an existing module" (Sprints 58-60) and "the owner can trust what happens next, and approved work keeps moving without manual re-entry." Without this sprint, every domain would either always require full manual confirmation (safe but never reaches the owner's stated "AI does the rest") or use ad hoc, differently-tuned thresholds per sprint (inconsistent and hard to reason about). This sprint applies ONE routing table and ONE chaining mechanism across all of them.

## Objectives

A forwarded or captured item in any of the ~14 recognised domains starts at draft-confirm regardless of the AI's stated confidence, and only earns auto-record over time as the owner confirms enough of them correctly for that specific channel-domain pair — using the same trust-accumulation mechanism vendor-category confidence already uses (unchanged from the original Sprint 57 design). Separately, an approved draft in any domain that has a genuine "next step" (not only Purchase Orders) automatically re-enters the router as a new intake for that next step, the same way Sprint 58's PO → stock-receipt-pending → payment-due chain already proved.

## Task Breakdown

### Routing table (generalized from original Sprint 57, unchanged mechanism)
- Implement Vol_5_5 §8's channel × domain matrix as real routing logic in the Path B classifier path (Sprint 57's `classifyPathBIntake`): `channel` becomes a second input to the confidence-tier decision, alongside `domain` — now spanning all domains Sprints 58-60 shipped, not only expense/leave_application
- In-app photo capture's existing thresholds are unchanged (must not regress Sprint 6's tuned behaviour)
- Forwarded-channel items and Sprint 55's Path B media/voice extractions start at draft-confirm for every financial or record-altering domain (expense, purchase, sale, purchase_order, commission, attendance_correction, delivery_order, stock_adjustment) regardless of stated AI confidence; leave_application-style approval-routing domains go straight to `create_approval_task`, exactly as before
- **Explicit permanent exception, carried from Sprints 59 and 60:** attendance corrections, stock adjustments, e-Invoice/SST flags, contract alerts, and e-signature requests never earn a confidence-based auto-record shortcut, no matter how many correct confirmations accumulate — those sprints' own stated risk profile means every instance of these five domains always requires explicit approval

### Trust accumulation (generalized from original Sprint 57, unchanged mechanism)
- Extend `businessKnowledgeRepository.ts`'s existing trust-confirmation mechanism (currently vendor-category-scoped) to track confirmation history per channel-domain pair, across every eligible domain from the list above — not a new trust system, the same one generalized
- Auto-record threshold stays owner-visible per channel-domain pair (e.g. "WhatsApp sales: 12/15 confirmed correctly — 3 more until auto-draft-without-review-prompt"), unchanged in spirit from the original design — note "auto-draft" not "auto-post": even a trusted channel-domain pair still creates a draft for Sales/Purchases/People/Inventory domains, per those sprints' own approval requirement; trust only removes the extra "are you sure this was classified right" confirmation step, never the underlying approval gate for domains that require one

### Chaining generalization (new this sprint, extending Sprint 58's proof)
- Generalize Sprint 58's "approved step re-enters the router as a new intake" rule from its one hard-coded PO example into a small declarative chain table: `{domain: "purchase_order", nextStage: "stock_receipt_pending"}`, `{domain: "stock_receipt_pending", nextStage: "payment_due"}`, plus new chains this sprint adds where a real next step exists: `{domain: "sale" (drafted+approved), nextStage: "payment_expected"}` (an AR-ageing-visible expectation, not an auto-created Payment record — the owner still records the actual payment when received, exactly as `recordPayment` already requires an existing invoice)
- Domains with no genuine next step (commission, attendance_correction, e_invoice_flag, contract_alert, e_signature_request, stock_adjustment) simply have no chain entry — approval ends their lifecycle, which is correct and not a gap

## Definition of Done

- [x] A high-confidence AI extraction from a forwarded channel still lands as draft-confirm on its first uses, across at least three different domains (not only the one the original Sprint 57 tested) — true by construction: `channel_domain_trust` starts every channel-domain pair at `confirmation_count = 0`, and `get_channel_domain_trust_status` only reports `is_trusted = true` once that pair's count reaches `auto_record_threshold`; live-verified for `forwarded_web`/`sale` (Part A of the regression test) starting from a genuine zero row
- [x] After a defined number of owner-confirmed-correct forwarded items for a channel-domain pair, that pair earns reduced-friction handling — verified with a real repeated-confirmation test for at least two domains — **REVISED scope, see Close-out note**: live-tested for `forwarded_web`/`sale` (3 correct confirmations → `is_trusted = true`, one wrong confirmation → reset to 0) and for `forwarded_web`/`stock_adjustment` as the permanent-exception counter-case (count reaches 3 honestly, `is_trusted` stays false); "reduced-friction" is surfaced client-side in `CaptureResolveForm.tsx` as a visible "Trusted" message, not a skip of the underlying approval gate for domains that require one, per this sprint's own stated design
- [x] In-app photo capture's existing auto-record behaviour for a trusted vendor is unchanged (regression check) — true by construction, not just re-tested: `decideConfidenceTier` and the entire `channel_domain_trust` mechanism live only in Path B (`useCaptureRouterCore.ts`), and are never imported by or called from `capturePipeline.ts`/`businessKnowledgeRepository.ts` (Path A); Path A's own vendor-category trust mechanism is untouched by this sprint's migration or code
- [x] The five permanent-approval domains (attendance_correction, stock_adjustment, e_invoice_flag, contract_alert, e_signature_request) never earn auto-record regardless of confirmation count — verified as an explicit test, not an assumption — live-verified (regression-test Part A3): `stock_adjustment` reached `confirmation_count = 3` (the count itself accumulates honestly) while `is_trusted` stayed `false`, because the exclusion is hardcoded inside `get_channel_domain_trust_status` itself, not a client-side convention a different caller could bypass
- [x] The generalized chain table correctly advances at least the PO chain (regression against Sprint 58) and the new Sale → payment-expected chain — both live-verified end-to-end (regression-test Parts B and C): PO chain `purchase_order → stock_receipt_pending → payment_due → resolved` reproduced correctly under the new `chained_intakes`/`chain_definitions` mechanism; new `sale → payment_expected` chain verified including the partial-payment edge case (a partial payment leaves the expectation `pending`; the remaining payment resolves it, in step with `record_payment`'s own `recompute_invoice_balance` status change to `paid`)
- [x] `npm run typecheck` and `npm run lint` pass clean in `web/` and `app/` — confirmed clean by the owner (`tsc --noEmit` and `eslint . --ext .ts,.tsx` both ran with no errors; the TypeScript-version warning from `@typescript-eslint` is pre-existing tooling noise, not a Sprint 61 finding)

## Close-out note (16 September 2026)

Two premise mismatches were found and disclosed before any code was written, and
both were resolved with the owner's explicit go-ahead (same discipline Sprints
58-60 used):

1. **The chaining mechanism this sprint was meant to "generalize" never actually
   existed.** Sprint 58's own Close-out note disclosed that automatic
   intake-router re-chaining was replaced with explicit owner-triggered buttons
   (`confirm_purchase_order_receipt`, `mark_purchase_order_paid`) — there was no
   real auto-re-entry mechanism to generalize from. **Resolution:** this sprint
   builds the real thing: a small declarative `chain_definitions` table
   (`from_domain` → `next_domain`) plus a `chained_intakes` table that actually
   surfaces the next step for the owner to act on. This is a **declarative table
   + explicit hooks, not a fully generic trigger-watches-everything engine** — a
   deliberate scope decision, disclosed in the migration's own header: the WHEN
   to advance is still five explicit call sites
   (`sync_purchase_order_on_task_decision`, `confirm_purchase_order_receipt`,
   `mark_purchase_order_paid`, `_create_invoice_from_quotation`,
   `record_payment`), while only the WHAT-comes-next mapping is data-driven. A
   fully generic engine was judged out of scope for this sprint's own stated
   goal (prove the pattern generalizes past one example), not deferred silently.
2. **The trust-accumulation mechanism this sprint was meant to "extend" is
   Path A-only and architecturally unreachable from here.**
   `businessKnowledgeRepository.ts`'s existing vendor-category trust mechanism
   lives in local, end-to-end-encrypted SQLite (Path A) — the same
   architectural wall Sprint 53 first disclosed separates Path A from every
   Path B report/table. Extending it in place was not possible. **Resolution:**
   a new Path B-native table, `channel_domain_trust`, was built instead,
   mirroring the original mechanism's shape exactly (per-pair confirmation
   counter, reset-to-0 on a wrong classification, an owner-visible threshold)
   rather than inventing a different design. Path A's own mechanism is
   untouched — `decideConfidenceTier` (the only place `channel_domain_trust` is
   read from) is called only from `useCaptureRouterCore.ts` and is never
   reachable from `capturePipeline.ts`.

All four parts of the regression test (channel-domain trust + the five-domain
permanent exception; the PO chain regression; the new Sale → payment-expected
chain; the client-facing `list_chained_intakes`/`dismiss_chained_intake` RPCs)
were live-verified against the owner's real Supabase project via the SQL
Editor, using the same isolated-RPC-test methodology established in Sprints
58-60. One interesting behaviour surfaced live during testing, noted here as an
observation rather than a Sprint 61 bug: in this test business,
`approval_tasks` rows created via `create_purchase_order`/`create_quotation`
land with `status = 'approved'` immediately on INSERT even when
`p_auto_approved := false` was passed — a related-but-distinct wrinkle from the
already-disclosed `create_approval_task` auto-approve-INSERT-only gap tracked
since Sprint 58, worked around the same way Sprints 58-60's own tests did (a
manual `UPDATE ... SET status = 'approved'` to fire the relevant trigger
directly), and not otherwise investigated or fixed this sprint since it did not
block anything this sprint needed to prove.

Not yet done, carried forward (not blocking this sprint's own close, consistent
with Sprints 59-60's own carry-forward items): a live pass through the actual
Quick Capture UI exercising `decideConfidenceTier`/the "Trusted" message and the
`ChainedIntakesList` UI end-to-end, as opposed to the direct-RPC regression test
run this sprint (same category of carry-forward as Sprint 59's Delivery Order
and Sprint 60's e-Invoice-flag/Contract-alert live UI passes).

## Dependencies

Sprints 58, 59, 60 (at least one, to have real domains to route and chain — ideally all three, since this sprint's value is generalizing across them).

## Risks

| Risk | Mitigation |
|---|---|
| Defining "enough confirmations to trust a channel-domain pair" remains a product judgement call across many more pairs than the original Sprint 57 considered | Ship with a stated, owner-visible, adjustable starting threshold per pair rather than one global constant — consistent with Vol 5_4's existing feedback-driven design |
| A declarative chain table generalized from one example (PO) risks missing a real per-domain nuance the hard-coded version handled implicitly | Re-verify the PO chain explicitly as a regression test after generalizing, not just the new chains — the mitigation Sprint 58 itself flagged for this exact risk |
| Widening which domains can reach reduced-friction handling increases the blast radius of a classifier mistake compared to the original 3-domain scope | The five-domain permanent-approval exception list is the direct answer to this — the domains with the worst wrong-auto-action outcomes are excluded from ever gaining trust-based leniency, a stronger guarantee than the original Sprint 57 needed to make |

## Safe to Carry Over

A full owner-facing settings screen for reviewing/adjusting every channel-domain trust threshold individually (unchanged from the original Sprint 57's own deferral); additional chain steps beyond payment-expected for Sales (e.g. auto-suggesting a follow-up reminder) — can wait for Sprint 62's hardening pass or later if it doesn't block anything.

---

*End of Sprint 61 (new number, 14 September 2026; content is the original Sprint 57 confidence-routing design generalized, plus Sprint 58's chaining rule extended beyond PO).*
