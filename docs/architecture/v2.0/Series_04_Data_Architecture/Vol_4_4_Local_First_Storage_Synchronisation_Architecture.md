# AIFA — Local-First Storage & Synchronisation Architecture
## Volume 4_4 — Series 4: Data Architecture — Version 2.0

**Status:** Complete
**Realism correction applied:** Yes — see Vol 0_1, Section 3.1 (offline scope)

---

## 1. Purpose

This volume defines how AIFA resolves local-first data ownership with the need for cloud AI, backup, and multi-device continuity — including the Phase 1 reality that AI reasoning, unlike data storage, is not optional.

## 2. Core Principle

> Knowledge stays with the owner. Intelligence may be borrowed when authorised.

## 3. What Lives Locally

The device stores, as the primary system of record:

- Finance PKA package(s)
- Business Events
- Business Data
- Financial Data
- Business Knowledge Store
- Documents (receipts, invoices, statements)
- Local indexes (for KRCE retrieval)
- Runtime configuration and user preferences
- Local retrieval capability
- Temporary Runtime Memory cache

## 4. What Goes to the Cloud, and When

| Cloud Interaction | What Is Sent | What Is Never Sent | Phase |
|---|---|---|---|
| Cloud AI reasoning (required in Phase 1 for interpretation/advisory) | A minimal Professional Context Bundle (Vol 3_1) | The full Finance PKA, the full business database | 1 |
| Encrypted backup | Encrypted snapshots of local data | Unencrypted business data | 1 |
| Multi-device sync | Encrypted deltas of Business Events/Data/Knowledge | Nothing beyond what's needed to reconcile devices | 2 |

Backup (upload-only, restore-on-new-device) ships in Phase 1; live multi-device sync ships in Phase 2 once there is real multi-device usage to justify the added conflict-handling complexity (Vol 0_1, Section 4).

## 5. Synchronisation Model

```text
Device A (local-first store) ⇄ Encrypted Sync Service ⇄ Device B (local-first store)
```

Synchronisation reconciles Business Events, Business Data, Financial Data, and Business Knowledge Store changes across a business owner's devices. The Finance PKA itself is not synchronised peer-to-peer between devices — each device installs it directly from the distribution channel (Vol 8_5) to guarantee package integrity.

## 6. Conflict Handling

Because Business Events are append-only and immutable (Vol 4_0), most sync conflicts reduce to ordering rather than content conflicts. Where two devices capture events concurrently, both are preserved with distinct Business Event IDs; no event is silently dropped or merged.

**Phase 1 status:** this entire concern is moot at launch — Phase 1 ships backup/restore only, not live multi-device sync (Section 4), so there are no concurrent devices to conflict. **Phase 2 open item:** once live sync ships, a formal cross-device conflict-resolution policy for concurrent Business Knowledge Store updates (as opposed to Business Events, which don't conflict by construction) still needs to be finalised, and remains tracked in Vol 4_0_0, Section 6. A reasonable default to evaluate then: last-confirmed-write-wins per knowledge key, with the losing update surfaced to the owner rather than silently discarded — consistent with the "surface, don't auto-resolve silently" principle already stated above.

## 7. Offline Behaviour

Capture, storage, and viewing existing data (Vol 7_4) function fully offline against local storage — nothing about logging a Business Event or checking the dashboard ever waits on a network call. Interpreting a new event into bookkeeping records and generating advisory guidance require cloud AI in Phase 1 and queue for processing when offline, rather than running degraded locally (see Vol 0_1, Section 3.1 for why "AI works fully offline" was corrected). Backup is additive and not required for the core loop; live sync is a Phase 2 capability.

## 8. Sprint 9 Concrete Implementation

Section 4's "Encrypted backup" row is implemented in two layers, deliberately split by what can be verified where (Vol 8_2 §2, Vol 11_0 §5): `app/src/db/backupRepository.ts` is the engine-agnostic core — `createLocalSnapshot` reads every Phase 1 table listed in Section 3 (except the Finance PKA, which is bundled with the app itself, not per-business data) into one portable JSON object; `restoreFromSnapshot` inserts it into any migrated database via generic, column-name-driven `INSERT OR IGNORE`. This layer has no native or network dependency at all and is fully unit-tested (a source-db-to-target-db round-trip asserting cash position, receivables, payables, and every table's row count match). `app/src/db/backupService.ts` is the native/network layer: it wraps that JSON snapshot in a small SQLCipher-encrypted temporary SQLite file (reusing the SAME device key that already encrypts the main local database — Section 3's encryption mechanism, not a new one) and uploads the raw encrypted bytes to Supabase Storage.

Section 6's "no live sync, backup/restore only" is upheld exactly — there is no delta/incremental mechanism; every backup is a full snapshot, matching this section's own "Phase 1 status: this entire concern is moot at launch."

**A real, honestly-stated gap:** both `uploadBackup` and `restoreLatestBackup` require a signed-in Supabase user (the backend's RLS policies are keyed on `auth.uid()`), and sign-up/sign-in screens do not exist yet in this codebase (carried since Sprint 2, scheduled for Sprint 10). Both functions throw a clear, distinct error rather than fabricating a user id or failing silently. This means the backup MECHANISM is complete and (where testable without a device) verified, but end-to-end backup/restore through a real account is not yet possible — a dependency gap between this volume's Phase 1 scope and Vol 8_1's Phase 1 auth scope that Sprint 10 needs to close.

Restore onto a genuinely NEW device (Section 6 is moot for conflicts, but key recovery still matters) needs the SAME SQLCipher key the backup was encrypted with — since that key lives only in the original device's platform keychain (Vol 8_2), it cannot be regenerated on a new device. Phase 1's answer is a "recovery code": the same device key, exposed via `getDeviceEncryptionKey` (db/client.ts) for the owner to save themselves, since there is no passphrase-derived key-wrapping scheme in Phase 1.

**Sprint 10 update:** the Settings screen now has a "reveal recovery code" control (`SettingsScreen.tsx`, Vol 7_7) closing the specific "if a device's keychain is cleared before that UI exists, backups become unrecoverable" risk stated above — an owner can now view and save this code proactively. What is still NOT built: a button to actually trigger a backup upload, or a field to enter a recovery code to restore onto a new device — `uploadBackup`/`restoreLatestBackup` (backupService.ts, Sprint 9) still have no owner-facing entry point, only this one reveal control. That remains a real, carried-forward gap, not silently closed.

## 9. Relationships to Other Volumes

- Vol 1_3 (Technology Architecture) states this principle at the product-foundation level.
- Vol 3_1 (KRCE) is the sole gatekeeper of what leaves the device for AI reasoning.
- Vol 8_2 (Security & Data Protection) defines the encryption used here.
- Vol 8_4 (Synchronisation & Cloud Services Architecture) details the sync service implementation-neutral design.
- Vol 7_4 (Offline & Synchronisation Experience Architecture) covers the owner-facing behaviour.
- Vol 8_1 (Identity & Access Management) is the still-missing prerequisite for real end-to-end backup/restore (Section 8).

---

*End of Volume 4_4.*
