// Root landing page of the ai-fa Vercel deployment itself (not a Client
// Business's page -- that's app/site/[slug]/page.tsx). Kept intentionally
// minimal: this domain's real job is /site/<slug>. UI polish Phase 5 only
// gives it the same look as the rest of the public site.
export default function IndexPage() {
  return (
    <main className="site-message">
      <div className="site-message__panel">
        <div className="site-message__mark" aria-hidden="true">
          A
        </div>
        <h1 className="site-message__title">AiFA</h1>
        <p className="site-message__text">
          This address hosts the public websites of AiFA clients. A
          business&apos;s page lives at{" "}
          <code className="site-message__code">/site/&lt;slug&gt;</code>.
        </p>
      </div>
    </main>
  );
}
