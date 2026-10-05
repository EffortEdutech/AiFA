/**
 * Public Site link — Sprint 70 (Architecture §2.4 rescope). Shows every
 * Business Owner their default, AiFA-hosted landing page link the moment
 * they have a business — no domain, no DNS, nothing to configure. Lets an
 * Owner (settings:configure) customize the slug in the link.
 *
 * Replaces DomainSettingsCard.tsx in this page's self-service surface: a
 * bound custom domain is now an optional, rare add-on the Platform
 * Operator configures on request (per the owner's 21 September 2026
 * decision), not something a Business Owner self-serves here. That
 * component and its lib (domains.ts) are left in the tree, unimported —
 * the backend and DNS-verification flow behind them still work and are
 * simply reached from an Operator-only surface once one exists, not from
 * here.
 *
 * UI polish Phase 4: presentation only — shared card, labelled fields and
 * buttons. Same data calls, gating and copy.
 */
import { useEffect, useState } from "react";

import { Button, Card, Field } from "../ui";
import { getBusinessSlug, publicSiteUrlForSlug, updateBusinessSlug } from "../lib/businessSlug";

interface Props {
  businessId: string;
  canConfigure: boolean;
}

export function PublicSiteLinkCard({ businessId, canConfigure }: Props): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [slug, setSlug] = useState<string>("");

  const [editing, setEditing] = useState(false);
  const [slugInput, setSlugInput] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function load(): Promise<void> {
    try {
      setLoadError(null);
      const s = await getBusinessSlug(businessId);
      setSlug(s);
      setSlugInput(s);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load your public site link.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  async function handleSave(): Promise<void> {
    setSaveBusy(true);
    setSaveError(null);
    try {
      const updated = await updateBusinessSlug(businessId, slugInput.trim());
      setSlug(updated);
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not update your site link.");
    } finally {
      setSaveBusy(false);
    }
  }

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(publicSiteUrlForSlug(slug));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can fail silently in some contexts — no-op; the
      // link is still shown and selectable by hand.
    }
  }

  return (
    <Card
      title="Public Site"
      description="Every business gets a public landing page on AiFA automatically — no domain or setup needed. Share this link or a QR code with your customers."
    >
      {loadError && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {loadError}
        </p>
      )}
      {loading ? (
        <p className="ui-muted">Loading…</p>
      ) : editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!saveBusy && slugInput.trim() !== "") void handleSave();
          }}
        >
          <Field label="Link name" hint=".../site/your-business-name">
            {(p) => <input {...p} className="ui-input" placeholder="your-business-name" value={slugInput} onChange={(e) => setSlugInput(e.target.value)} />}
          </Field>
          <div className="ui-form-actions">
            <Button type="submit" variant="primary" loading={saveBusy} disabled={slugInput.trim() === ""}>
              {saveBusy ? "Saving…" : "Save"}
            </Button>
            <Button
              variant="secondary"
              disabled={saveBusy}
              onClick={() => {
                setSlugInput(slug);
                setEditing(false);
                setSaveError(null);
              }}
            >
              Cancel
            </Button>
          </div>
          {saveError && (
            <p className="aifa-alert aifa-alert--danger" role="alert">
              {saveError}
            </p>
          )}
        </form>
      ) : (
        <div>
          <div className="ui-panel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <code style={{ wordBreak: "break-all", fontSize: 13 }}>{publicSiteUrlForSlug(slug)}</code>
            <div className="ui-inline-actions">
              <Button size="sm" variant="secondary" onClick={() => void handleCopy()}>
                {copied ? "Copied!" : "Copy link"}
              </Button>
              {canConfigure && (
                <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
            </div>
          </div>
          <p className="ui-muted">
            Want your own domain instead (e.g. www.yourbusiness.com)? Contact us — a custom domain is set up for you
            on request.
          </p>
        </div>
      )}
    </Card>
  );
}
