import { useState, type FormEvent } from "react";

import { signIn, signUp } from "../lib/auth";
import { AuthLayout } from "../shell/AuthLayout";
import { Button, Field, PasswordInput } from "../ui";

interface Props {
  /**
   * Dev-only escape hatch: skips real Supabase sign-in entirely, handing
   * App.tsx a fixed local business id so the app is reachable with no
   * backend running at all. Only ever passed by App.tsx when
   * import.meta.env.DEV is true -- stripped out of production builds.
   */
  onDevBypass?: (businessId: string) => void;
}

/**
 * Email+password sign-in -- switched from email/OTP 2026-09-07 (see
 * lib/auth.ts's header comment for why). "Create account" and "Sign in"
 * are two explicit modes rather than one combined call, since Supabase's
 * password API has no OTP-style implicit-create-on-sign-in shape.
 *
 * UI polish Phase 2: presentation only -- a real <form> (Enter submits),
 * labelled fields, themed alerts. Same auth calls and same copy.
 */
export function SignInScreen({ onDevBypass }: Props): JSX.Element {
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(): Promise<void> {
    setBusy(true);
    setError(null);
    setInfo(null);
    const result = mode === "signUp" ? await signUp(email, password) : await signIn(email, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.error) {
      // signUp() returns ok:true with an informational message when email
      // confirmation is required and no session was created yet.
      setInfo(result.error);
      return;
    }
    // On success, useAuthSession's onAuthStateChange listener updates the
    // session and App.tsx re-renders into the next step automatically.
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (busy || !email || !password) return;
    void handleSubmit();
  }

  const isSignUp = mode === "signUp";

  return (
    <AuthLayout
      title={isSignUp ? "Create your AiFA account" : "Sign in to AiFA"}
      description="Same email/password account as the mobile app — no separate web account."
      footer={
        <>
          {isSignUp ? "Already have an account?" : "New here?"}{" "}
          <button
            type="button"
            className="aifa-link-btn"
            onClick={() => {
              setMode(isSignUp ? "signIn" : "signUp");
              setError(null);
              setInfo(null);
            }}
          >
            {isSignUp ? "Sign in instead" : "Create an account"}
          </button>
        </>
      }
    >
      <form className="aifa-auth__form" onSubmit={onSubmit}>
        <Field label="Email">
          {(p) => (
            <input
              {...p}
              className="ui-input"
              type="email"
              placeholder="you@business.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          )}
        </Field>
        <Field label="Password">
          {(p) => (
            <PasswordInput
              {...p}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isSignUp ? "new-password" : "current-password"}
            />
          )}
        </Field>
        {error && (
          <p className="aifa-alert aifa-alert--danger" role="alert">
            {error}
          </p>
        )}
        {info && (
          <p className="aifa-alert aifa-alert--info" role="status">
            {info}
          </p>
        )}
        <div className="aifa-auth__actions">
          <Button type="submit" variant="primary" loading={busy} disabled={!email || !password}>
            {busy ? (isSignUp ? "Creating…" : "Signing in…") : isSignUp ? "Create account" : "Sign in"}
          </Button>
        </div>
      </form>
      {import.meta.env.DEV && onDevBypass && (
        <div className="aifa-auth__actions">
          <Button variant="ghost" onClick={() => onDevBypass("00000000-dev0-0000-0000-000000000001")}>
            Skip sign-in (dev only, no backend)
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}
