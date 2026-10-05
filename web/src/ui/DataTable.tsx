import type { KeyboardEvent, ReactNode } from "react";

import { Skeleton } from "./Skeleton";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Right-align and use tabular figures; use for money and counts. */
  numeric?: boolean;
  width?: number | string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  /** `null` means "still loading" and shows skeleton rows. */
  rows: T[] | null;
  rowKey: (row: T) => string;
  /** Accessible table name (visually hidden). */
  caption: string;
  /** Shown instead of the table when there are no rows. */
  empty?: ReactNode;
  /** Load error message; replaces the table when set. */
  error?: string | null;
  onRowClick?: (row: T) => void;
  /** `rowKey` of the row to highlight as selected (e.g. the one whose detail is open). */
  selectedKey?: string | null;
  skeletonRows?: number;
  /** Cap the height and scroll inside the table, keeping the header visible. */
  maxHeight?: number | string;
}

/**
 * The console's one list/table: sticky header, right-aligned money,
 * built-in loading, empty and error states. Replaces card-per-record
 * lists so long lists stay scannable.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  empty,
  error,
  onRowClick,
  selectedKey = null,
  skeletonRows = 5,
  maxHeight,
}: DataTableProps<T>): JSX.Element {
  if (error) {
    return (
      <div className="ui-table-state ui-table-state--error" role="alert">
        {error}
      </div>
    );
  }
  if (rows !== null && rows.length === 0) {
    return <>{empty ?? <div className="ui-table-state">Nothing to show yet.</div>}</>;
  }

  function handleKey(event: KeyboardEvent<HTMLTableRowElement>, row: T): void {
    if (!onRowClick) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onRowClick(row);
    }
  }

  return (
    <div className="ui-table-wrap" style={maxHeight ? { maxHeight } : undefined}>
      <table className="ui-table">
        <caption className="ui-sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} scope="col" className={col.numeric ? "is-num" : undefined} style={col.width ? { width: col.width } : undefined}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows === null
            ? Array.from({ length: skeletonRows }, (_, i) => (
                <tr key={`sk-${i}`} aria-hidden="true">
                  {columns.map((col) => (
                    <td key={col.key}>
                      <Skeleton width={col.numeric ? "50%" : "80%"} />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  className={[onRowClick ? "is-clickable" : "", selectedKey !== null && rowKey(row) === selectedKey ? "is-selected" : ""]
                    .filter(Boolean)
                    .join(" ") || undefined}
                  aria-current={selectedKey !== null && rowKey(row) === selectedKey ? "true" : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? (e) => handleKey(e, row) : undefined}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={col.numeric ? "is-num" : undefined}>
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}
