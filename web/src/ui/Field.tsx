import { useId, type ReactNode } from "react";

/** Props to spread onto the control so label, hint and error are wired for assistive tech. */
export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

interface FieldProps {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  /** Render-prop: `{(p) => <input className="ui-input" {...p} />}`. */
  children: (control: FieldControlProps) => ReactNode;
}

/** Label + control + hint + error, replacing unlabelled inputs with inline padding. */
export function Field({ label, hint, error, required, children }: FieldProps): JSX.Element {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={id}>
        {label}
        {required && <span className="ui-field__required" aria-hidden="true"> *</span>}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint && !error && (
        <span className="ui-field__hint" id={hintId}>
          {hint}
        </span>
      )}
      {error && (
        <span className="ui-field__error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
