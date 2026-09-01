/**
 * Web sign-in — Sprint 18 (Vol 12_0 §6a Auth: "Web sign-in against the
 * existing Supabase auth, same backend as mobile, no parallel auth
 * system"). Deliberately a near-verbatim port of app/src/lib/auth.ts's
 * email/OTP flow (same shouldCreateUser:true single-call sign-up/sign-in,
 * same requestOtp/verifyOtp/signOut/useAuthSession shape) — the one real
 * difference is session storage (browser localStorage via
 * supabaseClient.ts, not SecureStore), noted there.
 */
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

import { supabase } from "./supabaseClient";

export interface AuthActionResult {
  ok: boolean;
  error: string | null;
}

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
