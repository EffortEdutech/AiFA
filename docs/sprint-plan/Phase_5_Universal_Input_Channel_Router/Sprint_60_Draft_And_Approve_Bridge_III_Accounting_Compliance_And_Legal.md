# Sprint 60 — Draft-and-Approve Bridge III: Accounting, Compliance & Legal

**Duration:** Weeks 15-16 (of Phase 5)
**Architecture references:** Vol_5_5 §7 (draft-then-approve pattern, reused from Sprints 58-59); `eInvoiceSstTransport.ts`, `legalCommercialTransport.ts` (existing RPCs this sprint drafts into)

**Added 14 September 2026** as part of the sprint-plan revision described in `00_Sprint_Plan_Overview.md` — this sprint did not exist before the revision; it is new scope, not a renumbering of prior content.

---

## Theme

The third and last of the three domain-bridge sprints (58-60). These three modules are grouped together because each involves a real compliance or legal consequence if acted on wrongly, so — unlike Sales/Purchases/People/Inventory, where the draft eventually becomes an active record — every domain in this sprint stops at "flagged for the owner's attention" rather than auto-creating a fully-formed filing, contract, or signature request. This is a deliberately more conservative application of the draft-then-approve pattern, not a lighter version of it.

## Objectives

A captured document or description relevant to e-Invoice/SST, a contract obligation, or an e-signature need is surfaced to the owner as a real, actionable item inside the existing Compliance/Legal pages — never silently filed, submitted, or signed on the AI's own initiative, since each of these three actions has a real external or legal consequence beyond AiFA's own data.

## Task Breakdown

### Compliance — e-Invoice & SST flag
- A classified `e_invoice_flag` domain (a captured invoice-like document that appears to need e-Invoice/SST handling, extracted fields being the counterparty, amount, and whatever tax-relevant detail is present) creates a draft flag row against the existing `eInvoiceSstTransport.ts` schema — visible on the existing e-Invoice & SST page as "needs review," not auto-classified into a specific SST treatment or auto-submitted to any tax authority
- Explicitly does not attempt automatic tax-code determination or e-Invoice submission — Vol_5_5's own governing principle (draft, never auto-file, for anything with an external regulator on the other end) applies most strongly here

### Legal — Contract alert draft
- A classified `contract_alert` domain (a captured document or description referencing a contract term, renewal date, or obligation) creates a draft entry against `legalCommercialTransport.ts`'s existing Contracts & Alerts schema — the owner confirms it before it becomes a tracked alert, since a wrongly-created alert (or a missed real one, if extraction is wrong) has real downstream consequences for contract management
- If the capture includes an actual contract document (PDF/image), the draft links to the stored document via the same media-extraction pipeline Sprint 55 built, rather than re-extracting text separately

### Legal — e-Signature request draft
- A classified `e_signature_request` domain (a description or forwarded document indicating something needs to be signed) creates a draft request against the existing e-Signature flow — drafted only, never dispatched to a signer automatically; the owner reviews the document and recipient before any real signature request goes out, since sending a signature request is an externally-visible action to a third party

## Definition of Done

- [x] A captured e-Invoice/SST-relevant document produces a real draft flag on the existing e-Invoice & SST page, requiring the owner's own review before any tax treatment is finalized — see Close-out note; resolves to a real, existing invoice with no active submission yet and calls the existing `createSubmission` RPC directly (already-proven since Sprint 33/44), not yet live-tested end-to-end through the Quick Capture UI itself
- [x] A captured contract-relevant description or document produces a real draft entry on the existing Contracts & Alerts page, confirmed by the owner before becoming a tracked alert — see Close-out note; drafts a whole new Contract via the existing `createContract` RPC (already-proven since Sprint 36/47), which auto-generates the alert; not yet live-tested end-to-end through the Quick Capture UI itself
- [x] A captured signature-relevant description or document produces a real draft e-Signature request, confirmed by the owner (including the recipient) before anything is actually sent to a signer — see Close-out note; live-tested via an isolated trigger test (the one domain that needed new schema), passed
- [x] None of this sprint's three domains ever auto-submits to a tax authority, auto-creates a binding legal alert, or auto-sends a signature request — verified by code review (e-Invoice and Contract reuse existing RPCs whose own draft/ApprovalTask gating was already proven in earlier sprints; e-Signature's new trigger only creates the real envelope on approval, confirmed live) — see Close-out note
- [x] `npm run typecheck` and `npm run lint` pass clean in `web/` and `app/` — confirmed clean (16 September 2026); new RPC (`create_esignature_request_draft`) exercised against the live Supabase project (see Close-out note)

## Dependencies

Sprint 57 (classification/extraction for `e_invoice_flag`, `contract_alert`, `e_signature_request`), Sprint 53 (router pattern), Sprint 55 (document-linking for contract/e-signature captures that include an actual file).

## Risks

| Risk | Mitigation |
|---|---|
| Compliance and Legal actions carry real external/legal weight — a wrong auto-action here is categorically worse than a wrong auto-action in, say, Expense | Every domain in this sprint stops at "flagged/drafted for owner review," with no auto-record or confidence-based shortcut ever offered for these three, even after Sprint 61 — this is stated as a permanent design choice for this sprint's domains, not a temporary caution to loosen later |
| e-Invoice/SST tax-code determination is a specialised domain an LLM can plausibly get wrong in ways that are hard for a non-accountant owner to catch | This sprint deliberately does NOT attempt tax-code determination at all — it flags "this looks e-Invoice/SST-relevant" and stops, leaving the actual determination to the owner or their existing process |
| Contract and e-signature captures may reference a document Sprint 55's extraction handles imperfectly (e.g. a scanned, low-quality contract page) | The draft always links back to the original captured document for the owner to open and verify directly, rather than asking the owner to trust the extracted summary alone |

## Safe to Carry Over

Actual SST tax-code suggestion (as a further AI-assisted step after this sprint's plain "flagged" state), automatic contract-renewal-date calculation from ambiguous phrasing, and multi-recipient e-signature routing — genuinely out of this sprint's flag-only scope, logged as open items.

---

---

## Close-out note (16 September 2026)

Before writing any code, this doc's three Task Breakdown premises were checked against the real, already-shipped `eInvoiceSstTransport.ts` / `legalCommercialTransport.ts` schema (the same discipline that surfaced real mismatches in Sprints 58 and 59). Two of the three premises did not hold as stated; this was disclosed to the owner, who made three explicit scoping decisions before implementation began:

1. **e-Invoice/SST flag** — `public.e_invoice_submissions` has no freestanding "flag, no invoice yet" concept: its own `e_invoice_submissions_normal_has_invoice` constraint requires a real, already-existing `public.invoices` row for a 'normal' submission, and `create_einvoice_submission` (Sprint 33, unchanged) already inserts `status = 'draft'` directly — no `create_approval_task` routing of its own, since the draft state plus the e-Invoice & SST page's own separate "Submit" action already gate anything reaching LHDN. Resolution: the capture must resolve to a real, existing invoice with no active (non-rejected/cancelled) e-Invoice submission yet — the exact same resolution pattern Sprint 59 used for Delivery Order. **No schema change.**
2. **Contract alert** — `public.contract_alerts` has no RPC to insert a standalone alert row; every alert is only ever generated as an automatic side effect of `create_contract` (Sprint 36, unchanged), which already drafts a brand-new Contract and opens its own ApprovalTask. Resolution: the `contract_alert` capture drafts a whole new Contract (counterparty, type, dates, auto-renew, renewal notice days) via the existing `createContract` RPC — no schema change; the ContractAlert is a byproduct exactly as the schema already produces it.
3. **e-Signature request** — the one domain whose premise materially failed: `public.e_signature_envelopes` has NO draft/undispatched status at all (its own status check is `in ('sent', 'viewed', 'signed', 'declined', 'expired')`, defaulting to `'sent'`) — calling `create_esignature_envelope` today is equivalent to immediately dispatching. Resolution: migration `00000000000008` adds a new `e_signature_requests` draft table (own RPC `create_esignature_request_draft`, domain `legal_contract`), mirroring Sprint 59's `attendance_correction` shape — only on approval does `sync_esignature_request_on_task_decision` re-validate eligibility and insert the real `e_signature_envelopes` row.

`npm run typecheck` and `npm run lint` passed clean in `web/` after the transport (`legalCommercialTransport.ts` — new `ESignatureRequest` types/converter, `createEsignatureRequestDraft`, optional `aiDraftSummary` on `createContract`) and capture-router (`useCaptureRouterCore.ts`, `CaptureResolveForm.tsx`) wiring landed. Migration `00000000000008` applied to the live Supabase project (16 September 2026).

**Live test result (16 September 2026)** — one isolated SQL Editor regression test, same method as Sprints 58-59: insert the domain's draft row directly, then call `create_approval_task` directly with `p_auto_approved := true`, so the trigger is tested independently of any RPC's own path. Only `e_signature_requests` needed this (the only new schema this sprint) — `e_invoice_flag` and `contract_alert` reuse pre-existing RPCs (`create_einvoice_submission`/`create_contract`) whose own draft/approval gating was already proven live in earlier sprints.

- **e-Signature request**: created a test Contract directly in `status = 'pending_signature'`, then inserted an `e_signature_requests` row (`status = 'drafted'`) against it. After the approval task resolved `auto_approved`, the request's `status` read back as `'approved'` with `created_envelope_id` populated, and the resulting `e_signature_envelopes` row read back with the matching `contract_id`, `status = 'sent'` (this schema's own unavoidable starting status, unchanged), `provider = 'generic'` — confirms `sync_esignature_request_on_task_decision` correctly re-validates eligibility and creates the real envelope only on approval, never before.

Still open, not yet live-tested: `e_invoice_flag` and `contract_alert` through the actual Quick Capture UI end-to-end (both reuse already-proven RPCs, so the risk is confined to the new client-side resolution/wiring, not the underlying schema — same category of gap Sprint 59 logged for Delivery Order).

Test fixtures created for this run (tagged "(regression)" in its summary/reason, safe to leave or delete): one `contracts` row inserted directly in `pending_signature` status (not via `create_contract`, to isolate the new trigger).

*End of Sprint 60 (new, 14 September 2026; closed out 16 September 2026).*
