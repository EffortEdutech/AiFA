/**
 * Web sign-in — Sprint 18 (Vol 12_0 §6a Auth: "Web sign-in against the
 * existing Supabase auth, same backend as mobile, no parallel auth
 * system"). A near-verbatim port of app/src/lib/auth.ts's auth module
 * (same signUp/signIn/signOut/useAuthSession shape) — the one real
 * difference is session storage (browser localStorage via
 * supabaseClient.ts, not SecureStore), noted there.
 *
 * Switched from email/OTP to email+password 2026-09-07, same reasoning as
 * app/src/lib/auth.ts's header comment: OTP's numeric code only arrives if
 * the project has custom SMTP + a custom email template configured, which
 * is real setup cost blocking sign-in on a fresh cloud project. Password
 * auth needs no outbound email for the core sign-in path.
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
 * -- surfaced to the UI as a distinct message rather than a silent no-op.
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
      error: "Account created. Check your email to confirm it before signing in.",
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
