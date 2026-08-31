# Sprint 14 — Business DEK Generation & Distribution Runbook

**Purpose:** documents the exact sequence a device goes through to obtain the Business Data Encryption Key (DEK), per Vol 12_1 §5's own instruction that this "genuinely new path through code originally built for a different purpose" (Sprint 10's recovery code) be written down explicitly, not left implicit. This is an engineering/architecture runbook (how the mechanism works), unlike Sprint 12's runbook (owner actions this AI session cannot perform) — everything here is already implemented and tested (`packages/core/src/sync/dek.ts`, `dek.test.ts`).

**Companion documents:** `Sprint_14_Cloud_Data_Model_And_Key_Management.md` (this sprint's task breakdown), `docs/architecture/v2.0/Series_12_Web_Platform_Architecture/Vol_12_1_Cross_Platform_Data_Synchronisation_Architecture.md` §5 (the design this implements).

---

## 1. The core idea

The Business DEK is never generated once and stored/transmitted anywhere — it is **derived independently, identically, on every device**, from two inputs every authorised device already has:

1. **The recovery code** — the same 32-byte value Sprint 10 already built (`getDeviceEncryptionKey`, exposed via Settings' "reveal recovery code" control). High-entropy, known only to devices the owner has manually entered it into.
2. **The business id** — `auth.uid()`, known to any device signed in to that business's Supabase account (see Section 3 for why this is now the canonical `business_id`, not the old locally-generated one).

`deriveBusinessDek(recoveryCode, businessId)` (`packages/core/src/sync/dek.ts`) runs HKDF-SHA256 (RFC 5869) over these two inputs and returns a 32-byte AES-256 key. Because HKDF is deterministic, two devices that independently call this function with the same two inputs always get the identical key — **nothing about the DEK itself is ever transmitted, in any form**, satisfying Vol 12_1 §5 by construction rather than by an encrypted-transport promise.

## 2. Sequence: new device → recovery code entry → DEK receipt → ready to encrypt/decrypt

1. Owner signs in on the new device with existing Supabase email/OTP auth (Vol 8_1, Sprint 10). The device now knows `auth.uid()`.
2. Owner is prompted for the recovery code — the same value Settings' "reveal recovery code" control on an already-set-up device shows them (Sprint 10, `getDeviceEncryptionKey`). This single entry does double duty (Vol 12_1 §5): it is also what registers the device (Section 5a — Sprint 15's scope, not built yet).
3. The device calls `deriveBusinessDek(recoveryCode, auth.uid())`. This is synchronous, local, and offline-capable — no network round-trip is needed to obtain the DEK itself.
4. **First device only** (setting up a business for the first time — no recovery code exists yet from a prior device): the device generates its own recovery code exactly as `getOrCreateEncryptionKey` already does (`Crypto.getRandomBytesAsync(32)`, hex-encoded), then derives the DEK from that freshly generated code the same way. There is no separate "generate the DEK" step distinct from "derive it" — having a recovery code is sufficient.
5. The derived DEK is held in the device's own secure local storage for the remainder of the session/app lifetime (platform keychain on mobile via SecureStore, matching Sprint 1-13's existing pattern; a non-extractable WebCrypto key for the browser session on web, per Vol 12_0 §6 — Sprint 18's scope). It is never written to `sync_envelopes` or any other server-visible location.
6. The device is now able to call `encryptEnvelopePayload`/`decryptEnvelopePayload` (`dek.ts`) for any entity it pushes or pulls (Sprint 16's actual wiring — this sprint proves the primitive works, not the sync flow around it).

## 3. A prerequisite this sprint had to resolve: `business_id` must mean the same thing everywhere

Vol 12_1 §5 assumes `businessId` is available and consistent across devices, but Phase 1's actual local `business_id` (`db/client.ts`'s `getLocalBusinessId`) is a **random value generated on-device before any account exists** — `db/client.ts`'s own comment already flagged that this "is reconciled with real account identity when auth screens are built (Sprint 10)," but that reconciliation was never actually implemented. Left as-is, two devices for the same business would derive **different** DEKs, because they'd be salting the HKDF call with two different, unrelated `business_id` values.

**Resolution (this sprint):** `business_id`, for any cloud-synced business, is defined to be `auth.uid()` — the same value `public.profiles.id` already uses (Vol 11_0 §5). `packages/core/src/sync/businessIdentity.ts`'s `reconcileLocalBusinessId(db, oldBusinessId, canonicalBusinessId)` performs the one-time local repoint: every row in `business_events`, `business_knowledge_entries`, and `app_settings` (the three local tables that carry their own `business_id` column — see that file's comment for why the list stops there) gets updated from the old random id to the signed-in `auth.uid()`. It is safe to call on every sign-in (a no-op once the ids already match), so no separate "have I reconciled yet?" flag is needed.

**Where this gets called from** (not yet wired — Sprint 16, when the sync client actually exists): immediately after the owner enters the recovery code (Step 2 above), before the device is considered ready to push or pull. This sprint delivers the function, tested in isolation (`businessIdentity.test.ts`); wiring it into the actual sign-in/recovery-code screen happens alongside Sprint 16's sync client work.

## 4. Verification performed this sprint (in isolation, per this sprint's own Theme)

- **Determinism**: `deriveBusinessDek` called twice with the same inputs returns byte-identical keys (`dek.test.ts`).
- **Isolation**: a different `businessId` or a different `recoveryCode` derives a different DEK — confirms the salt/IKM actually matter, not just that the function runs.
- **Round-trip**: payload encrypted by one simulated device is decrypted correctly by a second simulated device that independently derived the same DEK — proves the "no transmission needed" design actually works, not just compiles.
- **Negative test**: a device holding a different DEK (wrong recovery code) cannot decrypt — throws, rather than returning garbage, satisfying this sprint's explicit "confirm a device without the DEK cannot read `payload_ciphertext`" DoD item.
- **Tamper detection**: a single flipped bit in the ciphertext fails to decrypt even with the correct DEK — AES-GCM's authentication tag catches corruption/tampering, not just wrong keys.
- **Reconciliation correctness**: `reconcileLocalBusinessId` repoints every business_id-bearing row, leaves every other column untouched, and is a safe no-op when called again.
- **Schema/RLS**: `public.sync_envelopes` applied to a local Postgres instance (this sandbox has no network access to Docker's registries, so the full local Supabase stack could not be pulled — plain PostgreSQL 16 plus a minimal hand-rolled `auth.uid()`/`auth.users` simulation was used instead, sufficient to exercise real RLS policy evaluation) — verified with two distinct simulated business accounts: each can insert/read only its own envelopes, a cross-tenant insert is rejected by RLS (not just application logic), an unauthenticated session sees zero rows, and the pull-query index (`business_id, server_seq`) is actually used by the query planner rather than falling back to a sequential scan. `public.profiles`/`public.backups` (Phase 1) were confirmed structurally unchanged after the migration.

## 5. What is explicitly NOT covered by this sprint

- **Applying this migration to a real, live Supabase project.** No AiFA-specific Supabase project has been confirmed set up as of this sprint (carried-forward open item since the Phase 2 design sign-off) — `03_sprint14_sync_envelopes.sql`'s statements are ready to run in the Supabase SQL editor (or via `apply_migration`) the moment a real project exists, but that step is the owner's to do or explicitly hand back to this session once a project is available.
- **Wiring any of this into the app's UI or sign-in flow.** No screen calls `deriveBusinessDek` or `reconcileLocalBusinessId` yet — Sprint 16 (mobile sync client) is where that happens, per this sprint's own Theme ("nothing reads or writes envelopes yet").
- **Device registration (`register_device` RPC, `public.devices`) or the active-device lock** — Sprint 15's schema, not this sprint's.
- **Key rotation** — remains Vol 12_1 §12's top open item, unresolved here as documented.

---

*End of Sprint 14 DEK Distribution Runbook.*
