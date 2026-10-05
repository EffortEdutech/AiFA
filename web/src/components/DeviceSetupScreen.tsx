import { useEffect, useState, type FormEvent } from "react";

import {
  bootstrapWebSyncIdentity,
  bootstrapWebSyncIdentityAsFirstDevice,
  bootstrapWebSyncIdentityLocalOnlyDevBypass,
  type WebSyncIdentity,
} from "../lib/deviceBootstrap";
import { getAllDevices } from "../lib/syncService";
import { AuthLayout } from "../shell/AuthLayout";
import { Button, Field } from "../ui";

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
 *
 * UI polish Phase 2: presentation only -- the three states (checking,
 * first device, existing code) and the one-time code reveal keep their
 * logic and wording; they now share the AuthLayout frame and ui kit
 * fields/buttons.
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

  const devBypassButton = import.meta.env.DEV ? (
    <Button variant="ghost" onClick={() => void handleDevBypass()} disabled={busy}>
      Skip (dev only, no backend)
    </Button>
  ) : null;

  const errorAlert = error ? (
    <p className="aifa-alert aifa-alert--danger" role="alert">
      {error}
    </p>
  ) : null;

  if (isFirstDevice === null) {
    return (
      <AuthLayout title="Set up this browser">
        <div className="aifa-loading aifa-loading--inline" role="status">
          <span className="ui-spinner" aria-hidden="true" />
          <span>Checking this business's devices…</span>
        </div>
      </AuthLayout>
    );
  }

  // Post-generation: show the new code once, and require an explicit
  // acknowledgement before continuing -- there is no "reveal" screen on
  // web yet (see this file's own doc), so this is genuinely the owner's
  // only chance to copy it down.
  if (generatedCode) {
    return (
      <AuthLayout
        title="Save your recovery code"
        description="This is the only time this code is shown. You'll need it to set up the mobile app or another browser for this business later — write it down or copy it somewhere safe now."
      >
        <p className="aifa-code">{generatedCode}</p>
        <div className="aifa-auth__actions">
          <Button variant="secondary" icon={copied ? "check" : undefined} onClick={() => void handleCopyCode()}>
            {copied ? "Copied" : "Copy code"}
          </Button>
          <Button variant="primary" onClick={handleConfirmSavedCode}>
            I've saved it — Continue
          </Button>
        </div>
      </AuthLayout>
    );
  }

  function onSubmitFirstDevice(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!busy) void handleGenerateFirstDeviceCode();
  }

  function onSubmitExistingCode(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!busy && recoveryCode.trim()) void handleSubmit();
  }

  const deviceNameField = (
    <Field label="Name this device">
      {(p) => (
        <input
          {...p}
          className="ui-input"
          value={deviceLabel}
          onChange={(e) => setDeviceLabel(e.target.value)}
          placeholder="e.g. Office laptop — Chrome"
        />
      )}
    </Field>
  );

  if (isFirstDevice) {
    return (
      <AuthLayout
        title="Set up this browser"
        description="No device has been set up for this business yet, so this browser will create the encrypted local storage and its recovery code — you'll be shown that code once, right after, to save for later (mobile app or another browser)."
      >
        <form className="aifa-auth__form" onSubmit={onSubmitFirstDevice}>
          {deviceNameField}
          {errorAlert}
          <div className="aifa-auth__actions">
            <Button type="submit" variant="primary" loading={busy}>
              {busy ? "Setting up…" : "Continue"}
            </Button>
            {devBypassButton}
          </div>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Set up this browser"
      description="Enter the recovery code from your AiFA mobile app (Settings → reveal recovery code) to unlock encrypted local storage on this browser. This is the same code, not a new one."
    >
      {checkError && (
        <p className="aifa-alert aifa-alert--info">
          Couldn't confirm whether this is the first device for this business, so a recovery code is required to be
          safe: {checkError}
        </p>
      )}
      <form className="aifa-auth__form" onSubmit={onSubmitExistingCode}>
        {deviceNameField}
        <Field label="Recovery code">
          {(p) => (
            <input
              {...p}
              className="ui-input"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              placeholder="from the mobile app"
              autoComplete="off"
              spellCheck={false}
            />
          )}
        </Field>
        {errorAlert}
        <div className="aifa-auth__actions">
          <Button type="submit" variant="primary" loading={busy} disabled={!recoveryCode.trim()}>
            {busy ? "Setting up…" : "Continue"}
          </Button>
          {devBypassButton}
        </div>
      </form>
    </AuthLayout>
  );
}
