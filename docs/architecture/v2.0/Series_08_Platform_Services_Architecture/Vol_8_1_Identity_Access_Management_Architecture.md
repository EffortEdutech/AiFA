# AIFA — Identity & Access Management Architecture
## Volume 8_1 — Series 8: Platform Services Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

This volume defines how AIFA authenticates owners and any additional team members, and how access permissions are scoped.

## 2. Identity Model

| Actor | Identity Scope |
|---|---|
| Business Owner | Full access — the primary account holder |
| Bookkeeper/Accountant (invited) | Configurable access, typically full financial visibility with restricted settings control |
| Staff member (invited) | Configurable, typically limited to specific domains (e.g., expense capture only) |

## 3. Access Scoping

Access is scoped along two axes: **domain** (e.g., sales, payroll — with payroll treated as high-sensitivity per Vol 6_7 Section 5) and **capability** (view, capture, approve, configure). A given invited user's permissions are the intersection of both.

## 4. Authentication Principles

- Local device authentication (biometric/PIN) protects the local encrypted store.
- Account-level authentication protects cloud backup, sync, and multi-device access.
- No credential or session material is ever embedded in a Professional Context Bundle sent to an AI model (Vol 3_1).

## 5. Multi-Tenant Consideration

For enterprise deployments spanning multiple businesses or entities, identity scoping extends to tenant boundaries — detailed in Vol 10_1 (Multi-Tenant Architecture), which builds on this volume rather than replacing it.

## 6. Sprint 10 Concrete Implementation

Section 4's "Account-level authentication protects cloud backup, sync, and multi-device access" is implemented minimally: `app/src/lib/auth.ts` wraps Supabase's email/OTP flow (`requestOtp`/`verifyOtp`/`signOut`/`useAuthSession`) — deliberately email/OTP only, no password field anywhere, avoiding a password-reset flow entirely in Phase 1 (Vol 11_0 Section 5's own stated choice). This closes a gap carried since Sprint 2: `db/backupService.ts` (Sprint 9) has required a signed-in Supabase user since it was written, with no way for an owner to actually reach that state until now.

Consistent with Section 4's "local device authentication protects the local encrypted store" being the PRIMARY guarantee, sign-in is surfaced only as an optional "Account" section inside Settings (`SettingsScreen.tsx`, Vol 7_7) — never a gate on the rest of the app. A signed-out owner still captures, views, and manages all local data normally (Vol 4_4 Section 2); signing in only unlocks encrypted cloud backup and remote-account deletion.

Section 2's Bookkeeper/Staff invited-user model and Section 3's domain/capability access scoping remain entirely unbuilt (Phase 2) — Phase 1 is genuinely single-user, single-business, matching this volume's own framing of those rows as the target shape rather than Phase 1 scope.

Section 4's "no credential or session material is ever embedded in a PCB" is upheld by construction: nothing in `auth.ts` is imported by `ai/pcb.ts` or any AI provider.

**A real, stated remaining gap:** account/business deletion (Vol 7_7, Vol 8_2 Section 6) can remove an owner's cloud backup data but cannot remove the underlying Supabase Auth user record itself — that requires an admin/service-role action that must live server-side (an Edge Function), which does not exist yet. A service-role key must never be embedded in this client app, so this is real backend work still to be done, not a client-side oversight.

## 7. Relationships to Other Volumes

- Vol 7_7 (Settings & Business Configuration) is the owner-facing surface for managing access (Section "Access & Team") and, as of Sprint 10, the optional Account sign-in affordance.
- Vol 8_2 (Security & Data Protection) covers the encryption underlying authenticated access.
- Vol 8_4 (Synchronisation & Cloud Services) is the backup service this volume's auth requirement unblocks.
- Vol 10_1 (Multi-Tenant Architecture) extends this model for enterprise scale.

---

*End of Volume 8_1.*
