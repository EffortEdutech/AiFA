# AIFA — Architecture Refinement & Design Decisions
## Volume 4_0_0 — Series 4: Data Architecture — Version 1.1 (Living Register)

**Status:** Complete — living document, updated as new ADRs are approved

---

## 1. Purpose

This volume is the single register of Architecture Decision Records (ADRs) for AIFA. Rather than repeatedly rewriting earlier volumes each time a refinement is agreed, decisions are recorded here and then propagated into affected volumes at the next documentation pass.

## 2. How to Use This Register

Each ADR has: a status, a decision statement, consequences, affected documents, and any terminology change it introduces. Once an ADR is applied to a volume, that volume states "Applies ADR-00X: Yes" in its header, as done throughout this Version 2.0 set.

## 3. ADR-001 — Business Events as the Canonical Source of Truth

**Status:** Approved and applied throughout this Version 2.0 set.

**Decision:** Business Events are the canonical source of truth for AIFA.

**Consequences:** All downstream artefacts are derived from Business Events: Business Data, Financial Data, Business Knowledge, reports, dashboards, AI analysis, AI CFO recommendations, and workflow automation.

**Terminology change:**
- Previous label for the initial processing stage: "Business Data"
- Approved label: **Business Event Layer**
- Business Data becomes the structured operational representation *derived from* Business Events, not the entry point itself.

**Documents updated in this pass:** Vol 1_0, Vol 1_1, Vol 2_0, Vol 2_2, Vol 4_0.

## 3a. ADR-002 — Cloud Sync Hub Becomes a Structured, Field-Encrypted Mirror (Web Platform Trigger)

**Status:** Proposed — recorded alongside the Web Platform Architecture design (Vol 12_0, Vol 12_1); not yet approved for implementation or built.

**Decision:** Once a web client exists for AIFA, the cloud tier's role changes from "opaque encrypted backup blob only" (Vol 4_4 Section 4, Vol 8_4 Section 5) to also holding a structured, field-encrypted mirror of Business Events/Data/Ledger/Documents/Business Knowledge/App Settings, delivered as an append-mostly stream of Sync Envelopes (Vol 12_1, Section 3-4), so that a browser client — which has no local-first store as durable or as trustworthy as a mobile OS keychain + SQLCipher — can reliably participate as a second live device rather than only restoring from backup.

**Consequences:**
- Live multi-device sync (previously Phase 2, left open in Vol 4_4 Section 4/6 and Vol 8_4 Section 2) is pulled forward and becomes required for the web platform to work at all, rather than an optional later enhancement.
- The cloud service (Vol 8_4) gains a new `public.sync_envelopes` table alongside the existing `public.backups` table; the server sees per-row metadata (entity type, device id, approximate timing) it did not see under the pure-blob backup model, while individual field payloads remain encrypted client-side and unreadable server-side (Vol 8_4 Section 3's boundary is preserved at the field level, not the whole-object level).
- A new per-business Data Encryption Key (DEK) is introduced, distinct from each device's local SQLCipher key, distributed via the existing Sprint 10 recovery-code mechanism (Vol 4_4 Section 8) rather than a new one (Vol 12_1 Section 5).
- Conflict handling for the small set of genuinely mutable entities (BusinessKnowledgeEntry, AppSettings) adopts, as a firm decision rather than a proposal, the last-confirmed-write-wins-with-surfacing default Vol 4_4 Section 6 had only proposed pending live sync; the BusinessEvent status-transition race is resolved by reusing the existing local immutability trigger as the distributed conflict arbiter (Vol 12_1 Section 7).
- Key rotation / lost-device revocation is explicitly NOT resolved by this ADR — tracked as an open item (Vol 12_1 Section 12) that should block real multi-device rollout, not just web's initial launch.

**Terminology change:** none — this ADR extends the existing Vol 4_4/Vol 8_4 model rather than renaming any existing term.

**Documents affected:** Vol 4_4 (Section 4, Section 6 — the Phase 2 conflict-policy proposal is now a firm decision per this ADR, pending a future documentation pass to update that volume's own text), Vol 8_4 (Section 2, Section 5), Vol 12_0, Vol 12_1 (new, this ADR's detailed design).

## 3b. ADR-003 — Single Active-Device Write Lock for Cross-Platform Sync

**Status:** Proposed — a firm product requirement from the user, recorded here and detailed in Vol 12_1 Section 5a-8; not yet implemented.

**Decision:** Of all devices registered for a business (Vol 12_1 Section 5a), exactly one may write (capture, confirm/correct, banking entries, settings changes) at any time — the "active" device, tracked by a single server-held `active_device_lock` row per business. Every other registered device is read-only. Switching the active device is an explicit owner action on the device being activated: that device must first fully sync (catch up to the cloud's current state) before the server grants it the lock, and every other device is stalled into read-only mode as soon as the lock changes. All four device facts — registered, logged in, active, and synced/behind — are separately visible to the owner from any device via a shared Devices panel (Vol 12_1 Section 8), not collapsed into a single indicator.

**Consequences:**
- This supersedes ADR-002/Vol 12_1 Version 1.0's assumption that multiple devices could write concurrently with conflicts resolved after the fact. Under ADR-003, that conflict-handling logic (Vol 12_1 Section 7) becomes a narrow backstop for one specific offline edge case (a device that captured data before learning it had been demoted), not the everyday mechanism.
- Two new cloud tables are introduced: `public.devices` (the registry) and `public.active_device_lock` (the single strongly-consistent row arbitrating write permission) — both deliberately unencrypted, unlike `public.sync_envelopes`, since device labels and lock state are not business data.
- The lock must be acquired through a genuinely atomic server-side operation (a single transaction verifying the requesting device is caught up, then granting the lock) — a client-side or two-step acquisition would reopen the split-brain risk this ADR exists to close.
- A revoked device is immediately stopped from writing (never granted the lock again) and force-signed-out, but this does not by itself stop it from decrypting data it already holds — DEK rotation remains unresolved (tracked since ADR-002, restated in Vol 12_1 Section 12).

**Terminology change:** introduces "active device," "read-only device," and "the active-device lock" as canonical terms for the web/mobile sync design (Vol 12_1 Section 5a.1); no existing terms are renamed.

**Documents affected:** Vol 12_1 (Section 5a, 6a, 7, 8 — new/rewritten), Vol 12_0 (Section 4, Section 6a — new), Vol 4_4/Vol 8_4 (still pending a future documentation pass to reflect that Phase 2 live sync, once built, uses a single-writer model rather than a fully concurrent one).

## 3c. ADR-004 — Primary Device Designation with Unconditional Forced Takeover

**Status:** Proposed — a firm product requirement from the user, recorded here and detailed in Vol 12_1 Section 5a.4/6a.5; not yet implemented. Amended 2026-08-31 to require a lightweight confirmation on primary takeover (see Decision below) — the sprint-planning design sign-off surfaced that "zero confirmation" as originally written was not actually what the owner wanted once it was about to be built.

**Decision:** In addition to ADR-003's single active-device write lock, the owner designates exactly one registered device as "primary" (a durable label, independent of which device is currently active). The primary device may reclaim active status at any time, unconditionally dropping whichever device currently holds it. **Amended 2026-08-31 (Phase 2 sprint-planning sign-off):** the primary takeover shows a lightweight, single-tap confirmation ("Take over as active device now?" / one Confirm action, no read-then-decide detail) rather than zero confirmation — this replaces the original "no confirmation prompt" framing. It remains categorically faster and lower-friction than a non-primary takeover, which shows a fuller caution prompt (explains the currently-active device's in-use state and requires the owner to read it before confirming) when that device appears to be in active use. The underlying data-safety rule from ADR-003 (the activating device must sync to the cloud's current state before the server grants the lock) is NOT waived for the primary device, and was never in question — this amendment only affects the confirmation-prompt UX, not the correctness guarantee.

**Consequences:**
- A new `is_primary` boolean column on `public.devices` (Vol 12_1 Section 4), enforced as exactly-one-true-per-business via the same atomic-update discipline as the active lock itself (`set_primary_device` RPC).
- The lock-change broadcast (Vol 12_1 Section 6a.2) gains a reason code so a demoted device can distinguish an ordinary handoff from a primary-device takeover in its own UI.
- Devices panel (Vol 12_1 Section 8) gains a Primary badge, independent of the Active/Read-only status, plus a "Set as primary" action.
- Explicitly out of scope: automatic/unattended failover to the primary device. Every takeover — primary or not — is still triggered by an explicit owner tap on the activating device; only the confirmation-prompt friction differs by primary status, not the requirement for an explicit action.
- Revocation handling (ADR-003) is extended: when the active device is revoked, the primary device (if not the one revoked) is offered as the default suggested replacement.

**Terminology change:** introduces "primary device" as a canonical term, distinct from "active device" (ADR-003). The two must not be conflated in future volumes — primary is a durable owner designation, active is the current write-holder and changes far more often.

**Documents affected:** Vol 12_1 (Section 5a.4, Section 6a.5, Section 8 — new), Vol 12_0 (Section 6a — extended).

## 4. Architecture Governance Pattern Established by ADR-001

Instead of rewriting earlier documents on every refinement, new architectural decisions are recorded as a numbered ADR in this volume, then propagated. This is now the standing governance pattern for the AIFA documentation set.

## 5. Resolved Conversation Inconsistencies (carried from the source conversation record)

| Item | Resolution Applied in Version 2.0 |
|---|---|
| Series 10 completion claim (10_3–10_5 previously unwritten) | Drafted in full in this pass; marked "reconstructed" in the master index |
| Series 9 volumes 9_0–9_2 previously unwritten | Drafted in full in this pass; marked "reconstructed" |
| Naming drift in Series 5 | Canonical titles fixed: AI Platform, AI Runtime, AI Agent, AI Context Management, AI Learning & Feedback Architecture |
| BKA (Business Knowledge Assets Engine) terminology | Fully superseded; not used anywhere in this Version 2.0 set — see Vol 3_0/4_2 for the correct PKA / Business Knowledge Store split |
| "Finance PKA owns knowledge" wording | Restated as governance/technical ownership only; commercial/legal ownership is explicitly out of scope in every volume that touches it |
| Industry PKA composition model | Resolved in Vol 10_2: industry packages are extension packages composed with the base Finance PKA, not standalone replacements |

## 6. Open Items for Future ADRs

- Formal PCB schema versioning policy (beyond the contract defined in Vol 3_1)
- Cross-device conflict resolution policy for Business Knowledge Store sync — proposed default now adopted by ADR-002 (Section 3a) and detailed in Vol 12_1 Section 7; still pending an update pass to Vol 4_4 Section 6's own text
- Key rotation / lost-device revocation for the new Business DEK introduced by ADR-002 (Vol 12_1, Section 12) — unresolved, should block real multi-device web rollout
- Commercial/legal licensing model for Finance PKA usage (explicitly deferred — not an architecture concern)

## 7. Relationships to Other Volumes

Every volume in this set that touches Business Event terminology, the PCB contract, or a resolved inconsistency above references this register. Vol 0_0 (Master Documentation Index) Section 6 tracks which freeze actions this register has satisfied.

---

*End of Volume 4_0_0.*
