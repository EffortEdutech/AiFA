interface SkeletonProps {
  width?: number | string;
  height?: number | string;
}

/** Grey shimmer block shown while data loads. Replaces plain "Loading…" text. */
export function Skeleton({ width = "100%", height = 14 }: SkeletonProps): JSX.Element {
  return <span className="ui-skeleton" style={{ width, height }} aria-hidden="true" />;
}

/** A few stacked lines, for text-shaped content. */
export function SkeletonLines({ lines = 3 }: { lines?: number }): JSX.Element {
  return (
    <div className="ui-skeleton-lines" role="status" aria-live="polite" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "60%" : "100%"} />
      ))}
    </div>
  );
}
