// AiFA Public Site -- business homepage, served from Vercel instead of the
// Supabase `public-homepage` edge function (see lib/supabasePublic.ts for
// why: Supabase's Edge Functions gateway won't let a function serve real
// HTML to a browser). Ports resolveBusinessId()/renderHomepage() from
// supabase/functions/public-homepage/index.ts to React -- same resolution
// (resolve_business_slug RPC), same content fields, same layout.
//
// businessName is read via get_public_business_name() (Sprint 70
// follow-up, 21 September 2026), not a direct `.from("businesses")`
// select -- confirmed live that RLS ("Members can view their own
// business") silently blocks an anon read of legal_name, unlike
// public-homepage/index.ts which uses a service_role client and never
// hit this. The RPC is a narrow, SECURITY DEFINER exception scoped to
// just legal_name, same pattern as resolve_business_slug().
//
// UI polish Phase 5 (October 2026): presentation only -- same data, same
// RPCs, same fields. Adds a sticky navigation with anchors, a stronger hero
// with calls to action, text colours computed from the owner's accent
// (lib/color.ts), email/phone/WhatsApp links (lib/contact.ts), a designed
// "not published yet" page, page metadata, and drops the About section that
// only repeated the hero text.
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { buildTheme } from "../../../lib/color";
import { emailHref, telHref, whatsAppHref } from "../../../lib/contact";
import { getPublicSupabaseClient } from "../../../lib/supabasePublic";
import { ContactForm } from "./ContactForm";

export const revalidate = 0; // publishing is explicit (Publish Changes), always read fresh

interface SiteContent {
  business_id: string;
  hero_headline: string | null;
  hero_subtext: string | null;
  services: { name: string; description: string }[] | null;
  contact_email: string | null;
  contact_phone: string | null;
  accent_color: string | null;
}

interface Site {
  businessId: string;
  businessName: string;
  content: SiteContent | null;
}

async function loadSite(slug: string): Promise<Site | null> {
  const supabase = getPublicSupabaseClient();

  const { data: businessId, error: resolveError } = await supabase.rpc(
    "resolve_business_slug",
    { p_slug: slug },
  );
  if (resolveError || !businessId) return null;

  const [{ data: content }, { data: businessName }] = await Promise.all([
    supabase
      .from("public_site_content")
      .select("*")
      .eq("business_id", businessId)
      .maybeSingle(),
    supabase.rpc("get_public_business_name", { p_business_id: businessId }),
  ]);

  return {
    businessId: businessId as string,
    businessName: (businessName as string | null) || "This business",
    content: (content as SiteContent | null) ?? null,
  };
}

function shorten(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const site = await loadSite(params.slug);
  if (!site) return { title: "Page not found", robots: { index: false } };

  const name = site.businessName;
  if (!site.content) {
    // Nothing published yet: keep search engines away until there is a real page.
    return { title: name, robots: { index: false, follow: false } };
  }

  const description = shorten(
    site.content.hero_subtext || `${name} — services and contact details.`,
    160,
  );
  return {
    title: name,
    description,
    openGraph: { title: name, description, type: "website" },
  };
}

export default async function BusinessSitePage({
  params,
}: {
  params: { slug: string };
}) {
  const site = await loadSite(params.slug);
  if (!site) notFound();

  const { businessId, businessName, content } = site;

  if (!content) {
    return (
      <main className="site-message">
        <div className="site-message__panel">
          <div className="site-message__mark" aria-hidden="true">
            {businessName.trim().charAt(0).toUpperCase() || "A"}
          </div>
          <h1 className="site-message__title">{businessName}</h1>
          <p className="site-message__text">
            This site has not published any content yet. Please check back soon.
          </p>
          <p className="site-message__foot">Powered by AiFA</p>
        </div>
      </main>
    );
  }

  const theme = buildTheme(content.accent_color);
  const headline = content.hero_headline || businessName;
  const subtext = content.hero_subtext || "";
  const services = content.services || [];
  const email = (content.contact_email || "").trim();
  const phone = (content.contact_phone || "").trim();

  const mailLink = email ? emailHref(email) : null;
  const callLink = phone ? telHref(phone) : null;
  const whatsAppLink = phone ? whatsAppHref(phone) : null;
  const hasContactDetails = Boolean(email || phone);

  const themeVars = {
    "--accent": theme.accent,
    "--on-accent": theme.onAccent,
    "--accent-text": theme.accentText,
    "--accent-tint": theme.accentTint,
    "--hero-btn-bg": theme.heroButtonBg,
    "--hero-btn-text": theme.heroButtonText,
  } as React.CSSProperties;

  return (
    <div className="site" style={themeVars}>
      <a className="site-skip" href="#main">
        Skip to content
      </a>

      <header className="site-nav">
        <div className="site-wrap site-nav__inner">
          <a className="site-nav__brand" href="#top">
            {businessName}
          </a>
          <nav className="site-nav__links" aria-label="Sections">
            <a className="site-nav__link" href="#services">
              Services
            </a>
            <a className="site-nav__link" href="#contact">
              Contact
            </a>
          </nav>
        </div>
      </header>

      <main id="main">
        <section className="site-hero" id="top">
          <div className="site-wrap">
            <h1 className="site-hero__title">{headline}</h1>
            {subtext && <p className="site-hero__sub">{subtext}</p>}
            <div className="site-hero__actions">
              <a className="site-btn site-btn--hero" href="#contact">
                Get in touch
              </a>
              {whatsAppLink ? (
                <a
                  className="site-btn site-btn--hero-outline"
                  href={whatsAppLink}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  WhatsApp us
                </a>
              ) : callLink ? (
                <a className="site-btn site-btn--hero-outline" href={callLink}>
                  Call us
                </a>
              ) : null}
            </div>
          </div>
        </section>

        <section className="site-section" id="services" aria-labelledby="services-title">
          <div className="site-wrap">
            <h2 className="site-section__title" id="services-title">
              Services
            </h2>
            {services.length > 0 ? (
              <div className="site-grid">
                {services.map((s, i) => (
                  <article className="site-card" key={i}>
                    <h3 className="site-card__title">{s.name}</h3>
                    {s.description && <p className="site-card__text">{s.description}</p>}
                  </article>
                ))}
              </div>
            ) : (
              <p className="site-empty-note">Services coming soon.</p>
            )}
          </div>
        </section>

        <section
          className="site-section site-section--tint"
          id="contact"
          aria-labelledby="contact-title"
        >
          <div className="site-wrap">
            <h2 className="site-section__title" id="contact-title">
              Contact
            </h2>
            <p className="site-section__lead">
              Send us a message and we&apos;ll get back to you
              {hasContactDetails ? ", or reach us directly." : "."}
            </p>
            <div className="site-contact">
              {hasContactDetails && (
                <ul className="site-contact__list">
                  {email && (
                    <li className="site-contact__item">
                      <span className="site-contact__label">Email</span>
                      <span className="site-contact__value">
                        {mailLink ? <a href={mailLink}>{email}</a> : email}
                      </span>
                    </li>
                  )}
                  {phone && (
                    <li className="site-contact__item">
                      <span className="site-contact__label">Phone</span>
                      <span className="site-contact__value">
                        {callLink ? <a href={callLink}>{phone}</a> : phone}
                      </span>
                    </li>
                  )}
                  {whatsAppLink && (
                    <li className="site-contact__item">
                      <span className="site-contact__label">WhatsApp</span>
                      <span className="site-contact__value">
                        <a href={whatsAppLink} target="_blank" rel="noopener noreferrer">
                          Chat on WhatsApp
                        </a>
                      </span>
                    </li>
                  )}
                </ul>
              )}
              <ContactForm businessId={businessId} />
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-wrap site-footer__inner">
          <span>
            &copy; {new Date().getFullYear()} {businessName}
          </span>
          <span>Powered by AiFA</span>
        </div>
      </footer>
    </div>
  );
}
