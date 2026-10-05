/** Full-area loading state used between the app's start-up steps. */
interface LoadingScreenProps {
  message?: string;
}

export function LoadingScreen({ message = "Loading…" }: LoadingScreenProps): JSX.Element {
  return (
    <div className="aifa-loading" role="status">
      <span className="ui-spinner aifa-loading__spinner" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
