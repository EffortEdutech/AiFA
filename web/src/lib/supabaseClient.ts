import { createClient } from "@supabase/supabase-js";

/**
 * Backend client — Vol 12_0 §6 ("Same Supabase project already in use...
 * extended per Vol 12_1, not replaced"). Mirrors app/src/lib/supabaseClient.ts's
 * shape (same env-var-missing guard), but session storage is plain
 * supabase-js default (browser localStorage) rather than a SecureStore
 * adapter — the browser has no OS keychain equivalent (Vol 12_0 §6's
 * documented, explicitly-weaker-than-mobile posture). The auth session
 * token is not the same secret class as the business DEK (see keyStore.ts
 * for how the DEK itself is protected) — Supabase's own session/refresh
 * token model is what's relied on here, unchanged from any other
 * supabase-js web app.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as
  | string
  | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase config. Copy .env.example to .env and fill in " +
      "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from your Supabase " +
      "project settings (see README.md).",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
