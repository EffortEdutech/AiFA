# Sprint 15 — Device Registry & Active-Device Lock Runbook

**Purpose:** documents the backend contract built this sprint — schema, RPCs, and the concurrency guarantees behind them — since Sprint 15's own Theme calls this "the single most load-bearing piece of new infrastructure in this whole plan" and requires proof, not just a design description, that the lock is atomic under real concurrent timing.

**Companion documents:** `Sprint_15_Device_Registry_And_Active_Device_Lock_Backend.md` (this sprint's task breakdown), Vol 12_1 §5a (Device Registry & the Active-Device Lock) and §6a (Active-Device Handoff Protocol), ADR-003 and ADR-004 (`Vol_4_0_0`).

---

## 1. What was built

`public.devices` and `public.active_device_lock` (appended to `app/backend/schema.sql`), plus four `SECURITY DEFINER` RPCs: `register_device`, `request_activation`, `request_primary_takeover`, `set_primary_device`. No mobile or web client code calls any of this yet — per the sprint's own DoD, it is verified entirely via direct RPC calls against Postgres, the same way Sprint 14's RLS was verified.

## 2. Two design decisions this sprint had to resolve (not fully specified in Vol 12_1's prose)

**Optimistic concurrency on the ordinary handoff.** Vol 12_1 §6a.2 describes `request_activation`'s three server-side checks (sync-before-write, registered/non-revoked, then grant) but doesn't specify what happens when two devices call it at genuinely the same instant with the same starting knowledge. Taken literally, two such calls would both individually satisfy every check §6a.2 lists and both succeed sequentially, with whichever transaction happens to commit second silently overwriting the first — the lock ends in a valid state, but Sprint 15's own Definition of Done is stricter: "confirm exactly one succeeds and the other receives a clear rejection, never both succeeding." To make that literally true under real concurrent timing (not just sequential-looking manual tests), `request_activation` takes a fourth parameter, `p_expected_lock_token` — the lock token the requesting device last observed (via its Realtime subscription, per §6.2) — and the atomic grant is a compare-and-swap: `UPDATE ... WHERE lock_token IS NOT DISTINCT FROM p_expected_lock_token`. Whichever request's expected token is still current wins; the other's `UPDATE` matches zero rows and raises `lock_conflict`, telling the client to refresh its observed lock state and retry. This is an engineering refinement beyond Vol 12_1's literal text, made explicitly to satisfy "genuinely impossible for two devices to both think they can write" (§5a.2) as a real guarantee under concurrent timing, not just an documented intention.

**Primary takeover deliberately has no such check.** Per §6a.5 / ADR-004, the primary device must always win regardless of the current lock holder — so `request_primary_takeover` has no compare-and-swap at all, only the shared sync-before-write precondition. This asymmetry is the actual backend expression of "no different safety rule for primary, only a different response the client uses to choose which prompt to show" (Sprint 15's own task breakdown): the safety rule (sync-before-write) is identical on both paths; the concurrency behaviour differs because ADR-004 requires it to.

Every mutating RPC serializes per-business via `pg_advisory_xact_lock(hashtext(business_id))`, so the concurrency test's outcome is deterministic and repeatable rather than depending on incidental transaction timing.

## 3. Schema

- `public.devices`: `device_id` (text PK, client-chosen), `business_id` (→ `auth.users`), `device_label`, `platform` (`ios`/`android`/`web`), `registered_at`, `last_seen_at`, `last_synced_server_seq`, `is_primary`, `revoked_at`.
- `public.active_device_lock`: `business_id` (PK, one row per business), `active_device_id`, `lock_token` (uuid), `acquired_at`.
- `devices_one_primary_per_business`: a partial unique index (`WHERE is_primary = true`) — the "exactly one primary" invariant is a real database constraint, not just something the RPCs are supposed to maintain. Verified directly: a manual `UPDATE` that tries to set a second device primary, bypassing every RPC, is rejected by the index itself with `unique_violation`.
- RLS on both tables: `SELECT` only, scoped to `auth.uid() = business_id`. No `INSERT`/`UPDATE`/`DELETE` policy on either table for the authenticated role — every mutation goes through the `SECURITY DEFINER` functions below, matching Vol 12_1 §5a.2's explicit requirement that the lock be "mutated only through one atomic server-side operation... not a plain client-side update."

## 4. RPCs

- **`register_device(device_id, platform, device_label)`** — onboards a device. First device ever registered for a business (checked under the per-business advisory lock, so two simultaneous "first" registrations can't both believe they're first) is auto-primary and auto-active. Every subsequent device registers read-only, non-primary.
- **`request_activation(device_id, last_applied_server_seq, expected_lock_token)`** — ordinary handoff. Rejects if the device is not registered or is revoked (`device_not_registered_or_revoked`), rejects if the device isn't caught up to the true current `max(server_seq)` (`not_caught_up`), rejects if `expected_lock_token` no longer matches the current lock (`lock_conflict`). Succeeds and grants the lock only if all three pass.
- **`request_primary_takeover(device_id, last_applied_server_seq)`** — forced takeover. Rejects if the device is not the current primary or is revoked (`device_not_primary_or_revoked`), still rejects if not caught up (`not_caught_up` — ADR-004 does not waive this). No lock-token check; if both preconditions pass, it always grants.
- **`set_primary_device(new_primary_device_id)`** — atomic reassignment (clear old primary, set new, in one transaction under the advisory lock).

All four use `auth.uid()` internally to scope every check to the caller's own business — cross-tenant calls (a device ID belonging to a different business) are rejected the same way an unregistered device ID would be, verified directly.

## 5. Verification performed this sprint

All verification ran against a real local Postgres instance (the same simulated `auth.uid()`/`auth.users` setup used for Sprint 14's RLS testing — this sandbox still has no network access to container registries, so a full local Supabase stack could not be pulled here; the owner separately confirmed this schema applies cleanly to their own real local Supabase-CLI/Docker instance when they ran `psql -f app/backend/schema.sql` against it for Sprint 14 — the same file, now with this sprint's section appended, is expected to apply the same way).

- **Primary invariant, enforced not just documented**: a direct `UPDATE` attempting to set a second `is_primary = true` row for the same business is rejected by the unique index (`unique_violation`), independent of any RPC.
- **`register_device`**: first device for a business becomes primary and active; every subsequent device does not; RLS confirms each business sees only its own devices, and an unauthenticated session sees zero.
- **`request_activation`, sequential**: wrong `expected_lock_token` → `lock_conflict`; stale `last_applied_server_seq` → `not_caught_up`; correct token and seq → succeeds and the lock's `active_device_id`/`lock_token` update.
- **`request_activation`, genuine concurrency** (`concurrency_test.py`, two real Postgres connections, `threading.Barrier` to force simultaneous dispatch, 5 repeated trials against a freshly reset lock each time): every trial produced exactly one success and exactly one `lock_conflict` rejection — never both succeeding, never a rejected-rejected or inconsistent outcome. Which device won varied trial to trial (confirming genuine non-deterministic race resolution, not an artifact of thread scheduling order), but the *shape* of the outcome (1 success, 1 rejection) held 5/5.
- **`request_primary_takeover`, genuine concurrency** (`primary_race_test.py`, primary device racing an ordinary device's `request_activation` for the same lock, 5 trials): the primary device was the final `active_device_id` in all 5 trials regardless of which request the database happened to process first — confirming "the primary always wins, unconditionally" holds under real concurrent timing, not just in the sequential case.
- **Stale-token live detection**: after a takeover, a direct comparison of a demoted device's previously-held `lock_token` against the current one shows they differ — demonstrating that any write-permission check performed against the current token, at any point in time (not only at app launch), correctly detects staleness. Building the actual client-side "re-check before every write" behaviour is Sprint 16/17's job; this sprint proves the backend data this check will be based on is always live and correct.
- **Cross-tenant safety**: a device ID belonging to business B, passed to `request_activation` or `request_primary_takeover` by business A, is rejected exactly as an unregistered device would be — the business A caller cannot affect business B's lock or devices at all.

## 6. What is explicitly NOT covered by this sprint

- **Wiring any of this into a mobile or web client.** No screen calls `register_device`, `request_activation`, `request_primary_takeover`, or `set_primary_device` yet — Sprint 16 (mobile sync client) and Sprint 17 (handoff/primary-override UX) build on this.
- **The client-side "live re-check before every write" behaviour itself** (§6a.3) — this sprint proves the token-comparison mechanism it will be based on is correct; the actual UI gating is Sprint 16/17.
- **Device revocation and renaming flows** — Sprint 15's own "Safe to Carry Over" note allows a thin RPC here or a later sprint; none was built this sprint since it wasn't required by the DoD.
- **Applying this migration to a real, live Supabase project** — same carried-forward open item as Sprint 14; the owner's local Supabase instance now has Sprint 14's section applied, Sprint 15's section is ready to apply the same way.
- **Realtime broadcast of lock/device changes** (§6.2's "server broadcasts the `active_device_lock` change via Realtime") — this sprint only proves the underlying state transitions are atomic and correct; wiring Realtime subscriptions is client-side work (Sprint 16+).

---

*End of Sprint 15 Runbook.*
