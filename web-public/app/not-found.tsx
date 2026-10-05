// Shown when /site/<slug> does not resolve to a business, and for any other
// unknown address on this deployment.
export default function NotFound() {
  return (
    <main className="site-message">
      <div className="site-message__panel">
        <div className="site-message__mark" aria-hidden="true">
          A
        </div>
        <h1 className="site-message__title">Page not found</h1>
        <p className="site-message__text">
          We could not find the page you were looking for. Please check the
          address, or ask the business for their current link.
        </p>
        <p className="site-message__foot">Powered by AiFA</p>
      </div>
    </main>
  );
}
