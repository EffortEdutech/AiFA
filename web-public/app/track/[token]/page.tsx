// Private status page for one customer request (Sprint 68a). The long random
// token in the URL is the only credential. Read-only, never indexed, and it
// never shows the customer's phone number or email.
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { STATUS_LABELS } from "../../../lib/requests";
import { getPublicSupabaseClient } from "../../../lib/supabasePublic";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Request status",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

interface Tracking {
  reference_code: string;
  request_type: string;
  status: string;
  created_at: string;
  business_name: string | null;
  business_slug: string | null;
  customer_name: string;
  message: string | null;
  items: { description: string; quantity: string }[];
  needed_by: string | null;
  delivery_area: string | null;
  events: { kind: string; status: string | null; body: string | null; created_at: string }[];
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" });

export default async function TrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = getPublicSupabaseClient();
  const { data } = await supabase.rpc("get_request_tracking", { p_token: token });
  if (!data) notFound();
  const t = data as Tracking;

  const eventLabel = (e: Tracking["events"][number]) =>
    e.kind === "received"
      ? "Request received"
      : e.kind === "reply"
        ? "Reply from the business"
        : e.kind === "quotation"
          ? "Quotation prepared"
          : STATUS_LABELS[e.status || ""] || "Update";

  return (
    <main className="site req-page">
      <div className="site-wrap req-wrap">
        <p className="req-kicker">{t.business_name}</p>
        <h1 className="site-section__title">
          {t.request_type === "rfq" ? "Quote request" : "Enquiry"} {t.reference_code}
        </h1>
        <p>
          <span className="req-status">{STATUS_LABELS[t.status] || t.status}</span>
        </p>

        <h2 className="req-h2">Timeline</h2>
        <ol className="req-timeline">
          {t.events.map((e, i) => (
            <li key={i} className="req-timeline__item">
              <div className="req-timeline__head">
                <strong>{eventLabel(e)}</strong>
                <time dateTime={e.created_at}>{when(e.created_at)}</time>
              </div>
              {e.body && <p className="req-timeline__body">{e.body}</p>}
            </li>
          ))}
        </ol>

        <h2 className="req-h2">What you sent</h2>
        <div className="site-card">
          {t.items.length > 0 && (
            <ul className="req-list">
              {t.items.map((it, i) => (
                <li key={i}>
                  {it.description}
                  {it.quantity ? ` × ${it.quantity}` : ""}
                </li>
              ))}
            </ul>
          )}
          {t.message && <p className="site-card__text">{t.message}</p>}
          {t.needed_by && <p className="site-card__text">Needed by: {t.needed_by}</p>}
          {t.delivery_area && <p className="site-card__text">Delivery area: {t.delivery_area}</p>}
        </div>

        <p className="req-note">
          Replies from {t.business_name} appear here and are also sent to the phone number you gave. This page is
          private; anyone with this link can view it.
        </p>
        {t.business_slug && (
          <p className="req-note">
            <a href={`/site/${t.business_slug}`}>Visit {t.business_name}</a>
          </p>
        )}
      </div>
    </main>
  );
}
