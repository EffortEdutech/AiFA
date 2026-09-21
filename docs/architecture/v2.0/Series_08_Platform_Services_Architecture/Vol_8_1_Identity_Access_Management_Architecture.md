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

## 6. Sprint 10 Concrete Implementation (superseded 7 September 2026 — see Section 6a)

Section 4's "Account-level authentication protects cloud backup, sync, and multi-device access" was originally implemented minimally: `app/src/lib/auth.ts` wrapped Supabase's email/OTP flow (`requestOtp`/`verifyOtp`/`signOut`/`useAuthSession`) — deliberately email/OTP only, no password field anywhere, avoiding a password-reset flow entirely in Phase 1 (Vol 11_0 Section 5's own stated choice). This closed a gap carried since Sprint 2: `db/backupService.ts` (Sprint 9) has required a signed-in Supabase user since it was written, with no way for an owner to actually reach that state until now.

## 6a. Auth Model Change (7 September 2026): OTP Replaced with Email + Password

The OTP-only design in Section 6 broke in practice once AiFA moved to a real cloud Supabase project (`yotapuotkbyyocraraza`): magic-link sign-in looped forever because the cloud project's default email template only supports link-based confirmation (no `{{ .Token }}`), and Supabase blocks all email-template customization on a project until custom SMTP is configured — a hard product-level gate, not a client-side bug. Rather than stand up SMTP, the owner explicitly directed: replace OTP with normal email + password sign-up/sign-in.

`app/src/lib/auth.ts` and `web/src/lib/auth.ts` now export `signUp(email, password)` (Supabase `auth.signUp`) and `signIn(email, password)` (Supabase `auth.signInWithPassword`) in place of `requestOtp`/`verifyOtp`; `signOut`/`getCurrentSession`/`useAuthSession` are unchanged. `SettingsScreen.tsx` (mobile) and `SignInScreen.tsx` (web) both present a single email+password form with a sign-in/create-account mode toggle. The cloud project's "Confirm email" setting was also disabled (Authentication → Sign In/Providers), so `signUp()` grants an immediate session with no email step at all — avoiding the same SMTP dependency that motivated dropping OTP in the first place.

This is a **narrower** implementation of Section 4 than Section 6 described, not a broader one: no password-reset flow exists yet (`resetPasswordForEmail` still needs SMTP to deliver a reset email), which remains a known, accepted gap. Everything else in Section 6 — sign-in as an optional, non-gating "Account" affordance inside Settings; a signed-out owner retaining full local access; PCB isolation from `auth.ts` — is unchanged by this switch.

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
