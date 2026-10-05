import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  /** One short line saying what this page is for. */
  description?: string;
  /** Right-aligned action buttons (at most one primary). */
  actions?: ReactNode;
  /** Optional tab strip rendered directly under the header. */
  children?: ReactNode;
}

/** Standard top-of-page block: title, purpose line, actions, optional tabs. */
export function PageHeader({ title, description, actions, children }: PageHeaderProps): JSX.Element {
  return (
    <>
      <header className="ui-page-header">
        <div>
          <h1 className="ui-page-title">{title}</h1>
          {description && <p className="ui-page-desc">{description}</p>}
        </div>
        {actions && <div className="ui-page-actions">{actions}</div>}
      </header>
      {children}
    </>
  );
}
