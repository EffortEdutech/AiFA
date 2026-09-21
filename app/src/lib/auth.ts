/**
 * Phase 1 authentication — Vol 8_1 Section 3 ("Account-level
 * authentication protects cloud backup, sync, and multi-device access").
 * Originally built as email/OTP-only (Vol 11_0 Section 5's stated Phase 1
 * choice, to avoid a password-reset flow). Switched to email+password
 * 2026-09-07 at the owner's explicit request: the OTP flow depends on
 * Supabase actually delivering an email with the numeric code embedded
 * (not just a magic link), which requires the project's own custom SMTP +
 * a custom email template -- real setup cost that blocked sign-in
 * entirely on a fresh cloud project. Password auth needs no outbound
 * email at all for the core sign-in path, so it has no such dependency.
 *
 * Deliberate scope decisions:
 * - No separate password-reset flow yet (Vol 11_0 Section 5's original
 *   concern) -- `resetPasswordForEmail` still depends on the same SMTP
 *   setup that email/OTP needed, so it's deliberately not wired in this
 *   pass. An owner who forgets their password has no self-serve recovery
 *   yet; flagged here as a real, known gap rather than silently missing.
 * - `signUp` and `signIn` are two explicit calls (unlike OTP's single
 *   `shouldCreateUser: true` call) since Supabase's password API has no
 *   equivalent implicit-create-on-sign-in shape -- the UI decides which
 *   one to call based on whether the owner picked "Create account" or
 *   "Sign in".
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
 * Creates a new account with a password. On a project where email
 * confirmation is required, Supabase returns success with no session yet
 * (the caller must confirm by email first) -- surfaced to the UI as a
 * distinct message rather than a silent no-op, since "created but not
 * signed in" and "signed in" look identical from a plain ok:true check
 * otherwise.
 */
export async function signUp(
  email: string,
  password: string,
): Promise<AuthActionResult> {
  const trimmed = email.trim();
  if (!trimmed || !password) {
    return { ok: false, error: "Enter both an email and a password." };
  }
  const { data, error } = await supabase.auth.signUp({
    email: trimmed,
    password,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  if (!data.session) {
    return {
      ok: true,
      error:
        "Account created. Check your email to confirm it before signing in.",
    };
  }
  return { ok: true, error: null };
}

/** Signs in an existing owner with their email and password. */
export async function signIn(
  email: string,
  password: string,
): Promise<AuthActionResult> {
  const trimmed = email.trim();
  if (!trimmed || !password) {
    return { ok: false, error: "Enter both an email and a password." };
  }
  const { error } = await supabase.auth.signInWithPassword({
    email: trimmed,
    password,
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
