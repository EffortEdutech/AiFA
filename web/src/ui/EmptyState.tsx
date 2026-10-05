import type { ReactNode } from "react";

import { Icon, type IconName } from "./icons";

interface EmptyStateProps {
  title: string;
  /** What to do next, in one sentence. */
  description?: string;
  action?: ReactNode;
  icon?: IconName;
}

/** Friendly "nothing here yet" block that points at the next step. */
export function EmptyState({ title, description, action, icon = "info" }: EmptyStateProps): JSX.Element {
  return (
    <div className="ui-empty">
      <span className="ui-empty__icon">
        <Icon name={icon} size={22} />
      </span>
      <p className="ui-empty__title">{title}</p>
      {description && <p className="ui-empty__desc">{description}</p>}
      {action && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}
