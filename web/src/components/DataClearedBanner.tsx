interface Props {
  onRetry: () => void;
}

/** Sprint 18 DoD: "IndexedDB-cleared scenario tested and surfaces a clear owner-facing message rather than a silent blank state." */
export function DataClearedBanner({ onRetry }: Props): JSX.Element {
  return (
    <div className="card" style={{ maxWidth: 420, margin: "80px auto", borderColor: "#b3261e" }}>
      <h1 style={{ fontSize: 18 }}>Your local web data was cleared</h1>
      <p>
        This browser's local storage (private browsing, or the browser
        freeing space) no longer has your encrypted local database. Nothing
        was lost on your other devices — sign in and complete setup again
        on this browser to continue.
      </p>
      <button onClick={onRetry}>Set up this browser again</button>
    </div>
  );
}
