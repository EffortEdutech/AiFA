import type { ReactNode } from "react";

import type { StatusTone } from "./StatusPill";

interface StatTileProps {
  label: string;
  /** Pre-formatted value, e.g. formatMoney(x) or a count; null shows a placeholder. */
  value: ReactNode | null;
  /** One short line of context under the value. */
  hint?: ReactNode;
  tone?: StatusTone;
}

/** A single headline figure with a label, replacing hand-styled 24px bold numbers. */
export function StatTile({ label, value, hint, tone = "neutral" }: StatTileProps): JSX.Element {
  return (
    <div className={`ui-stat ui-stat--${tone}`}>
      <div className="ui-stat__label">{label}</div>
      <div className="ui-stat__value">{value === null ? <span className="ui-skeleton ui-skeleton--value" /> : value}</div>
      {hint && <div className="ui-stat__hint">{hint}</div>}
    </div>
  );
}

/** Responsive row of StatTiles. */
export function StatGrid({ children }: { children: ReactNode }): JSX.Element {
  return <div className="ui-stat-grid">{children}</div>;
}
