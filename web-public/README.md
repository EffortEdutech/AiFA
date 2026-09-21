# AiFA Public Site (`web-public/`)

Serves every Client Business's default AiFA-hosted landing page at
`/site/<slug>` — e.g. `https://ai-fa-tawny.vercel.app/site/verify-test-co`,
or `aifa.com/site/<slug>` once that domain is attached to this Vercel
project.

## Why this app exists

Sprint 70 built the slug-resolution backend (`resolve_business_slug()`,
`businesses.slug`) and a Supabase Edge Function
(`supabase/functions/public-homepage`) to render it. Testing live on
21 September 2026 found that Supabase's Edge Functions gateway forces
`Content-Type: text/plain` (with a locked-down `sandbox` CSP) on any
function response that looks like HTML — confirmed via
`Invoke-WebRequest` against the deployed function — to stop a tenant's
function serving live, browser-renderable HTML from the shared
`*.supabase.co` domain. A Supabase Edge Function can compute the right
page but can never be the thing a browser loads directly to see it.

This Next.js app is that missing front door. It reuses the exact same
resolution and data (`resolve_business_slug()`, `public_site_content`,
`submit_public_request()`) via the Supabase JS client with the anon/
publishable key — nothing about the database or RPCs changed, only where
the final HTML response comes from.

`supabase/functions/public-homepage` is left in place, unchanged — it's
not wrong, it's just not reachable as a webpage by a browser. It can be
retired later once this app is confirmed live.

## Local development

```bash
cp .env.example .env.local   # fill in NEXT_PUBLIC_SUPABASE_ANON_KEY
npm install
npm run dev
```

Then visit `http://localhost:3000/site/verify-test-co` (or any real
business slug).

## Deploying (Vercel)

This app lives in a subfolder of the `00AiFA` monorepo, so the Vercel
project (already created and linked to this GitHub repo, per the owner's
own setup — see `https://vercel.com/eff-edus-projects/ai-fa`) needs its
**Root Directory** set to `web-public` under Project Settings -> General
-> Root Directory, and these Environment Variables set under Project
Settings -> Environment Variables (Production + Preview):

- `NEXT_PUBLIC_SUPABASE_URL` = `https://yotapuotkbyyocraraza.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = the anon/publishable key from the
  Supabase project's API settings (same value `web/.env`'s
  `VITE_SUPABASE_ANON_KEY` already uses — safe to reuse, it's a
  browser-exposable key, not the service_role key).

Once both are set, pushing this folder to the linked branch triggers a
normal Vercel deploy; no other configuration is needed (Next.js is
auto-detected).
