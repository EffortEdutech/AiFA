// Root landing page of the ai-fa Vercel deployment itself (not a Client
// Business's page -- that's app/site/[slug]/page.tsx). Kept intentionally
// minimal: this domain's real job is /site/<slug>.
export default function IndexPage() {
  return (
    <main style={{ padding: 48, maxWidth: 640, margin: "0 auto" }}>
      <h1>AiFA</h1>
      <p>
        This is the AiFA-hosted public site platform. A Client Business&apos;s
        page lives at <code>/site/&lt;slug&gt;</code>.
      </p>
    </main>
  );
}
