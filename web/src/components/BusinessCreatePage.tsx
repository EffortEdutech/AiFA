import { useState, type FormEvent } from "react";

import { createSupabaseTeamMembershipTransport } from "@aifa/core/sync/teamMembershipTransport";

import { supabase } from "../lib/supabaseClient";
import { AuthLayout } from "../shell/AuthLayout";
import { Button, Field } from "../ui";

const teamMembershipTransport = createSupabaseTeamMembershipTransport(supabase);

interface Props {
  onCreated: () => void;
}

/**
 * First-run-for-this-login business creation — Vol 13_4 (Business
 * Onboarding & Creation), the piece that was genuinely missing from the
 * schema before this: `businesses`/`business_memberships` and
 * `invite_member`/`accept_membership_invitation` already fully supported
 * everything AFTER a business exists (Vol 13_1 §4/§6); nothing let a new
 * login create their OWN first one. Shown by App.tsx in place of the
 * normal shell/device-setup path when the signed-in user owns no
 * `businesses` row yet — this is deliberately BEFORE device/DEK setup
 * (DeviceSetupScreen), since a device can't be registered to a business
 * that doesn't exist yet.
 *
 * `create_business` makes exactly one Owner membership (the caller's own).
 * Sprint 63 (Architecture §2.2) removed the old one-login-owns-at-most-
 * one-business guard, so this same RPC/page now also serves a login's
 * SECOND (or later) Client Business — App.tsx only shows this page when
 * the login's active `business_memberships` count is zero, so this
 * remains "the first-run screen for a business with no members yet," it
 * just no longer implies "and this login can never do this again."
 * A business wanting a team from day one reaches that afterward the same
 * way any existing business does: the new Owner invites teammates from
 * the Team section (already-live `invite_member`, Sprint 24) once signed
 * into the shell — not part of this one-time creation step.
 *
 * UI polish Phase 2: presentation only — same fields, same RPC call.
 */
export function BusinessCreatePage({ onCreated }: Props): JSX.Element {
  const [legalName, setLegalName] = useState("");
  const [industry, setIndustry] = useState("");
  const [ssmRegistrationNumber, setSsmRegistrationNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(): Promise<void> {
    if (!legalName.trim()) {
      setNameError("Business name is required.");
      return;
    }
    setBusy(true);
    setNameError(null);
    setError(null);
    try {
      await teamMembershipTransport.createBusiness(
        legalName.trim(),
        industry.trim() || null,
        ssmRegistrationNumber.trim() || null,
      );
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create this business.");
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void handleSubmit();
  }

  return (
    <AuthLayout
      title="Set up your business"
      description="This is a one-time step for this login — you'll be the Owner. You can invite teammates afterward from the Team section."
    >
      <form className="aifa-auth__form" onSubmit={onSubmit} noValidate>
        <Field label="Business name" required error={nameError}>
          {(p) => (
            <input
              {...p}
              className="ui-input"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="e.g. NHL Global Solution"
              autoComplete="organization"
            />
          )}
        </Field>
        <Field label="Industry (optional)">
          {(p) => <input {...p} className="ui-input" value={industry} onChange={(e) => setIndustry(e.target.value)} />}
        </Field>
        <Field label="SSM registration number (optional)">
          {(p) => (
            <input
              {...p}
              className="ui-input"
              value={ssmRegistrationNumber}
              onChange={(e) => setSsmRegistrationNumber(e.target.value)}
            />
          )}
        </Field>
        {error && (
          <p className="aifa-alert aifa-alert--danger" role="alert">
            {error}
          </p>
        )}
        <div className="aifa-auth__actions">
          <Button type="submit" variant="primary" loading={busy} disabled={!legalName.trim()}>
            {busy ? "Creating…" : "Create business"}
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
