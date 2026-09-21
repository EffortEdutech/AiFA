# AiFA Platform (aifa.com) — Multi-Client SaaS Architecture

**Status:** Draft — design doc, no code written yet (owner decision, 20 September 2026: "docs first").
**Tracked as:** a separate initiative, not a continuation of the Phase 1-5 series (owner decision, 20 September 2026).
**Prepared:** 20 September 2026
**Requested by:** the owner's pivot — "we will build aifa.com multi client, multi user in client, with all this feature we just discussed blended in" — following the client-facing UI mockup ("NHL Client Portal") and the shared ontology doc ("AiFA Multi-Client Platform Ontology") both produced earlier the same day.
**Reads against:** Vol 8_1 (Identity & Access Management), Vol 13_1 (Multi-Role Tenant & Delegated Approval Architecture), Vol 13_4 (Business Onboarding & Creation), Vol 4_4 (Local-First Storage & Synchronisation), Vol 5_5 (Universal Input Architecture, Phase 5).

---

## 1. What already exists — reuse, do not rebuild

A close reading of the current codebase and architecture volumes (20 September 2026) shows the internal multi-user foundation is considerably further along than the ontology conversation assumed:

- `businesses`, `business_memberships`, `roles` / `role_permissions`, and a domain-scoped `ApprovalTask` with a full resolution algorithm (eligible set → delegation → escalation to Owner) are all designed in Vol 13_1 and partially built (Sprint 38 onward).
- `create_business` (Vol 13_4) lets a freshly signed-up login create its own first Client Business, auto-seeded with an Owner membership and starting chart of accounts.
- `AccessContext.tsx` / `getMyActiveMembership` / `getGrantedDomainsForRole` already compute real, permission-based sidebar visibility for a signed-in user — but only once that user's `businessId` is already known.

**The genuine, confirmed gap** (read directly from `web/src/App.tsx`, 20 September 2026): `businessId = devBypassBusinessId ?? session?.user.id`. A signed-in Staff member's session carries *their own* `auth.uid()`, not the Client Business's id — there is no code path anywhere that looks up a signed-in user's `business_memberships` rows and routes them into the right Workspace. Vol 13_1 §11 item 4 and Vol 13_4 §5 item 1 both name "multi-business-per-login" as explicitly out of scope until a Vol 10_1-style true multi-tenant design exists. This initiative is that design.

## 2. What this initiative adds

### 2.1 Workspace Resolution (closes the gap in Section 1)

On sign-in, before rendering `AppShell`, resolve the signed-in login's workspace(s):

1. Query `business_memberships` where `user_id = auth.uid()` and `status = 'active'`, joined to `businesses` for `legal_name`.
2. **Zero rows and no owned business** → route to `BusinessCreatePage` (existing, Vol 13_4), or an "Accept invite" screen if an invitation is pending.
3. **Exactly one row** → auto-select that Workspace, unchanged from today's single-business behaviour.
4. **More than one row** → a new Workspace Switcher: list every Client Business this login belongs to by `legal_name`, select one to enter. Remember the last-selected Workspace **locally per device only** (never synced) so a returning User skips the picker.

This is the "multi-client" arm of the ontology's Section 5 — one User, many Client Businesses, each via its own `business_memberships` row.

### 2.2 True multi-business-per-owner

`create_business` (Vol 13_4) currently guards against a second business per login (`business_already_exists_for_this_login`), and `businesses.id` is deliberately the same UUID as the creating owner's `auth.uid()` (Vol 13_1 §2's own stated design). This initiative removes that ceiling properly rather than layering a workaround on the id-equals-`auth.uid()` shortcut:

- `businesses.id` becomes a fresh, independently-generated UUID (no longer required to equal any login's `auth.uid()`).
- `owner_user_id` continues to point at the creating login, and `create_business` continues to auto-create that login's Owner `business_membership` — but the same login may now call `create_business` again for a second Client Business.
- Existing rows are unaffected: for every business that exists today, `id` keeps its current value (which happens to already equal its owner's `auth.uid()`); only new businesses mint a fresh id.

**Implemented Sprint 63, 20 September 2026 — two schema constraints found live that this section's original text did not anticipate**, both fixed in the same migration (`00000000000010_sprint63_multi_business_per_owner.sql` plus one follow-up):
1. `businesses.id` carried a `FOREIGN KEY REFERENCES auth.users(id) ON DELETE CASCADE`, a leftover of "id always equals the owner's own auth.uid()." Dropped — `owner_user_id`'s own FK to `auth.users` is untouched.
2. `business_memberships` enforced "one login, one business" at the database level via a **global** unique index on `user_id` alone (`business_memberships_one_live_globally`), not just via `create_business`'s own guard. Replaced with a per-business unique index on `(business_id, user_id)` — a login still cannot hold two live rows in the *same* business, but can now hold live rows in more than one.
See `Checklist_Master.md`'s Sprint 63 close-out note for the full live regression that verified this against the real Supabase project.

### 2.3 Public-Facing Surface — the fork from local-first encryption

**The tension that must be resolved before any code is written.** Vol 4_4 and Vol 13_1 §8 make the device the primary operational environment: real business data is end-to-end encrypted, decryptable only by a device holding the business's recovery-code-derived DEK. A Public Site or a no-login invoice-pay page is, by definition, served to a browser that holds no DEK and never will — no amount of RLS policy changes closes that gap, because the server itself cannot decrypt the data either.

**Proposed resolution:** a new, deliberately **not** end-to-end-encrypted "Public Surface" schema, entirely separate from the encrypted business-data path, populated only by explicit publish actions the Owner takes from inside the (still fully encrypted) Workspace:

- **`public_site_content`** — one row per Client Business: hero text, services, contact info, accent colour, bound domain. Written only when an Owner clicks "Publish Changes" on the Website settings page (the mockup already shows exactly this button) — the client decrypts locally as always, then calls a publish RPC that writes plaintext into this table. Nothing here is decrypted server-side; it is written in plaintext because the Owner chose to make it public.
- **`public_documents`** — a deliberately published, point-in-time snapshot of one invoice, quotation, or e-signature document (amount, line items, status, an unguessable access token) — created when the Owner's device sends that document to an External Party. This is a snapshot, not a live decrypt-on-demand view: the encrypted ledger of record never leaves the local-first path; only what one page needs to render is copied out, deliberately, at send-time.
- **`requests`** / **`request_status_events`** — inbound RFQ/PO/enquiry submissions from End Customers (no auth) and the timeline entries a Tracking Page renders. These originate *outside* the encrypted store entirely — an End Customer has no device and no DEK — so they land here first, then get pulled into the Owner's real Workspace through the **existing** Universal Input Router / Approval Task pipeline (Phase 5, Vol 5_5) once accepted.

This keeps the payroll/ledger/local-first guarantee (Vol 4_4, Vol 13_1 §8 Path A/B) completely untouched, while making every public-facing surface in the ontology possible. It also explains, in hindsight, why the mockup's Website editor already had a "Publish Changes" button rather than live-editing a shared record — that instinct was the right one.

### 2.4 Default Hosting (Slug) + Optional Domain Binding

**Superseded (21 September 2026 owner decision):** this section originally read "Custom-domain-only for v1, per the ontology's confirmed decision — no `aifa.my` fallback subdomain," making a bound custom domain the *only* way to reach a Client Business's public site. That was built (Sprint 65/66) and then corrected live once it surfaced that `localhost:3070` — the internal AiFA app — was never going to show a public homepage reachable only via a domain nobody had yet bound. The corrected, current design:

- **Every Client Business gets a default, AiFA-hosted landing page automatically** — reachable at `aifa.com/site/<slug>` (or, before `aifa.com` itself is live, the Supabase functions URL with `?slug=<slug>`), and shareable as a link or QR code from inside the AiFA app. Zero DNS setup, zero Owner action required — it exists the moment the business exists.
- **`businesses.slug`**: a URL-safe identifier, unique, auto-generated from `legal_name` on business creation (with numeric-suffix collision handling), Owner-editable (`settings:configure`-gated) via `update_business_slug()`. Resolved via `resolve_business_slug(text) returns uuid` — a SECURITY DEFINER RPC, anon-callable, no verification gate (a business's own slug is trusted the instant it exists, unlike a claimed-but-unproven external domain).
- **`domains`** (unchanged schema; Sprint 65): `business_id`, `domain` (e.g. `www.nhlglobal.com`), `verification_status` (`pending` / `verified`), `ssl_status`, `verified_at`. **Now an optional, rare add-on**: a Client Business that wants its own branded domain instead of (or in addition to) the AiFA-hosted slug link requests one, and the **Platform Operator** configures it — this is no longer a Business Owner self-service flow (the `DomainSettingsCard` UI was removed from Business Settings accordingly; the RPCs, DNS TXT verification, and edge function behind it are unchanged and simply await an Operator-only surface).
- **Verification** (custom domain path only): unchanged — a standard DNS TXT-record challenge, checked by a scheduled job or a "Check now" call.
- **Routing**: the `public-homepage` edge function resolves a request in this order — explicit query overrides (testing/internal) → a slug parsed from the URL path (**the default path for every business**) → the incoming `Host` header against `domains` (only reached for a Client Business with an Operator-bound custom domain).

### 2.5 Request / Tracking Flow

Builds directly on the existing Universal Input Router (Phase 5, Vol 5_5) rather than inventing a parallel pipeline: an accepted public Request becomes a `chained_intake` / `ApprovalTask` in the Owner's Workspace, reusing the exact status machinery an End Customer sees reflected back on their Tracking Page — no new state machine needed.

## 3. Explicitly deferred, unaffected by this initiative

- **Path B envelope encryption** (Vol 13_1 §8) — its gate remains payroll/HR team access, entirely unrelated to public-facing surfaces; this initiative neither depends on nor changes that decision.
- **Billing model, cross-business Membership visibility rules, exact v1 Request-type list** — carried over from the ontology doc's own open questions; not resolved here.

## 4. Data model additions (net new tables)

| Table | Purpose | Encryption |
|---|---|---|
| `businesses.slug` (column, not a new table) | Default AiFA-hosted landing page identifier — every business has one | Plaintext (not sensitive) |
| `domains` | Optional, Operator-configured custom domain → `business_id` binding, verification state | Plaintext (not sensitive) |
| `public_site_content` | Published homepage content per Client Business | Plaintext by design (Section 2.3) |
| `public_documents` | Published snapshot of one invoice/quotation/e-sign doc + access token | Plaintext by design (Section 2.3) |
| `requests` | Inbound RFQ/PO/enquiry from an End Customer | Plaintext (never touches the encrypted store until accepted) |
| `request_status_events` | Timeline entries for the Tracking Page | Plaintext |

## 5. Security notes

- No-login pages authenticate by a long, random, single-purpose token — a pay link, a tracking link, and a sign link for the same subject are three different tokens, never derived from each other or from a guessable id.
- Public Surface tables are **not** end-to-end encrypted, by design (Section 2.3). This trade-off must be disclosed to the Owner explicitly, matching Vol 8_2's disclosure discipline: *"What you publish, or send to a customer as a link, is stored in plaintext on our servers; your internal books stay encrypted on your own device."*
- Rate-limit every public endpoint (Request submission, tracking lookup, document view) against enumeration and spam.

## 6. Relationships to other volumes

- Builds on Vol 8_1, Vol 13_1, Vol 13_4 — reuses their schema and RPCs; does not replace or restate them.
- Vol 4_4 and Vol 13_1 §8 remain the governing local-first encryption model; Section 2.3 above is this initiative's own boundary decision around them, not a change to those volumes.
- Phase 5 (Universal Input Router, Vol 5_5) is reused as-is for Request intake (Section 2.5).
- Supersedes nothing in Vol 10_1 (Multi-Tenant Architecture) — that volume frames an *enterprise administrator over several subsidiary tenants*; this initiative is a different shape (many independent SME Client Businesses, each self-service), and the two should be reconciled explicitly if they are ever needed together.

---

*End of document.*
