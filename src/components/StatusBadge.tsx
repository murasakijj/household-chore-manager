import type { ChoreStatus } from "../lib/api";
import { statusBadgeLabel, statusMeta } from "../lib/statusMeta";

export default function StatusBadge({
  status,
  overdueDays,
}: {
  status: ChoreStatus | null | undefined;
  overdueDays?: number | null;
}) {
  const meta = statusMeta(status);
  return (
    <span className={`status-badge status-badge--${meta.key}`}>
      <span aria-hidden="true">{meta.icon}</span>
      {statusBadgeLabel(status, overdueDays)}
    </span>
  );
}
