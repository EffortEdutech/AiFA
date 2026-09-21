// AiFA Public Site (Sprint 70 follow-up, 21 September 2026) -- server-side
// Supabase client for the Next.js app that replaces `public-homepage`
// (Supabase edge function) as the thing a browser actually loads.
//
// Why this app exists at all: Supabase's Edge Functions gateway forces
// `Content-Type: text/plain` (plus a locked-down `sandbox` CSP) on any
// function response that looks like HTML -- confirmed live via
// `Invoke-WebRequest` against the deployed `public-homepage` function,
// 21 September 2026 -- to stop a tenant's function serving live,
// browser-renderable HTML from the shared `*.supabase.co` domain (a
// phishing/XSS risk against that shared domain). Nothing wrong with the
// edge function's own code; a Supabase Edge Function can just never be the
// thing a browser loads directly for a real page. This Next.js app, on
// Vercel, has no such restriction, so it owns the actual HTML response.
//
// Uses the anon/publishable key only -- same as `web/src/lib/supabaseClient.ts`.
// Every query this app runs is either a SECURITY DEFINER RPC with its own
// access checks (`resolve_business_slug`, `submit_public_request`) or a
// read already covered by that business's own RLS-safe "public content is
// public" shape (Architecture.md §2.3) -- no service-role key is used or
// needed here, unlike `public-homepage/index.ts`.
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function getPublicSupabaseClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase config. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY in the Vercel project's Environment " +
        "Variables (see web-public/README.md).",
    );
  }
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
  });
}
