/**
 * Shared tab-strip component — Sprint 37 (Vol 12_2 §5.1).
 *
 * Built once here and reused by every later module sprint's tabbed
 * pages (Vol 12_2 §5.2/§5.3 worked examples) — the "tabs, not
 * noticeboards" rule is enforced by giving every page-with-multiple-
 * views the same, single tab implementation rather than letting each
 * module sprint improvise its own.
 */
export interface TabStripTab<T extends string> {
  id: T;
  label: string;
  /** Optional badge count (e.g. "3" pending items) shown next to the label. */
  count?: number;
}

interface Props<T extends string> {
  tabs: ReadonlyArray<TabStripTab<T>>;
  active: T;
  onChange: (id: T) => void;
}

export function TabStrip<T extends string>({ tabs, active, onChange }: Props<T>): JSX.Element {
  return (
    <div className="aifa-tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {typeof t.count === "number" && <span className="aifa-tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
