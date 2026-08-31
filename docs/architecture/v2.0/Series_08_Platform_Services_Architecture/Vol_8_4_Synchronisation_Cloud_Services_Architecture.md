# AIFA — Synchronisation & Cloud Services Architecture
## Volume 8_4 — Series 8: Platform Services Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

This volume defines the backend services supporting encrypted backup and multi-device synchronisation, as the service-side counterpart to Vol 4_4 (Local-First Storage & Synchronisation) and Vol 7_4 (Offline & Synchronisation Experience).

## 2. Service Responsibilities

| Responsibility | Description |
|---|---|
| Encrypted backup storage | Store encrypted device snapshots durably |
| Delta synchronisation | Reconcile Business Event/Data/Knowledge deltas across a business owner's devices |
| Sync conflict surfacing | Detect and surface (not silently resolve) conflicting concurrent changes |
| Package distribution relay | Work with Vol 8_5 to deliver Finance PKA updates to devices |

## 3. What This Service Never Does

- Store or process unencrypted business data
- Merge business data into the Finance PKA
- Perform AI reasoning itself — it is a storage/sync service, not an intelligence layer

## 4. Sync Flow

```text
Device change (Business Event / Data / Knowledge Store update)
        ↓
Encrypted delta queued locally
        ↓
On connectivity: delta uploaded to Synchronisation Service
        ↓
Other registered devices for the same business pull and apply the delta
        ↓
Conflicts (if any) surfaced to the owner, not auto-resolved silently (Vol 4_4, Section 6)
```

## 5. Sprint 9 Concrete Implementation

Section 2's "Encrypted backup storage" is `backend/schema.sql`'s `public.backups` table (pointer metadata: which storage path, whose account, when) plus a real Supabase Storage bucket named `backups` with row-level-security-equivalent object policies (`storage.objects` insert/select/delete policies checking that the first path segment equals the caller's `auth.uid()`) — added this sprint alongside the app-side upload/download code in `app/src/db/backupService.ts`. Delta synchronisation and sync conflict surfacing (Section 2, 4) remain entirely unbuilt, correctly: Phase 1 ships backup/restore only (Vol 4_4 §4, §6), not live multi-device sync.

Section 3's "never store or process unencrypted business data" is upheld by construction: the object the service ever sees is a SQLCipher-encrypted SQLite file's raw bytes — the service has no visibility into its contents, and no encryption/decryption ever happens server-side.

The Section 4 Sync Flow diagram's shape is realised for backup specifically as: local snapshot -> SQLCipher-encrypt (device key) -> upload to Storage -> pointer row inserted into `public.backups`. The "on connectivity" trigger and "other registered devices pull" steps do not apply to backup-only Phase 1 (there is exactly one device's data being preserved, not reconciled across several). This whole flow is presently blocked end-to-end by the absence of Supabase auth screens (Vol 8_1) — both upload and restore require `auth.uid()` to exist, which it does not yet in this codebase (Sprint 10 closes this gap).

## 6. Relationships to Other Volumes

- Vol 4_4 (Local-First Storage & Synchronisation) defines the client-side model this service supports.
- Vol 8_2 (Security & Data Protection) defines the encryption this service relies on.
- Vol 8_5 (Finance PKA Distribution & Update Architecture) is a related but distinct distribution channel.
- Vol 8_1 (Identity & Access Management) is the authentication prerequisite this service's RLS policies depend on.

---

*End of Volume 8_4.*
