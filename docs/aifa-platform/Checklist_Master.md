# AiFA Platform (aifa.com) — Checklist Master

**Status:** Sprints 63-66 DONE (20 September 2026) — see close-out notes below. **Owner decision, 20 September 2026:** no domain owned yet — proceed building sprints that depend on domain binding anyway, verified by business_id/direct calls instead of a real bound domain; the real DNS + real-domain-in-browser live tests for Sprints 65 and 66 stay open until a domain is available, tracked here rather than blocking progress.
**Companion to:** `Architecture.md` and `Sprint_Plan.md` in this same folder.

---

## Sprint Status

| Sprint | Title | Status | DoD summary |
|---|---|---|---|
| 63 | Workspace Resolution & Multi-Business-Per-Owner | DONE (20 September 2026) — see close-out note below | Test login can create 2 businesses, gets Workspace Switcher, lands correctly; solo Owner flow unaffected |
| 64 | Public Surface Schema & Publish Pipeline | DONE (20 September 2026) — see close-out note below | Website settings "Publish Changes" writes a real `public_site_content` row |
| 65 | Domain Binding | DONE (backend + UI) — see close-out note below; real-domain DNS test still owner-pending | Real domain added, DNS-verified, routes to correct `business_id` |
| 66 | Public Homepage Renderer | DONE (backend) — see close-out note below; real-domain-in-browser test still owner-pending | Bound domain shows real, owner-edited homepage content in a real browser |
| 67 | No-Login Transactional Pages | Not started | Real invoice produces a working pay link; paying it updates status both sides |
| 68 | RFQ/PO Submission + Tracking | Not started | Real RFQ becomes a real Approval Task; progress reflects on public Tracking page |
| 69 | End-to-End Pilot & Hardening | Not started | Full loop runs live on a real domain; regression pass + honest close-out |

## Pre-conditions before Sprint 63 starts

- [x] Owner has reviewed and accepted `Architecture.md` in full, including Section 2.3's encryption-boundary decision (Public Surface tables are deliberately plaintext) — **approved by the owner, 20 September 2026** ("the three docs reviewed and agreed / Architecture §2.3 is now approved").
- [x] Payment provider for Sprint 67 decided — **owner decision, 20 September 2026: both FPX gateway and Stripe** ("Payment FPX gateway and stripe").
- [x] Ontology doc's open questions (billing model, cross-business Membership visibility, v1 Request-type list) — **explicitly deferred by the owner, 20 September 2026** ("Defer for now"), carried in `Architecture.md` §3; each will be resolved per sprint as it becomes load-bearing, not held over the whole initiative.

## Sprint 63 close-out note (20 September 2026)

**Status: DONE.** Implemented, applied live to the AiFA Supabase project (`yotapuotkbyyocraraza`), and regression-verified live — not just reviewed by reading code.

**What shipped:**
- `web/src/App.tsx` — replaced the old `businessId = devBypassBusinessId ?? session.user.id` gate with real Workspace Resolution: queries every ACTIVE `business_memberships` row for the signed-in login (`list_my_businesses()`), then routes to `BusinessCreatePage` (zero rows), auto-select (exactly one row), or the new `WorkspaceSwitcher` (more than one row, unless a still-valid last choice is remembered on this device).
- `web/src/components/WorkspaceSwitcher.tsx` (new) and `web/src/lib/workspaceSelection.ts` (new, local-only `localStorage`, never synced).
- `packages/core/src/sync/teamMembershipTransport.ts` — added `listMyBusinesses()`; updated `createBusiness()`'s own doc comment (the one-business-per-login limit it used to describe is gone).
- Migration `00000000000010_sprint63_multi_business_per_owner.sql` — `create_business` now mints a fresh `businesses.id` for every new business instead of reusing `auth.uid()`, and its old `business_already_exists_for_this_login` guard is removed; added `list_my_businesses()` RPC.

**Two premise mismatches found live, disclosed and fixed in the same sprint (not in the original Architecture.md §2.2 plan — the schema turned out to enforce the old one-business-per-login rule more deeply than `create_business`'s own guard):**
1. `businesses.id` carried a `FOREIGN KEY ... REFERENCES auth.users(id) ON DELETE CASCADE` (`businesses_id_fkey`), a leftover of "id always equals the owner's own auth.uid()." A fresh, independent id for a second business violates this FK. Fixed by dropping the constraint (`owner_user_id`'s own FK to `auth.users` is untouched — ownership still always resolves to a real login).
2. `business_memberships` had a **global** unique index, `business_memberships_one_live_globally`, on `user_id` alone (any invited/active/suspended row) — the actual mechanism enforcing "one login, one business," independent of `create_business`. Replaced with `business_memberships_one_live_per_business`, a unique index on `(business_id, user_id)` for the same statuses — preserves "no duplicate membership row within one business" while allowing a login to hold live memberships in more than one.

**Live regression, using the existing `verify-test@aifa.local` test login (id `86fb847e-fca1-4eae-a489-315b2d524b8c`, solo Owner of "Verify Test Co"):**
- [x] Before any change: `list_my_businesses()` returned exactly its one existing business, id unchanged — solo-Owner baseline confirmed.
- [x] `create_business()` called a second time for the same login → succeeded, returned a fresh UUID not equal to the login's own id.
- [x] `list_my_businesses()` then returned both businesses — this is exactly the App.tsx branch that shows the Workspace Switcher.
- [x] The original "Verify Test Co" row's `id`/`owner_user_id` were re-queried and confirmed unchanged throughout.
- [x] Test membership row for the second business removed afterward; `list_my_businesses()` for that login confirmed back to exactly one row — solo-Owner regression restored.

**One disclosed, harmless leftover:** the test business row itself (`SPRINT63_TEST — Second Business (delete me)`, id `0fa95a1e-0f13-496c-95d8-18ea3e5638e7`) could not be deleted outright — its auto-seeded chart of accounts includes rows marked `is_system = true`, and a pre-existing trigger (`enforce_system_account_immutability`, not part of this sprint) refuses to delete those, by design, for any business. Its membership row was removed, so it is not reachable from any login's Workspace Switcher or sidebar — it is simply an orphaned row sitting in `businesses`/`chart_of_accounts`, clearly named for identification. Left in place rather than working around that immutability trigger; flagged here for the owner's awareness rather than silently ignored.

**Frontend build verification — closed out 20 September 2026:** owner ran `npm run build` in `web/` on their own machine — `tsc --noEmit && vite build` completed with zero type errors and a clean production build (210 modules transformed, built in 3.25s). This confirms the Sprint 63 TypeScript changes (`App.tsx`, `WorkspaceSwitcher.tsx`, `workspaceSelection.ts`, `teamMembershipTransport.ts`) are type-correct and bundle cleanly. A real browser sign-in click-through (exercising the Workspace Switcher UI itself, not just the build) is still outstanding and left to the owner's discretion.

## Sprint 64 close-out note (20 September 2026)

**Status: DONE.** Implemented, applied live to the AiFA Supabase project (`yotapuotkbyyocraraza`), and regression-verified live — not just reviewed by reading code.

**What shipped:**
- Migration `00000000000013_sprint64_public_surface_schema.sql` — new `public_site_content` table (one row per business: hero headline/subtext, services jsonb, contact email/phone, accent color, `published_at`), RLS `USING (true)` SELECT policy ("Anyone can read published site content" — no auth, no DEK, by design per Architecture §2.3); new `public_documents` table (schema only this sprint, populated starting Sprint 67), RLS-gated to active members via the existing `is_active_member()` primitive; new `publish_site_content()` SECURITY DEFINER RPC — checks active membership, checks `settings:configure` via `role_permissions`, then upserts.
- Migration `00000000000014_sprint64_grant_anon_select_site_content.sql` — follow-up GRANT (see finding below).
- `web/src/lib/websiteSettings.ts` (new) — `getPublicSiteContent()` (plain anon-safe select) and `publishSiteContent()` (calls the RPC).
- `web/src/components/WebsiteSettingsCard.tsx` (new) — full editing UI: hero headline/subtext, dynamic services list, contact email/phone, accent color, "Publish Changes" button — gated by the page's existing `canConfigure` prop.
- `web/src/shell/pages/BusinessSettingsPage.tsx` — wired `<WebsiteSettingsCard>` in, alongside the existing Business profile/Notifications/BYOK cards.

**Two findings, disclosed:**
1. `Sprint_Plan.md`'s own Sprint 64 wording referred to a "Website settings" screen as if one already existed in the app — it did not; only the standalone "NHL Client Portal" mockup Artifact sketched it. `WebsiteSettingsCard.tsx` is genuinely new code, built to match that mockup's Publish-Changes-only write model, not a promotion of pre-existing code (unlike Sprint 63's WorkspaceSwitcher pattern).
2. Anon SELECT on `public_site_content` initially failed with `permission denied for table public_site_content` even though the RLS policy was `USING (true)` — the same RLS-vs-GRANT two-layer gotcha this schema's own `00000000000001_grant_authenticated_select.sql` already documents as a project convention (a correct RLS policy with no matching table-level GRANT still fails closed). Fixed via the follow-up migration: `grant select on public.public_site_content to anon, authenticated;`.

**Live regression, using the existing `verify-test@aifa.local` test login (solo Owner of "Verify Test Co") and a second, non-member login:**
- [x] As the test Owner: `publish_site_content()` called with real hero/services/contact content → succeeded, returned the upserted row with a fresh `published_at`.
- [x] Simulated `role anon` (no JWT claim at all) query against `public_site_content` for that business → **failed** with `permission denied` before the GRANT fix.
- [x] Same anon-role query after applying `00000000000014_...` → **succeeded**, returned the full published content, confirming Architecture §2.3's core claim: a visitor with zero auth and zero DEK can read it directly.
- [x] Security-gate negative test: `publish_site_content()` called as a different, non-member login for the test Owner's `business_id` → correctly rejected with `not_a_member_of_this_business`.

**Frontend build verification — closed out 20 September 2026:** owner ran `npm run build` in `web/` on their own machine — `tsc --noEmit && vite build` completed with zero type errors and a clean production build (210 modules transformed, built in 3.25s). This confirms the Sprint 64 TypeScript/React changes (`websiteSettings.ts`, `WebsiteSettingsCard.tsx`, `BusinessSettingsPage.tsx`) are type-correct and bundle cleanly. A real browser click-through of Business Settings → Website is still outstanding and left to the owner's discretion.

## Sprint 65 close-out note (20 September 2026)

**Status: Backend + UI DONE, live-verified except the real-DNS round trip.** Implemented and applied live to the AiFA Supabase project (`yotapuotkbyyocraraza`).

**What shipped:**
- Migration `00000000000015_sprint65_domain_binding.sql` — new `domains` table (business_id, domain, verification_token, verification_status, ssl_status, verified_at, last_checked_at), globally-unique on `lower(domain)`; RLS restricted to each business's own active members (`is_active_member()`); `add_domain()` SECURITY DEFINER RPC (membership + `settings:configure` gated, normalizes the domain string, generates the DNS TXT challenge value); `resolve_domain(text) returns uuid` — the Host-header routing primitive, callable by anon, returns a `business_id` only for a *verified* domain.
- Migration `00000000000016_sprint65_domain_verify_scheduled_recheck.sql` — enabled `pg_cron`/`pg_net`, scheduled a 15-minute job that calls the edge function below in batch mode (the "scheduled re-check" Sprint_Plan.md calls for).
- Edge Function `verify-domain` (deployed) — does the actual live DNS-over-HTTPS TXT lookup (via Cloudflare's public resolver) and flips a domain to `verified` when the challenge value matches; supports both a per-domain "Check now" call (membership-gated) and the cron's batch mode.
- `web/src/lib/domains.ts` (new) and `web/src/components/DomainSettingsCard.tsx` (new) — add-a-domain form, the TXT record to publish, and a "Check now" button; wired into `BusinessSettingsPage.tsx` alongside the Website card.

**Scope note (consistent with Sprint 64's own precedent):** the "Host-header routing layer" itself — an edge function/reverse proxy sitting in front of real traffic — is Sprint 66's own scope, built alongside the homepage renderer it serves; this sprint ships and live-verifies `resolve_domain()`, the resolution primitive that layer will call.

**Live regression, using `verify-test@aifa.local` (solo Owner of "Verify Test Co") and a second, non-member login:**
- [x] `add_domain()` as the Owner → succeeded; domain string normalized (`https://www.example/` → `www.example`); a real DNS TXT challenge value generated.
- [x] `add_domain()` called again for the same domain → correctly rejected, `domain_already_claimed`.
- [x] `resolve_domain()` before verification → `null` (both as the Owner and as true `anon` with zero JWT claims).
- [x] A different, non-member login: sees zero rows from `domains` (RLS), and `add_domain()` for the Owner's business correctly rejected with `not_a_member_of_this_business`.
- [x] Verification flip simulated at the same layer the edge function itself writes at (service-role-equivalent write, bypassing RLS by design) → `resolve_domain()` as true `anon` immediately returned the correct `business_id`.
- [x] Security advisors re-run after the migration — no new findings on `domains` or its functions.
- [x] Test domain row removed afterward — no leftover data.

**Correction (21 September 2026):** the "Verification flip simulated..." line above was accurately labeled as a simulation at the time, but it is now known to have been standing in for a write path that was *actually broken*, not just untested — see the Sprint 66 addendum below. The real `verify-domain` edge function's own `.from("domains").update(...)` call had no working `service_role` GRANT to write with, and would have failed on every real invocation (cron or "Check now") until the fix described there. The direct-SQL simulation above never exercised that code path, so it could not have caught this. `resolve_domain()`'s *read* behavior, RLS, and the RPC gates remain correctly live-verified as stated above — only the "edge function's real write" claim needed this correction.

**One disclosed, genuine limitation — not yet closed:** the actual DNS-over-HTTPS round trip inside the `verify-domain` edge function has not been exercised against a real domain, because that requires a domain the owner actually controls (to add a real TXT record to). Everything on this side — RLS, the RPC gates, the routing primitive, the edge function's auth/branching logic — is live-verified; only the "owner's registrar → real DNS → our DoH lookup" leg is outstanding. **Ad-hoc task for the owner:** name a real domain (or subdomain) to bind for testing, add the TXT record `add_domain()` generates to it, and either wait ~15 minutes for the scheduled re-check or click "Check now" in Business Settings.

**Not yet done (frontend runtime verification):** as with Sprints 63-64, `DomainSettingsCard.tsx`/`domains.ts` have not been run through `npm run build` this session — recommend the owner include them in their next build pass alongside a real click-through of the new "Domain" card.

## Sprint 66 close-out note (20 September 2026)

**Status: Backend DONE and live-verified; the real-domain-in-browser test is the one open item, by owner decision (no domain owned yet — see Status line above).**

**What shipped:**
- Migration `00000000000017_sprint66_requests_schema_and_submit_rpc.sql` — new `requests` table (minimal schema per Sprint_Plan.md's own instruction not to make the contact form a dead end before Sprint 68's full build): `business_id`, `request_type` (`contact`/`rfq`/`po`), `payload` jsonb, `status`, `created_at`; RLS restricted to each business's own active members; `submit_public_request()` SECURITY DEFINER RPC, anon-callable (a website visitor has no account).
- Edge Function `public-homepage` (deployed, `verify_jwt: false`) — server-renders the homepage: resolves the visitor's business via `resolve_domain()` (Sprint 65) from the incoming Host header, reads `public_site_content`, and renders nav / hero / services grid / about / contact form / footer, matching the existing mockup's layout. The same function's POST handler is the contact form's real target — it calls `submit_public_request()` so a real submission lands as a real `requests` row.
- Because no domain is bound yet (owner decision above), the function also accepts `?business_id=` and `?domain=` query overrides so it can be built and tested without one — the real Host-header path always takes priority when present, so this does not change production behavior once a domain exists.

**One disclosed schema gap:** the mockup's homepage has a dedicated "About" section, but `public_site_content` (Sprint 64) has no dedicated about-text field. The renderer currently reuses `hero_subtext` for that section. Flagging this as something to revisit — either add a real `about_text` column, or confirm reusing the hero subtext is intentional — rather than silently inventing a new field without the owner's sign-off.

**Live regression, using `verify-test@aifa.local`'s "Verify Test Co" (already has published Sprint 64 content):**
- [x] `public-homepage` deployed successfully (status ACTIVE).
- [x] Contact-form write path tested directly: `submit_public_request()` called as true `anon` → succeeded, created a real `requests` row with `status = 'new'`.
- [x] Owner (active member) can see that request; a different, non-member login cannot (RLS) — same isolation pattern as every other business-scoped table.
- [x] Security advisors re-run after the migration — no new findings.
- [x] Test request row removed afterward — no leftover data.

**Not verified this session (network-restricted, disclosed honestly):** the actual page render over HTTP — I could not reach the deployed function's URL myself: my own sandbox's network policy blocks direct calls to `*.supabase.co` from here, and the device shell needed to test it from your machine was unavailable again this session. Everything upstream of "does the browser show the right HTML" — the routing, the data, the write path — is live-verified at the database level above; only the final HTML render is unconfirmed.

**Ad-hoc task for the owner:** open this link in a real browser to confirm the rendered page looks right (nav/hero/services/about/contact/footer, using "Verify Test Co"'s real published content):
`https://yotapuotkbyyocraraza.supabase.co/functions/v1/public-homepage?business_id=86fb847e-fca1-4eae-a489-315b2d524b8c`
Submitting the contact form there will create a real (harmless, test) `requests` row — feel free to try it.

### Addendum (21 September 2026): real bug found and fixed after a reported system reboot

After the close-out above, the owner reported a system reboot and pasted the link's actual output: `"This site has not published any content yet."` — instead of the real published content. Investigating this live surfaced a genuine, previously-undiscovered bug, unrelated to the reboot itself.

**Initial (wrong) hypothesis:** `postgrest_logs` around that time showed `"Warp server error: Thread killed by timeout manager"` entries clustered near a schema-cache reload, coincidentally close to when the owner mentioned the reboot. This was real but turned out to be an unrelated, pre-existing instability pattern — not the cause. Disclosing this misstep rather than omitting it, per this project's own close-out discipline.

**Real root cause:** `public-homepage` and `verify-domain` are the *first* code in this entire codebase to query tables directly via a service-role admin client (`.from(...).select()/.update()`). Every other domain in the project goes through `SECURITY DEFINER` RPC functions instead, which run as the function owner and never needed `service_role` to hold direct table grants. Checking `information_schema.role_table_grants` confirmed `service_role` had never been granted `SELECT`/`INSERT`/`UPDATE` on `public_site_content`, `businesses`, `domains`, or `requests` — and the same gap exists on the long-pre-existing `invoices` table, confirming this is a project-wide, longstanding architectural convention (not a Sprint 65/66-specific mistake) that these two new edge functions were simply the first to run into. The homepage's own `.from(...).select()` calls were failing with `permission denied for table ...` (`42501`) on every request, and — because the original code didn't check the error before rendering — that failure silently fell through to the generic "not published" message instead of surfacing.

This was confirmed with certainty (not just inferred) by temporarily deploying a debug-patched version of `public-homepage` (adds a `?debug=1` mode returning the raw query results/errors instead of rendered HTML) and having the owner visit that URL directly in their own browser — first showing the `42501 permission denied` error verbatim, then, after the fix below, showing `success: true` with the real published content for "Verify Test Co."

**Fix applied (migration `00000000000018_sprint66_grant_service_role_public_homepage_reads.sql`, applied live and now delivered/committed alongside this note):**
```sql
grant select on public.public_site_content to service_role;
grant select on public.businesses to service_role;
grant select, update on public.domains to service_role;
grant select, insert on public.requests to service_role;
```
Confirmed fixed two ways: a direct `set local role service_role;` query against the same tables, and the owner's own before/after `?debug=1` browser test.

**Retroactive implication for Sprint 65:** `verify-domain`'s pg_cron-driven recheck (every 15 minutes since Sprint 65 shipped) calls the same `.from("domains").update(...)` write, which was almost certainly silently failing on every single run this whole time, for the same GRANT-gap reason — now fixed by this same migration's `grant select, update on public.domains to service_role;` line. This has not yet been re-verified against a real cron cycle post-fix (that requires ~15 minutes of elapsed time and a real pending domain, which we don't have yet per the Status line above); flagging it as something to watch once a real domain is added.

**Also fixed while here:** `verify-domain`'s own `.from("domains").update(patch)` call had the identical silent-error-swallowing pattern (no error check) as the one that masked this bug in `public-homepage`. Hardened it to check and `console.error()` the result, redeployed live, so a *future* write failure of a different kind (not just this GRANT gap) will surface in the function's logs instead of failing invisibly again.

**The `?debug=1` diagnostic branch added to `public-homepage` during this investigation has been kept permanently** (not stripped back out) — it's the fastest way to diagnose a future "not published"-looking issue on this function without guessing, and it only returns internal query metadata (no secrets), so keeping it live is low-risk. The delivered/committed `public-homepage/index.ts` now matches exactly what's deployed (previously the delivered copy was the pre-debug v1, out of sync with the live v2).

**Still outstanding (unchanged from above):** the real-domain-in-browser render is now understood to work correctly (confirmed via the debug JSON showing real content), but the owner has not yet reported seeing the actual rendered HTML page (non-debug URL) with their own eyes — very likely fine given the same underlying data read now succeeds, but technically the last unconfirmed link in the chain.

## Sprint 70 close-out note (21 September 2026)

**Status: DONE — genuinely confirmed live (see "web-public/ follow-up" section below for how; the original `supabase/functions/public-homepage` path never worked as a browser-facing page and was superseded, not fixed).** A genuine architecture correction, raised by the owner after testing `localhost:3070` and finding none of the new Public Site work visible there.

**The premise mismatch, stated plainly:** Sprint 65/66 were built to Architecture.md §2.4's documented decision — "Custom-domain-only for v1 ... no `aifa.my` fallback subdomain" — meaning a bound custom domain was the *only* way any Client Business's public site could be reached. The owner's actual product intent is the reverse: every Client Business should get a working, AiFA-hosted landing page (a slug-based link, shareable from inside the AiFA app, e.g. `aifa.com/site/nhlglobal`) the moment it exists, with zero DNS setup; a custom domain like `www.nhlglobal.com` becomes an optional add-on the **Platform Operator** configures on a client's request, not something every business must set up itself. This was a real prior decision being reversed, not an error introduced this session — disclosed here per this file's own close-out discipline, same as the Sprint 66 addendum above.

**What shipped:**
- Migration `00000000000019_sprint70_business_slug_default_hosting.sql` — adds `businesses.slug` (unique, format-checked), a `_slugify()`/`_assign_business_slug()` auto-generation trigger (backfilled every existing business live, e.g. "NHL Global Solution" → `nhl-global-solution`), `resolve_business_slug(text) returns uuid` (SECURITY DEFINER, anon-callable, no verification gate — a business's own slug is trusted immediately, unlike an unproven external domain), and `update_business_slug()` (Owner-editable, `settings:configure`-gated, same pattern as `add_domain()`).
- `public-homepage/index.ts` (redeployed, v3) — resolution order changed to: query overrides (testing) → **a slug parsed from the URL path, now the default path for every business** → `Host` header against `domains` (kept only as the optional custom-domain fallback).
- `web/src/lib/businessSlug.ts` (new) and `web/src/components/PublicSiteLinkCard.tsx` (new) — shows every Owner their default hosted link with copy/edit; wired into `BusinessSettingsPage.tsx` in place of `DomainSettingsCard`.
- `DomainSettingsCard.tsx`/`domains.ts`/the `verify-domain` edge function are all left exactly as built (Sprint 65) — none of that work is wasted, it simply moves from a Business-Owner self-service card to an Operator-only surface not yet built (tracked as an open item below).
- `Architecture.md` §2.4 and `Sprint_Plan.md` (Sprint 65/66/69 wording) updated to match, per this file's own close-out discipline requiring all three docs to stay mutually consistent.

**Live regression:**
- [x] Migration applied; every pre-existing business (including "Verify Test Co", `86fb847e-...`) backfilled with a correct, unique slug — verified by direct query.
- [x] `resolve_business_slug('verify-test-co')` as true `anon` (`set local role anon`, no JWT claim) → correctly returned `86fb847e-fca1-4eae-a489-315b2d524b8c`.
- [x] `resolve_business_slug('no-such-slug')` as true `anon` → correctly returned `null`.
- [x] `public-homepage` redeployed (v3) with the new resolution order; `?slug=` override path exercised via the RPC call chain (same code path the URL-path-based default will use once a real reverse proxy sits in front of this function).

**CORRECTION (21 September 2026, same day) — the "Confirmed live" claim below was premature and is walked back:** the paragraph originally here claimed the owner's browser "rendered the actual HTML homepage." That was inferred from a pasted text block that could equally have been raw source — and it was: the owner's next test, with two actual browser screenshots (Chrome, incognito), shows the page displaying the full HTML source (`<!doctype html>`, `<style>` block, tags and all) as **literal, unstyled plain text** — no nav bar, no colored hero, no styled form, nothing rendered. The browser is not interpreting the response as HTML at all, despite `public-homepage/index.ts` explicitly setting `Content-Type: text/html; charset=utf-8` on both HTML responses (confirmed by reading the deployed source). Root cause not yet established — candidates: the Supabase Edge Functions gateway overriding/duplicating the `Content-Type` header on the way out, a stale cached response from before any header was set, or some other Deno/Supabase response-handling quirk. **Disclosing this plainly per this file's own close-out discipline:** the "Confirmed live" and "not yet re-confirmed" language below should be read as superseded by this correction, not as still-accurate history. Next step: the owner checking the actual response `Content-Type` header via browser DevTools (Network tab → the request → Response Headers), or running `curl.exe -I <url>` / `Invoke-WebRequest -Uri <url> -Method Head` from PowerShell, since this session's sandbox cannot reach `*.supabase.co` directly to test it itself.

**ROOT CAUSE FOUND (21 September 2026, same day):** the owner ran `Invoke-WebRequest -Uri <url> | Select-Object -ExpandProperty Headers` against the live URL. The actual response headers show `Content-Type: text/plain` and `Content-Security-Policy: default-src 'none'; sandbox` — **not** the `text/html; charset=utf-8` the function code sends. This is not a bug in `public-homepage/index.ts`; it is the Supabase Edge Functions gateway itself overriding the response. Supabase sanitizes any function response that looks like raw HTML — forcing `text/plain` and a locked-down sandboxed CSP — because Edge Functions are hosted on the shared `*.supabase.co` domain, and letting any tenant's function serve live HTML there unsanitized would be a phishing/XSS risk against that shared domain. Our function's own `Content-Type` header is being stripped and replaced by the platform before it ever reaches the browser; nothing in our code can override this from inside a Supabase Edge Function.

**Architectural implication:** a raw `*.supabase.co/functions/v1/...` URL can never be the thing a browser loads directly to see a rendered public homepage — this was always going to need a real front door at `aifa.com/site/<slug>` (per Architecture.md §2.4's own stated end state), and now we know precisely why it isn't optional even for interim testing. Nothing already built is wasted: `resolve_business_slug()`, the content read, and `renderHomepage()`'s HTML generation are all confirmed correct — only the final step (serving that HTML to a browser) needs to move to a layer that doesn't sit behind Supabase's Functions gateway sanitization, e.g. a small edge renderer (Vercel Edge Function / Cloudflare Worker / Next.js route) at `aifa.com/site/[slug]` that calls the same Supabase RPCs and returns the HTML itself. **Decision on which hosting layer to use is with the owner — not yet made, so not yet built.**

**Original (now-superseded) claim, left visible for the record, not deleted:** "opened `https://yotapuotkbyyocraraza.supabase.co/functions/v1/public-homepage?slug=verify-test-co` in a real browser — rendered the actual HTML homepage (not the debug JSON) with 'Verify Test Co''s real published content, correct nav/hero/services/about/contact/footer." `npm run build` (`web/`) succeeding cleanly (212 modules, no type errors) is unaffected by this correction — that part is a build-tool result, not a browser-rendering claim, and stands.

**One real bug found from that same output, fixed same-session (charset/mojibake):** the rendered HTML text showed mojibake — `"Verify Test Co â€" Sprint 64 live test"` and `"weâ€™ll be in touch"` instead of the correct em dash (—) and curly apostrophe ('). Root cause identified: both HTML `Response()`s in `public-homepage/index.ts` sent `Content-Type: text/html` with no `charset` declared. Fixed by declaring `charset=utf-8` explicitly on both responses; redeployed live (v4) — confirmed present in the currently-deployed source. **Whether this fix actually took effect is now unknown**, because the owner's fresh-load screenshot still shows the identical mojibake text — but since that same screenshot shows the raw-text-rendering bug above is also still present, it's not possible to tell from this evidence alone whether the charset fix failed, was served from a cache, or is simply masked by the bigger rendering problem. This needs re-testing once the rendering bug is understood.

**Also not yet built:** an Operator-only surface for binding a custom domain (Sprint 65's UI is no longer reachable by a Business Owner at all now that it's removed from Business Settings) — until that exists, the Platform Operator binds a domain the same way this session did, directly via SQL/Supabase MCP against `add_domain()`. Flagging this as a real gap, not silently deferring it.

## Sprint 70 follow-up — `web-public/` Next.js app on Vercel (21 September 2026, same day)

**Why:** the root-cause finding above (Supabase's Edge Functions gateway forces `text/plain` on HTML responses) means `supabase/functions/public-homepage` can never be the thing a browser loads directly. The owner independently created a Vercel project (`https://ai-fa-tawny.vercel.app`, linked to this repo's GitHub remote, team `eff-edus-projects`) as the intended `aifa.com` front door — confirmed the right move, it was just empty (Vercel's own default 404, no code deployed yet).

**What shipped:** a new `web-public/` Next.js 14.2.35 app (App Router) in this repo, built and delivered this session:
- `app/site/[slug]/page.tsx` — ports `resolveBusinessId()`/`renderHomepage()` from `public-homepage/index.ts` to React: same `resolve_business_slug()` RPC, same `public_site_content`/`businesses.legal_name` reads, same layout (nav/hero/services/about/contact/footer).
- `app/site/[slug]/ContactForm.tsx` — client component port of the original inline contact-form script.
- `app/api/site/contact/route.ts` — POST handler calling the same, unchanged `submit_public_request()` RPC.
- `lib/supabasePublic.ts` — anon/publishable-key-only Supabase client (no service_role key needed or used here; every query is either a `SECURITY DEFINER` RPC or an already-public read).
- `supabase/functions/public-homepage` is left in place, unchanged — not wrong, just not the thing a browser can load. Can be retired later once `web-public/` is confirmed live.

**Verified this session:** `npm install` + `npm run build` succeeded cleanly (`✓ Compiled successfully`, all routes generated, `/site/[slug]` and `/api/site/contact` correctly built as dynamic/`ƒ` routes) — confirmed in the sandbox, using the same Node toolchain, before committing to the device. Also bumped `next` from the originally-scaffolded `14.2.5` to `14.2.35` after `npm install` flagged `14.2.5` with a known security advisory — shipped on the patched version from the start, not left as a follow-up.

**Status update (21 September 2026, same day): CONFIRMED LIVE, for real this time.** The owner set Root Directory to `web-public`, hit one config error (Vercel's Framework Preset defaulted to "Other" instead of "Next.js", causing a "No Output Directory named public" build failure — fixed by setting Framework Preset to Next.js), then loaded `https://ai-fa-tawny.vercel.app/site/verify-test-co` in a real browser. Confirmed by the owner's own pasted output: a real, styled, rendered page (not raw text, not a 404) showing the hero headline, services, about, and contact sections — **and the em dash renders correctly** ("Verify Test Co — Sprint 64 live test"), so the charset/mojibake fix from earlier in this file is now also genuinely re-confirmed, not just deployed-but-unverified.

**One real bug found in that same confirmation, fixed same-session:** the business name showed as the placeholder "This business" instead of "Verify Test Co" in the nav bar. Root cause: `web-public/app/site/[slug]/page.tsx` reads `businesses.legal_name` using the anon key (correctly — it's a public app, no service_role key belongs there), but `businesses` only has "Members can view their own business" RLS; an anonymous visitor has no membership, so that read silently returned zero rows. `supabase/functions/public-homepage` never hit this because it uses a service_role client that bypasses RLS. Fixed with migration `00000000000020_sprint70_public_business_name_rpc.sql` — a narrow, anon-callable `get_public_business_name(uuid) returns text` RPC (same `SECURITY DEFINER` pattern as `resolve_business_slug()`), scoped to just `legal_name`, not a general RLS opening on `businesses`. Rebuilt clean locally before committing; **not yet re-confirmed live by the owner after this specific fix** — flagging as the one open item.

**Remaining owner action:**
- [ ] Push the latest commit (includes the `get_public_business_name()` fix) and redeploy, then reload `https://ai-fa-tawny.vercel.app/site/verify-test-co` once more to confirm the nav bar now shows "Verify Test Co" instead of "This business".
- [ ] Test the contact form end-to-end (submits via `/api/site/contact` -> `submit_public_request()` -> should appear as a `requests` row / Approval Task per Sprint 68's existing wiring) — not yet exercised live.
- [ ] Decide whether/when to retire `supabase/functions/public-homepage` now that `web-public/` supersedes it as the browser-facing renderer.
- [ ] When ready, attach the `aifa.com` custom domain to this Vercel project (Project Settings -> Domains) so `/site/<slug>` resolves there instead of only `ai-fa-tawny.vercel.app`.

## Phase 5 relationship

This initiative reuses Phase 5's Universal Input Router (Vol 5_5) unchanged for Request intake (Sprint 68). It does not reopen or renumber any Phase 5 sprint (53-62, closed PARTIAL per the 16 September 2026 close-out) — those remain exactly as closed.

## Close-out discipline (unchanged from Phase 5)

Every sprint above closes with:
1. DoD items marked `[x]` / `[ ]` / `[~]` honestly against what was actually verified live, not what the code merely appears to do.
2. A dated close-out note disclosing any premise mismatch or limitation found during the sprint.
3. This file, `Architecture.md`, and `Sprint_Plan.md` updated together so all three stay mutually consistent — the same rule Phase 5's `00_Sprint_Plan_Overview.md` enforced.

---

*End of document.*
