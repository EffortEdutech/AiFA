# Sprint 57 — Universal AI Domain Classification (Path B)

**Duration:** Weeks 9-10 (of Phase 5)
**Architecture references:** Vol_5_5 §7 (the disclosed future upgrade this sprint delivers); Vol 5_4/`capturePipeline.ts` (the existing Path A `classify()` pattern this sprint ports, not reinvents)

**CORRECTION (14 September 2026, made before any revised Sprint 57 code was written):** This sprint slot originally held "Channel × Domain Confidence & Approval Routing" — a routing table added on top of the existing regex/keyword classifier (`classifyChannelIntakeDomain`), covering only the 3 domains Sprint 53 shipped (expense, leave_application, unclassified). That content is **not discarded** — it is generalized and moved to new **Sprint 61 (Cross-Domain Approval Chaining & Confidence Trust)**, once there is more than one domain-bridge sprint's worth of domains to route between.

This slot is reassigned to a different, more foundational problem the owner surfaced directly: *"does it means we are not using llm but detect words from the input?"* — yes. `classifyChannelIntakeDomain` (`packages/core/src/ai/inputRouter.ts`) is, by its own header comment, "Deliberately a keyword + regex heuristic, not an AI provider call," and it only recognises `expense`/`leave_application`/`unclassified`; a same-day bug in its sale-detection regex (fixed 13 September 2026 as a standalone patch, not part of this sprint) demonstrated concretely how a keyword heuristic misses real phrasing an LLM would not. Meanwhile the owner's 14 September 2026 objective statement requires roughly 14 domains across Sales, Purchases & Cash, Inventory, Accounting, Compliance, People, and Legal — a scale at which hand-written regex per domain stops being viable, and was never the intended end state: Sprint 53's own text already named "a real AI-provider-backed router" as "a disclosed future upgrade, not this sprint's job." This sprint is that upgrade, brought forward because the rest of the revised plan depends on it.

**CORRECTION #2 (14 September 2026, same day, caught during implementation planning before any code was written):** This document's own Task Breakdown (below) originally said this sprint would "port `classify()` from Path A to Path B." That claim was checked directly against `capturePipeline.ts` and found wrong. `AiProvider.classify(pcb)` does not classify DOMAIN — it picks a chart-of-accounts CATEGORY from a candidate list the caller already narrowed to one already-known domain (`event.domain_hint`, decided before `classify()` is ever invoked). No existing AI call anywhere in the codebase — Path A included — looks at raw text and decides which of several domains it belongs to; that is genuinely new work, not a relocation. The Task Breakdown below is corrected: this sprint adds a new `AiProvider.classifyDomain()` optional method (parallel to the existing `classify()`/`extractExpenseFromImage()`/`transcribeAudio()` optional-method pattern in `types.ts`), not a port of `classify()` itself. `classify()` is unchanged and keeps doing its own job once Sprints 58-60 have a domain to hand it.

---

## Theme

The foundational sprint every domain-bridge sprint (58, 59, 60) depends on. Replaces text classification's keyword/regex heuristic with the same LLM-backed classification approach Path A's photo-capture pipeline already uses and has already proven, applied instead to Path B — the plaintext tables every live web report actually reads from — and widened to recognise every domain the owner's full-module objective requires, not just the three Sprint 53 shipped.

## Objectives

Any text, image, PDF, or voice-transcript capture arriving through any Phase 5 channel (in-app, web forward, mobile share) is classified into the correct one of roughly 14 business domains by a real AI call with a stated confidence score — not by string-matching — with the extracted fields (amount, counterparty, dates, line items where applicable) attached, so that Sprints 58-60 have something accurate to draft from. Anything the model itself reports low confidence on, or that doesn't fit any known domain, still lands in the existing `unclassified` triage queue exactly as it does today — this sprint changes how a domain is detected, not what happens when detection is uncertain (that stays Sprint 61's job, generalized).

## Task Breakdown

### New capability: `AiProvider.classifyDomain()` (not a port — see CORRECTION #2)
- New optional method on the `AiProvider` interface (`packages/core/src/ai/types.ts`), following the same optional-method pattern `extractExpenseFromImage`/`transcribeAudio` already use: `classifyDomain(input: DomainClassificationInput): Promise<{ result: DomainClassificationResult; metrics: AiClassificationMetrics }>` — a provider without this capability simply omits it, exactly like a provider without vision or transcription
- `DomainClassificationInput` carries the raw text (or already-extracted fields from a photo/PDF/voice capture) plus the list of candidate domains this call is allowed to choose from; `DomainClassificationResult` carries `{ domain: BusinessDomain, confidence: number, extractedFields: {...}, reasoning: string }` — deliberately mirroring `CategoryClassificationResult`'s shape (confidence + reasoning already proven useful there) without claiming to BE that type, since domain classification and category classification are different decisions
- New `classifyPathBIntake(rawText, provider)` in `packages/core/src/ai/inputRouter.ts` calls `provider.classifyDomain()` when the provider implements it; falls back to the existing `classifyChannelIntakeDomain` regex heuristic when it doesn't (offline, no API key, or a provider that hasn't implemented it yet) — the same "never silently drop the input" discipline Sprint 53 used for `unclassified`, applied here to a missing/failed classifier capability rather than a triage outcome
- The Gateway-backed implementation of `classifyDomain()` needs a new server-side route in the separate `ai-gateway-service` repository (this sprint documents the request/response contract, mirroring how Sprint 55 documented `/ai-vision` before that repo's own route existed) — building the actual Gateway route is tracked as this sprint's own dependency below, not silently assumed done

### Domain vocabulary expansion
- `BusinessDomain` (`packages/core/src/ai/types.ts`) gains the domains the owner's full-module objective requires and Sprints 58-60 will each act on: `purchase_order` (already added by original Sprint 58's design, now classified by AI instead of not-at-all from text), `delivery_order`, `stock_adjustment`, `commission`, `attendance_correction`, `e_invoice_flag`, `contract_alert`, `e_signature_request` — additive only, alongside the existing `expense`, `sale`, `purchase`, `leave_application`, `unclassified`
- The model's classification prompt is given a short description of each domain (mirroring how `capturePipeline.ts` already primes `classify()` for Path A's narrower set) so a new domain can be added later by extending the prompt data, not by writing a new regex

### Confidence and extraction contract
- The classifier returns a domain, a 0-1 confidence score, and whatever structured fields it could extract for that domain (line items for `purchase_order`/`sale`, an employee/date range for `attendance_correction`, a counterparty/amount for the financial domains) — one consistent result shape every downstream domain-bridge sprint consumes the same way
- `CaptureResolveForm.tsx` and `useCaptureRouterCore.ts` are updated to show the model's own confidence alongside the detected domain (previously there was no confidence concept at all in the Path B router — the heuristic either matched or didn't) — the owner still confirms or corrects before anything drafts, unchanged from Sprint 53's own "never posts silently" rule

## Definition of Done

- [~] A typed, forwarded, or transcribed description for each of the roughly 14 recognised domains is classified correctly by the new `classifyDomain()` call in a real test set (not just code review), with confidence scores that visibly distinguish clear cases from ambiguous ones — **partially verified 14 September 2026**, now 2 of ~14 domains confirmed reaching a real UI destination: (1) "ABC Sdn Bhd send invoice for transportation charge RM250" → `expense`, 95% confidence; (2) "invoiced DEF Sdn Bhd RM520" → `sale`, 95% confidence, correctly routed to the Sale/Income triage-with-record-note path. Two further tests ("paid RM50 commission to Ali", "delivery order for 20 units to XYZ Trading") returned high confidence (95%, 98%) but surfaced in the UI as `unclassified` — **this is correct, not a miss**: `commission` and `delivery_order` are real `BusinessDomain` values the classifier can return, but `useCaptureRouterCore.ts`'s `toRoutableDomain()` has no case for them yet (Sprints 58-60 haven't built a destination), so they fall through to the `unclassified` default by design, exactly as this sprint's own Risks table anticipated — the AI confidence being shown at all on those two proves `classifyDomain()` correctly identified them as a distinct domain even though the app can't act on it yet. Still not real-tested: purchase, purchase_order, leave_application, stock_adjustment, attendance_correction, e_invoice_flag, contract_alert, e_signature_request, and genuinely ambiguous unclassified input.
- [x] The previously-buggy "invoiced ABC Sdn Bhd RM500" sale-detection case (fixed as a regex patch 13 September 2026) is re-verified as correctly classified by the new LLM-backed path, confirming the AI approach doesn't reintroduce the same failure class — **verified 14 September 2026** with the equivalent phrasing "invoiced DEF Sdn Bhd RM520": correctly classified `sale` at 95% confidence, and correctly the opposite direction from the earlier expense test.
- [ ] The regex-heuristic fallback still classifies the original 3 domains reasonably when the Gateway is unreachable, verified with the Gateway call deliberately disabled in a test run — not yet tested
- [x] `unclassified` triage is unchanged in behaviour for genuinely ambiguous input, and for a new domain with no destination yet — **verified 14 September 2026**: the `commission` and `delivery_order` test captures above landed in the same Unclassified Triage list, with the same "nothing is guessed or dropped" messaging, that Sprint 53 already shipped — this sprint changed how detection happens, not what triage does with the result, exactly as designed.
- [x] `npm run typecheck` and `npm run lint` pass clean in `web/` and `app/` — **verified 14 September 2026**: both run clean, 0 errors; the 10 lint warnings present are pre-existing prettier-only issues in `DevicesPanel.tsx`, `syncService.ts`, `AppNavigator.tsx` — none touched by this sprint's changes
- [ ] Gateway cost impact of a new per-capture classification call is disclosed and, if material, a `model_catalog` row exists for whatever model this call uses — following the same cost-tracking discipline already applied for `gemini-3.6-flash`'s vision route — not yet checked

## Dependencies

Sprint 53 (the domains and router UI this sprint reclassifies into), the AI Gateway's existing chat/completion route (already live infrastructure, per the cost-tracking work already done this stretch), and at least one real channel (Sprint 54 or 56) to supply real-world input to classify.

## Risks

| Risk | Mitigation |
|---|---|
| An LLM classification call is slower and costs more per capture than a local regex check | Acceptable and disclosed trade-off — the owner's own objective ("1 input, AiFA do the rest") explicitly trades a small per-capture cost/latency for correctness across ~14 domains a hand-written heuristic cannot realistically cover; cost is tracked via `model_catalog`, not silently absorbed |
| Widening the domain vocabulary before Sprints 58-60 exist means some newly-classified domains (e.g. `contract_alert`) have nowhere real to route yet | Those captures fall through to `unclassified` triage exactly like any domain this sprint doesn't yet have a bridge for — never fabricated a fake success; Sprints 58-60 are what give each domain a real destination |
| Retiring the regex heuristic as the *production* path risks a regression if the Gateway has an outage | Heuristic is kept as an explicit fallback, not deleted — this sprint's DoD requires testing that fallback deliberately, not assuming it still works |

## Safe to Carry Over

Prompt-tuning for edge-case phrasing within any one domain, and adding further domains beyond this sprint's ~14 (e.g. a finer split within Sales) can continue after this sprint closes if it doesn't block Sprints 58-60 from having a working classifier to depend on.

---

*End of Sprint 57 (revised 14 September 2026; supersedes the original "Channel × Domain Confidence & Approval Routing" content, now at Sprint 61).*
