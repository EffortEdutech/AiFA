import { useState } from "react";

import { bootstrapWebSyncIdentity, type WebSyncIdentity } from "../lib/deviceBootstrap";

interface Props {
  businessId: string;
  onReady: (identity: WebSyncIdentity) => void;
}

/**
 * First-run-on-this-browser setup — Sprint 18. Reuses the SAME recovery
 * code the owner already has from mobile setup (Sprint 9/14, and the
 * ad-hoc mobile bootstrap fix) to derive the identical Business DEK
 * (Vol 12_0 §6a's "DEK-reuse" sign-off item) and register this browser as
 * a device (Sprint 15's register_device RPC). No sync runs yet this
 * sprint (Sprint 19) — this step exists purely to (a) get local storage
 * encrypted with the real DEK and (b) make this device visible in
 * public.devices ahead of Sprint 19, per the sprint's own DoD.
 */
export function DeviceSetupScreen({ businessId, onReady }: Props): JSX.Element {
  const [deviceLabel, setDeviceLabel] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const identity = await bootstrapWebSyncIdentity(
        businessId,
        deviceLabel.trim() || "Web browser",
        recoveryCode.trim(),
      );
      onReady(identity);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 420, margin: "60px auto" }}>
      <h1 style={{ fontSize: 20 }}>Set up this browser</h1>
      <p className="muted">
        Enter the recovery code from your AiFA mobile app (Settings → reveal
        recovery code) to unlock encrypted local storage on this browser.
        This is the same code, not a new one.
      </p>
      <label style={{ display: "block", marginTop: 12 }}>
        Name this device
        <input
          value={deviceLabel}
          onChange={(e) => setDeviceLabel(e.target.value)}
          placeholder="e.g. Office laptop — Chrome"
          style={{ width: "100%", padding: 8, marginTop: 4 }}
        />
      </label>
      <label style={{ display: "block", marginTop: 12 }}>
        Recovery code
        <input
          value={recoveryCode}
          onChange={(e) => setRecoveryCode(e.target.value)}
          placeholder="from the mobile app"
          style={{ width: "100%", padding: 8, marginTop: 4 }}
        />
      </label>
      <button
        onClick={() => void handleSubmit()}
        disabled={busy || !recoveryCode.trim()}
        style={{ marginTop: 16 }}
      >
        {busy ? "Setting up…" : "Continue"}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
