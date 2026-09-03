# Sprint 25 — Delegated, SoD-Aware Approval Engine & Role-Gated Capture

**Status: ✅ COMPLETE — 3 September 2026**
**Duration:** Weeks 9–10 (of Phase 3)
**Architecture references:** Vol 13_1 §5 (Delegation), §6 (`ApprovalTask`); Vol 13_2 (full — Role-Gated Capture & SoD)

## Outcomes (recorded 3 September 2026)

`public.approval_tasks`, `public.approval_delegations`, `public.segregation_of_duties_policies` built with RLS; the full Vol 13_1 §6.1 five-step resolution algorithm (`resolve_approval_task`), `create_approval_task`, `decide_approval_task`, delegation lifecycle (`create_approval_delegation`/`revoke_approval_delegation`, both re-running resolution on affected pending tasks), the Vol 13_2 §3 capture-permission gate (`check_capture_permission`), and the Vol 13_2 §4.3 SoD policy layer (`set_sod_policy`, auto-seeded at Sprint 24's growth-trigger hook) are all live in `app/backend/migrations/sprint25_delegated_sod_approval_engine.sql`, appended to `app/backend/schema.sql`. Client-side: `packages/core/src/sync/approvalEngineTransport.ts`, type-checks clean (see the disclosed pre-existing, unrelated `@types/node`/`@noble/*` dependency gaps below). Verification: `app/backend/verification/sprint25_approval_engine_test.py` — 27/27 checks pass against a full replay of the real, cumulative `app/backend/schema.sql` (Phase 1/2 base through Sprint 25) on a local Postgres instance (Sprint 14's method).

**A real owner decision made mid-sprint, not assumed:** Vol 13_3 §3 requires solo-mode capture/confirm to stay byte-identical to today's behaviour (no separate approval step, since there's no one else); Vol 13_0 §10 separately bars payroll from ever auto-approving via AI confidence. Those two rules were written for different situations but both touch payroll. The owner confirmed a solo business's payroll resolves via `solo_self_resolved` exactly like every other domain — §10's rule targets AI-confidence bypass, not a sole owner's own act of capturing-and-confirming their own payroll run. Implemented as a DB-level hard bar: `create_approval_task` unconditionally rejects `p_auto_approved = true` for `domain = 'payroll'` regardless of what a caller passes, while `solo_self_resolved` (a structurally different path — there being no one else, not an AI-confidence shortcut) is unaffected by that bar. Verified by test (J: payroll auto-approve rejected; A: solo payroll still resolves instantly).

**Two genuine architecture calls, disclosed rather than silently made:**
1. `ApprovalTask` did not exist as a real table before this sprint — Vol 13_0 §3.3 and Vol 13_1 §6 only ever specified it on paper. Built fresh from Vol 13_1 §6's spec (its "revised" supersedes the paper design, not an existing table), plus two `resolved_via` values beyond that section's own four: `solo_self_resolved` (Vol 13_3 §3's own extension) and `blocked_awaiting_reviewer` (this sprint's own addition — Vol 13_2 §4.3's escape valve names a blocking *behaviour* that Vol 13_1 §6 predates having a value for).
2. `BusinessEvent` (Vol 13_2 §2) is still not a standalone table — its fields live inside `sync_envelopes.payload_ciphertext`, unreadable server-side under Vol 13_1 §8's Path A local-first encryption model. Vol 13_2 §2's two new fields (`captured_by_membership_id`, `capture_channel`) are added to `sync_envelopes` as plaintext metadata columns instead (the same treatment `business_id`/`device_id` already get alongside that same ciphertext) — forward-compatible with a future first-class `BusinessEvent` table, and exactly what Section 4's SoD control and Section 5's audit trail need without decrypting anything. A `BEFORE INSERT` trigger (`enforce_own_capture_attribution`) stops a caller from stamping someone else's membership as the capturer — verified by test (L). Correspondingly, Vol 13_2 §3's capture-permission gate is implemented as a pipeline-callable RPC (`check_capture_permission`), matching how §3 itself frames the gate ("today, any input reaching `capturePipeline.ts` is processed unconditionally" — a pipeline-stage problem, not an RLS-on-ciphertext one).

**A design refinement made and tested, not left to guesswork:** Vol 13_2 §5's literal text ("plainly flag the specific case where they are the same person") could be read as flagging every self-approval a policy touches, including an ordinary below-`amount_threshold_myr` self-approval that SoD never actually excluded. Implemented instead as branch-precise: `self_approved_via_escape_valve` is `true` only when the escape valve mechanism itself (the sole-eligible branch, or an Owner-escalation landing back on a maker SoD wanted to exclude) is what produced the self-approval — never for a routine below-threshold or no-policy-in-force self-approval. Verified by test (D/G distinguishing the two).

**A real implementation-vs-spec correction found and fixed during testing, not shipped:** the first delegation-lookup draft required a delegate to independently hold their own `approve` grant on the domain via `role_permissions` — this contradicts Vol 13_1 §5's own statement that delegation "moves *whose queue* a task lands in," exercising the delegator's own permission, not a prerequisite that the delegate already had standing of their own. Caught when a test delegate who already held `approve` on the domain via their own role made the test pass for the wrong reason (`resolved_via = direct_permission`, not `delegation`) — the delegation lookup's own join was masked. Removed the incorrect join; re-verified with a delegate role (Warehouse Staff) that has no independent `sales` approve grant, confirming delegation is what supplies the authority.

**Test harness gaps found and fixed, not schema bugs:** the `authenticated` role's `GRANT ... ON ALL TABLES` from Sprint 23/24's harness never granted sequence usage, so a direct `sync_envelopes` insert as `authenticated` (this sprint's own capture-attribution test, L) failed with a misleading `permission denied for sequence` before ever reaching the trigger under test — fixed by adding `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated` alongside the existing table grant (both must be re-run after any migration creating new tables/sequences).

**Pre-existing, unrelated TypeScript gaps, disclosed rather than worked around:** `npx tsc --noEmit` on `packages/core` surfaces errors in `src/ai/providers/*`, `src/sync/dek.ts`, and `src/testing/testAdapter.ts` — missing `@types/node` and missing `@noble/ciphers`/`@noble/hashes` packages in this sandbox's `node_modules`. None reference `approvalEngineTransport.ts`; confirmed by grep that this sprint's own file produces zero compiler errors. These gaps predate this sprint and are a `node_modules` install-completeness issue, not something this sprint's schema/RPC work touches.

---

## Theme

The last foundation sprint, and the one every module sprint after it directly depends on: the revised `ApprovalTask` (Vol 13_1 §6), delegation (§5), capture attribution and permission gating (Vol 13_2 §2–3), and segregation-of-duties enforcement (Vol 13_2 §4). Nothing in Sub-phase 3b can start meaningfully until this engine exists, since every module's draft-then-approve flow routes through it.

## Objectives

A working, generic `ApprovalTask` engine — resolution algorithm (Vol 13_1 §6.1), delegation, SoD exclusion with its configurable policy and escape valve, and `solo_self_resolved` auto-resolution (Vol 13_3 §3) — exists in `@aifa/core`, exercised end to end by a synthetic test domain (no real module needed yet to prove it works).

## Task Breakdown

### Schema
- `public.approval_delegations` per Vol 13_1 §5
- `public.segregation_of_duties_policies` per Vol 13_2 §4.3, seeded with Vol 13_2 §4.3's default domains at the Sprint 24 growth-trigger hook
- Revise `ApprovalTask` (introduced conceptually in Vol 13_0 §3.3, finalised here) with every field from Vol 13_1 §6 and Vol 13_2 §5's audit additions (`self_approved_via_escape_valve`)
- `BusinessEvent.captured_by_membership_id` / `capture_channel` per Vol 13_2 §2

### Engine Logic
- Implement the 5-step resolution algorithm (Vol 13_1 §6.1) exactly, including the escalate-to-Owner fallback
- Implement delegation lookup (narrowing-only scope, respecting the delegate's own lower limit if applicable)
- Implement Section 4's maker-exclusion step, wired into Step 1 of the resolution algorithm as Vol 13_2 §4.1 specifies
- Implement the escape valve (Vol 13_2 §4.3's `allow_self_approval_if_sole_eligible`) with the audit flag always set when it fires
- Implement `solo_self_resolved` per Vol 13_3 §3 — instant same-transaction resolution when `effective_access_model = solo`
- Implement Vol 13_2 §3's capture-permission gate ahead of any AI pipeline processing, with the domain-mapping table from Vol 13_2 §3

### Verification
- A synthetic test domain (not a real Vol 13_0 module — those don't exist yet) exercises: direct-permission resolution, delegation resolution, escalation, SoD exclusion, the escape valve firing (with audit flag), and solo-mode auto-resolution — every path in Vol 13_1 §6.1 and Vol 13_2 §4 gets at least one passing test
- Confirm captured_by/decided_by both surface correctly on the same record for the audit-trail claim in Vol 13_2 §5

## Definition of Done

- [x] All new tables live with RLS
- [x] Resolution algorithm implemented and tested against every named path
- [x] Delegation narrowing behaviour verified (delegate never gains more than delegator had) — the delegate's own `approval_limit_myr` is the binding check, and delegation supplies authority rather than requiring the delegate to already hold it (see Outcomes' delegation-lookup fix)
- [x] SoD exclusion + escape valve + audit flag all verified — including the branch-precise flag semantics refinement (see Outcomes)
- [x] Solo-mode instant resolution verified byte-identical in owner-facing effect to pre-Series-13 behaviour, including payroll per this sprint's own owner decision
- [x] Capture-permission gate rejects an unauthorised capture attempt with a clear message, verified by test

## Dependencies

Sprint 23 (schema foundation), Sprint 24 (`effective_access_model`, growth-trigger hook for SoD policy seeding).

## Risks

| Risk | Mitigation |
|---|---|
| Engine built generically enough in theory but the first real module (Sprint 28) reveals an assumption that doesn't fit | Time-box; if Sprint 28 needs a small `ApprovalTask` schema addition, that's an acceptable, expected refinement — flag it as an ad-hoc task against this sprint's output rather than treating it as a Sprint 25 failure |
| Synthetic-domain testing gives false confidence versus a real module's actual data shapes | Sprint 28 (first real module) explicitly re-verifies the full resolution algorithm against real `Invoice`/`Quotation` approval tasks, not just trusting Sprint 25's synthetic coverage |

## Safe to Carry Over

None — this sprint is the hard dependency for all of Sub-phase 3b onward; running long here should delay Sprint 26 rather than ship an incomplete engine.

---

*End of Sprint 25.*
