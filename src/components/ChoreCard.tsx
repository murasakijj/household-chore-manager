import { Link } from "react-router-dom";
import type { ChoreDto } from "../lib/api";
import StatusBadge from "./StatusBadge";
import { formatDate } from "../lib/datetime";

export default function ChoreCard({
  chore,
  areaName,
  timezone,
  onComplete,
  completing,
}: {
  chore: ChoreDto;
  areaName?: string | null;
  timezone: string;
  onComplete: (chore: ChoreDto) => void;
  completing: boolean;
}) {
  return (
    <li className="chore-card">
      <div className="chore-card-main">
        <div className="chore-card-title-row">
          <span className="chore-card-name">{chore.name}</span>
          <StatusBadge status={chore.status} />
        </div>
        <div className="chore-card-meta">
          {areaName && <span>{areaName}</span>}
          <span>
            前回:{" "}
            {chore.lastCompletedAt
              ? formatDate(chore.lastCompletedAt, timezone)
              : "未実施"}
          </span>
          {chore.elapsedDays !== null && (
            <span>経過 {chore.elapsedDays}日</span>
          )}
          <span>推奨 {chore.intervalDays}日ごと</span>
        </div>
      </div>
      <div className="chore-card-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={completing}
          aria-label={`「${chore.name}」をやった`}
          onClick={() => onComplete(chore)}
        >
          やった
        </button>
        <Link
          className="btn"
          to={`/chores/${chore.id}`}
          aria-label={`「${chore.name}」の詳細`}
        >
          詳細
        </Link>
      </div>
    </li>
  );
}
