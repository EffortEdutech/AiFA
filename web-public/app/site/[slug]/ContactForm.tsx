"use client";

// Client component: the contact form's submit handler. Posts to this app's
// own /api/site/contact Route Handler, which calls the existing
// submit_public_request() RPC -- same destination the original
// public-homepage edge function's inline <script> posted to, just moved
// into a real React component now that this app owns the page.
import { useState } from "react";

export function ContactForm({ businessId }: { businessId: string }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setStatus("Sending…");
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
      setStatus("Thanks — we'll be in touch.");
      form.reset();
    } catch {
      setStatus("Could not send — please try again.");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    padding: 10,
    border: "1px solid #ccc",
    borderRadius: 6,
    font: "inherit",
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 480 }}
    >
      <input name="name" placeholder="Your name" required style={inputStyle} />
      <input name="email" type="email" placeholder="Your email" required style={inputStyle} />
      <textarea name="message" placeholder="Message" rows={4} required style={inputStyle} />
      <button
        type="submit"
        disabled={busy}
        style={{
          padding: "10px 20px",
          background: "var(--accent)",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.7 : 1,
        }}
      >
        {busy ? "Sending…" : "Send"}
      </button>
      <p style={{ fontSize: 14 }}>{status}</p>
    </form>
  );
}
