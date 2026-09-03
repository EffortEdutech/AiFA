# Sprint 22 — Key-Wrapping & Multi-User Crypto Design Review

**Status: ✅ COMPLETE — 2 September 2026**
**Duration:** Weeks 3–4 (of Phase 3)
**Architecture references:** Vol 13_1 §8 (Local-First Encryption vs. Multi-User Access)

## Outcomes (recorded 2 September 2026)

Full technical review: `Sprint_22_Multi_User_Key_Wrapping_Design_Review.md`. Summary — the existing Business DEK is deterministic shared-secret derivation (Sprint 14), not stored/wrapped envelope encryption as Vol 13_1 §8's language assumed; the review reconciled this and compared two paths forward.

| Decision | Resolution |
|---|---|
| Crypto model for Sprint 24-25 / non-sensitive Sub-phase 3b | Path A — extend the existing recovery-code/shared-secret model |
| Crypto model required before Payroll/HR (Sprint 34-35) opens to a team | Path B — true per-recipient envelope encryption (deferred, not abandoned) |
| ADR-003 single-active-device write lock vs. team mode | Real structural conflict found: unmodified, it allows only one device business-wide to write at a time. Resolved in direction — scope moves from per-business to per-`BusinessMembership`. Elevated by the owner ahead of the original Sprint-24 recommendation: amended into Vol 12_1 (V1.4, §5b) now, with the concrete schema/RPC rework added to **Sprint 23's** Task Breakdown, not Sprint 24's |
| Go/No-Go | GO for Sprint 23 (no crypto dependency in the relational schema itself) |

---

## Theme

Vol 13_1 §8 was explicit that it hands over a direction, not a finished spec, and asked for a dedicated review before anything gets built on it. This sprint is that review — design and paper-verification only, no production schema, mirroring how Sprint 14's DEK Distribution Runbook was itself preceded by design work, but going further: this sprint's subject is materially higher-stakes (multiple *people*, not just one owner's devices) and gets treated accordingly.

## Objectives

A written, reviewed key-wrapping design exists — covering per-membership DEK wrapping, the business-level KEK, key rotation on membership removal, and how this interacts with the existing Sprint 14 DEK/Sprint 15-19 device-lock machinery — with an explicit go/no-go recorded before Sprint 23 writes any schema depending on it.

## Task Breakdown

### Design
- Specify the business-level KEK: generation, storage (never in plaintext outside a member's own secure enclave/keychain equivalent), and its relationship to the existing per-business DEK (`deriveBusinessDek`, Sprint 14)
- Specify per-`BusinessMembership` DEK wrapping: what each member's device actually holds, how a newly-active membership receives its wrapped copy, and how this differs from (and reuses what it can from) the Sprint 14 recovery-code distribution mechanism
- Specify rotation: what "issue a new DEK, re-wrap for every remaining active member" actually requires from the sync/local-first model (Vol 4_4, Vol 12_1) — does this need a new sync_envelope entity_type, a dedicated rotation RPC, or something else
- Specify revocation: confirm a removed `BusinessMembership` genuinely loses access after the next rotation, and state plainly what the exposure window is between removal and rotation completing (do not understate this, matching Vol 13_1 §8's own honesty about the current `revoke_device` gap)
- State explicitly how this interacts with Vol 12_1's ADR-003 single-active-device-write-lock — that model was single-owner; confirm whether it still holds per-membership or needs its own amendment

### Review
- Self-review against known failure modes: what happens if two members are removed simultaneously; what happens if rotation fails partway; what happens to data captured between a membership's removal and the next successful rotation
- If any reviewed scenario cannot be answered with confidence, this sprint's Definition of Done is **not met** — record the specific unresolved question and stop rather than proceeding on an unresolved design (see Risks)
- If external/specialist cryptographic review is warranted (a real possibility this design study cannot rule out), record that as a required follow-on before Sprint 23, not skip it

### Output
- A runbook document (mirroring `Sprint_14_DEK_Distribution_Runbook.md`'s format) — `Sprint_22_Multi_User_Key_Wrapping_Design_Review.md`
- An explicit go/no-go statement at the top of that runbook

## Definition of Done

- [x] KEK/per-membership wrapping, rotation, and revocation are all specified in writing
- [x] Every self-review failure mode above has either a confident answer or an explicitly flagged follow-on requirement
- [x] Interaction with ADR-003 (active-device lock) is explicitly stated, amended if needed (amended — Vol 12_1 V1.4 §5b)
- [x] A go/no-go decision is recorded — if "no-go," Sprint 23 does not start until the flagged follow-on is resolved (GO, with disclosed limitations)

## Dependencies

Sprint 21 sign-off complete, including explicit owner understanding that this sprint may conclude "not yet safe to build" rather than a finished spec — that outcome is a legitimate result of this sprint, not a failure of it.

## Risks

| Risk | Mitigation |
|---|---|
| This design review reveals the direction needs specialist audit AiFA's current team can't provide in-house | Record as the go/no-go outcome plainly; do not let schedule pressure turn an honest "no-go, needs specialist review" into a soft "probably fine" |
| Rotation-on-removal is more expensive than assumed (re-encrypting a large local dataset) | Model the cost against realistic data volumes before Sprint 23 commits to a specific rotation trigger/frequency design |

## Safe to Carry Over

If the review is incomplete after two weeks, extend rather than ship a partial go decision — this is the one sprint in the whole plan where running long is preferable to declaring done prematurely, given what depends on it being right.

---

*End of Sprint 22.*
