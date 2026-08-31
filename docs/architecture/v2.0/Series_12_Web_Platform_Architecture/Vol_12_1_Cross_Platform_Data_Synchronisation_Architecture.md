# AIFA — Cross-Platform Data Synchronisation Architecture
## Volume 12_1 — Series 12: Web Platform Architecture — Version 1.3 (Proposed)

**Status:** Proposed — architecture design, not yet implemented.
**Applies:** Vol 4_4 (Local-First Storage & Synchronisation), Vol 8_4 (Synchronisation & Cloud Services), Vol 7_4 (Offline & Synchronisation Experience), Vol 11_1 (MVP Data Schema), Vol 12_0 (Web Platform Architecture), ADR-002, ADR-003, and ADR-004 (Vol 4_0_0)
**Relationship to existing volumes:** this volume does not contradict Vol 4_4/Vol 8_4 — it is the concrete Phase 2 realisation of the "live multi-device sync" row those volumes already left open (Vol 4_4 Section 4 and Section 6's "Phase 2 open item"; Vol 8_4 Section 2's "delta synchronisation" and "sync conflict surfacing" rows, both stated there as "remain entirely unbuilt, correctly"). Web is the trigger that makes Phase 2 necessary now rather than later.
**Version 1.1 change note:** the user reviewed Version 1.0 of this volume and gave a firm product requirement that changes the concurrency model: the owner must always be able to see which devices are registered, logged in, active, and synced, and only one device may be active (able to write) at a time — switching the active device requires the newly-active device to sync first, and every other device is stalled into read-only mode. Section 5a, Section 6a, Section 7, and Section 8 were rewritten to reflect this. The Sync Envelope/push/pull mechanics from Version 1.0 (Sections 3, 4, 6.1-6.3) are unchanged — the active-device lock sits in front of them as a write gate, it does not replace them.
**Version 1.2 change note:** the user added a further requirement: one device is designated "primary" by the owner, and the primary device can always reclaim active status and force-drop whichever device currently holds it, with no confirmation friction. Section 5a.4 (new) and Section 6a.5 (new) cover this; Section 8's Devices panel gains a Primary badge and a "Set as primary" action.
**Version 1.3 change note:** during the Phase 2 sprint-planning design sign-off (Sprint 13's own gate, see `docs/sprint-plan/Phase_2_Web_And_Sync/Sprint_13_Design_SignOff_And_Shared_Core_Extraction.md`), the owner revisited Version 1.2's "no confirmation friction" primary takeover and asked for a lightweight confirmation to remain, specifically to prevent an accidental takeover from a stray tap. Section 6a.5 was amended accordingly: primary takeover now shows a single-tap "Take over as active device now?" confirmation, distinct from and faster than the fuller caution prompt a non-primary takeover shows. The sync-before-write safety rule (Section 6a.2) was never in question and is unchanged.

---

## 1. Purpose and Problem Statement

Mobile-only AIFA never needed live sync: one phone is one business's whole local-first store, and Phase 1's answer to "what if I get a new phone" is backup/restore (Vol 4_4 Section 8), not reconciliation between two live devices. A web client changes this completely. The moment a second, independently-usable client exists for the same business, the owner can log a Sale on the phone at 9am and expect to see it on the web Dashboard at 9:05am without manually exporting anything. That expectation is what this volume designs for.

The design goal, stated plainly: **make sync boring.** Because Business Events are already immutable and append-only by construction (Vol 4_0, enforced by the trigger described in Vol 11_1 Section 2), most of what would normally make distributed sync hard — concurrent edits to the same field — does not occur in this schema. Version 1.1 goes further, per the owner's explicit instruction: rather than *allowing* concurrent writes from multiple devices and resolving the rare conflicts after the fact, only one device is ever allowed to write at all. Every other registered device is visible, kept in sync as a read-only mirror, and can become the active (writing) device only through an explicit, visible handoff. This removes almost all need for the conflict-resolution machinery a fully concurrent model would require, at the cost of not being able to capture from two devices at literally the same moment — a trade-off the owner has explicitly chosen and one that fits a single-operator small business far better than always-on multi-writer sync.

## 2. Design Principles

1. **Business Events remain canonical and immutable.** Sync never rewrites history; it only ever adds rows or applies the one narrow, trigger-guarded status transition already defined in Vol 11_1 Section 2.
2. **Every device is offline-first, including web.** A write always lands in the device's own local store first (SQLite on mobile, IndexedDB on web) and is queued for sync — never the other way around. This is the same discipline Sprint 9 already built for the AI-interpretation queue (`isOnline` check, try/catch, `queued`/`queued_retry` states, `useAutoResume`), extended to a second queue.
3. **Conflicts are surfaced, never silently resolved.** Carried directly from Vol 4_4 Section 6 and Vol 8_4 Section 4's diagram.
4. **The cloud becomes a structured, field-encrypted mirror — not an intelligence layer.** Vol 8_4 Section 3's boundary ("never store or process unencrypted business data," "never perform AI reasoning itself") is preserved; only the *shape* of what the cloud stores changes, from one opaque encrypted blob per backup to individually-encrypted rows per business-data field (Section 4). The server still cannot read business content.
5. **Reuse existing idempotency and immutability mechanisms rather than inventing new ones.** Sprint 6/7/12 already solved "the same operation might be applied twice" (deterministic ids + `INSERT OR IGNORE`, the `resumeQueuedWork` in-flight guard). Section 6 applies that exact pattern to sync delivery instead of designing a new de-duplication scheme.
6. **Exactly one device may write at a time (new in Version 1.1).** Concurrency is avoided structurally, not just handled gracefully after the fact. The owner always knows, from any device, which one that is.
7. **The owner is never left guessing about device or sync state (new in Version 1.1).** Registered, logged in, active, and sync-caught-up-or-behind are four distinct, separately visible facts about every device — collapsing them into a single "connected/not connected" indicator is explicitly rejected as insufficient (Section 8).

## 3. Sync Unit: the Sync Envelope

Every row that needs to travel between devices is wrapped in a Sync Envelope before it leaves the device:

```text
SyncEnvelope
├── envelope_id        string, unique = business_id + ":" + device_id + ":" + device_seq
├── business_id         string
├── device_id           string, stable per installed app/browser profile
├── device_seq          integer, monotonically increasing per device (local counter)
├── server_seq          integer, nullable, assigned by the server on ingest — the global ordering key
├── entity_type          enum: business_event | business_data | ledger_entry | document | ai_interpretation
│                              | business_event_status_transition | business_knowledge_entry | app_settings
├── op                   enum: insert | status_transition | upsert
├── payload_ciphertext   bytes — the entity's field-encrypted content (Section 4)
├── payload_iv           bytes — WebCrypto/SQLCipher-compatible IV for this envelope
├── created_at           timestamp, device-local clock (advisory only — server_seq is the real order)
└── applied_at           timestamp, nullable, set locally once a *received* envelope has been applied
```

`op` has exactly three values, matching Section 2's "most things are inserts" principle:

- `insert` — the default for `business_event`, `business_data`, `ledger_entry`, `document`, `ai_interpretation`. Always safe to apply; never overwrites anything.
- `status_transition` — the single case from Vol 11_1 Section 2 (a BusinessEvent moving to `confirmed`, or `superseded_by` being set). Applied only through the existing local DB trigger (Section 7.2).
- `upsert` — for the two genuinely mutable, low-stakes entities: `business_knowledge_entry` and `app_settings` (Section 7.3).

## 4. What the Cloud Stores (extends Vol 8_4 Section 2 and 5)

Today (Sprint 9/Vol 8_4 Section 5), Supabase Storage holds one opaque SQLCipher-encrypted file per backup, and `public.backups` is just a pointer table. This volume adds two parallel structures — it does not remove the existing backup mechanism, which remains useful as the sync bootstrap (Section 10):

```text
public.sync_envelopes (Postgres, RLS-scoped to auth.uid() = business owner)
├── envelope_id           text, primary key
├── business_id           uuid, foreign key, indexed
├── device_id             text, indexed
├── device_seq            bigint
├── server_seq            bigserial, the real ordering column, indexed
├── entity_type           text
├── op                    text
├── payload_ciphertext    bytea
├── payload_iv            bytea
└── server_received_at    timestamptz, default now()
```

```text
public.devices (Postgres, RLS-scoped to auth.uid() = business owner) — new in Version 1.1, see Section 5a
├── device_id              text, primary key
├── business_id            uuid, foreign key, indexed
├── device_label           text, owner-chosen (e.g. "Ahmad's Phone", "Shop Laptop")
├── platform               text, enum: mobile_ios | mobile_android | web
├── registered_at          timestamptz
├── last_seen_at           timestamptz, updated on every successful push or pull
├── last_synced_server_seq bigint, this device's own reconciliation checkpoint (Section 6.2)
├── is_primary             boolean, default false — exactly one true per business (Section 5a.4, new in Version 1.2)
├── revoked_at             timestamptz, nullable

public.active_device_lock (Postgres, RLS-scoped to auth.uid() = business owner) — new in Version 1.1, see Section 5a
├── business_id      uuid, primary key (exactly one row per business)
├── active_device_id text, foreign key → devices.device_id
├── lock_token        text, opaque, regenerated on every handoff
└── acquired_at       timestamptz
```

Only `business_id`, `device_id`, `entity_type`, `op`, and the two ordering columns are plaintext in `sync_envelopes` — exactly the columns the server needs to route, order, and enforce row-level security. `payload_ciphertext` is opaque to Postgres and to Supabase's own infrastructure, encrypted client-side with the per-business Data Encryption Key (Section 5) before it ever leaves the device. `devices` and `active_device_lock` are deliberately NOT encrypted — a device label, platform, and lock state are not business data, and the whole point of Section 8's visibility requirement is that every device (and, in principle, the owner via any admin tooling later) can read this plainly. This satisfies Vol 8_4 Section 3's boundary at the field level: the service still never sees unencrypted business data.

## 5. Key Management: the Business Data Encryption Key (DEK)

Mobile's local encryption key (SQLCipher, via the platform keychain — Vol 8_2) cannot be shared safely as-is: it never leaves one device by design. Live cross-device sync needs one key that every authorised device for a business can hold, so this volume introduces a distinct key:

- **Business DEK**: one symmetric key per business, generated on the *first* device that ever sets up that business (mobile, in Phase 1's existing flow). This is the key that encrypts every `payload_ciphertext` in Section 4.
- **Reuses the existing recovery-code mechanism**, rather than inventing a new one: Sprint 10 already built `getDeviceEncryptionKey` and a "reveal recovery code" control in Settings (Vol 4_4 Section 8, Vol 7_7). This volume proposes that the *same* recovery code becomes the vehicle for authorising a new device — mobile or web — to hold the Business DEK: the owner enters it once when signing in on a new device, that device derives/imports the DEK into its own local secure storage (platform keychain on mobile; a non-extractable WebCrypto `CryptoKey` for the browser session on web, per Vol 12_0 Section 6), and the DEK is never transmitted to or stored by the server, in any form, at any point.
- **Entering the recovery code is also what registers the device** (Section 5a) — there is one owner action, not two separate "unlock encryption" and "add this device" steps.
- **Web-specific caveat, stated plainly:** a non-extractable WebCrypto key held in a browser session is materially weaker than a mobile OS keychain entry — it can be lost on "clear site data," a private window, or simply not persisting across browser reinstalls. This is a real, accepted trade-off of bringing a browser into a local-first-by-keychain architecture, not a solved problem (Section 12).
- **No key rotation is designed here.** The single-active-device lock (Section 5a) gives an immediate way to stop a lost or revoked device from *writing* — it simply is never granted the lock again, and its Supabase session can be force-signed-out — but it does not stop that device from *decrypting* `sync_envelopes` rows it already pulled, or new ones, if it still holds the DEK and can still authenticate. Full revocation therefore still needs DEK rotation, which remains the top open item in Section 12.

## 5a. Device Registry & the Active-Device Lock (new in Version 1.1)

This section is the direct answer to the owner's requirement: always know which devices exist and what state each is in, and never allow more than one device to write at once.

### 5a.1 Device states

Four distinct facts are tracked and shown per device — deliberately not collapsed into one status pill, because they answer different owner questions:

| State | Question it answers | Where it's determined |
|---|---|---|
| **Registered** | Has this device ever been authorised for this business? | Row exists in `public.devices`, `revoked_at IS NULL` |
| **Logged in** | Does this device currently hold a valid Supabase session? | Local session state on that device (not centrally trackable in real time, shown as "last seen" instead — Section 8) |
| **Active** | Is this the one device currently allowed to write? | `public.active_device_lock.active_device_id = this device` |
| **Synced** | Is this device's local copy caught up with the cloud? | This device's `last_applied_server_seq` (local) compared against the cloud's current max `server_seq` — "Up to date" / "N changes behind" / "Never synced" |

A device is **read-only** whenever it is registered and not currently active — regardless of its sync state; a read-only device that is also behind is simply "read-only and catching up." A device is **revoked** once `revoked_at` is set — it is not deleted from the registry (the owner should still be able to see "this old phone was removed on 12 Aug"), but it is excluded from ever holding the active lock again and, per Section 5, its Supabase session is force-signed-out server-side as an additional immediate control.

### 5a.2 Why a server-held lock, not a client-negotiated one

The lock cannot be negotiated device-to-device (e.g. "last device to push wins") because two devices could both believe they hold it while offline, which is exactly the split-brain scenario the owner's requirement is meant to prevent. `public.active_device_lock` is therefore a single row, mutated only through one atomic server-side operation (a Postgres transaction / RPC, not a plain client-side update), which is what makes "exactly one active device" an actual guarantee rather than a UI convention. This is a deliberately small, strongly-consistent piece of state sitting next to the otherwise eventually-consistent `sync_envelopes` stream — the one place in this design where strong consistency matters more than availability, because the entire point of the owner's requirement is that it must be genuinely impossible (not just discouraged) for two devices to both think they can write.

### 5a.3 Registering a device

Registration happens once, the first time a device signs in and enters the recovery code (Section 5): the device calls a `register_device` RPC with a self-chosen `device_id`, its `platform`, and an owner-editable `device_label` (defaulted to something reasonable, e.g. "iPhone" or the browser name, and renameable later from the Devices panel, Section 8). The very first device to ever set up a business is also, at that moment, granted the active lock automatically (there is nothing to hand off from), and is set as the primary device by default (Section 5a.4). Every subsequent device registers as read-only, non-primary by default — it does not start active, even though it just proved it holds the DEK; activation is always a separate, explicit step (Section 6a), so plugging in a new device never silently interrupts whichever device the owner is currently using.

### 5a.4 Primary Device (new in Version 1.2)

The owner designates exactly one registered device as **primary** — a durable "this is my main device" label, distinct from **active** ("this is the device currently allowed to write"). The two are independent: a device can be primary and not active (the owner is temporarily working from a laptop while their phone stays primary), or active and not primary (any device can be made active via the ordinary handoff, Section 6a.2-6a.4). Primary answers "which device do I trust to always be able to take back control," Active answers "which device can write right now."

- **Setting the primary device** is an explicit owner action from the Devices panel (Section 8), "Set as primary," on any registered, non-revoked device. It is a small atomic update (`set_primary_device` RPC: clears `is_primary` on whichever device previously held it, sets it on the new one, in one transaction) — the same reasoning as the active lock's atomicity requirement (Section 5a.2) applies here: exactly one primary device must be enforceable as a real guarantee, not a UI convention.
- **The first device to ever register for a business is primary by default** (Section 5a.3) — there being nothing to choose between yet — and stays primary until the owner reassigns it.
- Revoking the current primary device (Section 8) does not automatically promote another device to primary; the owner is prompted to pick a new one (or leave the business with no primary device for the moment — primary is a convenience designation, not a requirement for the app to function, since any registered device can still be manually activated through the ordinary handoff).
- The Devices panel (Section 8) shows Primary as its own badge, separate from the Active indicator, so both facts are visible on every device at once.

## 6. Sync Flow

### 6.1 Push (local change → cloud → other devices)

```text
Local write (capture, confirm, correct, banking entry, knowledge update, settings change)
        ↓
Device checks: am I the current active device? (cached lock_token, refreshed per Section 6a.3) — if not, the
write is blocked at the UI layer before it reaches this flow at all (Section 7 covers the narrow exception:
an offline device that captured before learning it had been demoted)
        ↓
Write lands in local store exactly as today (SQLite / IndexedDB) — unchanged from Sprint 1-12 behaviour
        ↓
A SyncEnvelope is built and appended to a new local `sync_outbox` table (device_seq = local counter + 1)
        ↓
If online: push immediately.  If offline: outbox row waits — reuses Sprint 9's isOnline/queued pattern
        ↓
POST to the sync endpoint (Supabase RPC or Edge Function) with the envelope
        ↓
Server assigns server_seq, inserts into public.sync_envelopes, acknowledges
        ↓
Device marks the outbox row synced and removes it — the canonical local row is untouched;
only the outbox bookkeeping row is cleaned up
```

### 6.2 Pull (cloud → other devices)

```text
Each device holds one checkpoint per business: last_applied_server_seq
        ↓
Online: subscribe via Supabase Realtime to public.sync_envelopes AND public.active_device_lock,
   both filtered on business_id (fallback: poll on reconnect / app foreground)
        ↓
On receipt of a sync_envelopes row with server_seq > local checkpoint:
   - Decrypt payload_ciphertext with the Business DEK (Section 5)
   - Apply through the SAME repository function local writes already use
   - Advance local checkpoint to this envelope's server_seq, and push that checkpoint back to
     public.devices.last_synced_server_seq so every device's Devices panel (Section 8) can show it
        ↓
On receipt of an active_device_lock change:
   - If this device is the new active_device_id: unlock write UI
   - If this device was active and no longer is: immediately lock write UI (Section 6a.3)
   - Every device updates its own rendering of "which device is active" (Section 8)
```

Routing every applied envelope through the same repository functions used for local writes (rather than writing separate "remote apply" logic) is deliberate: it means every invariant already enforced locally — the confirmed-row trigger, the reversal-based correction shape, the idempotent ledger posting — is enforced identically regardless of which device originated the change.

### 6.3 Idempotency

`envelope_id` (`business_id:device_id:device_seq`) is globally unique and deterministic. A re-delivered envelope is a safe no-op on both ends: server-side via a unique constraint on `envelope_id` (`ON CONFLICT DO NOTHING`, the same `INSERT OR IGNORE` idiom already used for ledger settlement ids since Sprint 6/7), device-side because applying an already-applied envelope through the existing repository functions hits the existing local uniqueness/immutability guards.

## 6a. Active-Device Handoff Protocol (new in Version 1.1)

This is the mechanism behind the owner's requirement: "switching active device will require sync and stall (read-only mode) of other devices."

### 6a.1 Trigger

The owner opens the Devices panel (Section 8) on the device they want to make active and taps "Make this device active." This is always an explicit owner action on the device being activated — never automatic, and never triggered from a different device ("push" activation is not offered, only "pull": you activate the device you're sitting at).

### 6a.2 Steps

```text
Device X taps "Make this device active"
        ↓
Device X must first be caught up: if its last_applied_server_seq is behind the cloud's current
max server_seq, it runs a normal pull (Section 6.2) to completion first — this is the
"switching requires sync" half of the requirement, enforced before activation, not after
        ↓
Device X calls a request_activation RPC, passing its device_id and its now-current
last_applied_server_seq
        ↓
Server, in one transaction:
   - Verifies Device X's reported checkpoint equals the true current max server_seq for
     this business (rejects the request if a newer envelope arrived in the meantime —
     Device X must pull again and retry, closing the race where "caught up" went stale
     mid-request)
   - Verifies Device X is registered and not revoked
   - Updates active_device_lock: active_device_id = X, new lock_token, acquired_at = now()
        ↓
Server broadcasts the active_device_lock change via Realtime (Section 6.2)
        ↓
Every other registered device, on receiving the broadcast (or on its next reconnect/foreground
check if it was offline), immediately treats itself as read-only — this is the "stall other
devices" half of the requirement
        ↓
Device X's write UI unlocks once it receives confirmation of its own activation
```

### 6a.3 What "stalled / read-only" means concretely

A non-active device does not stop syncing — it keeps pulling normally (Section 6.2), so its data stays current even though it cannot write. Concretely:

- Capture forms, confirm/correct actions, banking entry, and settings edits are disabled in the UI with a persistent banner: "[Device label] is currently active — this device is read-only. Make this device active to make changes here."
- The write-permission check is not a one-time flag read at app launch — it is re-checked against the cached `lock_token` (updated live via the Realtime subscription in Section 6.2, or on next reconnect for an offline device) immediately before any write action, so a device that was active five minutes ago and has since been superseded cannot slip a write through a stale in-memory flag.
- Viewing the Dashboard, AI Workspace (read side), Documents, and Activity Feed all continue to work normally on a read-only device — only the write paths are gated.

### 6a.4 Offline edge case: the previously-active device never sees the handoff

If Device Y (previously active) is offline when Device X requests activation, Y has no way to learn about it until it reconnects — this does not block the handoff (Section 6a.2's server-side steps do not require Y to acknowledge anything), which is intentional: an owner whose old phone is lost, broken, or simply switched off must still be able to activate a new device. Two sub-cases on Y's eventual reconnect:

- **Y made no local writes while offline and demoted.** Reconnect just means Y pulls the envelopes it missed (Section 6.2) and its UI locks to read-only. No conflict, no data at risk.
- **Y made local writes while offline and demoted, unaware it was no longer active.** These sit in Y's local `sync_outbox` (Section 6.1). On reconnect, Y discovers (via the lock broadcast) that it is not the active device. Rather than silently pushing these queued writes as if nothing happened, or silently discarding them, Y surfaces them to the owner as a distinct "N items captured on this device before it was deactivated — review before sending" list. Section 7 below covers exactly how each queued item is reconciled once the owner reviews it; this is the one place the general append-only/status-transition/upsert reasoning from Version 1.0 still matters, now as a rare backstop rather than the everyday mechanism.

### 6a.5 Primary Device Override — Forced Takeover (new in Version 1.2; confirmation behaviour amended 2026-08-31)

The owner's explicit instruction: the primary device can always drop whichever device is currently active and take over. This is layered on top of Section 6a.1-6a.4, not a separate mechanism:

- **The data-safety rule is not waived, even for the primary device.** Section 6a.2's requirement — the activating device must first sync to the cloud's current state before the server grants it the lock — is a correctness requirement (a device cannot safely start writing on top of data it hasn't seen yet), not a courtesy extended to whichever device is currently active. Primary status changes the *confirmation-UX* friction around taking over, never the underlying sync-before-write guarantee.
- **What primary status removes is the FULL caution prompt, not confirmation itself.** Any registered device could already request activation unconditionally under Section 6a.1-6a.2 — no cooperation from the currently-active device is required by the protocol. Activating a *non-primary* device shows a fuller caution prompt if the currently-active device looks like it's genuinely in use (`last_seen_at` within the last few minutes) — it names the device and its apparent in-use state, and requires the owner to read that before confirming: "[Device Y] appears to be in use right now — take over anyway?" **The primary device shows a lightweight, single-tap confirmation instead — "Take over as active device now?" with one Confirm action, no read-then-decide detail about the current device's state.** This is an amendment from Version 1.2's original "no confirmation prompt at all": the owner asked, once this was about to become real rather than hypothetical, for a deliberate acknowledgement step to remain even on the primary path — specifically so a stray tap can't force a takeover unintentionally — while keeping it categorically faster than the non-primary flow.
- **The demoted device is told why.** The lock-change broadcast (Section 6a.2) carries a reason code; when the change was a primary-device takeover, the demoted device's read-only banner reads "[Primary device label] took over as the active device" rather than the generic handoff message — so an owner sitting at a demoted device isn't left wondering what happened.
- **Revocation interaction:** when Section 8's "revoking the active device requires immediately activating a replacement" rule fires, the primary device (if it is not the one being revoked) is offered as the default suggested replacement.
- **Explicitly out of scope:** automatic, unattended failover to the primary device (for example, auto-promoting it if the active device has been silent for some threshold with no owner action). Every takeover, primary or not, is still triggered by an explicit tap-then-confirm on the device being activated (Section 6a.1) — this keeps "exactly one writer, always by deliberate owner choice" simple and consistent with the rest of this design being owner-initiated rather than system-initiated. Noted as a possible future enhancement, not designed here.

## 7. Reconciling Offline Writes From a Demoted Device — the Backstop Case

With the active-device lock in place (Section 5a-6a), two online devices can never both attempt to write — the lock makes that structurally impossible, not just unlikely. The only remaining case where a genuine conflict can arise is Section 6a.4's second sub-case: a device captured data offline, unaware it had just been demoted. This section is deliberately narrow — it is what Version 1.0 designed as the everyday conflict-handling model; in Version 1.1 it only ever fires in this one edge case, entity by entity:

### 7.1 Append-only entities: BusinessEvent (insert), BusinessData, LedgerEntry, Document, AiInterpretation

These never conflict, by construction, even from a demoted device — they are always new rows with their own ids. Once the owner reviews the "N items captured before deactivation" list (Section 6a.4), these are safe to push exactly as any other queued write; no arbitration is needed, they simply become part of the business's history alongside whatever the newly-active device recorded in the meantime. The owner's review step exists to give visibility ("oh, I did log that expense on the old phone before switching"), not to gate correctness.

### 7.2 The one real case: BusinessEvent status transition (confirm / correct)

If the demoted device's queued items include a confirm/correct action on an event that the newly-active device *also* confirmed or corrected in the meantime, only one can win — resolved exactly as Version 1.0 designed: the transition travels as a `status_transition` envelope, applied through the existing Sprint 3/4 trigger (Vol 11_1 Section 2, migration 4), which permits exactly one `superseded_by` NULL→value transition per event. Whichever transition reaches the trigger second is rejected; the owner, reviewing the demoted device's queued list, sees "this transaction was already confirmed/corrected elsewhere" against that specific item rather than a silent drop.

### 7.3 Genuinely mutable, low-stakes entities: BusinessKnowledgeEntry, AppSettings

If the demoted device's queue includes a knowledge-mapping confirmation or a settings change that the newly-active device also changed, the same default proposed in Vol 4_4 Section 6 applies: last-confirmed-write-wins keyed by `server_seq`, with a one-line provenance note ("updated on [device] on [date]") shown wherever that value next surfaces — never a blocking dialog, consistent with how low-stakes this data is.

### 7.4 Summary table

| Entity | Envelope op | Conflict possible? | When | Resolution |
|---|---|---|---|---|
| BusinessEvent (create) | insert | No | — | N/A — always a new row |
| BusinessEvent (status transition) | status_transition | Yes, narrow | Only via 6a.4's offline-demoted-device case | Existing local trigger; losing write rejected, surfaced in the review list (7.2) |
| BusinessData / LedgerEntry / Document / AiInterpretation | insert | No | — | N/A |
| BusinessKnowledgeEntry | upsert | Yes, low-stakes | Only via 6a.4 | Last-confirmed-write-wins by server_seq, provenance note shown (7.3) |
| AppSettings | upsert | Yes, low-stakes | Only via 6a.4 | Same as above |

## 8. Device Visibility — Always Knowing What's Registered, Logged In, Active, and Synced

This section is the direct design for the owner's first requirement. A "Devices" panel (Settings, both mobile and web — extending Vol 7_7's mobile Settings and Vol 12_0's web Settings parity item) lists every non-deleted row in `public.devices` for the business, synced down like any other read-mostly data, rendered as:

| Column | Source | Example |
|---|---|---|
| Device label | `devices.device_label`, owner-renameable | "Ahmad's Phone" |
| Platform | `devices.platform` | Mobile (Android) |
| Status | Derived: Active / Read-only / Revoked (Section 5a.1) | Active |
| Primary | `devices.is_primary` (Section 5a.4) — shown as a badge, independent of Status | ★ Primary |
| Sync state | Local checkpoint vs. cloud max `server_seq`, or the device's own last-reported `last_synced_server_seq` for a device other than the one you're looking at it from | "Up to date" / "3 changes behind" / "Never synced" |
| Last seen | `devices.last_seen_at` | "2 minutes ago" |
| Registered | `devices.registered_at` | "12 Aug 2026" |

Actions available from this panel: **Make this device active** (only enabled on a device that is fully synced — if it's behind, the button first triggers a sync and then activation, per Section 6a.2; shown as an immediate, no-confirmation action on the primary device and a confirm-if-the-current-active-device-looks-in-use action on any other device, per Section 6a.5), **Set as primary** (Section 5a.4), **Rename**, and **Revoke** (sets `revoked_at`, force-signs-out that device's Supabase session, and — if that device happened to be the active one — requires the owner to immediately activate a different registered device, defaulting to the primary device if one exists and isn't the device being revoked, since the business cannot be left with no possible writer).

This panel is intentionally the same one place both platforms read from, rather than a mobile-only or web-only view — the owner should be able to check "who's active right now" from whichever device is in front of them, including a read-only one.

## 9. Auth and Device Authorisation

Signing in to a device with the same account (existing Supabase email/OTP, Vol 8_1, built Sprint 10) starts the process; entering the recovery code (Section 5) both unlocks the Business DEK and registers the device (Section 5a.3) in one step. A device can be authenticated (logged in) without being active — indeed that is the default state for every device after the first. Because a browser is inherently more exposed than a personal phone (shared or public computers, browser extensions, no OS-level app sandboxing to the same degree), the recommended mitigation is: hold the DEK as a non-extractable, session-scoped WebCrypto key, and clear all local IndexedDB content on explicit sign-out. This is a mitigation, not a guarantee, and is named as such in Section 12.

## 10. Bootstrapping a New Device

Rather than designing a new "initial full sync" mechanism, this volume reuses what Sprint 9 already built: a new device (web or mobile) authorises and registers itself (Section 5a.3, Section 9), then restores from the most recent backup snapshot (`backupRepository.ts` / `restoreFromSnapshot`, Vol 4_4 Section 8) to get a complete local copy in one step, and only then switches to the incremental `sync_envelopes` stream (Section 6) for everything going forward, using the backup's own timestamp to set its initial `last_applied_server_seq` checkpoint. It registers as read-only (Section 5a.3) — becoming active, if the owner wants that, is the separate Section 6a step, done only once the device is confirmed caught up.

## 11. Relationships to Other Volumes

- Vol 4_4 (Local-First Storage & Synchronisation) — Section 4's "multi-device sync" row and Section 6's Phase 2 open item are what this volume implements concretely; the single-active-device model (5a-6a) is a Phase 2 refinement beyond what Vol 4_4 originally sketched.
- Vol 8_4 (Synchronisation & Cloud Services) — Section 2's "delta synchronisation" and "sync conflict surfacing" rows, and the Section 4 flow diagram, are realised here; Section 5 of that volume (the existing backup implementation) is the bootstrap mechanism in Section 10 above.
- Vol 7_4 (Offline & Synchronisation Experience) — the mobile-side owner-facing behaviour this volume's Section 6a.3/Section 8 extend to web and keep consistent with.
- Vol 7_7 / Vol 12_0 Section 4 — Settings screens on both platforms now include the Devices panel (Section 8) as a first-class item, not an afterthought.
- Vol 8_1 (Identity & Access Management) — the auth this volume's Section 9 builds device authorisation and registration on top of.
- Vol 8_2 (Security & Data Protection) — the encryption-at-rest/in-transit principles this volume's Section 4-5 extend to a field-level, DEK-based model.
- Vol 11_1 (MVP Data Schema) — the exact entities and mutability rules Section 3 and Section 7 are built against.
- Vol 12_0 (Web Platform Architecture) — the client this sync design serves; Section 6 there names the IndexedDB/WebCrypto choices this volume assumes.
- Vol 4_0_0 — ADR-002 (cloud sync hub shape), ADR-003 (single active-device write lock), and ADR-004 (primary device designation and forced takeover), the decision records this volume is the detailed design for.

## 12. Open Items (stated honestly, not hidden)

- **No key rotation or full decryption-access revocation.** The active-device lock (Section 5a) immediately stops a revoked device from *writing*, and force-signing-out its Supabase session stops it from authenticating further, but a device that already holds the DEK locally could, in principle, still decrypt data it already has or — if somehow still authenticated — still pull and decrypt new `sync_envelopes` rows before its session is fully torn down. Full revocation still needs DEK rotation, unresolved here and the top-priority follow-up design task.
- **The `request_activation` RPC must be genuinely atomic.** Section 5a.2's whole guarantee depends on the server-side lock acquisition being a single transaction (check-caught-up-and-acquire, not two separate calls) — this needs to be verified carefully at implementation time, not assumed from this description.
- **Metadata exposure trade-off not yet confirmed acceptable.** Section 4's plaintext columns in `sync_envelopes` (`entity_type`, `device_id`, approximate timing via `server_received_at`) are more than the current all-opaque backup blob reveals to the server; `devices`/`active_device_lock` are plaintext by design (Section 4). This should be explicitly signed off, not assumed.
- **Realtime vs. polling has not been load-tested**, and the active-device lock broadcast (Section 6a.2) in particular needs to be reliable — a missed broadcast just means a stale "who's active" display until the next reconnect/poll, not a write-safety issue (the write gate is re-checked against the lock, Section 6a.3), but the UX should not silently show the wrong device as active for long.
- **Web-specific storage fragility (Section 5, Section 9) is a real, accepted weakness**, not a solved problem — a browser's "clear site data" or a new machine forces re-authorisation, re-registration, and re-download via Section 10's bootstrap; this is expected behaviour, but should be communicated to the owner in-product.
- **The lightweight-confirmation primary takeover (Section 6a.5) still trades most of a safety net for speed** — a primary-device takeover only shows a single-tap "take over now?" prompt, not the fuller caution detail a non-primary takeover shows, even if the currently-active device is mid-write on a slow connection. In practice this is safe (the sync-before-write rule still applies, so no data is lost — the worst case is the previously-active device's owner is surprised), and the 2026-08-31 amendment already answers the earlier open question of whether *zero* confirmation was too little; whether this lighter-but-not-zero confirmation is calibrated right is still worth re-confirming once the primary-device flow has real usage to observe.
- **What happens if the owner revokes the only registered device, or all devices are offline and the active one is lost with no other device ever registered:** Section 8 requires an owner to immediately activate a replacement when revoking the active device, but the harder case — the sole device is lost, not revoked in advance — has no built-in remote "break glass" recovery beyond Section 10's normal new-device bootstrap (which still works, since the recovery code and cloud data are independent of any specific device's lock status). Worth confirming this is an acceptable answer before implementation.
- **This entire volume is unimplemented.** Every section above is a design, not a report of built/verified code, unlike the corresponding sections of Vol 4_4/Vol 8_4/Vol 11_1 that describe what Sprints 1-12 actually shipped. Building this should follow the project's existing sprint discipline (Vol 0_1) — proposed as its own sprint sequence in a future Vol 0_1 revision or a new Series 12 implementation-foundations pass, not started ad hoc.

---

*End of Volume 12_1.*
