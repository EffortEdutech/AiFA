# Sprint 44 — e-Invoice & SST Compliance

**Duration:** Weeks 15–16 (of Phase 4)
**Architecture references:** Vol 13_0 §9 (Module F: e-Invois & SST / LHDN & Kastam Compliance); Vol 12_2 §4.2, §10

---

## Theme

The compliance module built against Sprint 33's explicitly stubbed `StubMyInvoisClient` — this sprint's own central discipline is making sure the UI never overstates what is, and is not, actually verified against LHDN.

## Objectives

An Invoice's e-Invoice submission state machine and SST computation are visible and operable end to end against the stub, with every screen clearly labelling stub/simulated results as such.

## Task Breakdown

### e-Invoice & SST (`eInvoiceSstTransport.ts`)
- Submission state view (per Invoice), SST computation display
- A persistent, unmissable "Simulated — not connected to LHDN MyInvois" banner or badge on every screen this module renders, per the transport's own "do not wire this up as done" instruction (Vol 12_2 §10)
- Rejection-reason display path, tested against the stub's simulated rejection case

## Definition of Done

- [x] Submission state machine (sent/accepted/rejected states the stub produces) renders correctly
- [x] SST computation displays correctly for a real test invoice
- [x] The stub/simulated labelling is present on every screen in this module, verified as a specific check, not assumed
- [x] Standard five DoD items from `00_Sprint_Plan_Overview.md`

## Dependencies

Sprint 37 (shell), Sprint 40 (Invoices this module attaches to).

## Risks

| Risk | Mitigation |
|---|---|
| Once this screen exists and looks polished, it is easy for anyone (owner, a future developer) to forget it is not really talking to LHDN | The visible stub-labelling requirement is itself a DoD item, not a suggestion; do not close this sprint without it |

## Safe to Carry Over

Real LHDN MyInvois sandbox integration remains explicitly out of this sprint's scope (unresolved since Sprint 33, per Vol 12_2 §10) — this sprint builds the UI against the existing stub only.

---

## Outcomes (recorded 2026-09-03)

**Status: DONE**, with one disclosed pre-existing gap found and fixed, and one disclosed scope boundary (Payment Voucher SST computation is unreachable from any UI, not something this sprint could wire up).

- `web/src/lib/einvoiceSst.ts` (new): the seventh "no list RPC" lib helper — `eInvoiceSstTransport.ts` exposes only mutating/lifecycle RPCs (create/submit/record/compute) for its four business-scoped entities, plus `sst_rates`, a shared reference catalog with its own "any authenticated user" SELECT policy (not business-scoped at all). Also adds `listEInvoiceSubmissionLines`, reading `e_invoice_submission_lines` directly — schema-only, same pattern as `quotation_lines`/`delivery_order_lines` — since the transport's own doc comment on `generateConsolidatedBatch` explicitly says which invoices landed in a batch is meant to be read this way, not returned by the RPC.
- **Pre-existing gap found and fixed while wiring this up:** `packages/core/src/sync/eInvoiceSstTransport.ts` had a private `toSstRate` converter (from Sprint 33) that no RPC in that file ever called — dead code invisible to `tsc` until this sprint's page became the first thing to import the module at all, at which point `noUnusedLocals` correctly flagged it. Removed, with a note left in place explaining why (`sst_rates` reads go through direct table access, matching every other lib helper's own convention); the lib helper above keeps its own row→model mapper, same as every other file's pattern. No behavior changed — this was strictly dead code.
- `web/src/shell/pages/EInvoiceSstPage.tsx` (new), two tabs under the single `einvoice-sst` sidebar item:
  - A red **"SIMULATED — NOT CONNECTED TO LHDN MyInvois"** banner renders twice on every load of this page — once above the tab strip, once immediately below it — so it is visible regardless of which tab is active, per this sprint's own DoD item (verified as its own specific check, not assumed present). `TAX_ADVICE_BOUNDARY_STATEMENT` is rendered verbatim directly under the page title, per the transport's own instruction not to paraphrase it.
  - **e-Invoice tab:** create a draft submission for a single invoice (excluding invoices that already have an active, non-rejected/cancelled submission — computed client-side from the loaded submission list); generate a consolidated batch by period, with an on-demand "show invoices in batch" expander reading `e_invoice_submission_lines`. "Submit" is built as one combined action — `submitEinvoice` → `StubMyInvoisClient.submitForValidation` → `recordSubmissionResult` — so a submission never gets stuck in `'submitted'` waiting on an async callback the stub will never send; two distinct buttons cover both of the stub's two outcomes ("succeed" vs. a "test rejection" form with editable IRB code/message), directly exercising this sprint's own required rejection-reason display path. `lhdnUuid`/`qrCodeRef`/the IRB response are all labelled "Simulated" wherever shown, and a rejection's code+message render verbatim (never swallowed into a generic error), matching the transport's own DoD wording.
  - **SST tab:** the `sst_rates` reference catalog; compute SST for a selected invoice (disclosing that untagged lines are silently skipped, and that a second computation attempt throws); a table of posted `sst_transactions`; create and submit an `SstReturn` by period, labelled as "status flip only — not a real Kastam filing" on the submit button itself, not just in prose.
  - **Disclosed scope boundary:** `computeSstForPaymentVoucher` is gated on `payment_vouchers.sst_code`, a column Sprint 33 added to a table whose write surface (Sprint 30's `createPaymentVoucher`) predates it — no RPC anywhere accepts an `sst_code` value, and `payment_vouchers` has no client-facing UPDATE policy (RPC-only mutation, this codebase's established convention). Building a button for it would only ever produce `payment_voucher_has_no_sst_code_set`. Left unbuilt, disclosed in the page's own header comment and here, rather than shipping a button that cannot succeed; Invoice-side SST computation (the primary flow) is fully built and verified.
- `web/src/shell/AppShell.tsx` / `sidebarConfig.ts`: wired `einvoice-sst` to `status: "existing"`.
- Onboarding gap remains open by the owner's own explicit instruction, still tracked for a dedicated follow-up.

*End of Sprint 44.*
