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
 */
import { useEffect, useState } from "react";

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
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Website</h2>
        {publishedAt && (
          <span className="muted" style={{ fontSize: 12 }}>
            Last published {new Date(publishedAt).toLocaleString()}
          </span>
        )}
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        This is what visitors see on your Public Site — no login required. Nothing here is encrypted; only
        publish what you're happy to make public.
      </p>

      {loadError && <p className="error">{loadError}</p>}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label>
              Hero headline
              <input
                value={heroHeadline}
                onChange={(e) => setHeroHeadline(e.target.value)}
                disabled={!canConfigure}
                placeholder="e.g. NHL Global Solution"
                style={{ display: "block", width: "100%", marginTop: 4, padding: 6 }}
              />
            </label>
            <label>
              Hero subtext
              <input
                value={heroSubtext}
                onChange={(e) => setHeroSubtext(e.target.value)}
                disabled={!canConfigure}
                placeholder="A short line describing your business"
                style={{ display: "block", width: "100%", marginTop: 4, padding: 6 }}
              />
            </label>

            <div>
              <span className="muted">Services</span>
              {services.map((service, i) => (
                <div key={i} className="row" style={{ gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                  <input
                    value={service.name}
                    onChange={(e) => updateService(i, "name", e.target.value)}
                    disabled={!canConfigure}
                    placeholder="Service name"
                    style={{ padding: 6, flex: "1 1 160px" }}
                  />
                  <input
                    value={service.description}
                    onChange={(e) => updateService(i, "description", e.target.value)}
                    disabled={!canConfigure}
                    placeholder="Short description"
                    style={{ padding: 6, flex: "2 1 240px" }}
                  />
                  {canConfigure && services.length > 1 && (
                    <button onClick={() => removeService(i)} aria-label="Remove service">
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {canConfigure && (
                <button onClick={addService} style={{ marginTop: 6 }}>
                  + Add service
                </button>
              )}
            </div>

            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <label style={{ flex: "1 1 200px" }}>
                Contact email
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  disabled={!canConfigure}
                  style={{ display: "block", width: "100%", marginTop: 4, padding: 6 }}
                />
              </label>
              <label style={{ flex: "1 1 200px" }}>
                Contact phone
                <input
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  disabled={!canConfigure}
                  style={{ display: "block", width: "100%", marginTop: 4, padding: 6 }}
                />
              </label>
              <label style={{ flex: "0 0 140px" }}>
                Accent colour
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  disabled={!canConfigure}
                  style={{ display: "block", width: "100%", marginTop: 4, padding: 2, height: 32 }}
                />
              </label>
            </div>
          </div>

          {canConfigure ? (
            <div className="row" style={{ marginTop: 12 }}>
              <button onClick={() => void handlePublish()} disabled={busy}>
                {busy ? "Publishing…" : "Publish Changes"}
              </button>
              {justPublished && <span className="muted">Published.</span>}
            </div>
          ) : (
            <p className="muted" style={{ marginTop: 12 }}>
              Editing requires `settings: configure` access — contact an Owner or Bookkeeper to change this.
            </p>
          )}
          {publishError && <p className="error">{publishError}</p>}
        </>
      )}
    </div>
  );
}
