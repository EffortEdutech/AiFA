import { useState } from "react";

import { createSupabaseTeamMembershipTransport } from "@aifa/core/sync/teamMembershipTransport";

import { supabase } from "../lib/supabaseClient";

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
 */
export function BusinessCreatePage({ onCreated }: Props): JSX.Element {
  const [legalName, setLegalName] = useState("");
  const [industry, setIndustry] = useState("");
  const [ssmRegistrationNumber, setSsmRegistrationNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(): Promise<void> {
    if (!legalName.trim()) {
      setError("Business name is required.");
      return;
    }
    setBusy(true);
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

  return (
    <div style={{ maxWidth: 420, margin: "48px auto", padding: 16 }}>
      <div className="card">
        <h1 style={{ fontSize: 18, marginTop: 0 }}>Set up your business</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          This is a one-time step for this login — you'll be the Owner. You can invite teammates afterward from
          the Team section.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          <label>
            Business name
            <input
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="e.g. NHL Global Solution"
              style={{ display: "block", width: "100%", marginTop: 4 }}
            />
          </label>
          <label>
            Industry <span className="muted">(optional)</span>
            <input
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              style={{ display: "block", width: "100%", marginTop: 4 }}
            />
          </label>
          <label>
            SSM registration number <span className="muted">(optional)</span>
            <input
              value={ssmRegistrationNumber}
              onChange={(e) => setSsmRegistrationNumber(e.target.value)}
              style={{ display: "block", width: "100%", marginTop: 4 }}
            />
          </label>
        </div>

        <div className="row" style={{ marginTop: 16 }}>
          <button onClick={() => void handleSubmit()} disabled={busy || !legalName.trim()}>
            {busy ? "Creating…" : "Create business"}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
