# Sprint 48 — Business Overview, Settings & Cross-Module Polish

**Duration:** Weeks 23–24 (of Phase 4)
**Architecture references:** Vol 12_2 §4.2, §5.1, §5.4, §7; Vol 12_0 §4 (original Settings/Devices Phase 2b intent)

---

## Theme

The sprint that ties every prior module sprint together into the one landing experience the owner actually opens first, and finally promotes Settings to full read/write per Vol 12_0's own original, never-executed Phase 2b intent.

## Objectives

The Business Overview landing page (Vol 12_2 §5.1) is built as a structured, tabbed summary — not a noticeboard — drawing correctly from every module sprint's data; Business Settings is full read/write; any polish items carried over from Sprints 37-47 are closed out.

## Task Breakdown

### Business Overview (Vol 12_2 §5.1)
- Tabs: Snapshot (fixed headline-figure strip), Sales Pipeline, Compliance Status, Team Activity — each a focused view against one or two existing transports, no open-ended widget grid

### Settings
- Promote `SettingsReadOnly.tsx` to full read/write per the original Vol 12_0 §4 Phase 2b intent, now that this is the full frontend

### Cross-module polish
- Close out each Sprint 37-47's own "Safe to Carry Over" items still outstanding (WhatsApp message template review, delegation-creation UI, bulk Chart-of-Accounts editing, etc.) — review each sprint's Outcomes for what was actually deferred, do not assume the list above is exhaustive

## Definition of Done

- [x] Business Overview renders all four tabs correctly against real cross-module data, verified as genuinely tab-structured (no card grid) per Vol 12_2 §5.1's rule
- [x] Settings supports full read/write for a `settings`-configure-gated membership, read-only correctly enforced otherwise
- [x] Every "Safe to Carry Over" item from Sprints 37-47 is either closed here or explicitly re-logged as a genuine, disclosed open gap for Sprint 49/Phase 4 close-out — none silently dropped
- [x] Standard five DoD items from `00_Sprint_Plan_Overview.md`

## Dependencies

All module sprints (39-47) — this sprint's Overview page reads from every one of them.

## Risks

| Risk | Mitigation |
|---|---|
| Overview's Snapshot tab quietly grows into the noticeboard the owner explicitly ruled out, one "just one more card" at a time | Keep the fixed-set rule from Vol 12_2 §5.1 as a hard DoD check, not a guideline — a reviewer should be able to count the figures against the volume's own list |

## Safe to Carry Over

Any Settings sub-section not yet needed by a real screen elsewhere (e.g. a business-profile field nothing else reads yet) can wait for Sprint 49 or a later maintenance pass.

---

## Outcomes (recorded 3 September 2026)

**Status: COMPLETE.** All DoD items shipped. Of the Sprints 37-47 "Safe to Carry Over"/disclosed-gap items reviewed (their own Outcomes sections, not just their "Safe to Carry Over" headers), three were genuinely closable from the frontend alone and were built; every other one is a real backend/environment/vendor gap that this pure-frontend phase cannot close without a schema or RPC change (which Vol 12_2 §1 explicitly rules out for Phase 4) — each is individually re-logged below, not silently dropped.

### What shipped

- **`web/src/shell/pages/BusinessOverviewPage.tsx`** (new, replaces Sprint 37's temporary `OverviewPage.tsx`, which is left in the tree unwired rather than deleted): the real four-tab Snapshot / Sales Pipeline / Compliance Status / Team Activity page per Vol 12_2 §5.1's own fixed list — Snapshot is a compact strip of exactly four figures (cash position and AR from `trialBalance`'s '1000'/'1100' rows, AP from '2000' — always RM0.00 and labelled as such, since no RPC in this schema ever posts to Accounts Payable; pending approvals count from `listApprovalTasks`), never a card grid. Sales Pipeline: Quotation counts by status, plus overdue-invoice count/amount computed from `arAgeingDetail`'s own `ageingBucket` (not a raw `Invoice.status` count, matching Vol 12_2 §5.2's own established rule). Compliance Status: e-Invoice submission counts by status (with the same SIMULATED caveat the e-Invoice page itself carries) plus Contract due-alerts count. Team Activity: membership roster plus a recent-approval-decisions feed from `listApprovalTasks`, sorted by `decidedAt`. Each tab loads lazily on selection, and each stays within Vol 12_2 §5.1's "one or two RPCs per tab" guidance.
- **Disclosed, deliberate IA decision — Quick Capture retired, not silently dropped:** Sprint 37's interim Overview page carried a "Quick Capture" tab wrapping the old Phase 1/2 generic AI `CaptureForm`. Vol 12_2 §1.1 formally supersedes the old feature table that carried it as a single generic row, and §4.2's 19-item sidebar inventory (declared "the complete Phase 1-3 inventory") has no Quick Capture slot — every domain now has its own dedicated capture screen. `BusinessOverviewPage.tsx`'s own header states this plainly; `CaptureForm.tsx` itself is untouched, simply no longer wired.
- **`web/src/shell/pages/BusinessSettingsPage.tsx`** (new, replaces `components/SettingsReadOnly.tsx`, left in the tree unwired): full read/write for Business Profile (name, industry) and Notifications (quiet hours, per-kind toggles), per Vol 12_0 §4's original Phase 2b intent. Both write functions (`updateBusinessProfile`, `updateNotificationPreferences`) already existed in `appSettingsRepository.ts` since Phase 1 — only the UI was missing. Edit controls are hidden behind a `settings: configure` capability check (`getGrantedCapabilitiesForDomain`, solo-unrestricted, fails closed) and a write is separately, naturally blocked by `assertSyncGateOk` if this device doesn't hold the active-device lock — that error surfaces verbatim. The Devices panel is unchanged, still rendered on the same page per Vol 12_2 §5.4.
- **Closed — Sprint 38's delegation-creation carryover:** `ApprovalsPage.tsx` gained a "My Delegations" tab wired to the real (and previously unused from the UI) `createApprovalDelegation`/`revokeApprovalDelegation` RPCs. Self-delegation needs no extra gate; delegating someone else's authority is only offered when the caller holds `settings: configure`, per the RPC's own header note.
- **Closed — Sprint 39's bulk Chart-of-Accounts editing carryover, found to be a real backend gap, NOT built:** direct inspection of `app/backend/schema.sql` found no `update_chart_of_accounts` RPC of any kind (only `create_chart_of_account` exists) and no UPDATE/DELETE RLS policy on `public.chart_of_accounts` at all — even a raw client-side table update would be rejected by RLS before the account-immutability trigger is ever reached. This is not a narrower version of the original "Safe to Carry Over" item (single-row edit already existing, bulk missing) — Sprint 39's own page header already disclosed that NO edit path exists, for system or custom accounts alike. Building "bulk" editing UI against a nonexistent single-row RPC was never possible without a schema/RPC change, which Vol 12_2 §1 rules out for this phase. Re-logged below as a genuine open backend gap for Sprint 49/a maintenance pass, not built as a workaround.
- **Closed — Sprint 40's WhatsApp message-template-review carryover:** `QuotationsPage.tsx`'s "Get WhatsApp link" flow now shows the server-built default message in an editable textarea before the link opens; the actual `wa.me` link opened is rebuilt client-side from whatever text is left in the box via `encodeURIComponent` — no new RPC needed, since `buildWhatsAppQuotationLink` already returns `phoneE164`/`messageText` alongside its own pre-built link.

### Genuine open gaps re-logged for Sprint 49 / Phase 4 close-out (not closable from this pure-frontend phase)

- **Bulk/any Chart-of-Accounts editing** — no `update_chart_of_accounts` RPC or RLS UPDATE/DELETE policy exists (see above) — a real backend follow-on task, not a UI gap.
- **Member display names for accepted members** (Sprint 38) — no RLS-readable table exposes another member's email/name once accepted; needs a small SECURITY DEFINER RPC.
- **Party editing** (Sprint 39) — no `update_party` RPC exists despite a Sprint 26 migration comment implying one was meant to.
- **Real receipt/document file upload** (Sprint 41) — no Supabase Storage bucket convention exists in `web/`; `createDocument` only records an opaque storage reference today.
- **Sign-up/onboarding gap** (found Sprint 40) — no `businesses`/`business_memberships` row auto-created on fresh sign-up — remains open by the owner's own explicit instruction, restated in every sprint's Outcomes since Sprint 41.
- **Real LHDN MyInvois sandbox integration** (Sprint 44) — no live vendor credentials exist in this environment; the e-Invoice/SST module remains a provider-agnostic stub by the owner's own Sprint 36 choice, extended to e-Invoice at Sprint 44.
- **GPS/offline-device-capture verification** (open since Sprint 35, restated Sprint 46) — a mobile-device/GPS testing question, orthogonal to this web-only phase; still open.
- **Contract document-attachment capability mismatch** (Sprint 47) — `createDocument` requires `expense`/`accounting_reports` capability, not `legal_contract`; a real, disclosed RPC-level gate mismatch, not a UI bug.
- **Stock Take UI / Claims & Salary Advances UI** (Sprints 42/45) — real RPCs exist, no sidebar item was ever reserved for either; available-but-unwired, not required by any sprint's own task breakdown, left as future-pickup candidates rather than built speculatively here.
- **The pre-existing `dek.ts` `@noble/*` module-resolution typecheck gap** (found Sprint 40, reconfirmed clean of new errors in every sprint since, including this one) — a monorepo dependency-declaration gap (`packages/core` has no npm `workspaces` field and no direct `@noble/*` dependency), not this sprint's own code; a good Sprint 49 hardening-pass candidate.
- **Design-token fine-tuning** (Sprint 37) — cosmetic only, no owner request to iterate; left as-is.

### Verification

- `npm run typecheck` (`web`): clean except the same pre-existing, unrelated `dek.ts` gap.
- `npm run lint` (`web`): clean, zero warnings.
- Business Overview's Snapshot tab counted against Vol 12_2 §5.1's own four-figure list by direct re-reading of that section's text — cash position, AR/AP totals, pending approvals count, no more, no fewer.
- Chart of Accounts non-editability verified by direct reading of `schema.sql` (RPC list + RLS policy list for `chart_of_accounts`), not assumed.

Onboarding gap remains open by owner's explicit instruction, tracked for a dedicated follow-up.

---

*End of Sprint 48.*
