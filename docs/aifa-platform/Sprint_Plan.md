# AiFA Platform (aifa.com) — Sprint Plan

**Status:** Draft — proposed sequencing, not yet started.
**Tracked as:** a separate initiative from the Phase 1-5 series (owner decision, 20 September 2026), but sprint numbers continue the project's single chronological sequence (last shipped: Sprint 62) rather than restarting at 1, so "what sprint are we on" always has one unambiguous answer across every initiative.
**Reads against:** `Architecture.md` (this initiative's design doc) — every sprint below implements one numbered section of it.

---

## Sequencing principle

Each sprint below is scoped to be independently demoable and to leave the system in a working state — the same discipline Phase 5 used. Nothing here starts until `Architecture.md` is reviewed and accepted by the owner; per the owner's own instruction, no code precedes the design doc.

## Sprint 63 — Workspace Resolution & Multi-Business-Per-Owner

**Implements:** Architecture §2.1, §2.2.

- Add the sign-in bootstrap branch: query `business_memberships`, route to BusinessCreatePage / Workspace Switcher / auto-select as specified.
- Build the Workspace Switcher screen (list Client Businesses by `legal_name`, select to enter; remember last choice locally per device).
- Relax `create_business`'s single-business guard; mint a fresh `businesses.id` instead of reusing `auth.uid()` for every *new* business (existing businesses keep their current id unchanged).
- Regression: a solo Owner's existing single-business flow must be provably unaffected (same test discipline as Sprint 62 — a live, interactive regression check against the real Supabase project, not just a code read).

**DoD:** a test login can create two Client Businesses, is offered the Workspace Switcher on sign-in, and lands in the correct Workspace either way; an existing single-business login's experience is unchanged (verified live, not assumed).

## Sprint 64 — Public Surface Schema & Publish Pipeline

**Implements:** Architecture §2.3.

- Migrate `public_site_content`, `public_documents` tables (Architecture §4).
- Build the publish RPC(s): Owner's device decrypts locally, calls the RPC with plaintext content; RPC writes/updates the relevant public row.
- Wire the existing Website settings mockup screen to real data: load current `public_site_content` for editing, "Publish Changes" calls the publish RPC for real.
- Security: publish RPCs must verify the caller holds an Owner (or sufficiently-permissioned) `business_membership` for that `business_id` before writing.

**DoD:** editing and publishing from the Website settings page produces a real row in `public_site_content`, readable back by a follow-up query — verified live.

## Sprint 65 — Domain Binding

**Implements:** Architecture §2.4.

**Scope corrected by Sprint 70 (21 September 2026 owner decision):** this sprint's DoD originally required a *bound custom domain* as the only way to reach a business's public site. That premise was wrong — see Sprint 70 below. Everything this sprint actually built (the `domains` table, DNS TXT verification, `resolve_domain()`) is unchanged and still live; it is now explicitly the *optional*, Platform-Operator-configured path, not the default one.

- Migrate `domains` table.
- Build the DNS TXT-record verification flow (generate challenge value, "Check now" button, scheduled re-check).
- Build the Host-header routing layer (edge function / reverse proxy) that resolves `domain → business_id`.

**DoD:** a test domain can be added, verified via a real DNS TXT record, and the routing layer correctly resolves it to the right `business_id` — verified live against a real domain the owner controls. (Still open, unaffected by the Sprint 70 correction: needs a domain the owner actually controls to exercise the real DNS round trip.)

## Sprint 66 — Public Homepage Renderer

**Implements:** Architecture §2.3, §2.4 (consumption side).

**Scope corrected by Sprint 70 (21 September 2026 owner decision):** see Sprint 70 below — the renderer's resolution logic now tries a slug-based default path before falling back to a bound custom domain, so the DoD below is satisfied by the default AiFA-hosted link, not only by a custom domain.

- Server-render (or statically generate + revalidate) the Public Site homepage from `public_site_content`, scoped by the resolved `business_id`.
- Match the mockup's homepage layout and content fields exactly (nav, hero, services grid, about, contact form, footer).
- Contact form submissions land as a `requests` row (see Sprint 68) even before the full Request/Tracking feature ships, so this sprint's form is not a dead end.

**DoD:** visiting a business's public link (its default `aifa.com/site/<slug>` link, or a bound custom domain if it has one) in a real browser shows the real, owner-edited homepage content — verified live, not a local preview.

## Sprint 67 — No-Login Transactional Pages

**Implements:** Architecture §2.3 (document snapshot), §5 (token security).

- Build the publish-on-send flow: when an Owner sends an invoice/quotation/e-sign document to an External Party, snapshot it into `public_documents` with a fresh unguessable token.
- Build the public Invoice Pay page and e-Signature page (per the existing mockup), reading from `public_documents` by token.
- Wire "Pay Now" to a real payment flow — **both FPX gateway and Stripe** (owner decision, 20 September 2026), offered as alternative payment methods on the same pay page — and "Review & Sign" to a real signing flow, both updating the `public_documents` row's status.

**DoD:** a real invoice sent from a test Workspace produces a working, no-login pay link; paying it updates status visibly on both the public page and back in the Owner's Workspace — verified live.

## Sprint 68 — Customer Requests: QR Intake, Requests Inbox, RFQ → Quotation

**Implements:** Architecture §2.3 (`requests`/`request_status_events`), §2.5 (revised 11 October 2026).

**Re-scoped 11 October 2026 (owner decision):** requests get their own Sales → Requests inbox instead of the Approval Task pipeline, and the sprint is delivered in three phases. Reply channel is a tracking link plus an owner-tapped WhatsApp message (no email service yet). Phase D (customer views the quote online, Sprint 67 territory) and phase E (email/push, Bahasa Malaysia labels, follow-ups) come after the pilot.

**68a — Intake and QR (built, 11 October 2026).**
- Migration 21: reference code, tracking token, contact fields, source, consent, `slug_aliases`, `request_throttle`, `submit_public_request_v2()`, `get_request_tracking()`; database-enforced validation and rate limits. Regression test `supabase/tests/sprint68a_regression_test.sql` (T1-T9) passes on the live project.
- Public Site: request form (`/site/<slug>/request`), success screen with reference and tracking link, private status page (`/track/<token>`), business-page buttons, renamed-slug redirect.
- Owner Console: QR card in Business Settings (preview, PNG/SVG download, A5 print poster, source labels), vendored MIT QR encoder, corrected public link.
- Still to do for 68a: deploy web-public, submit one real request, then revoke the old open request function.

**68b — Requests inbox and replies (not started).** Owner RPCs (list, open, reply, set status, notes), Requests page and detail, unread badge, Overview card, WhatsApp reply shortcut, realtime, seed data.

**68c — RFQ to quotation (not started).** Match or create the party, prefilled quotation draft, link back to the request, `quoted` status.

**DoD:** a customer scans the owner's QR, submits a quote request, and the owner sees it in Sales → Requests, replies, and turns it into a quotation draft; the customer sees the reply on the tracking page within the same session — verified live.

## Sprint 69 — End-to-End Pilot & Hardening

**Implements:** all of the above, integrated.

- One real (or realistic test) Client Business, reachable on its default AiFA-hosted landing page (a custom domain is optional, added only if that business requested one), running the full loop: Public Site live → a real customer submits an RFQ → Owner quotes it → an invoice is sent and paid → tracked throughout.
- A live regression pass in the same style as `sprint62_regression_test.sql`: idempotency checks, permission boundary checks (an End Customer must never reach Workspace data beyond their own Request/document), and a full close-out note disclosing anything not fully verified.
- Update `Checklist_Master.md` (this initiative's own) to its honest final status — DONE, PARTIAL, or explicit open items, following the same discipline as every Phase 5 close-out.

## Sprint 70 — Default AiFA-Hosted Landing Page (Slug) & Domain Binding Rescope

**Implements:** Architecture §2.4 (corrected), following the owner's 21 September 2026 decision. Numbered after Sprint 69 per this project's chronological-sprint-number convention (it's new work directed now, not a renumbering of the already-documented 65-69 sequence), but its changes apply immediately, not after Sprint 69.

- Add `businesses.slug` (unique, auto-generated from `legal_name`, Owner-editable via `settings:configure`), plus `resolve_business_slug()` (anon-callable RPC, no verification gate) and `update_business_slug()`.
- Update `public-homepage`'s resolution order so a slug-based default path (`aifa.com/site/<slug>`, or `?slug=` today) is tried before falling back to a bound custom domain via the `Host` header.
- Remove `DomainSettingsCard` from the Business Owner's self-service Settings; add `PublicSiteLinkCard` showing every Owner their default hosted link, with copy/edit. Domain binding stays fully built (Sprint 65) but becomes an Operator-configured add-on, reached from an Operator-only surface not yet built.

**DoD:** a business's `slug` is present the moment it's created (no manual step); `resolve_business_slug()` resolves it as true `anon`; the Business Settings page shows the AiFA-hosted link instead of a domain-binding requirement — verified live.

**DoD:** the pilot loop runs start to finish against the real Supabase project, on the business's default AiFA-hosted link, with every step confirmed live by the owner, not assumed from a code read.

---

*End of document.*
