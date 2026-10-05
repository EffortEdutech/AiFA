import type { ReactNode } from "react";

interface CardProps {
  title?: string;
  description?: string;
  /** Right-aligned header content, usually a button. */
  actions?: ReactNode;
  /** Remove body padding, for a table that should touch the card edges. */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

/** Bordered surface with an optional header. Replaces hand-built `.card` blocks. */
export function Card({ title, description, actions, flush = false, className, children }: CardProps): JSX.Element {
  const hasHeader = Boolean(title || actions);
  return (
    <section className={["ui-card", className ?? ""].filter(Boolean).join(" ")}>
      {hasHeader && (
        <div className="ui-card__header">
          <div>
            {title && <h2 className="ui-card__title">{title}</h2>}
            {description && <p className="ui-card__desc">{description}</p>}
          </div>
          {actions && <div className="ui-page-actions">{actions}</div>}
        </div>
      )}
      <div className={flush ? "ui-card__body ui-card__body--flush" : "ui-card__body"}>{children}</div>
    </section>
  );
}
