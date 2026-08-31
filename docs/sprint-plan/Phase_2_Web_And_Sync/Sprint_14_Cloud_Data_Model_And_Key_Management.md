# Sprint 14 — Cloud Data Model & Key Management

**Duration:** Weeks 3–4 (of Phase 2)
**Architecture references:** Vol 12_1 §4 (What the Cloud Stores), §5 (DEK Key Management); ADR-002

---

## Theme

This is where the cloud actually changes shape: `public.sync_envelopes` ships alongside the existing `public.backups`, and every business gets a Business Data Encryption Key distributed through the reused recovery-code mechanism. Nothing reads or writes envelopes yet (that's Sprint 16) — this sprint is schema and key plumbing, verified in isolation.

## Objectives

The `sync_envelopes` table exists in production schema with correct field types and constraints, the DEK generation/distribution path works end-to-end for a fresh device, and payload encryption is verified real (not a placeholder) before anything is built on top of it.

## Task Breakdown

### Schema
- Create `public.sync_envelopes` per Vol 12_1 §4: `envelope_id`, `business_id`, `device_id`, `device_seq`, `server_seq`, `entity_type`, `op`, `payload_ciphertext`, `payload_iv`, `created_at`, `applied_at`
- Add appropriate indexes (business_id + server_seq for pull queries; business_id + device_id + device_seq for idempotency checks — see Sprint 16)
- Row-level security policies scoped to the owning business, consistent with existing `backups` table policy patterns
- Migration is additive only — `public.backups` is untouched; Phase 1 backup/restore continues working unchanged

### DEK Generation & Distribution
- Generate a per-business Business Data Encryption Key, symmetric, distinct from each device's local SQLCipher key
- Wire DEK distribution through the existing Sprint-10 recovery-code mechanism: a device presenting a valid recovery code receives the DEK, rather than any new key-exchange protocol being invented
- Confirm the DEK never transits or is stored in plaintext outside the device's secure local storage
- Document the exact distribution sequence (new device → recovery code entry → DEK receipt → ready to encrypt/decrypt envelopes) as a short runbook, since this is a genuinely new path through code originally built for a different purpose (Sprint 13's sign-off flagged this as a specific risk)

### Payload Encryption Verification
- Implement envelope payload encryption/decryption using the DEK (client-side, before anything reaches `payload_ciphertext`)
- Write a standalone test harness: encrypt a representative payload, store it, fetch it back from a second simulated device holding the same DEK, decrypt, confirm byte-identical round-trip
- Confirm a device without the DEK cannot produce a readable payload from `payload_ciphertext` — negative test, not just the positive path

## Definition of Done

- [ ] `public.sync_envelopes` exists in the production schema with RLS policies scoped correctly
- [ ] Existing `public.backups` / Phase 1 backup-restore flow verified unaffected by the migration
- [ ] A fresh device can complete the recovery-code flow and receive a working DEK
- [ ] Round-trip encrypt→store→fetch→decrypt verified across two simulated devices sharing one DEK
- [ ] A device without the DEK is confirmed unable to read `payload_ciphertext` content
- [ ] Distribution runbook written and stored alongside this sprint's notes

## Dependencies

Sprint 13 (design sign-off must have confirmed the metadata-exposure and DEK-reuse approach before this schema ships). Does not depend on Sprint 13's `@aifa/core` extraction directly, but the two can run in parallel only if a second workstream exists — per this plan's solo-developer assumption, they're sequenced.

## Risks

| Risk | Mitigation |
|---|---|
| DEK distribution path silently reuses a Sprint-10 assumption that doesn't hold for this new purpose (e.g. recovery code shown only once, but a new device now needs it too) | Explicit fresh-device test in this sprint, not just unit tests of the crypto — this is exactly the risk Sprint 13 flagged |
| RLS policy gap exposes envelope metadata across businesses | Test with two distinct business accounts before calling this done, not just one |
| Migration touches production schema for the first time in this plan | Run and verify on a branch/staging project first if the Supabase setup supports it; do not apply directly to production without a rollback plan |

## Safe to Carry Over

Performance tuning of the indexes (e.g. partial indexes, covering indexes) can wait until Sprint 16/19 show real query patterns — get correctness first.

---

*End of Sprint 14.*
