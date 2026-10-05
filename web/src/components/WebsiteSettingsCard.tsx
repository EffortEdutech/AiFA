/**
 * Website settings — Sprint 64 (Architecture §2.3). The real
 * implementation of the card the "NHL Client Portal" mockup's Owner
 * Console sketched — edits and publishes this business's Public Site
 * content (public_site_content, Sprint 64's own new table).
 *
 * Deliberately separate from BusinessSettingsPage's own local-first
 * Business profile / Notifications cards above it: this data is NOT
 * part of the encrypted store (websiteSettings.ts talks to Supabase
 * directly, not `db`) — see that file's own header for why. Rendered
 * from BusinessSettingsPage.tsx alongside those cards, gated by the same
 * `canConfigure` (`settings: configure`) check that page already
 * computes — the publish RPC re-checks this server-side regardless.
 *
 * "Publish Changes" is the one and only write path (Architecture §2.3's
 * own design: nothing here is a live-editing shared record) — matches
 * the mockup's own button, not a coincidence.
 *
 * UI polish Phase 4: presentation only — shared card, labelled fields and
 * buttons. Same data calls, gating and copy.
 */
import { useEffect, useState } from "react";

import { Button, Card, Field } from "../ui";
import {
  getPublicSiteContent,
  publishSiteContent,
  type WebsiteService,
} from "../lib/websiteSettings";

interface Props {
  businessId: string;
  canConfigure: boolean;
}

const EMPTY_SERVICE: WebsiteService = { name: "", description: "" };

export function WebsiteSettingsCard({ businessId, canConfigure }: Props): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);

  const [heroHeadline, setHeroHeadline] = useState("");
  const [heroSubtext, setHeroSubtext] = useState("");
  const [services, setServices] = useState<WebsiteService[]>([]);
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [accentColor, setAccentColor] = useState("#1a2b3c");

  const [busy, setBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [justPublished, setJustPublished] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getPublicSiteContent(businessId)
      .then((content) => {
        if (cancelled) return;
        if (content) {
          setHeroHeadline(content.heroHeadline ?? "");
          setHeroSubtext(content.heroSubtext ?? "");
          setServices(content.services.length > 0 ? content.services : [EMPTY_SERVICE]);
          setContactEmail(content.contactEmail ?? "");
          setContactPhone(content.contactPhone ?? "");
          setAccentColor(content.accentColor ?? "#1a2b3c");
          setPublishedAt(content.publishedAt);
        } else {
          setServices([EMPTY_SERVICE]);
        }
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load website content.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  function updateService(index: number, field: keyof WebsiteService, value: string): void {
    setServices((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }

  function addService(): void {
    setServices((prev) => [...prev, { ...EMPTY_SERVICE }]);
  }

  function removeService(index: number): void {
    setServices((prev) => prev.filter((_, i) => i !== index));
  }

  async function handlePublish(): Promise<void> {
    setBusy(true);
    setPublishError(null);
    setJustPublished(false);
    try {
      const cleanServices = services
        .map((s) => ({ name: s.name.trim(), description: s.description.trim() }))
        .filter((s) => s.name !== "" || s.description !== "");
      const result = await publishSiteContent(businessId, {
        heroHeadline: heroHeadline.trim(),
        heroSubtext: heroSubtext.trim(),
        services: cleanServices,
        contactEmail: contactEmail.trim(),
        contactPhone: contactPhone.trim(),
        accentColor: accentColor.trim(),
      });
      setPublishedAt(result.publishedAt);
      setJustPublished(true);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "Could not publish your website.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Website"
      description="This is what visitors see on your Public Site — no login required. Nothing here is encrypted; only publish what you're happy to make public."
      actions={
        publishedAt ? <span className="ui-muted">Last published {new Date(publishedAt).toLocaleString()}</span> : undefined
      }
    >
      {loadError && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {loadError}
        </p>
      )}
      {loading ? (
        <p className="ui-muted">Loading…</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canConfigure && !busy) void handlePublish();
          }}
        >
          <div className="ui-form-grid">
            <Field label="Hero headline">
              {(p) => (
                <input {...p} className="ui-input" value={heroHeadline} onChange={(e) => setHeroHeadline(e.target.value)} disabled={!canConfigure} placeholder="e.g. NHL Global Solution" />
              )}
            </Field>
            <Field label="Hero subtext">
              {(p) => (
                <input {...p} className="ui-input" value={heroSubtext} onChange={(e) => setHeroSubtext(e.target.value)} disabled={!canConfigure} placeholder="A short line describing your business" />
              )}
            </Field>
          </div>

          <h3 className="ui-section-title">Services</h3>
          {services.map((service, i) => (
            <div key={i} className="ui-inline-actions" style={{ alignItems: "flex-end", marginBottom: 8 }}>
              <Field label={`Service ${i + 1} name`}>
                {(p) => (
                  <input {...p} className="ui-input" value={service.name} onChange={(e) => updateService(i, "name", e.target.value)} disabled={!canConfigure} placeholder="Service name" />
                )}
              </Field>
              <Field label="Short description">
                {(p) => (
                  <input {...p} className="ui-input" value={service.description} onChange={(e) => updateService(i, "description", e.target.value)} disabled={!canConfigure} placeholder="Short description" />
                )}
              </Field>
              {canConfigure && services.length > 1 && (
                <Button size="sm" variant="ghost" icon="x" aria-label="Remove service" onClick={() => removeService(i)}>
                  Remove
                </Button>
              )}
            </div>
          ))}
          {canConfigure && (
            <Button size="sm" variant="secondary" icon="plus" onClick={addService}>
              Add service
            </Button>
          )}

          <div className="ui-form-grid" style={{ marginTop: 16 }}>
            <Field label="Contact email">
              {(p) => <input {...p} className="ui-input" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} disabled={!canConfigure} />}
            </Field>
            <Field label="Contact phone">
              {(p) => <input {...p} className="ui-input" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} disabled={!canConfigure} />}
            </Field>
            <Field label="Accent colour">
              {(p) => (
                <input {...p} className="ui-input" type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} disabled={!canConfigure} style={{ height: 36, padding: 2 }} />
              )}
            </Field>
          </div>

          {canConfigure ? (
            <div className="ui-form-actions">
              <Button type="submit" variant="primary" loading={busy}>
                {busy ? "Publishing…" : "Publish Changes"}
              </Button>
              {justPublished && <span className="ui-muted">Published.</span>}
            </div>
          ) : (
            <p className="ui-muted">Editing requires `settings: configure` access — contact an Owner or Bookkeeper to change this.</p>
          )}
          {publishError && (
            <p className="aifa-alert aifa-alert--danger" role="alert">
              {publishError}
            </p>
          )}
        </form>
      )}
    </Card>
  );
}
