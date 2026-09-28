import type { ChoreStatus } from "../lib/api";
import { statusMeta } from "../lib/statusMeta";

export default function StatusBadge({
  status,
}: {
  status: ChoreStatus | null | undefined;
}) {
  const meta = statusMeta(status);
  return (
    <span className={`status-badge status-badge--${meta.key}`}>
      <span aria-hidden="true">{meta.icon}</span>
      {meta.label}
    </span>
  );
}
