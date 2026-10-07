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

/**
 * DEV-ONLY seed mode: `AIFA_SEED_MODE=1 npm run dev` serves one fictional
 * business (slug "kedai-contoh") without any Supabase env vars, so the
 * Public Site can be reviewed offline. Ignored in production builds
 * (NODE_ENV === "production"); the contact form is refused (read-only).
 */
const SEED_BUSINESS_ID = "00000000-0000-4000-8000-000100000001";
const seedContent = {
  business_id: SEED_BUSINESS_ID,
  hero_headline: "Fresh food, fair prices",
  hero_subtext: "Sample copy for the seeded business. Catering and wholesale for offices, events and cafes.",
  services: [
    { name: "Catering", description: "Event and office catering." },
    { name: "Wholesale", description: "Bulk supply for cafes." },
    { name: "Gift hampers", description: "Festive hampers made to order." },
  ],
  contact_email: "hello@kedai-contoh.example",
  contact_phone: "+60 12-345 6789",
  accent_color: "#2f6f5e",
};

function createSeedClient() {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  return {
    rpc(name: string, args: Record<string, unknown> = {}) {
      if (name === "resolve_business_slug") return ok(args.p_slug === "kedai-contoh" ? SEED_BUSINESS_ID : null);
      if (name === "get_public_business_name") return ok("Kedai Contoh Sdn Bhd");
      return Promise.resolve({ data: null, error: { message: "Seed mode is read-only." } });
    },
    from() {
      const q = { select: () => q, eq: () => q, maybeSingle: () => ok(seedContent) };
      return q;
    },
  };
}

export function getPublicSupabaseClient() {
  if (process.env.NODE_ENV !== "production" && process.env.AIFA_SEED_MODE === "1") {
    return createSeedClient() as unknown as ReturnType<typeof createClient>;
  }
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
