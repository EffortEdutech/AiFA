"use client";

// Client component: the contact form's submit handler. Posts to this app's
// own /api/site/contact Route Handler, which calls the existing
// submit_public_request() RPC -- same destination the original
// public-homepage edge function's inline <script> posted to, just moved
// into a real React component now that this app owns the page.
//
// UI polish Phase 5: labelled fields, a visible success/error message that
// screen readers announce, and the shared site styles. The request body and
// endpoint are unchanged.
import { useState } from "react";

type Status = { kind: "idle" } | { kind: "ok"; text: string } | { kind: "error"; text: string };

export function ContactForm({ businessId }: { businessId: string }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setStatus({ kind: "idle" });
    const form = e.currentTarget;
    const fd = new FormData(form);
    try {
      const res = await fetch("/api/site/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          name: fd.get("name"),
          email: fd.get("email"),
          message: fd.get("message"),
        }),
      });
      if (!res.ok) throw new Error("failed");
      setStatus({ kind: "ok", text: "Thanks — we'll be in touch." });
      form.reset();
    } catch {
      setStatus({ kind: "error", text: "Could not send — please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="site-form" onSubmit={handleSubmit}>
      <div className="site-form__field">
        <label className="site-form__label" htmlFor="contact-name">
          Your name
        </label>
        <input
          id="contact-name"
          name="name"
          className="site-form__input"
          autoComplete="name"
          required
        />
      </div>
      <div className="site-form__field">
        <label className="site-form__label" htmlFor="contact-email">
          Your email
        </label>
        <input
          id="contact-email"
          name="email"
          type="email"
          className="site-form__input"
          autoComplete="email"
          required
        />
      </div>
      <div className="site-form__field">
        <label className="site-form__label" htmlFor="contact-message">
          Message
        </label>
        <textarea
          id="contact-message"
          name="message"
          rows={5}
          className="site-form__input"
          required
        />
      </div>
      <button type="submit" className="site-btn site-btn--solid" disabled={busy} aria-busy={busy}>
        {busy ? "Sending…" : "Send message"}
      </button>
      <div aria-live="polite">
        {status.kind === "ok" && (
          <p className="site-form__status site-form__status--ok" role="status">
            {status.text}
          </p>
        )}
        {status.kind === "error" && (
          <p className="site-form__status site-form__status--error" role="alert">
            {status.text}
          </p>
        )}
      </div>
    </form>
  );
}
