# Sprint 22 — Multi-User Key-Wrapping Design Review

**Purpose:** review, in writing, whether Vol 13_1 §8's key-wrapping *direction* is safe to build Sprint 23 onward against — per that section's own instruction not to hand over a finished spec without a dedicated review first. This is a design/paper review, mirroring Sprint 14's DEK Distribution Runbook in format; nothing here is implemented yet.
**Companion documents:** `docs/architecture/v2.0/Series_13_Accounting_Compliance_Operations/Vol_13_1_Multi_Role_Tenant_Delegated_Approval_Architecture.md` §8 (the direction this reviews), `docs/sprint-plan/Phase_2_Web_And_Sync/Sprint_14_DEK_Distribution_Runbook.md` (the existing single-owner mechanism this must extend, not contradict).

---

## 1. The Finding That Changes This Review's Shape

Vol 13_1 §8 proposed "a business-level KEK, with the DEK wrapped separately per membership" — language borrowed from conventional envelope encryption (a randomly generated key, stored, wrapped once per recipient's public key). **That is not how AiFA's existing DEK actually works.** Per Sprint 14's runbook: the Business DEK is never generated-and-stored at all — it is **deterministically derived, independently, on every device**, via `deriveBusinessDek(recoveryCode, businessId)` (HKDF-SHA256 over the recovery code and `auth.uid()`). There is no key to "wrap" — there is a **shared secret** (the recovery code) that anyone who has it can turn into the same DEK, offline, with no server round-trip.

This is a materially different starting point than Vol 13_1 §8 assumed, and it is this sprint's first and most important job to reconcile the two rather than build against a mismatched mental model. Section 2 evaluates two real paths forward; Section 5 gives the reviewed recommendation.

## 2. Two Candidate Designs

### Path A — Extend the existing shared-secret model (minimal change)

Every `BusinessMembership` that needs decrypt access receives the current recovery code, entered manually into their device the same way a new device does today (Sprint 14 §2, Step 2) — no new cryptographic primitive, no new key type, no asymmetric keys anywhere in the codebase.

- **Rotation** = generate a *new* recovery code (a new random 32 bytes, same mechanism `getOrCreateEncryptionKey` already uses); every device still needing access — every remaining active membership's device(s) — must re-enter it manually, exactly like onboarding a new device today. `deriveBusinessDek` then produces a new DEK because one of its two inputs changed.
- **Revocation** = rotate. The removed member retains the *old* recovery code and can still derive the *old* DEK from it — meaning any already-synced ciphertext they retained (or any envelope still encrypted under the old DEK that they can still reach) stays readable to them until rotation completes and all remaining devices have moved to the new code. This is the same category of gap Sprint 19's `revoke_device` comment already admits for a single owner's own devices — Path A does not close that gap, it inherits it, now across multiple *people* instead of multiple devices of one person.
- **Cryptographic role enforcement: none.** Because every holder of the recovery code can derive the *same* DEK for the *whole business*, a Warehouse Staff member's device is, cryptographically, just as capable of decrypting Payroll data as the Owner's — Vol 13_1's role/permission model (view/capture/approve per domain) is enforced entirely at the application/RLS layer, never at the encryption layer, under this path. This is the honest limitation Section 5 weighs most heavily.

### Path B — True per-recipient envelope encryption (new primitive)

Each `BusinessMembership`'s device generates its own asymmetric keypair (e.g. X25519); the public key is registered against the membership. A real, randomly-generated DEK is wrapped separately for each active member's public key (sealed-box style encryption — only that member's private key can open their copy).

- **Rotation** = generate a new random DEK, re-wrap it for every remaining active member's already-registered public key — no manual re-entry needed on anyone's device, since the server can safely hold each member's *wrapped* copy (only their own private key opens it).
- **Revocation** = simply stop re-wrapping for the removed member's public key on the next rotation. Materially cleaner than Path A: no dependency on every remaining person manually re-entering anything.
- **Cryptographic role enforcement: possible, not automatic.** A single DEK still means "everyone with a wrapped copy can decrypt everything" — Path B's revocation is stronger than Path A's, but true per-*domain* cryptographic segregation (a Warehouse Staff key that literally cannot unwrap Payroll ciphertext) would need multiple DEKs, one per sensitivity tier, each independently wrapped — a further design this sprint does not attempt, flagged in Section 7.
- **Cost:** this is a new primitive with zero precedent anywhere in the current codebase — key generation, per-device secure key storage, a public-key registration flow, and critically, a **lost-device recovery story** this project doesn't have an answer for yet (if a member's only device holding their private key is lost, do they lose access permanently unless someone re-invites them? That question has no existing analogue to lean on, since Path A's shared-secret model sidesteps it entirely — the recovery code itself IS the recovery mechanism).

### Comparison

| | Path A (shared secret, extended) | Path B (per-recipient envelope) |
|---|---|---|
| New primitive required | None | Asymmetric keypairs, per-device |
| Engineering lift | Small | Substantial |
| Revocation cleanliness | Weak — depends on every remaining device re-entering a new code | Strong — server-side re-wrap only |
| Rotation friction | Scales badly with team size (everyone must act) | Low — no action needed from unaffected members |
| Cryptographic role enforcement | None (RLS/app-layer only) | Possible with further design (multi-DEK), not built here |
| Lost-device recovery story | Already solved (recovery code re-entry) | Undesigned — new open question |
| Precedent in this codebase | Direct extension of Sprint 14 | None |

## 3. Rotation Design (Path A, the recommended near-term path — see Section 5)

1. Owner (or anyone with `configure` on `settings`) triggers rotation, most commonly right after removing a `BusinessMembership`.
2. A new recovery code is generated exactly as `getOrCreateEncryptionKey` already does.
3. Every still-active membership is shown a "your business's security code has changed — enter it on each of your devices" prompt (mirrors Sprint 14 §2 Step 2's existing new-device UX, now fired proactively rather than only at first sign-in).
4. Until a given device re-enters the new code, it can still derive the *old* DEK and read/write against stale ciphertext locally — it does not silently lose functionality, but per Section 4's negative-test discipline (Sprint 14 §4), it also cannot read anything newly encrypted under the new DEK, so a device that delays re-entry falls behind, visibly, rather than silently.
5. No server-side "rotation complete" state is strictly required for Path A (unlike Path B, where re-wrapping is a real completed/incomplete operation) — rotation is complete, per device, the moment that device re-derives with the new code. This is simpler than Path B but also means there is no clean single moment "the business has finished rotating," only a per-device one.

## 4. Revocation Design and the Honest Exposure Window (Vol 13_1 §8 asked this be stated plainly, not softened)

A removed `BusinessMembership` is **not** cryptographically cut off at the moment of removal under Path A. The actual sequence: `status → removed` (Sprint 24's operation) stops that person from authenticating into the app and stops RLS from returning rows to them (Sprint 23's migration) — but if they retained the recovery code (which they necessarily had, to have been a working member at all) and any local ciphertext, they can still derive the DEK and decrypt anything they already hold, and, until rotation (Section 3) completes, could in principle still decrypt anything newly synced too, if they found a way to reach it outside the now-blocked app/API surface. **The only thing that actually closes this window is completed rotation** — removal alone does not. This mirrors, almost exactly, the honesty Sprint 19's `revoke_device` comment already models for the single-owner device case; Path A does not improve on that pattern, it extends it to people instead of devices.

## 5. Self-Review Against Named Failure Modes

- **Two members removed simultaneously:** no different from one — a single rotation after either/both removals closes the window for both, same mechanism, no special-casing needed.
- **Rotation fails partway (some devices update, some don't):** Path A has no atomic "rotation transaction" to fail — each device updates independently on its own schedule when the owner (or that person) acts on the re-entry prompt. This is a feature, not a bug, under Path A (no distributed-transaction risk) but does mean "rotation is done" is a fuzzy, not a crisp, business-wide state — acceptable for Path A's scope, explicitly not acceptable if this project ever needs "prove, for audit, that a specific person's access was fully closed off by time T" — which Section 7 flags as exactly the kind of requirement that would force a move to Path B.
- **Data captured between removal and rotation completing:** captured correctly under whatever DEK is currently in use by the capturing device (could be the old or the new, depending on whether that specific device rotated yet) — no data loss, but this is precisely the exposure window Section 4 already names; capture itself is not a new risk beyond what Section 4 already states.

## 6. Interaction with ADR-003 (Active-Device Write Lock) — a Real Structural Conflict Found, Resolved in Direction

Reviewing this surfaced something Vol 13_1 §8 flagged only vaguely ("confirm whether it still holds per-membership or needs its own amendment") and this review must state plainly rather than leave soft: **ADR-003's single-active-device-write-lock (Vol 12_1 §5a-8) was designed for one owner's own multiple devices, trading write access between a phone and a laptop that are never used at the same moment by two different people.** Applied unmodified to team mode, it would mean an entire business — Sales Agent, Bookkeeper, Payroll Admin, Owner, everyone — can only ever have *one* of their devices writing at a time, business-wide, with everyone else locked to read-only until an explicit handoff. That is not a minor rough edge; it makes genuinely concurrent team use — the entire point of Vol 13_1 — impossible as designed.

**Owner decision (2 September 2026):** rather than defer this to a later sprint as an implementation task, the owner judged it more urgent than that — it needed resolving in direction *before* Sprint 23 writes any `devices`/`active_device_lock` schema migration that would otherwise bake in the wrong (per-business) assumption. It is therefore resolved here, not merely flagged: the write-lock scope moves from *per-business* to *per-`BusinessMembership`* — each team member's own device(s) trade exclusive write access only among themselves, the way ADR-003 already works for a single owner, while different members write concurrently against each other, relying on the already-append-only `sync_envelopes` log (ordered by `server_seq`) for safety rather than a business-wide exclusive lock. A solo business (one membership) degenerates back to exactly today's behaviour — no change for the common case.

Vol 12_1 has been amended in place to Version 1.4, §5b, recording this direction and its rationale. The concrete schema/RPC rework (`active_device_lock`/`devices` gaining `business_membership_id`; `register_device`, `request_activation`, `request_primary_takeover`, `set_primary_device`, `revoke_device` re-scoped accordingly) is **added to Sprint 23's own Task Breakdown** — that sprint already migrates `devices`/`active_device_lock` RLS from `auth.uid() = business_id` to membership-based checks, so implementing the correct scope there the first time avoids a second migration later. This is no longer an open item carried to Sprint 24; see Section 9.

## 7. What Remains Genuinely Open (not resolved by this review)

- Path B's exact algorithm choice (X25519/libsodium sealed boxes vs. an alternative) is not selected here — a real implementation of Path B needs that choice made by whoever builds it, ideally with specialist input.
- Path B's lost-device recovery story (Section 2) has no proposed answer yet.
- Multi-DEK, per-sensitivity-tier segregation (true cryptographic enforcement of Vol 13_2 §9's payroll access restriction, not just RLS) is named as a real, desirable future direction, not designed here.
- Whether Path A's weaker guarantee is acceptable for payroll/HR data specifically, or whether those domains should stay restricted to Owner/Payroll-Admin devices only until Path B exists, is a risk decision for the owner (Section 8 records it).

## 8. Go/No-Go Decision (2 September 2026)

**GO — Sprint 23 proceeds.** `Business`/`Role`/`Permission`/`BusinessMembership` schema (Vol 13_1 §2-4) has no dependency on which crypto path is chosen — it is relational data, gated by RLS, independent of Section 2's analysis. No reason to hold it.

**GO, with an explicit, informed limitation — Path A is the near-term crypto model for Sprint 24-25 and Sub-phase 3b's non-sensitive-domain modules.** Ships fast, extends a proven mechanism, and its weaker revocation guarantee is disclosed plainly (Section 4) rather than overstated — matching this whole project's standing "explained, never silent" discipline. **Path B is deferred, not abandoned**, and is required — not optional — before payroll/HR domain data (Vol 13_0 §10-11, Sprint 34-35) is genuinely opened to a multi-person team; see the owner decision recorded in Section 9.

**RESOLVED IN DIRECTION, elevated ahead of schedule — ADR-003 amendment (Section 6).** Not deferred to Sprint 24: the owner judged this urgent enough to resolve before Sprint 23 writes schema, so Vol 12_1 is amended (V1.4, §5b) now and the concrete `active_device_lock`/`devices` re-scoping is added to Sprint 23's own Task Breakdown, folded into the RLS migration that sprint already performs.

## 9. Owner Decision Recorded (2 September 2026)

**Decision 1 — Path A/Path B (Section 2, Section 8):** Accepted as recommended. Path A (extend the existing shared-secret/recovery-code model) is the crypto model for Sprint 24-25 and Sub-phase 3b's non-sensitive-domain modules. Path B (true per-recipient envelope encryption) is deferred, not abandoned, and is required before payroll/HR data (Sprint 34-35) is opened to a multi-person team. No additional interim guardrail on payroll/HR access was requested beyond what Section 7/Section 8 already state.

**Decision 2 — ADR-003 / write-lock scope (Section 6):** The owner judged this more urgent than the original "add as a required Sprint 24 task" recommendation. Direction: resolve it now, before Sprint 23 writes any schema that assumes per-business lock scope. Acted on accordingly — Vol 12_1 amended in place to Version 1.4 (new §5b: per-`BusinessMembership` write-lock scope), and the concrete migration task added to Sprint 23's Task Breakdown (see that sprint's plan) rather than Sprint 24's.

---

*End of Sprint 22 Multi-User Key-Wrapping Design Review.*
