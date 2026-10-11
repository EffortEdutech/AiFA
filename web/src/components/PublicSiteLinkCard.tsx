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
import { useEffect, useMemo, useState } from "react";

import { Button, Card, Field } from "../ui";
import {
  getBusinessSlug,
  publicRequestUrl,
  publicSiteUrlForSlug,
  updateBusinessSlug,
  type QrTarget,
} from "../lib/businessSlug";
import { downloadBlob, printQrPoster, qrPngBlob, qrSvg } from "../lib/qr";

interface Props {
  businessId: string;
  canConfigure: boolean;
  /** Shown as the heading on the printed QR poster. */
  businessName?: string;
}

export function PublicSiteLinkCard({ businessId, canConfigure, businessName }: Props): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [slug, setSlug] = useState<string>("");

  const [editing, setEditing] = useState(false);
  const [slugInput, setSlugInput] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [qrTarget, setQrTarget] = useState<QrTarget>("rfq");
  const [qrSource, setQrSource] = useState("counter");
  const [qrError, setQrError] = useState<string | null>(null);
  const qrUrl = useMemo(() => (slug ? publicRequestUrl(slug, qrTarget, qrSource) : ""), [slug, qrTarget, qrSource]);
  const qrMarkup = useMemo(() => (qrUrl ? qrSvg(qrUrl, 220) : ""), [qrUrl]);
  const qrFile = `${slug || "qr"}-${qrTarget}${qrSource.trim() ? `-${qrSource.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}` : ""}`;

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
          <h3 style={{ marginTop: 20, marginBottom: 4 }}>QR code for customers</h3>
          <p className="ui-muted" style={{ marginTop: 0 }}>
            Print it, or send the image on WhatsApp. A customer scans it, fills in a short form, and the request reaches
            you here.
          </p>
          <div className="ui-panel" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div
              role="img"
              aria-label="QR code preview"
              style={{ width: 220, height: 220, background: "#fff", border: "1px solid var(--aifa-border)", borderRadius: 8 }}
              dangerouslySetInnerHTML={{ __html: qrMarkup }}
            />
            <div style={{ flex: "1 1 220px", minWidth: 0 }}>
              <Field label="When scanned, open">
                {(p) => (
                  <select {...p} className="ui-select" value={qrTarget} onChange={(e) => setQrTarget(e.target.value as QrTarget)}>
                    <option value="rfq">Request a quote form</option>
                    <option value="enquiry">Ask a question form</option>
                    <option value="page">My public page</option>
                  </select>
                )}
              </Field>
              <Field label="Where will you put it?" hint="Saved on each request, e.g. counter, flyer, van">
                {(p) => <input {...p} className="ui-input" maxLength={40} value={qrSource} onChange={(e) => setQrSource(e.target.value)} />}
              </Field>
              <p className="ui-muted" style={{ wordBreak: "break-all", fontSize: 12 }}>
                {qrUrl}
              </p>
              <div className="ui-inline-actions">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setQrError(null);
                    qrPngBlob(qrUrl, 1024)
                      .then((b) => downloadBlob(b, `${qrFile}.png`))
                      .catch((e: unknown) => setQrError(e instanceof Error ? e.message : "Could not create the image."));
                  }}
                >
                  Download PNG
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => downloadBlob(new Blob([qrSvg(qrUrl, 1024)], { type: "image/svg+xml" }), `${qrFile}.svg`)}
                >
                  Download SVG
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setQrError(null);
                    try {
                      printQrPoster({
                        text: qrUrl,
                        businessName: businessName?.trim() || "Welcome",
                        headline: qrTarget === "page" ? "Scan to visit us" : qrTarget === "rfq" ? "Scan to request a quote" : "Scan to ask us a question",
                        subline: "Open your phone camera and point it at the code",
                      });
                    } catch (e) {
                      setQrError(e instanceof Error ? e.message : "Could not open the print window.");
                    }
                  }}
                >
                  Print poster (A5)
                </Button>
              </div>
              {qrError && (
                <p className="aifa-alert aifa-alert--danger" role="alert">
                  {qrError}
                </p>
              )}
            </div>
          </div>
          <p className="ui-muted">
            Good to know: what customers type into the form is stored as plain text on AiFA&apos;s servers so you can
            read it here (your books stay encrypted on your device). Tell customers if they ask. If you rename your
            link, QR codes you already printed keep working.
          </p>
          <p className="ui-muted">
            Want your own domain instead (e.g. www.yourbusiness.com)? Contact us — a custom domain is set up for you
            on request.
          </p>
        </div>
      )}
    </Card>
  );
}
