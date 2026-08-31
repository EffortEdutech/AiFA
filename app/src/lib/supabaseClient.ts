import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

/**
 * Backend client — Vol 11_0 Section 5, Vol 8_1 (Identity & Access Management,
 * Phase 1 single-user). Supabase provides auth, Postgres, and encrypted-blob
 * storage for backup (Vol 8_4, upload/restore only in Phase 1 — no live
 * multi-device sync, per Vol 0_1 Section 4).
 *
 * Requires EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY —
 * see .env.example. This file will throw a clear error at startup if those
 * are missing, rather than failing silently later.
 */

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase config. Copy .env.example to .env and fill in " +
      "EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY from your " +
      'Supabase project settings (see README.md "Manual setup required").',
  );
}

// SecureStore-backed session storage so the auth session itself is never
// held in plain AsyncStorage (consistent with Vol 8_2's encryption-at-rest
// principle applied to the whole app, not just the business database).
const SecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: SecureStoreAdapter as never,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
