import { useState } from "react";

import { requestOtp, verifyOtp } from "../lib/auth";

export function SignInScreen(): JSX.Element {
  const [email, setEmail] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSendCode(): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await requestOtp(email);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOtpSent(true);
  }

  async function handleVerify(): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await verifyOtp(email, token);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
    }
    // On success, useAuthSession's onAuthStateChange listener updates the
    // session and App.tsx re-renders into the next step automatically.
  }

  return (
    <div className="card" style={{ maxWidth: 360, margin: "80px auto" }}>
      <h1 style={{ fontSize: 20 }}>Sign in to AiFA</h1>
      <p className="muted">
        Same email/OTP sign-in as the mobile app — no separate web account.
      </p>
      {!otpSent ? (
        <>
          <input
            type="email"
            placeholder="you@business.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: "100%", padding: 8, marginBottom: 8 }}
          />
          <button onClick={() => void handleSendCode()} disabled={busy || !email}>
            Send code
          </button>
        </>
      ) : (
        <>
          <p className="muted">Enter the code emailed to {email}.</p>
          <input
            inputMode="numeric"
            placeholder="123456"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            style={{ width: "100%", padding: 8, marginBottom: 8 }}
          />
          <button onClick={() => void handleVerify()} disabled={busy || !token}>
            Verify
          </button>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
