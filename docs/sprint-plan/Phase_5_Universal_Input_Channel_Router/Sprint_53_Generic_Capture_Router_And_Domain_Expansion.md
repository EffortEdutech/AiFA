# Sprint 53 — Generic Capture Router UI & Domain Expansion

**Duration:** Weeks 1-2 (of Phase 5)
**Architecture references:** Vol_5_5 §2 (channel/domain separation), §3 (current-reality audit this sprint acts on), §7 (domain expansion)

**CORRECTION (5 September 2026, made before any Sprint 53 code was written):** The
original draft below wired the router to `capturePipeline.ts`
(`runCaptureInterpretation`/`classifyAndRoute`). Investigation before coding started
found that pipeline writes only to the LOCAL, end-to-end-encrypted `business_events`/
`business_data`/`ledger_entries` tables (Vol 13_1 §8 Path A) — there is no
`public.business_events` or `public.business_data` table in Supabase at all, only
`public.ledger_entries`, which Path A's local ledger never touches. Every Phase 4
page an owner actually looks at (Ledger, Cash Book/P&L, Full Reports, Business
Overview's Snapshot) reads exclusively from Path B: plaintext Supabase tables written
by direct RPC transports (`paymentVouchersReportsTransport.ts`,
`attendanceLeaveCommissionTransport.ts`, etc.), the architecture every Phase 4 sprint
(37-49) actually shipped on. Wiring this router to Path A would have produced captures
that looked successful but never appeared anywhere the owner actually looks — the same
"looks built, isn't really wired in" failure this whole phase exists to close, not
reproduce.

**Retargeted scope, decided with the owner before implementation:** this sprint routes
into Path B transports directly — the same ones `ExpenseQuickCapturePage.tsx` and
`AttendanceLeavePage.tsx` already call — instead of `capturePipeline.ts`. Consequences:

- **Photo capture is dropped from this sprint's scope.** Path B's expense entry
  (`createPaymentVoucher`) is a structured form call, not a vision-extraction pipeline;
  Path A's `runExpensePhotoInterpretation` is Path A-only and out of scope now. Photo
  input for Path B is a real, separate future sprint (a vision-extraction step that
  calls the SAME `createPaymentVoucher` RPC, not a revival of Path A).
- **`sale` and `purchase` one-shot text capture are dropped from this sprint's scope.**
  Path B has no single-call "record a sale" or "record a purchase" RPC — a sale is a
  Quotation/Invoice document cycle (`quotationInvoiceTransport.ts`) and Purchase Order
  entry is Sprint 57's own new work. Collapsing either into a bare one-line capture is
  a real design question on its own, not a same-sprint extension of the expense/leave
  case. **`expense` is the one AI-interpreted domain this sprint actually ships**,
  proven end-to-end against the live Ledger/Cash Book the owner already uses.
- **`leave_application` ships as originally scoped** — `create_leave_application` was
  already a direct Path B RPC (`attendanceLeaveCommissionTransport.ts`), so no
  re-targeting was needed there.
- **`unclassified` needs a new, real Path B table** (`public.capture_triage`) — Path A's
  `domain_hint = 'unclassified'` business_event row was never an option once this
  sprint stopped writing to Path A at all.

`BusinessDomain` (`packages/core/src/ai/types.ts`) still gains `"leave_application"`
and `"unclassified"` as literal type members — additive, and harmless for Path A's own
`capturePipeline.ts` (its `AI_INTERPRETED_DOMAINS` allowlist is unchanged: `expense`,
`sale`, `purchase`). `businessEventRepository.ts`'s `DomainHint` is deliberately **not**
touched — `leave_application` never becomes a `business_event` row under this
retargeted design.

---

## Theme

The one sprint every later Phase 5 sprint is built on top of, mirroring Sprint 37's
role in Phase 4. Brings back a generic, domain-agnostic capture screen — now built on
the same Path B transports the live Phase 4 shell already reports from, not on the
disconnected Path A pipeline `CaptureForm.tsx` used before its Sprint 48 retirement —
and closes the leave-application example from the owner's original ask using entirely
existing RPC machinery.

## Objectives

An owner can open one screen, type a plain description of an expense or a leave
request, and have it correctly classified and posted through the same RPCs the
dedicated Expense and Attendance & Leave pages already use — with anything the
classifier cannot confidently place landing in a visible triage queue instead of being
silently dropped or guessed into the wrong domain.

## Task Breakdown

### Router UI
- New `CaptureRouterPage.tsx` in the Phase 4 shell — a single free-text box ("what
  happened?"), reachable as its own sidebar item ("Quick Capture (AI)"), additive to
  (not replacing) the per-domain screens Sprint 48 built
- On submit, runs the heuristic domain detector, shows the owner the detected domain
  and extracted fields for confirmation/correction (never posts silently), then
  dispatches to the matching Path B transport call

### Domain detection (new, local, no AI provider round-trip this sprint)
- New `packages/core/src/ai/inputRouter.ts`: `classifyChannelIntakeDomain(rawText)` —
  a keyword + regex heuristic (leave keywords, an amount pattern, a date-range
  pattern) returning a detected `BusinessDomain` plus whatever it could extract
  (amount, date range). Explicitly a Phase 1-style starting heuristic, not a model —
  matches this codebase's own existing convention for first-cut confidence rules
  (see `TRUSTED_MAPPING_CONFIDENCE_FLOOR`'s own comment in `capturePipeline.ts`).
  A real AI-provider-backed router is a disclosed future upgrade, not this sprint's
  job — see Vol_5_5 §7.

### Domain expansion
- Add `"leave_application"` and `"unclassified"` to `BusinessDomain`
  (`packages/core/src/ai/types.ts`) — additive only
- Confirmed `leave_application` detections call `attendanceLeaveCommissionTransport.ts`'s
  existing `createLeaveApplication` (extended this sprint with an optional
  `aiDraftSummary` passed through to the RPC's existing `p_ai_draft_summary` param —
  the RPC already accepted this, nothing used it until now), which already opens a
  real `ApprovalTask` — no new approval machinery
- Anything the heuristic can't place (no leave keyword, no parseable amount) is
  `unclassified`: inserted into a new `public.capture_triage` table via a new
  `create_capture_triage_item` RPC, and shown in a real, visible list on the same
  page — not merely a database row

## Definition of Done

- [x] A typed description of a leave request ("I want to apply leave next Monday")
      is detected as `leave_application`, and — once the owner confirms the
      employee/leave type/dates — results in a real `ApprovalTask` the owner (or a
      delegate) can decide on, visible on the existing Approvals page — **live
      smoke-tested 6 September 2026**
- [x] A typed expense description with a parseable amount is detected as `expense`
      and, once confirmed, creates a real `PaymentVoucher` visible on the existing
      Payment Vouchers / Expense / Cash Book pages — **live smoke-tested 6 September
      2026, including the manual-override path**
- [x] Text the heuristic cannot place lands in a visible Unclassified Triage list on
      the same page, not silently dropped — **live smoke-tested 6 September 2026**
- [x] `npx tsc --noEmit` passes clean in `web/` (and `app/`, unchanged by this sprint)
- [x] Router screen is reachable from the web shell (mobile share-target/router screen
      is Sprint 55's own scope, not duplicated here)

## Dependencies

`paymentVouchersReportsTransport.ts`'s `createPaymentVoucher` and
`attendanceLeaveCommissionTransport.ts`'s `createLeaveApplication`/`create_approval_task`
— both already built and verified Path B RPCs; this sprint adds one new table+RPC
(`capture_triage`) and a heuristic front door, per Vol_5_5 §2's governing rule against
parallel pipelines (now correctly read as: parallel *Path B* pipelines — Path A is
excluded from this router entirely, disclosed above).

## Risks

| Risk | Mitigation |
|---|---|
| A keyword/regex heuristic will misclassify some real inputs (e.g. an expense description that happens to contain no parseable amount, or a leave request phrased without any of the matched keywords) | The owner always sees the detected domain and extracted fields before anything posts, with a manual override to reassign the domain — nothing is ever posted on a silent guess |
| `sale`/`purchase` one-shot capture being out of scope may read as a narrower "one input, AI does everything" than the owner's original ask | Disclosed explicitly above and in Vol_5_5's own Rollout Sequencing — a real one-shot sale/purchase capture needs its own document-cycle design, not a same-sprint bolt-on, and is queued as a future sprint rather than shipped half-working |
| Reviving a generic capture screen risks re-introducing the exact UX confusion Sprint 48 retired it to fix (users unsure which screen to use for what) | Framed explicitly as "Quick Capture (AI) — let AI figure out what this is," distinct from and additive to the per-domain screens, not a replacement |

## Safe to Carry Over

Extending the unclassified triage list with bulk actions (dismiss, manually
reclassify) and a real AI-provider-backed classifier (replacing this sprint's
heuristic) — Sprint 56 formalises routing/confidence; richer triage UX can wait for
Sprint 58's hardening pass if it doesn't block anything else.

---

## Outcomes (6 September 2026)

Sprint 53 closed genuinely done, not just structurally, after a full live smoke test
against the owner's running app and real local Supabase instance (see
`Sprint_53_Smoke_Test.md`). All 4 tests (Expense, Leave application, Unclassified
triage, Manual override) passed.

One real, previously-undiscovered bug was found and fixed along the way, outside
this sprint's own new code but blocking Test 2: a systemic PostgREST response-shape
bug where a function declared `RETURNS <table>` (a single composite row) was being
handled as if it returned an array (`const rows = data as XRow[]; return
toX(rows[0])`, where `rows[0]` is `undefined` on a plain object response). This
pattern was found and fixed at 33 call sites across 5 transport files
(`attendanceLeaveCommissionTransport.ts`, this sprint's own `captureTriageTransport.ts`,
`eInvoiceSstTransport.ts`, `legalCommercialTransport.ts`, `payrollTransport.ts`),
each verified individually against its real SQL `RETURNS` declaration — genuinely
`SETOF`/`TABLE`-returning functions in the same files were confirmed already correct
and left untouched. This means every create/mutate action on Attendance & Leave,
Commission, e-Invoice & SST, Contracts & Alerts, e-Signature, and Payroll pages was
silently broken in the live app before this fix — worth a targeted spot-check of
those pages before relying on them, even though it's unrelated to this sprint's own
scope.

Three apparent test failures during the smoke test were correctly diagnosed as not
bugs: missing seed data (no Party existed yet — Test 1), Cash Book requiring a
separate `bank_accounts` row distinct from Chart of Accounts (Test 1), and the real
two-step Payment Voucher lifecycle (create → approve → **Mark Paid** is a separate
step that actually posts the ledger; `Sprint_53_Smoke_Test.md` itself was wrong to
assert immediate P&L movement, and was corrected). None of these needed a code
change.

---

*End of Sprint 53 (retargeted to Path B, 5 September 2026; smoke-tested and closed
6 September 2026).*
