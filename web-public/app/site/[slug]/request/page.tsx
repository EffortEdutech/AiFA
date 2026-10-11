// Customer request page (Sprint 68a): reached from the business page buttons
// or from the owner's QR code (/site/<slug>/request?type=rfq&src=counter).
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";

import { buildTheme } from "../../../../lib/color";
import { internationalDigits } from "../../../../lib/contact";
import { getPublicSupabaseClient } from "../../../../lib/supabasePublic";
import { RequestForm } from "./RequestForm";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Send a request",
  robots: { index: false, follow: false },
};

export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ type?: string; src?: string }>;
}) {
  const { slug } = await params;
  const { type, src } = await searchParams;
  const supabase = getPublicSupabaseClient();

  const { data: businessId } = await supabase.rpc("resolve_business_slug", { p_slug: slug });
  if (!businessId) notFound();

  // A renamed slug keeps working; send the visitor to the current address.
  const { data: currentSlug } = await supabase.rpc("get_current_business_slug", { p_slug: slug });
  if (typeof currentSlug === "string" && currentSlug !== slug) {
    const qs = new URLSearchParams();
    if (type) qs.set("type", type);
    if (src) qs.set("src", src);
    redirect(`/site/${currentSlug}/request${qs.toString() ? `?${qs}` : ""}`);
  }

  const [{ data: content }, { data: name }] = await Promise.all([
    supabase.from("public_site_content").select("*").eq("business_id", businessId).maybeSingle(),
    supabase.rpc("get_public_business_name", { p_business_id: businessId }),
  ]);
  const businessName = (name as string | null) || "This business";
  const row = content as { accent_color: string | null; contact_phone: string | null } | null;
  const theme = buildTheme(row?.accent_color ?? null);
  const themeVars = {
    "--accent": theme.accent,
    "--on-accent": theme.onAccent,
    "--accent-text": theme.accentText,
    "--accent-tint": theme.accentTint,
    "--hero-btn-bg": theme.heroButtonBg,
    "--hero-btn-text": theme.heroButtonText,
  } as React.CSSProperties;

  const source = /^[a-z0-9_-]{1,40}$/i.test(src || "") ? (src as string).toLowerCase() : "";

  return (
    <div className="site" style={themeVars}>
      <main className="req-page">
        <div className="site-wrap req-wrap">
          <a className="req-back" href={`/site/${slug}`}>
            ← {businessName}
          </a>
          <h1 className="site-section__title">Send {businessName} a request</h1>
          <p className="site-section__lead">
            Ask a question or request a quote. We will reply using the phone number you give.
          </p>
          <RequestForm
            businessId={businessId as string}
            businessName={businessName}
            slug={slug}
            initialKind={type === "rfq" ? "rfq" : "contact"}
            source={source}
            whatsAppDigits={row?.contact_phone ? internationalDigits(row.contact_phone) : null}
          />
        </div>
      </main>
    </div>
  );
}
