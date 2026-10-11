"use client";

// Customer request form (Sprint 68a): an enquiry or a quote request. Posts to
// /api/site/request. On success it shows the reference code and a private
// tracking link, which are the only way the customer can come back to it.
import { useRef, useState } from "react";

type Kind = "contact" | "rfq";
interface Item {
  description: string;
  quantity: string;
}
type Result = { code: string; token: string | null };

const EMPTY_ITEM: Item = { description: "", quantity: "" };

export function RequestForm({
  businessId,
  businessName,
  slug,
  initialKind,
  source,
  whatsAppDigits,
}: {
  businessId: string;
  businessName: string;
  slug: string;
  initialKind: Kind;
  source: string;
  whatsAppDigits: string | null;
}) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const [items, setItems] = useState<Item[]>([{ ...EMPTY_ITEM }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);
  const openedAt = useRef<number>(Date.now());

  function updateItem(index: number, patch: Partial<Item>) {
    setItems((list) => list.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/site/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          type: kind,
          name: fd.get("name"),
          phone: fd.get("phone"),
          email: fd.get("email"),
          message: fd.get("message"),
          consent: fd.get("consent") === "on",
          items: kind === "rfq" ? items.filter((i) => i.description.trim()) : undefined,
          neededBy: fd.get("neededBy"),
          deliveryArea: fd.get("deliveryArea"),
          source,
          website: fd.get("website"),
          elapsedMs: Date.now() - openedAt.current,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.message || "Could not send your request. Please try again.");
        return;
      }
      setResult({ code: data.reference_code, token: data.tracking_token });
    } catch {
      setError("Could not send your request. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const trackingUrl = result.token ? `${window.location.origin}/track/${result.token}` : null;
    const waText = encodeURIComponent(
      `Hi ${businessName}, I just sent a request (${result.code}).${trackingUrl ? ` ${trackingUrl}` : ""}`,
    );
    return (
      <div className="site-form" role="status">
        <p className="site-form__status site-form__status--ok">
          Thank you. {businessName} has received your request.
        </p>
        <div className="req-ref">
          <span className="req-ref__label">Your reference</span>
          <span className="req-ref__code">{result.code}</span>
        </div>
        {trackingUrl && (
          <>
            <p className="req-note">
              Keep this private link. It is the only way to see the status of your request and any reply.
              Anyone with the link can view it, so please do not share it.
            </p>
            <div className="req-link">
              <a href={trackingUrl}>{trackingUrl}</a>
            </div>
            <div className="req-actions">
              <button
                type="button"
                className="site-btn site-btn--solid"
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(trackingUrl)
                    .then(() => setCopied(true))
                    .catch(() => undefined);
                }}
              >
                {copied ? "Link copied" : "Copy link"}
              </button>
              <a className="site-btn site-btn--outline" href={trackingUrl}>
                Open status page
              </a>
              {whatsAppDigits && (
                <a
                  className="site-btn site-btn--outline"
                  href={`https://wa.me/${whatsAppDigits}?text=${waText}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Message us on WhatsApp
                </a>
              )}
            </div>
          </>
        )}
        <p className="req-note">
          <a href={`/site/${slug}`}>Back to {businessName}</a>
        </p>
      </div>
    );
  }

  return (
    <form className="site-form" onSubmit={handleSubmit}>
      <div className="req-tabs" role="group" aria-label="Request type">
        <button
          type="button"
          className={`req-tab${kind === "contact" ? " req-tab--on" : ""}`}
          aria-pressed={kind === "contact"}
          onClick={() => setKind("contact")}
        >
          Ask a question
        </button>
        <button
          type="button"
          className={`req-tab${kind === "rfq" ? " req-tab--on" : ""}`}
          aria-pressed={kind === "rfq"}
          onClick={() => setKind("rfq")}
        >
          Request a quote
        </button>
      </div>

      <div className="site-form__field">
        <label className="site-form__label" htmlFor="rq-name">Your name</label>
        <input id="rq-name" name="name" className="site-form__input" autoComplete="name" required minLength={2} maxLength={100} />
      </div>
      <div className="site-form__field">
        <label className="site-form__label" htmlFor="rq-phone">Phone / WhatsApp number</label>
        <input id="rq-phone" name="phone" type="tel" className="site-form__input" autoComplete="tel" placeholder="012-345 6789" required />
      </div>
      <div className="site-form__field">
        <label className="site-form__label" htmlFor="rq-email">Email (optional)</label>
        <input id="rq-email" name="email" type="email" className="site-form__input" autoComplete="email" maxLength={254} />
      </div>

      {kind === "rfq" && (
        <fieldset className="req-items">
          <legend className="site-form__label">What do you need?</legend>
          {items.map((item, i) => (
            <div className="req-item" key={i}>
              <input
                className="site-form__input req-item__desc"
                aria-label={`Item ${i + 1} description`}
                placeholder="Item or service"
                maxLength={200}
                value={item.description}
                onChange={(e) => updateItem(i, { description: e.target.value })}
                required={i === 0}
              />
              <input
                className="site-form__input req-item__qty"
                aria-label={`Item ${i + 1} quantity`}
                placeholder="Qty"
                maxLength={20}
                value={item.quantity}
                onChange={(e) => updateItem(i, { quantity: e.target.value })}
              />
              {items.length > 1 && (
                <button
                  type="button"
                  className="req-item__remove"
                  aria-label={`Remove item ${i + 1}`}
                  onClick={() => setItems((list) => list.filter((_, idx) => idx !== i))}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {items.length < 10 && (
            <button type="button" className="req-add" onClick={() => setItems((l) => [...l, { ...EMPTY_ITEM }])}>
              + Add another item
            </button>
          )}
          <div className="site-form__field">
            <label className="site-form__label" htmlFor="rq-needed">Needed by (optional)</label>
            <input id="rq-needed" name="neededBy" type="date" className="site-form__input" min={new Date().toISOString().slice(0, 10)} />
          </div>
          <div className="site-form__field">
            <label className="site-form__label" htmlFor="rq-area">Delivery area (optional)</label>
            <input id="rq-area" name="deliveryArea" className="site-form__input" maxLength={200} placeholder="e.g. Shah Alam" />
          </div>
        </fieldset>
      )}

      <div className="site-form__field">
        <label className="site-form__label" htmlFor="rq-message">
          {kind === "rfq" ? "Anything else we should know?" : "Your question"}
        </label>
        <textarea id="rq-message" name="message" rows={5} className="site-form__input" required minLength={10} maxLength={2000} />
      </div>

      {/* Honeypot: hidden from people, tempting to bots. */}
      <div className="req-hp" aria-hidden="true">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <label className="req-consent">
        <input type="checkbox" name="consent" required />
        <span>
          I agree that {businessName} may contact me about this request using the details above. My details are
          stored as plain text on AiFA&apos;s servers and are visible to {businessName}.
        </span>
      </label>

      <button type="submit" className="site-btn site-btn--solid" disabled={busy} aria-busy={busy}>
        {busy ? "Sending…" : kind === "rfq" ? "Send quote request" : "Send question"}
      </button>
      <div aria-live="polite">
        {error && (
          <p className="site-form__status site-form__status--error" role="alert">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
