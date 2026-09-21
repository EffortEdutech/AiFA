// AiFA Public Site -- business homepage, served from Vercel instead of the
// Supabase `public-homepage` edge function (see lib/supabasePublic.ts for
// why: Supabase's Edge Functions gateway won't let a function serve real
// HTML to a browser). Ports resolveBusinessId()/renderHomepage() from
// supabase/functions/public-homepage/index.ts to React -- same resolution
// (resolve_business_slug RPC), same content fields, same layout.
import { notFound } from "next/navigation";
import type { Metadata } from "next";

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

  const [{ data: content }, { data: business }] = await Promise.all([
    supabase
      .from("public_site_content")
      .select("*")
      .eq("business_id", businessId)
      .maybeSingle(),
    supabase.from("businesses").select("legal_name").eq("id", businessId).maybeSingle(),
  ]);

  return {
    businessId: businessId as string,
    businessName: (business as { legal_name?: string } | null)?.legal_name || "This business",
    content: (content as SiteContent | null) ?? null,
  };
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const site = await loadSite(params.slug);
  return { title: site?.businessName ?? "AiFA" };
}

export default async function BusinessSitePage({
  params,
}: {
  params: { slug: string };
}) {
  const site = await loadSite(params.slug);
  if (!site) notFound();

  const { businessId, businessName, content } = site;
  const accent = content?.accent_color || "#1a2b3c";
  const headline = content?.hero_headline || businessName;
  const subtext = content?.hero_subtext || "";
  const services = content?.services || [];
  const email = content?.contact_email || "";
  const phone = content?.contact_phone || "";

  if (!content) {
    return (
      <main style={{ padding: 48, maxWidth: 640, margin: "0 auto" }}>
        <h1>{businessName}</h1>
        <p>This site has not published any content yet.</p>
      </main>
    );
  }

  return (
    <div style={{ "--accent": accent } as React.CSSProperties}>
      <nav
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 24px",
          borderBottom: "1px solid #eee",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 18 }}>{businessName}</span>
      </nav>

      <div
        style={{
          padding: "64px 24px",
          background: accent,
          color: "#fff",
          textAlign: "center",
        }}
      >
        <h1 style={{ margin: "0 0 12px", fontSize: 32 }}>{headline}</h1>
        {subtext && <p style={{ margin: 0, fontSize: 18, opacity: 0.9 }}>{subtext}</p>}
      </div>

      <section style={{ padding: "48px 24px", maxWidth: 960, margin: "0 auto" }}>
        <h2>Services</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 16,
          }}
        >
          {services.length > 0 ? (
            services.map((s, i) => (
              <div
                key={i}
                style={{ border: "1px solid #eee", borderRadius: 8, padding: 20 }}
              >
                <h3 style={{ marginTop: 0, color: accent }}>{s.name}</h3>
                <p>{s.description}</p>
              </div>
            ))
          ) : (
            <p>Services coming soon.</p>
          )}
        </div>
      </section>

      <section style={{ padding: "48px 24px", maxWidth: 960, margin: "0 auto" }}>
        <h2>About</h2>
        <p>{subtext || `${businessName} is on AiFA.`}</p>
      </section>

      <section style={{ padding: "48px 24px", maxWidth: 960, margin: "0 auto" }}>
        <h2>Contact</h2>
        {email && <p>Email: {email}</p>}
        {phone && <p>Phone: {phone}</p>}
        <ContactForm businessId={businessId} />
      </section>

      <footer
        style={{
          padding: 24,
          textAlign: "center",
          color: "#777",
          fontSize: 13,
          borderTop: "1px solid #eee",
        }}
      >
        Powered by AiFA
      </footer>
    </div>
  );
}
