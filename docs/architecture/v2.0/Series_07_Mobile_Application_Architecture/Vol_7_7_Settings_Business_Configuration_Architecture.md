# AIFA — Settings & Business Configuration Architecture
## Volume 7_7 — Series 7: Mobile Application Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

This volume defines the owner-controlled configuration surface: autonomy levels, notification preferences, installed Finance PKA packages, and access management entry points.

## 2. Configuration Domains

| Domain | Controls |
|---|---|
| AI Autonomy | How much AIFA may act without explicit per-item approval (see Section 3) |
| Notifications | Categories enabled, quiet hours (Vol 7_5) |
| Finance PKA Management | View installed package version(s), check for updates (Vol 8_5) |
| Business Profile | Business details, industry (drives Industry Finance PKA selection, Vol 10_2) |
| Access & Team | Who else can access the business's AIFA account, and at what permission level (Vol 8_1) |
| Data & Privacy | Export, backup status, deletion requests (Vol 8_2) |

## 3. AI Autonomy Levels

| Level | Behaviour |
|---|---|
| Review everything | Every proposed bookkeeping entry and recommendation requires explicit owner approval |
| Auto-post high-confidence | High-confidence entries (per Vol 2_2 Section 4) post automatically; low-confidence still requires review |
| Full autonomy (opt-in) | AIFA posts all entries automatically; owner reviews via periodic summary rather than per-item |

This directly implements the configurable review boundary referenced in Vol 2_2 Section 4 and Vol 5_2 Section 5.

## 4. Governance Note

Autonomy configuration never overrides the hard boundaries in Vol 0_0 Section 4 (e.g., irreversible external actions like sending payments still require explicit approval regardless of autonomy level, per Vol 2_4 Section 6).

## 5. Relationships to Other Volumes

- Vol 2_2 and Vol 2_4 define the review/approval behaviour configured here.
- Vol 8_1 (Identity & Access Management) implements the Access & Team domain.
- Vol 8_5 (Finance PKA Distribution & Update Architecture) implements the Finance PKA Management domain.
- Vol 10_2 (Industry Finance PKA Architecture) is driven by the Business Profile's industry setting.

## 6. Sprint 10 Concrete Implementation

Four of Section 2's six domains are built this sprint, in `app/src/screens/SettingsScreen.tsx` (replacing the Sprint 1 placeholder) backed by a single new `app_settings` table (migration 8, `app/src/db/appSettingsRepository.ts`) covering Business Profile and Notifications together — one row per business, since Phase 1 is single-business-per-device. Notifications is now the FULL owner-configurable form (quiet hours window plus per-kind `notify_action_needed`/`notify_confirmation_request` toggles), closing the gap Sprint 8's own doc explicitly deferred; `ai/notificationEngine.ts`'s `getNotifications` accepts these as options, and `DashboardScreen.tsx` reads and passes them through every load, so the settings are not merely stored but actually change what the owner sees. Finance PKA Management is read-only version display only (`pka/accounting_rules.json`'s `pka_version`), per this section's own scope note that update-checking is Vol 8_5/Phase 2 territory.

AI Autonomy (Section 3) and Access & Team remain entirely unbuilt, correctly — both are Phase 2 (Vol 0_1 Section 4, Vol 8_1 Section 4) — and deliberately have no placeholder toggle in the UI, since a visible-but-inert control would misrepresent what Phase 1 actually does.

Data & Privacy is partially built: export (JSON snapshot + CSV) and account/business deletion (local, plus best-effort remote backup-data removal) are both implemented — see Vol 8_2 Section 6 for the security/deletion detail. "Backup status" is represented narrowly: a recovery-code reveal control was added (closing the specific gap Vol 4_4 Section 8 named), but there is still no button to trigger a backup upload or enter a recovery code to restore on a new device — Sprint 9's backup mechanism remains code-complete but without that full owner-facing trigger, a real gap carried forward rather than silently closed.

## 7. Relationships to Other Volumes (Sprint 10 additions)

- Vol 8_1 (Identity & Access Management) Section 4 (Sprint 10) implements the minimal email/OTP Account affordance this screen surfaces — deliberately not a gate on the rest of the app.
- Vol 8_2 (Security & Data Protection) Section 6 covers the security-audit findings (including the PCB sensitivity-classification fix) and the deletion/export security model this screen exposes.
- Vol 4_4 (Local-First Storage & Synchronisation) Section 8 is the origin of the recovery-code-reveal requirement this sprint closes.

---

*End of Volume 7_7.*
