import { AuthLayout } from "../shell/AuthLayout";
import { Button } from "../ui";

interface Props {
  onRetry: () => void;
  /** Sprint 40 addition: LocalDataKeyMismatchError (sqlJsAdapter.ts) carries
   * a more specific message than the generic "data was cleared" case --
   * shown here when the caller has one, falling back to the original
   * generic copy otherwise so this stays correct for any other caller. */
  message?: string;
}

/** Sprint 18 DoD: "IndexedDB-cleared scenario tested and surfaces a clear owner-facing message rather than a silent blank state." */
export function DataClearedBanner({ onRetry, message }: Props): JSX.Element {
  return (
    <AuthLayout title="Your local web data was cleared">
      <p className="aifa-alert aifa-alert--danger" role="alert">
        {message ??
          "This browser's local storage (private browsing, or the browser " +
            "freeing space) no longer has your encrypted local database. " +
            "Nothing was lost on your other devices — sign in and complete " +
            "setup again on this browser to continue."}
      </p>
      <div className="aifa-auth__actions">
        <Button variant="primary" onClick={onRetry}>
          Set up this browser again
        </Button>
      </div>
    </AuthLayout>
  );
}
