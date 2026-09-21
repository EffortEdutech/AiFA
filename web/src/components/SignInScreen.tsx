import { useState } from "react";

import { signIn, signUp } from "../lib/auth";

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

  return (
    <div className="card" style={{ maxWidth: 360, margin: "80px auto" }}>
      <h1 style={{ fontSize: 20 }}>{mode === "signUp" ? "Create your AiFA account" : "Sign in to AiFA"}</h1>
      <p className="muted">
        Same email/password account as the mobile app — no separate web account.
      </p>
      <input
        type="email"
        placeholder="you@business.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
        style={{ width: "100%", padding: 8, marginBottom: 8 }}
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete={mode === "signUp" ? "new-password" : "current-password"}
        style={{ width: "100%", padding: 8, marginBottom: 8 }}
      />
      <button onClick={() => void handleSubmit()} disabled={busy || !email || !password}>
        {busy ? (mode === "signUp" ? "Creating…" : "Signing in…") : mode === "signUp" ? "Create account" : "Sign in"}
      </button>
      <p className="muted" style={{ marginTop: 8 }}>
        {mode === "signUp" ? "Already have an account?" : "New here?"}{" "}
        <button
          onClick={() => {
            setMode(mode === "signUp" ? "signIn" : "signUp");
            setError(null);
            setInfo(null);
          }}
          style={{ padding: 0, background: "none", border: "none", textDecoration: "underline", cursor: "pointer" }}
        >
          {mode === "signUp" ? "Sign in instead" : "Create an account"}
        </button>
      </p>
      {error && <p className="error">{error}</p>}
      {info && <p className="muted">{info}</p>}
      {import.meta.env.DEV && onDevBypass && (
        <button
          onClick={() => onDevBypass("00000000-dev0-0000-0000-000000000001")}
          style={{ marginTop: 16, opacity: 0.7 }}
        >
          Skip sign-in (dev only, no backend)
        </button>
      )}
    </div>
  );
}
