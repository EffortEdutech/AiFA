import { useEffect, useState } from "react";

import {
  bootstrapWebSyncIdentity,
  bootstrapWebSyncIdentityAsFirstDevice,
  bootstrapWebSyncIdentityLocalOnlyDevBypass,
  type WebSyncIdentity,
} from "../lib/deviceBootstrap";
import { getAllDevices } from "../lib/syncService";

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
 *
 * Sprint 51 bugfix -- the above was only ever true for a business that
 * had ALREADY been set up on mobile first. A business created on web with
 * no mobile app in the picture has no existing recovery code for its
 * Owner to enter, and this screen used to have no other path through it
 * at all (confirmed live: a brand-new web-only business was stuck at this
 * screen with nothing valid to type in). This screen now checks, on
 * mount, whether ANY device has ever been registered for this business
 * (getAllDevices, already exposed by web's own syncService.ts) --
 * genuinely zero devices means no recovery code exists anywhere yet, so
 * this device is offered the "first device" path instead (generates one
 * via bootstrapWebSyncIdentityAsFirstDevice and shows it once). Any
 * existing device (even a revoked one) means a code already exists
 * elsewhere, so the original enter-the-existing-code form stays exactly
 * as it was for that case.
 */
export function DeviceSetupScreen({ businessId, onReady }: Props): JSX.Element {
  const [deviceLabel, setDeviceLabel] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // null while checking; true = no device has ever been registered for
  // this business (this browser can mint the first recovery code); false
  // = at least one device row already exists (even revoked), so a
  // recovery code already exists somewhere and must be entered as before.
  // Deliberately defaults to false on a failed check -- see the catch
  // block below: guessing "first device" wrongly would mint a second,
  // incompatible DEK, so an unknown state must fail toward the safer,
  // existing-code-required form, never toward the generator.
  const [isFirstDevice, setIsFirstDevice] = useState<boolean | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  // Holds the freshly-generated identity once bootstrapWebSyncIdentityAsFirstDevice
  // succeeds, so its one-time recoveryCode can be shown and acknowledged
  // BEFORE onReady() hands control to the rest of the app -- this is the
  // only chance the owner gets to see and save this value (see
  // deviceBootstrap.ts's WebSyncIdentityWithRecoveryCode doc).
  const [pendingFirstDeviceIdentity, setPendingFirstDeviceIdentity] =
    useState<WebSyncIdentity | null>(null);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAllDevices(businessId)
      .then((devices) => {
        if (!cancelled) setIsFirstDevice(devices.length === 0);
      })
      .catch((err) => {
        if (cancelled) return;
        setIsFirstDevice(false);
        setCheckError(
          err instanceof Error
            ? err.message
            : "Could not check this business's existing devices.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [businessId]);

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

  async function handleGenerateFirstDeviceCode(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const identity = await bootstrapWebSyncIdentityAsFirstDevice(
        businessId,
        deviceLabel.trim() || "Web browser",
      );
      setPendingFirstDeviceIdentity(identity);
      setGeneratedCode(identity.recoveryCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed.");
    } finally {
      setBusy(false);
    }
  }

  function handleConfirmSavedCode(): void {
    if (pendingFirstDeviceIdentity) onReady(pendingFirstDeviceIdentity);
  }

  async function handleCopyCode(): Promise<void> {
    if (!generatedCode) return;
    try {
      await navigator.clipboard.writeText(generatedCode);
      setCopied(true);
    } catch {
      // Best-effort only -- the code is still shown as selectable text.
    }
  }

  // Dev-only escape hatch: skip the recovery code and the register_device
  // RPC entirely, so the app is reachable for local UI testing with no
  // backend at all. Never shows up in a production build (import.meta.env.DEV
  // is statically false there, so Vite/esbuild strip this branch out).
  async function handleDevBypass(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const identity = await bootstrapWebSyncIdentityLocalOnlyDevBypass(businessId);
      onReady(identity);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dev bypass failed.");
    } finally {
      setBusy(false);
    }
  }

  if (isFirstDevice === null) {
    return (
      <div className="card" style={{ maxWidth: 420, margin: "60px auto" }}>
        <h1 style={{ fontSize: 20 }}>Set up this browser</h1>
        <p className="muted">Checking this business's devices…</p>
      </div>
    );
  }

  // Post-generation: show the new code once, and require an explicit
  // acknowledgement before continuing -- there is no "reveal" screen on
  // web yet (see this file's own doc), so this is genuinely the owner's
  // only chance to copy it down.
  if (generatedCode) {
    return (
      <div className="card" style={{ maxWidth: 420, margin: "60px auto" }}>
        <h1 style={{ fontSize: 20 }}>Save your recovery code</h1>
        <p className="muted">
          This is the only time this code is shown. You'll need it to set up
          the mobile app or another browser for this business later — write
          it down or copy it somewhere safe now.
        </p>
        <p
          style={{
            fontFamily: "monospace",
            fontSize: 14,
            wordBreak: "break-all",
            background: "rgba(127,127,127,0.15)",
            padding: 12,
            borderRadius: 6,
            userSelect: "all",
            marginTop: 12,
          }}
        >
          {generatedCode}
        </p>
        <button onClick={() => void handleCopyCode()} style={{ marginTop: 8 }}>
          {copied ? "Copied" : "Copy code"}
        </button>
        <button onClick={handleConfirmSavedCode} style={{ marginTop: 16, marginLeft: 8 }}>
          I've saved it — Continue
        </button>
      </div>
    );
  }

  if (isFirstDevice) {
    return (
      <div className="card" style={{ maxWidth: 420, margin: "60px auto" }}>
        <h1 style={{ fontSize: 20 }}>Set up this browser</h1>
        <p className="muted">
          No device has been set up for this business yet, so this browser
          will create the encrypted local storage and its recovery code —
          you'll be shown that code once, right after, to save for later
          (mobile app or another browser).
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
        <button
          onClick={() => void handleGenerateFirstDeviceCode()}
          disabled={busy}
          style={{ marginTop: 16 }}
        >
          {busy ? "Setting up…" : "Continue"}
        </button>
        {import.meta.env.DEV && (
          <button
            onClick={() => void handleDevBypass()}
            disabled={busy}
            style={{ marginTop: 8, opacity: 0.7 }}
          >
            Skip (dev only, no backend)
          </button>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 420, margin: "60px auto" }}>
      <h1 style={{ fontSize: 20 }}>Set up this browser</h1>
      <p className="muted">
        Enter the recovery code from your AiFA mobile app (Settings → reveal
        recovery code) to unlock encrypted local storage on this browser.
        This is the same code, not a new one.
      </p>
      {checkError && (
        <p className="muted" style={{ fontSize: 12 }}>
          (Couldn't confirm whether this is the first device for this
          business, so a recovery code is required to be safe: {checkError})
        </p>
      )}
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
      {import.meta.env.DEV && (
        <button
          onClick={() => void handleDevBypass()}
          disabled={busy}
          style={{ marginTop: 8, opacity: 0.7 }}
        >
          Skip (dev only, no backend)
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
