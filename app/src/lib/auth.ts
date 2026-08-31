/**
 * Minimal Phase 1 authentication — Vol 8_1 Section 3 ("Account-level
 * authentication protects cloud backup, sync, and multi-device access"),
 * Vol 11_0 Section 5 ("Backend-provided email/OTP or social auth, single
 * user per business account"). Sprint 10 closes a gap carried since
 * Sprint 2: `backupService.ts` (Sprint 9) has required a signed-in
 * Supabase user since it was written, but no sign-in flow existed for a
 * real owner to ever reach that state.
 *
 * Deliberate scope decisions:
 * - Email/OTP only (no password field anywhere) -- avoids building and
 *   securing a password-reset flow in Phase 1, per Vol 11_0 Section 5's own
 *   stated Phase 1 choice and AGENTS.md's bias toward the smallest correct
 *   thing.
 * - This module is a thin wrapper around `supabase.auth`, the same
 *   native/network-bound shape as `backupService.ts` (Sprint 9) --
 *   real network calls to Supabase Auth are not exercisable in this
 *   sandbox, so this file is verified by tsc/eslint only, not a Jest
 *   round-trip. `useAuthSession`'s pure state-transition shape (loading ->
 *   session | null, updated on both the initial fetch and subsequent
 *   auth-state-change events) is the part that would be worth an RTL/hook
 *   test once a device or CI environment with real Supabase access exists
 *   -- flagged here rather than silently skipped.
 * - No credential or session material is ever embedded in a PCB (Vol 8_1
 *   Section 3) -- nothing in this module is imported by ai/pcb.ts or any
 *   AI provider.
 * - Auth is NOT a gate on the rest of the app (Vol 4_4 Section 2, "Local
 *   first"): a signed-out owner can still capture, view, and manage all
 *   local data. Signing in is surfaced only as an optional "Account"
 *   affordance inside Settings (SettingsScreen.tsx), unlocking backup/
 *   restore and remote account deletion specifically -- see that screen
 *   and db/backupService.ts's own BackupNotAvailableError precedent.
 */
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

import { supabase } from "./supabaseClient";

export interface AuthActionResult {
  ok: boolean;
  error: string | null;
}

/**
 * Step 1 of email/OTP sign-in: asks Supabase to email a one-time code to
 * this address. `shouldCreateUser: true` means the same call covers both
 * first-time sign-up and returning sign-in -- Phase 1 has no separate
 * "create account" flow (Vol 11_0 Section 5's "single user per business
 * account" keeps this simple).
 */
export async function requestOtp(email: string): Promise<AuthActionResult> {
  const trimmed = email.trim();
  if (!trimmed) {
    return { ok: false, error: "Enter an email address." };
  }
  const { error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: { shouldCreateUser: true },
  });
  return { ok: !error, error: error?.message ?? null };
}

/**
 * Step 2: verifies the code the owner received by email and, on success,
 * establishes a real Supabase session (persisted via the SecureStore
 * adapter configured in supabaseClient.ts).
 */
export async function verifyOtp(
  email: string,
  token: string,
): Promise<AuthActionResult> {
  const trimmed = email.trim();
  const trimmedToken = token.trim();
  if (!trimmed || !trimmedToken) {
    return { ok: false, error: "Enter both the email and the code." };
  }
  const { error } = await supabase.auth.verifyOtp({
    email: trimmed,
    token: trimmedToken,
    type: "email",
  });
  return { ok: !error, error: error?.message ?? null };
}

export async function signOut(): Promise<AuthActionResult> {
  const { error } = await supabase.auth.signOut();
  return { ok: !error, error: error?.message ?? null };
}

export async function getCurrentSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export interface AuthSessionState {
  session: Session | null;
  isLoading: boolean;
}

/**
 * Settings screen convenience hook: tracks the current session, updated on
 * mount and on every subsequent sign-in/sign-out/token-refresh event
 * (Vol 8_1 Section 3's "session expiry" hardening -- an expired/refreshed
 * token is reflected here without the owner needing to reopen the screen).
 */
export function useAuthSession(): AuthSessionState {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    getCurrentSession()
      .then((initialSession) => {
        if (isMounted) {
          setSession(initialSession);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) setIsLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (isMounted) setSession(nextSession);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return { session, isLoading };
}
