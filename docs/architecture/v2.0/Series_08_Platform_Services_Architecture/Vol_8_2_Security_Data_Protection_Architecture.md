# AIFA — Security & Data Protection Architecture
## Volume 8_2 — Series 8: Platform Services Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

This volume defines the encryption and data-protection principles applied across local storage, backup, sync, and AI transmission.

## 2. Protection by Data State

| State | Protection |
|---|---|
| At rest (local device) | Local encrypted storage — Business Events, Data, Financial Data, Business Knowledge Store, documents (Vol 4_4) |
| At rest (cloud backup) | Encrypted before leaving the device; encrypted at rest in the backup service (Vol 8_4) |
| In transit (sync) | Encrypted channel between device and sync service |
| In transit (AI reasoning) | Only the minimal PCB (Vol 3_1) is transmitted, over an encrypted channel, to the selected AI model |

## 3. Sensitivity Classification

Business data is classified by sensitivity (e.g., payroll and personal identifiers are higher sensitivity than general expense categories, per Vol 6_7 Section 5). Sensitivity classification is one of the required fields in every PCB (Vol 3_1, Section 4), allowing KRCE to apply stricter minimisation to higher-sensitivity fields.

## 4. Data Minimisation as a Security Control

The PCB contract's token/size budget and "only relevant Knowledge Objects" rule (Vol 3_1) is simultaneously a security control: less data leaving the device means a smaller exposure surface, independent of transport encryption.

## 5. Deletion and Retention

Owners can request deletion of their business data. Because Business Events are canonical and immutable while active (Vol 4_0), deletion is treated as a distinct, explicit lifecycle action (full account/business deletion) rather than selective retroactive editing, preserving audit integrity while still honouring legitimate deletion requests.

## 6. Sprint 10 Concrete Implementation

A full security audit against Sections 2-3 was run this sprint, covering local storage, transmission, and PCB sensitivity classification (per that sprint's own task breakdown). Results:

- **Section 2, local encryption:** confirmed correct, no change needed. `app/src/db/client.ts` opens op-sqlite with a SecureStore-backed key; `document_blobs` (Vol 4_4) lives in that SAME encrypted database, not a separate unencrypted store.
- **Section 2, transmission:** confirmed HTTPS throughout, no change needed. `providers/anthropicProvider.ts`'s `API_URL` is `https://api.anthropic.com/v1/messages` at every call site (classification, vision extraction, Workspace Q&A); `supabaseClient.ts`'s URL is HTTPS by convention (`.env.example`).
- **Section 3, sensitivity classification:** **a genuine gap was found and fixed.** `ProfessionalContextBundle` (`ai/types.ts`) had NO `sensitivity_classification` field at all, despite this section's own "one of the required fields in every PCB" and Vol 3_1 Section 4 / Vol 11_1 Section 6 both stating the field remains required even in Phase 1's minimal PCB form. Fixed: the type now includes `sensitivity_classification: "standard" | "high"`, populated as `"standard"` by both `buildCapturePcb` and `buildWorkspacePcb` (`ai/pcb.ts`) — Phase 1 has no high-sensitivity domain (payroll, Vol 6_7) wired into capture yet, so `"standard"` is correct everywhere today; this field exists now so a future higher-sensitivity domain has somewhere honest to report itself, rather than the gap being discovered and patched under time pressure later.

Section 5's "deletion... as a distinct, explicit lifecycle action" is implemented as `db/deletionRepository.ts`'s `deleteAllLocalData` (clears every Phase 1 table, leaves `schema_migrations` intact so the app stays usable) plus `db/deletionService.ts`'s best-effort `deleteRemoteAccountData` (removes the owner's backup Storage objects and metadata rows, signs out). Deletion never edits a confirmed Business Event retroactively — it erases rows outright, consistent with this section's framing of deletion as a distinct action rather than selective retroactive editing. **Stated limitation:** this does not delete the underlying Supabase Auth user record (see Vol 8_1 Section 6) — that is real, undone backend work, not silently assumed complete.

## 7. Relationships to Other Volumes

- Vol 4_4 (Local-First Storage & Synchronisation) defines the storage boundary this volume protects.
- Vol 3_1 (KRCE) is the enforcement point for Section 4's minimisation control.
- Vol 8_1 (Identity & Access Management) governs who can even reach protected data, and (Sprint 10) implements the account-level auth this volume's Section 2 "at rest (cloud backup)" and "in transit (sync)" rows depend on.
- Vol 7_7 (Settings & Business Configuration) is the owner-facing surface for the Section 5 deletion action and data export.

---

*End of Volume 8_2.*
