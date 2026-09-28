export default function Skeleton({
  rows = 3,
  label = "読み込み中",
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <div className="skeleton-list" role="status" aria-label={label}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton-card" aria-hidden="true" />
      ))}
    </div>
  );
}
