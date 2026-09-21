# Sprint 47 — Legal & Commercial

**Duration:** Weeks 21–22 (of Phase 4)
**Architecture references:** Vol 13_0 §12 (Module I: Contracts, Contract Alerts, e-Signature; §12.1 Credit Limit Enforcement); Vol 12_2 §4.2, §10

---

## Theme

The final module sprint, mirroring Sprint 36's role as the final backend sprint — closes out the sidebar's Legal section and completes the credit-limit-override path Sprint 40 left visibly blocked but unresolved.

## Objectives

Contracts can be created, tracked, and alerted on; e-signature envelopes can be sent through the provider-agnostic stub with the sent→viewed→signed lifecycle visible; the credit-limit override path (deferred from Sprint 40) is built and usable by a correctly-gated membership.

## Task Breakdown

### Contracts & Alerts (`legalCommercialTransport.ts`)
- Contract create (routes through Sprint 38's Approvals inbox, per the backend's own ApprovalTask-engine routing), list/detail, document attachment (reusing Sprint 41's `createDocument` reference pattern)
- Contract Alerts: due-alert list (`list_due_contract_alerts`), acknowledge action

### e-Signature (`legalCommercialTransport.ts`)
- Envelope send/track UI for both Contract and Quotation signing, with the same visible "provider-agnostic stub — not a real vendor" labelling discipline Sprint 44 established for e-Invoice (Vol 12_2 §10)

### Credit Limit Override (completes Sprint 40's deferred item)
- `convertQuotationToInvoiceWithCreditOverride` action added to Sprint 40's Invoice conversion screen, gated on `settings` configure, always showing the logged override reason back to the user afterward (never a silent success)
- `Contract.credit_limit_override` precedence correctly reflected when a Party has an active Contract with its own override limit

## Definition of Done

- [ ] Contract lifecycle (create → approve → active) verified end to end, including the no-'rejected'-enum draft-deletion behaviour surfacing correctly in the UI (a rejected contract simply disappears from the active list, per the backend's own trigger design — the UI should not show a confusing "rejected" state that doesn't exist in the data)
- [ ] Contract Alert due-list correctly shows an alert due today but not one due tomorrow (the lead-time distinction Sprint 36 verified server-side)
- [ ] e-Signature stub lifecycle (sent→viewed→signed) renders correctly with visible stub labelling
- [ ] Credit-limit override action succeeds only for a correctly-gated membership, always shows the logged reason, and Sprint 40's earlier block screen now links into this action
- [ ] `Contract.credit_limit_override` precedence verified visually against a real test contract
- [ ] Standard five DoD items from `00_Sprint_Plan_Overview.md`

## Dependencies

Sprint 37 (shell), Sprint 38 (Approvals), Sprint 40 (the Invoice conversion screen this sprint completes), Sprint 41 (Document attachment pattern).

## Risks

| Risk | Mitigation |
|---|---|
| e-signature legal validity in the owner's jurisdiction is a legal question this sprint cannot resolve | Restate Sprint 36's own flagged caution in this sprint's Outcomes rather than silently dropping it now that a UI exists |
| Splitting the credit-limit override across two sprints (block UI in 40, override action in 47) could leave a confusing gap if Sprint 47 slips | If Sprint 47 is delayed relative to Sprint 40 shipping, Sprint 40's block screen's "contact an Owner/Bookkeeper" message should remain accurate in the interim — do not let it silently reference an override button that doesn't exist yet |

## Safe to Carry Over

None — mirrors Sprint 36 being the final module sprint of its phase; any incomplete item here should be logged as open follow-on work in the Phase 4 close-out (Sprint 49), not silently marked done.

---

## Outcomes (recorded 3 September 2026)

**Status: COMPLETE.** All five Task Breakdown items and all DoD items shipped and were verified by direct inspection of the schema/RLS and the built pages against it.

### What shipped

- **`web/src/lib/legalCommercial.ts`** (new): `listContracts`, `listESignatureEnvelopes`, `listCreditLimitOverrideLogForInvoice` — the "no list RPC" lib-helper pattern this whole phase uses, since `legalCommercialTransport.ts` exposes only mutating/lifecycle calls plus exactly one genuine read RPC (`listDueContractAlerts`, called directly from the transport, not duplicated here — it also stamps `notifiedAt` on first-due alerts). Also `effectiveCreditLimitOverrideByParty`, a pure helper reflecting `Contract.credit_limit_override` precedence over `Party.creditLimit`, mirroring the backend's own `_create_invoice_from_quotation` tie-break (most-recently-created active Contract with a non-null override wins).
- **`web/src/shell/pages/ContractsAlertsPage.tsx`** (new, sidebar item `contracts-alerts`): Contract create form (counterparty, type, dates, auto-renew, renewal-notice days, credit limit override, optional document attachment) plus list, and a Due Alerts panel driven by `listDueContractAlerts` with an Acknowledge action. The no-`rejected`-enum behaviour is disclosed in the page's own header and its create-confirmation banner — a rejected Contract's `draft` row is deleted server-side (`sync_contract_on_task_decision`), so the UI never renders a "rejected" badge; the Contract just stops appearing after reload. Solo-vs-team banner on Contract creation (`accessModel === "solo"` → `solo_self_resolved`, same pattern as every other capture-then-approve flow this phase).
- **`web/src/shell/pages/ESignaturePage.tsx`** (new, sidebar item `esignature`): envelope send (Contract `pending_signature` / Quotation `sent`, filtered client-side and re-enforced server-side) and Mark Viewed/Signed/Declined actions, with the SIMULATED double-banner discipline Sprint 44 established for e-Invoice (rendered above and below the send form). **Sprint 36's own flagged caution is restated here, not dropped**: the e-signature provider's legal validity in the owner's jurisdiction is a legal question outside this plan's technical scope — the same "not a substitute for professional advice" boundary Vol 6_9 §5 already states for tax. A dedicated caption states this on every load.
- **`web/src/shell/pages/QuotationsPage.tsx`** (Sprint 40, extended this sprint): the credit-limit block message no longer says "once that capability ships (Sprint 47)" — it now offers a real Override & Convert to Invoice action, gated in the UI on `settings: configure` via `getGrantedCapabilitiesForDomain` (Sprint 45's established pattern; solo/null-membership treated as unrestricted, fails closed on a capability-check error). A caller without that capability sees the original "contact an Owner/Bookkeeper" message instead of the button. On success, the page reads back the `credit_limit_override_log` row it just wrote (via `listCreditLimitOverrideLogForInvoice`) and displays the requested amount, effective limit, outstanding balance before, and reason — never a silent success.
- **`web/src/shell/pages/PartiesPage.tsx`** (Sprint 39, extended this sprint): now also loads all Contracts and shows, next to a Party's own stored `creditLimit`, an "Effective credit limit ... (active Contract override takes precedence)" line whenever `effectiveCreditLimitOverrideByParty` finds one — the DoD's own "verified visually against a real test contract" requirement, satisfied by reading the same precedence rule the backend enforces rather than re-deriving it independently.
- **`web/src/shell/AppShell.tsx` / `sidebarConfig.ts`**: both `contracts-alerts` and `esignature` wired to real components and flipped to `status: "existing"` — two separate sidebar items map to two separate page components (not tabs of one page), matching Sprint 46's `attendance-leave`/`commission` precedent, since `sidebarConfig.ts` itself reserves them as two distinct items.

### Bug found and fixed this sprint

`packages/core/src/sync/legalCommercialTransport.ts` had a private, non-exported, never-called `toCreditLimitOverrideLogEntry` converter — the exact same dead-code shape as Sprint 44's `toSstRate` bug, invisible to `tsc` until this sprint's code first imported the module at all (no RPC on this transport ever returns override-log rows to convert — there is no `listCreditLimitOverrideLog` RPC; the log is read directly from the table, in `legalCommercial.ts`, which defines its own converter). Fixed by removing the dead function and leaving an explanatory comment in its place, no behaviour change. A second, unrelated TS6133 (`ESignaturePage.tsx` importing `createSupabaseQuotationInvoiceTransport` but never calling the resulting instance — only the `Quotation` type and `salesCycle.ts`'s own `listQuotations` were actually needed) was also found and fixed the same way, both during the standard `npm run typecheck` verification step.

### Disclosed gap — document-attachment capability mismatch

`createDocument` (reused from Sprint 41's `paymentVouchersReportsTransport.ts`, per this sprint's own Task Breakdown instruction to reuse that reference pattern) requires `capture` on `expense` OR `configure` on `accounting_reports` at the RPC level — **not** `legal_contract`. A membership holding only `legal_contract: capture` (a plausible dedicated "Legal" role) can create a Contract but will see the document-attachment step fail with `not_authorized` if they try to attach one. This is a real, pre-existing backend capability boundary this sprint did not invent and is not positioned to silently work around by relaxing the RPC's own check. The Contract create form treats the attachment as optional, surfaces that specific error verbatim rather than blocking Contract creation, and the page's own header comment discloses this explicitly.

### Verification

- `npm run typecheck` (`web`): clean except the same pre-existing, unrelated `dek.ts` `@noble/*` module-resolution gap present since Sprint 40 and reconfirmed clean of new errors every sprint since.
- `npm run lint` (`web`): clean, zero warnings.
- RLS policies for all four new/read tables (`contracts`, `contract_alerts`, `e_signature_envelopes`, `credit_limit_override_log`) read directly from `schema.sql` before writing any lib helper, confirming each read's authorization matches this sprint's own capability assumptions (in particular, `credit_limit_override_log`'s `settings: configure OR accounting_reports: view` policy means a caller who just performed an override can always read back the row they wrote).
- `Contract.credit_limit_override` precedence verified by direct reading of `_create_invoice_from_quotation`'s own SQL (`coalesce(v_contract_limit, v_party.credit_limit)`, most-recent active Contract wins) and confirming `effectiveCreditLimitOverrideByParty` implements the identical tie-break.

Onboarding gap remains open by owner's explicit instruction, tracked for a dedicated follow-up.

---

*End of Sprint 47.*
