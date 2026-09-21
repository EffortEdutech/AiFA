# Phase 5 — Universal Input & Channel Router — Checklist Master

**Architecture reference:** `docs/architecture/v2.0/Series_05_AI_Platform_Architecture/Vol_5_5_Universal_Input_Architecture.md`
**Sprint plan:** `00_Sprint_Plan_Overview.md` (this directory)
**Status:** Not started. Awaiting owner go-ahead per the standing "proceed sprint by sprint with explicit go-ahead" discipline used throughout Phases 3 and 4.

---

## How to read this checklist

Mirrors Phase 4's `Checklist_Master.md`: one section per sprint, its own Definition of Done items copied here as checkboxes (kept in sync with each `Sprint_NN_*.md` file — that file is the source of truth if the two ever drift), updated as each sprint completes with its own Outcomes summary appended to both this file and the sprint's own doc. A phase-exit criteria section closes the file, updated only once every sprint above it is genuinely done, not aspirationally checked early.

---

## Sprint 53 — Generic Capture Router UI & Domain Expansion

**Status:** DONE (6 September 2026) — genuinely, not just structurally: all 4 live
smoke tests (see `Sprint_53_Smoke_Test.md`) passed against the owner's real running
app and local Supabase instance. A pre-existing, previously-undiscovered bug (a
PostgREST singular-RPC-response array-indexing bug — `const rows = data as XRow[];
return toX(rows[0])` where the RPC actually returns a single JSON object, not an
array) was found while diagnosing Test 2 and fixed across 33 call sites in 5
transport files: `attendanceLeaveCommissionTransport.ts` (8),
`captureTriageTransport.ts` (2, this sprint's own new file), `eInvoiceSstTransport.ts`
(7), `legalCommercialTransport.ts` (8), `payrollTransport.ts` (8) — meaning every
create/mutate action on Attendance & Leave, Commission, e-Invoice & SST, Contracts &
Alerts, e-Signature, and Payroll pages was silently non-functional in the live app
before this fix, unrelated to Sprint 53's own scope but found and fixed here rather
than left for a future sprint to rediscover.

**RETARGETED (see the sprint doc's own correction note):** originally spec'd against
`capturePipeline.ts` (Path A, local-only, invisible to every Phase 4 report — a
gap found and disclosed before any code was written). Rebuilt against Path B — the
same `paymentVouchersReportsTransport.ts`/`attendanceLeaveCommissionTransport.ts` RPCs
the live Expense and Attendance & Leave pages already call — so captures actually
appear in Ledger/Cash Book/Approvals. Consequence: photo capture and one-shot
`sale`/`purchase` text capture are OUT of this sprint's scope (see the doc) — only
`expense` and `leave_application` route to a real Path B action this sprint;
everything else lands in the new Unclassified Triage list.

- [x] `BusinessDomain` gains `leave_application`/`unclassified` (additive); a new
      `AiLedgerDomain` type keeps `capturePipeline.ts`/`pcb.ts` correctly narrowed to
      the original three ledger domains (fixes real compile breaks the addition
      caused, not worked around)
- [x] New local heuristic domain detector (`packages/core/src/ai/inputRouter.ts`) —
      disclosed as a keyword/regex starting rule, not an AI-provider call (Sprint 56
      formalises this)
- [x] Typed leave-request text detected as `leave_application`; once the owner
      confirms employee/leave type/dates, `createLeaveApplication` (extended with an
      `aiDraftSummary` passthrough) opens a real `ApprovalTask` — **smoke-tested live
      6 September 2026 (Test 2): two leave applications created, both correctly
      auto-approved via `solo_self_resolved`, visible on Attendance & Leave**
- [x] Typed expense text with a parseable amount detected as `expense`; once
      confirmed, `createPaymentVoucher` posts a real Payment Voucher — **smoke-tested
      live 6 September 2026 (Test 1 + Test 4): PV created, approved, marked paid,
      confirmed reflected in Profit & Loss; manual-override path also confirmed
      (Test 4) — a "leave"-keyword expense line correctly overridden to Expense and
      posted as PV-000003**
- [x] Unconfident input lands in the new `public.capture_triage` table (new migration
      + `create_capture_triage_item`/`resolve_capture_triage_item` RPCs + a visible
      list on the new page) — **smoke-tested live 6 September 2026 (Test 3): item
      persisted across reload, both Mark Handled and Dismiss confirmed working**
- [x] Existing expense/sale/purchase `capturePipeline.ts` classification behaviour
      unchanged (only type-level narrowing added, no logic changed; regression is
      structural, not yet re-run live)
- [x] `npx tsc --noEmit` clean in `web/` and `app/`; `web/`'s `eslint` clean
- [x] Router screen (`CaptureRouterPage.tsx`, sidebar item "Quick Capture (AI)")
      wired into the web shell — **mobile is NOT reachable this sprint**, corrected
      from the original DoD's "both shells" claim; a mobile front door is Sprint 55's
      own scope (its share-target work), not duplicated here

### Outcomes (6 September 2026)

All 4 smoke tests passed live against the owner's running app and real local
Supabase instance:

- **Test 1 (Expense):** PV created via Quick Capture → approved → Mark Paid →
  confirmed on Profit & Loss. Along the way, two non-bugs were correctly diagnosed
  and resolved with seed data / doc fixes rather than code changes: missing Party
  seed data, and the smoke test doc's own wrong assumption that P&L would move
  before Mark Paid (corrected in `Sprint_53_Smoke_Test.md`).
- **Test 2 (Leave application):** blocked first by a genuine bug (see Status above),
  fixed, then passed — two leave applications created, correctly auto-approved
  (`solo_self_resolved`, expected for a solo business), visible on Attendance &
  Leave.
- **Test 3 (Unclassified triage):** passed — item appeared, persisted across
  reload, Mark Handled/Dismiss both correctly just update `status` (no downstream
  automation; the owner is expected to have already acted on the item manually
  before marking it handled).
- **Test 4 (Manual override):** passed — a "leave"-keyword expense line was
  correctly auto-detected as `leave_application` by the heuristic, then manually
  overridden to `expense`, and posted as a real Payment Voucher (PV-000003), not a
  leave application — confirming the override actually changes which RPC is called.

Sprint 53 is genuinely done: real data lands in the real Ledger/Approvals/
Attendance pages through the exact same RPCs those pages use, and the triage/
override safety nets work as designed.

## Sprint 54 — Web "Forward to AiFA" Channel

**Status:** Code complete (6 September 2026), retargeted to Path B / text-only before
implementation — same discipline as Sprint 53's own correction (see
`Sprint_54_Web_Forward_To_AiFA_Channel.md`'s correction note). `tsc`/`eslint` clean in
`web/`. **Not yet live-smoke-tested by the owner** — pasting a forwarded WhatsApp/email
text description through the new "Forward to AiFA" screen and confirming it posts
identically to Quick Capture is the one remaining item before this sprint is
genuinely, not just structurally, done.

- [x] Pasted forwarded text reaches the same Path B core as in-app capture
      (`useCaptureRouterCore.ts`'s `handleDetect`/`handleSubmit`, shared by both
      `CaptureRouterPage.tsx` and the new `ForwardToAifaPage.tsx`) — traced via
      shared function calls, not assumed from visible outcome alone. **Not yet
      smoke-tested live.**
- [x] Dropped forwarded image/PDF explicitly deferred (Path B has no
      image-extraction RPC yet) rather than silently dropped or wired back to Path A
      — drop zone visible, honestly labelled as not available yet
- [x] `ChannelIntake` (`packages/core/src/ai/channelIntake.ts`) is one real shared
      type consumed by at least two adapters (in-app, forwarded)
- [x] typecheck/lint clean in `web/`

## Sprint 55 — Universal Media & Voice Intake Foundation

**Status:** Code complete (6 September 2026) — inserted mid-phase after the owner's
explicit scope expansion ("Business process mostly involve pdf files, images, text,
voices no matter it comes from email or whatsapp or other sources. We need to build
that feature"). Renumbered the previously-planned Sprint 55-58 to 56-59 to make room
(see `Sprint_55_Universal_Media_And_Voice_Intake_Foundation.md`'s own note — same
"insert and renumber, document why" discipline Sprint 53 already established).
`tsc`/`eslint` clean in `web/` and `app/`; `capturePipeline.test.ts` and
`documentsAndPhotoCapture.test.ts` re-run, 20/20 passing, no regression to Sprint
5/6's existing mobile photo-capture. **A hard constraint found mid-sprint:** the AI
Gateway (`ai-gateway-service`) is confirmed to be a separate repository, unreachable
from this session — so web's new image/PDF path is a real, documented contract
against a Gateway route (`POST /ai-vision`) that does **not exist yet**; it will show
an honest failure message until that route is built in the Gateway's own repo. Voice
transcription has **no chosen vendor** anywhere in the codebase; it is modeled as an
optional `AiProvider.transcribeAudio()` that no shipped provider implements yet, and
shows "not configured" everywhere until the owner picks one. **Not yet live-smoke-
tested by the owner.**

- [x] `AiProvider` gains optional `transcribeAudio()`; missing-method degrades to an
      honest "capability not available" outcome everywhere, never a crash or a
      fabricated result (Vol 7_1 §5.1's honesty pattern, extended)
- [x] `VisionExtractionInput` gains `kind: "image" | "pdf"`; `anthropicProvider.ts`
      sends a real Anthropic `"document"` content block for PDFs instead of
      mis-sending them as `"image"` (real-but-unverified in this sandbox — no live
      key/network here)
- [x] `gatewayProvider.ts` documents and implements a client-side contract for a new
      `/ai-vision` Gateway route; `compositeProvider.ts` tries Gateway-if-signed-in
      first, then any injected (mobile-only) vision provider, else throws a named
      "no vision capability" error — never a silent guess
- [x] `packages/core/src/ai/pathBMediaExtraction.ts` — `extractMediaViaPathB()` and
      `transcribeVoiceForPathB()`, both total functions that degrade to an honest
      failed/not-configured status rather than throwing into the UI
- [x] `ForwardToAifaPage.tsx` gets a real drag-and-drop/browse zone for image/PDF and
      a voice-note upload control, each showing live extracting/transcribing/failed/
      not-configured status — replacing Sprint 54's honestly-disabled placeholder
- [x] `npx tsc --noEmit` clean in `web/` and `app/`; `web/`'s `eslint` clean;
      `capturePipeline.test.ts` + `documentsAndPhotoCapture.test.ts` 20/20 passing

## Sprint 56 — Mobile Share-Target Channel

**Status:** Not started (renumbered from the original Sprint 55; now depends on
Sprint 55's real Path B media-extraction pipeline instead of the old, incorrect
"existing vision pipeline" assumption)

- [ ] Sharing WhatsApp text to AiFA on a real Android device classifies correctly through the shared core
- [ ] Sharing a WhatsApp/email image to AiFA on a real Android device extracts via Sprint 55's Path B media-extraction pipeline
- [ ] iOS share-target behaviour verified on a real device, or explicitly disclosed as unverified (not assumed to mirror Android)
- [ ] typecheck/lint clean in `app/`

## Sprint 57 — Channel × Domain Confidence & Approval Routing

**Status:** Not started (renumbered from the original Sprint 56)

- [ ] A high-confidence forwarded-channel extraction still lands at draft-confirm on first use, not auto-recorded
- [ ] Repeated owner confirmation of the same channel-domain pair genuinely graduates it to auto-record (tested, not only coded)
- [ ] In-app photo capture's existing auto-record behaviour for a trusted vendor unchanged (regression checked)
- [ ] Sprint 55's new media/voice extractions also start at draft-confirm per Vol_5_5 §8, not exempted as a "new feature" special case
- [ ] typecheck/lint clean in `web/` and `app/`

## Sprint 58 — Draft-and-Approve Bridge I: Sales & Purchases

**Status:** DONE (15 September 2026), genuinely — every item below is live-tested or
code-verified, not just coded. **Note: this checklist section is stale against the
14 September 2026 sprint-plan revision** (widened from PO-only to also cover Sales);
`Sprint_58_Purchase_Order_Entity_And_Chaining.md` is the source of truth per this
file's own header rule. Summary: PO capture (`find_or_create_party` →
`createPurchaseOrder`) and Sale capture (`create_quotation` with
`p_already_completed`) both live-tested by the owner (PO-000002 for KBCM progressed
drafted → approved → stock received → paid; INV-000001 for Sunrise Trading issued
directly on approval). The two DoD items still open as of the 14 September revision
— the ledger/AR-bypass regression check, and the disclosed `create_approval_task`
auto-approve trigger gap — are both closed: the regression check is code-verified,
and the trigger-gap fix (`00000000000006_fix_auto_approve_trigger_gap.sql`) is
applied to the live Supabase project and live-tested (a direct `create_approval_task`
call with `p_auto_approved := true` correctly flipped a real PO from `drafted` to
`approved`). One follow-up surfaced during that test, not yet resolved: two live
overloads of `create_approval_task` exist (9-param legacy, 10-param current), and a
call omitting the 10th argument is ambiguous — unconfirmed whether this affects
`approvalEngineTransport.ts`'s own 9-argument call (Expense/Leave Application) through
PostgREST; tracked as an open item, not blocking Sprint 58's own close.

- [x] Captured/forwarded PO produces a real multi-line `purchase_order` record — single-line only this sprint (multi-line PO editing explicitly Safe to Carry Over)
- [~] Approving a drafted PO chains forward — **REVISED**: automatic intake-router re-chaining (`stock_receipt_pending`/`payment_due` as new router intakes) was NOT built; replaced with explicit owner-triggered actions (`confirm_purchase_order_receipt`, `mark_purchase_order_paid`) on the new Purchase Orders page — a simpler, safer first cut, live-tested working
- [x] Sale capture produces the right artifact (direct Invoice for an already-completed sale, not always a Quotation) — live-tested working
- [x] New tables' RLS matches this schema's existing per-membership pattern, verified against `caller_has_capability`
- [x] typecheck/lint clean in `web/`
- [x] Regression: neither PO nor sale drafting ever bypasses approval or posts to the ledger directly — code-verified 15 September 2026
- [x] Cross-cutting `create_approval_task` auto-approve trigger gap — fixed in `00000000000006`, applied and live-tested 15 September 2026 (PO status flipped `drafted` → `approved` via the fixed trigger, isolated from `mark_purchase_order_paid`'s own workaround)

## Sprint 59 — Draft-and-Approve Bridge II: People & Inventory

**Status:** DONE (16 September 2026) for schema/trigger correctness — three of the
four new domains live-tested via isolated SQL Editor regression tests (same method
as Sprint 58's PO trigger test); Delivery Order still needs a live pass through the
actual Quick Capture UI (no new trigger there — see Sprint 59's own Close-out note).
Before implementation, the sprint doc's own premise (that all four domains already
had a working manual-entry screen or Path B RPC to draft into) was checked against
the actual schema and found not to hold for any of the four; the owner made four
explicit scoping decisions (documented in `Sprint_59_Hardening_Cross_Channel_QA_And_Pilot.md`'s
Close-out note) before migration `00000000000007` was written.

- [x] A captured commission description produces a real draft commission row, correct once approved — new `create_manual_commission_draft` RPC + `'drafted'` status; live-tested (`drafted` → `approved` via the fixed trigger), not yet tested through Quick Capture's own UI
- [x] A captured attendance-correction description produces a draft correction (not a direct edit), requiring approval — new `attendance_corrections` table/RPC; live-tested, a real `attendance_records` row (`source: 'manual_admin_entry'`) confirmed created only on approval
- [x] A captured delivery-order or stock-adjustment description produces a real draft row, requiring approval before stock quantity changes — stock adjustment live-tested (new `stock_adjustments` table/RPC, `stock_movements` + `stock_levels` upsert confirmed correct); delivery order requires a real invoice reference in the capture (owner's decision — no schema change, reuses Sprint 31's `create_delivery_order` unchanged), not yet live-tested end-to-end
- [x] None of this sprint's four new domains ever bypasses `create_approval_task` — code-verified (every new table's only write path is via `create_approval_task` + its own `sync_*_on_task_decision` trigger) and confirmed live for three of the four
- [x] typecheck/lint clean in `web/` and `app/`; new RPCs exercised against the local Supabase instance — three of four domains' triggers live-tested in isolation (see Sprint 59's own Close-out note for full results)

## Sprint 60 — Draft-and-Approve Bridge III: Accounting, Compliance & Legal

**Status:** DONE (16 September 2026) for schema/trigger correctness and typecheck/lint;
e-Invoice-flag and Contract-alert reuse pre-existing, already-proven RPCs (no schema
change) but are not yet live-tested end-to-end through the Quick Capture UI — see
`Sprint_60_Draft_And_Approve_Bridge_III_Accounting_Compliance_And_Legal.md`'s own
Close-out note. Covers e-Invoice/SST flags, Contract alerts, and e-Signature requests,
all deliberately stopping at "flagged/drafted for owner review" with no auto-record
path ever offered. Two of the three Task Breakdown premises didn't hold as stated
once checked against the real `eInvoiceSstTransport.ts`/`legalCommercialTransport.ts`
schema (same discipline as Sprints 58-59) — resolved by the owner: e-Invoice flag
requires a real invoice reference (no schema change, same pattern as Sprint 59's
Delivery Order); Contract alert drafts a whole new Contract via the existing
`createContract` RPC (no schema change, the alert is an automatic byproduct);
e-Signature request needed a genuinely new `e_signature_requests` draft table
(migration `00000000000008`) since `e_signature_envelopes` has no draft/undispatched
status of its own.

- [x] A captured e-Invoice/SST-relevant document produces a real draft flag, requiring owner review — resolves to a real invoice with no active submission yet, calls the existing (Sprint 33/44) `createSubmission` RPC directly; not yet live-tested end-to-end
- [x] A captured contract-relevant description/document produces a real draft entry, confirmed by the owner — drafts a new Contract via the existing (Sprint 36/47) `createContract` RPC, which auto-generates the alert; not yet live-tested end-to-end
- [x] A captured signature-relevant description/document produces a real draft e-Signature request, confirmed by the owner including recipient — new `e_signature_requests` table/RPC; live-tested, a real `e_signature_envelopes` row confirmed created only on approval
- [x] None of this sprint's three domains ever auto-submits/auto-creates/auto-sends — code-verified (e-Invoice/Contract reuse already-proven draft/ApprovalTask gating; e-Signature's new trigger only creates the real envelope on approval, confirmed live)
- [x] typecheck/lint clean in `web/` and `app/`; new RPC exercised against the live Supabase instance — see Sprint 60's own Close-out note for full results

## Sprint 61 — Cross-Domain Approval Chaining & Confidence Trust

**Status:** DONE (16 September 2026), genuinely — all four regression-test parts
live-verified against the owner's real Supabase project via the SQL Editor, same
isolated-RPC methodology as Sprints 58-60. Two premise mismatches were found and
disclosed before any code was written, both resolved with the owner's go-ahead
(see `Sprint_61_Cross_Domain_Chaining_And_Confidence_Trust.md`'s own Close-out
note): (1) the chaining mechanism this sprint was meant to generalize never
actually existed — Sprint 58 shipped explicit owner-triggered buttons instead of
real auto-re-entry, so this sprint builds the real thing (`chain_definitions` +
`chained_intakes`, a declarative next-domain table with explicit hooks at five
call sites, not a fully generic engine — a disclosed scope decision); (2) the
trust-accumulation mechanism this sprint was meant to extend
(`businessKnowledgeRepository.ts`'s vendor-category trust) is Path A-only,
end-to-end-encrypted local SQLite and architecturally unreachable from Path B —
resolved by building a new Path B-native table, `channel_domain_trust`, mirroring
the original mechanism's shape rather than touching the unreachable original
(which remains untouched and unaffected). One related-but-distinct behaviour
surfaced live during testing (not a Sprint 61 bug, noted as an observation): in
the test business, `approval_tasks` rows land `status = 'approved'` immediately
on INSERT via `create_purchase_order`/`create_quotation` even with
`p_auto_approved := false` — worked around the same way Sprints 58-60's own
tests did (a manual `UPDATE` to fire the relevant trigger directly).

- [x] A high-confidence forwarded-channel extraction still lands at draft-confirm on first use, across ≥3 domains — true by construction (every channel-domain pair starts at `confirmation_count = 0`); live-verified for `forwarded_web`/`sale`
- [x] Repeated owner confirmation of a channel-domain pair genuinely earns reduced-friction handling, verified for ≥2 domains — live-verified for `forwarded_web`/`sale` (3 correct → trusted, 1 wrong → reset to 0) and `forwarded_web`/`stock_adjustment` (permanent-exception counter-case)
- [x] The five permanent-approval domains never earn auto-record regardless of confirmation count — live-verified: `stock_adjustment` reached `confirmation_count = 3` honestly while `is_trusted` stayed `false`, enforced inside `get_channel_domain_trust_status` itself (a real DB guarantee, not a client-side convention)
- [x] The generalized chain table correctly advances the PO chain (regression) and the new Sale → payment-expected chain — both live-verified end-to-end, including the Sale chain's partial-payment edge case
- [x] typecheck/lint clean in `web/` and `app/` — confirmed clean by the owner (`tsc --noEmit`, `eslint . --ext .ts,.tsx`)

Not yet done, carried forward (not blocking close, same category as Sprint 59's
Delivery Order and Sprint 60's e-Invoice-flag/Contract-alert carry-forwards): a
live pass through the actual Quick Capture UI exercising the "Trusted" message
and the `ChainedIntakesList` UI end-to-end, as opposed to the direct-RPC
regression test run this sprint.

## Sprint 62 — Hardening, Cross-Channel QA & Pilot

**Status:** PARTIAL (16 September 2026) — honestly, not fully DONE. The SQL-
verifiable scope is genuinely complete: PO chaining and the new Sale →
payment-expected chaining were each re-run as a second, fully independent
cycle and reproduced Sprint 61's own shape exactly, AND a true idempotency
guard was proven directly — re-calling `confirm_purchase_order_receipt`,
`mark_purchase_order_paid`, and `record_payment` on already-completed records
all failed cleanly rather than silently duplicating a `chained_intakes` row.
All five permanent-approval domains (not just the one, `stock_adjustment`,
Sprint 61 sampled) were independently swept and confirmed to never earn
`is_trusted = true` regardless of confirmation count. **Two DoD items remain
explicitly open, not assumed passing:** the full channel × domain UI
verification matrix, and the real owner-run pilot forwarding an actual
WhatsApp message/email on a real device — both genuinely require the owner's
own running app and phone, which this cloud session has no access to (the
same limitation Sprint 49 disclosed closing out Phase 4). A written checklist,
`Sprint_62_Pilot_And_UI_Checklist.md`, was handed to the owner to run at their
own pace; see `Sprint_62_Hardening_Cross_Channel_QA_And_Pilot.md`'s own
Close-out note for full detail, including a test-writing correction found
live (`approval_tasks.status` accepts `pending_approval`, not `pending`).

- [ ] Full channel × domain verification matrix completed and recorded across all ~14 domains — OPEN, disclosed: handed to owner as `Sprint_62_Pilot_And_UI_Checklist.md`, requires the real app UI this session cannot drive
- [x] PO chaining and Sale → payment-expected chaining each re-verified idempotent across at least two full runs — live-verified: second independent PO/sale cycles reproduced correctly, and re-calling a completed step is cleanly rejected rather than duplicating a chain entry
- [x] The five permanent-approval domains verified to never auto-record, across real test captures — all five (not just one) independently confirmed
- [ ] At least one real owner-run pilot completed on a real device — OPEN, disclosed: requires the owner's own phone and a real forwarded message, handed over as the same checklist
- [x] typecheck/lint clean across `web/` and `app/` — trivially true, no new code this sprint
- [x] Vol_5_5, `Checklist_Master.md`, and `00_Sprint_Plan_Overview.md` all agree on actual shipped state — reconciled this close-out

---

## Phase 5 Exit Criteria

Evaluated at Sprint 62 close-out (16 September 2026 — corrected from this
section's own stale reference to "Sprint 59," the pre-14-September-revision
close-out sprint number), following the same discipline Phases 3 and 4 used:
items marked complete only when genuinely complete, PARTIAL with a stated
sub-clause when only part is done, and left open with an honest reason
otherwise. **Overall: PARTIAL** — the mechanisms are real and SQL-verified;
the owner's own live-device confirmation (criterion 1's UI reachability) is
the one piece still outstanding.

1. [~] PARTIAL — A solopreneur can reach every domain this phase ships from at least three channels without touching a per-domain-only screen: true by construction (every domain routes through the same `useCaptureRouterCore.ts` core regardless of channel — no parallel pipeline exists), but not yet confirmed live through the real UI across the full ~14-domain list; handed to the owner as `Sprint_62_Pilot_And_UI_Checklist.md`, Part 1
2. [x] Nothing from a newly-introduced channel auto-posts to the ledger before the trust-accumulation mechanism says it has earned that — live-verified: every domain-bridge sprint (58-60) ships as a draft requiring approval first (never a direct post), and Sprint 61/62 together confirmed the five permanent-approval domains can never bypass that gate via trust, across all five domains
3. [x] An approved Purchase Order carries forward to at least stock-receipt-pending and payment-due without manual re-entry — live-verified across THREE independent PO runs now (Sprint 58's original, Sprint 61's regression run, Sprint 62's second independent run), plus a genuine idempotency guard confirmed on top of reproducibility
4. [x] Every genuinely deferred item is named honestly, not silently declared resolved — voice transcription vendor selection, the Gateway `/ai-vision` route, true unattended inbound listener, and PO partial-receipt/amendment remain open exactly as `00_Sprint_Plan_Overview.md`'s own "Explicitly out of scope" section states; this close-out adds the real owner-run pilot and full UI matrix as two more explicitly-open items, not silently resolved
5. [x] `Vol_5_5_Universal_Input_Architecture.md`'s own Status line reflects actual shipped state, not the Draft status it carried at this phase's start — updated this close-out (see that file's own Status line)

---

*End of Phase 5 Checklist Master.*
