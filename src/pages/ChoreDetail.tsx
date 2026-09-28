import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  getChore,
  listAreas,
  listCategories,
  listMembers,
  listResources,
  patchChore,
  voidChoreEvent,
  type AreaDto,
  type CategoryDto,
  type ChoreDetailDto,
  type MemberDto,
  type ResourceDto,
} from "../lib/api";
import { useSettings } from "../contexts/useSettings";
import { useCompleteChore } from "../hooks/useCompleteChore";
import { useToast } from "../contexts/useToast";
import { describeApiError, isAlreadyVoidedError } from "../lib/errorMessages";
import { formatCalendarDate, formatDateTime } from "../lib/datetime";
import StatusBadge from "../components/StatusBadge";
import Skeleton from "../components/Skeleton";
import PageHeader from "../components/PageHeader";

export default function ChoreDetail() {
  const { id } = useParams<{ id: string }>();
  const { timezone } = useSettings();
  const { showToast } = useToast();

  const [chore, setChore] = useState<ChoreDetailDto | null>(null);
  const [areas, setAreas] = useState<AreaDto[]>([]);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [resources, setResources] = useState<ResourceDto[]>([]);
  const [members, setMembers] = useState<MemberDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [detail, areaList, categoryList, resourceList, memberList] =
        await Promise.all([
          getChore(id),
          listAreas(true),
          listCategories(true),
          listResources(true),
          listMembers(),
        ]);
      setChore(detail);
      setAreas(areaList.items);
      setCategories(categoryList.items);
      setResources(resourceList.items);
      setMembers(memberList.items);
    } catch {
      setError("読み込みに失敗しました。");
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const { complete, isPending } = useCompleteChore((updated) => {
    setChore((current) => (current ? { ...current, ...updated } : current));
    void load();
  });

  const memberName = (memberId: string) =>
    members.find((m) => m.id === memberId)?.displayName ?? memberId;

  const handleToggleActive = async () => {
    if (!chore) return;
    const goingInactive = chore.isActive;
    if (goingInactive) {
      const confirmed = window.confirm(
        `「${chore.name}」を無効化しますか？一覧・通知の対象外になります(履歴は保持されます)。`,
      );
      if (!confirmed) return;
    }
    setBusy(true);
    try {
      const updated = await patchChore(chore.id, { isActive: !goingInactive });
      setChore((current) => (current ? { ...current, ...updated } : current));
      showToast({
        message: goingInactive ? "無効化しました。" : "再有効化しました。",
      });
    } catch {
      showToast({ message: "更新に失敗しました。", tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const handleVoidEvent = async (eventId: string) => {
    const confirmed = window.confirm("この記録を取り消しますか？");
    if (!confirmed) return;
    setBusy(true);
    try {
      await voidChoreEvent(eventId);
      showToast({ message: "記録を取り消しました。" });
      await load();
    } catch (err) {
      if (isAlreadyVoidedError(err)) {
        showToast({
          message: "この記録は既に取り消し済みです。",
          tone: "warning",
        });
        await load();
      } else {
        showToast({
          message: describeApiError(err, "取り消しに失敗しました。"),
          tone: "error",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <>
        <PageHeader title="家事詳細" back />
        <p role="alert">{error}</p>
      </>
    );
  }

  if (!chore) {
    return (
      <>
        <PageHeader title="家事詳細" back />
        <Skeleton rows={4} />
      </>
    );
  }

  const areaName = chore.areaId
    ? areas.find((a) => a.id === chore.areaId)?.name
    : null;
  const categoryName = chore.categoryId
    ? categories.find((c) => c.id === chore.categoryId)?.name
    : null;
  const resourceName = chore.resourceId
    ? resources.find((r) => r.id === chore.resourceId)?.name
    : null;

  return (
    <>
      <PageHeader title={chore.name} back />
      <section className="detail-block">
        <StatusBadge status={chore.status} />
        {!chore.isActive && (
          <p className="detail-note">この家事は無効化されています。</p>
        )}
        <dl className="detail-list">
          <div>
            <dt>前回実施日時</dt>
            <dd>
              {chore.lastCompletedAt
                ? formatDateTime(chore.lastCompletedAt, timezone)
                : "未実施"}
            </dd>
          </div>
          <div>
            <dt>次の状態変化予定日</dt>
            <dd>
              {chore.nextChangeDate
                ? formatCalendarDate(chore.nextChangeDate)
                : "—"}
            </dd>
          </div>
          <div>
            <dt>推奨間隔</dt>
            <dd>{chore.intervalDays}日</dd>
          </div>
          <div>
            <dt>予告日数</dt>
            <dd>{chore.warningDays}日</dd>
          </div>
          <div>
            <dt>猶予日数</dt>
            <dd>{chore.graceDays}日</dd>
          </div>
          <div>
            <dt>場所</dt>
            <dd>{areaName ?? "未設定"}</dd>
          </div>
          <div>
            <dt>カテゴリ</dt>
            <dd>{categoryName ?? "未設定"}</dd>
          </div>
          <div>
            <dt>対象リソース</dt>
            <dd>{resourceName ?? "未設定"}</dd>
          </div>
          <div>
            <dt>平均実施間隔</dt>
            <dd>
              {chore.averageIntervalDays !== null
                ? `${chore.averageIntervalDays}日(参考値)`
                : "履歴不足"}
            </dd>
          </div>
        </dl>
        {chore.description && (
          <p className="detail-description">{chore.description}</p>
        )}
      </section>

      <section className="detail-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={isPending(chore.id)}
          onClick={() => void complete(chore)}
        >
          やった
        </button>
        <Link
          className="btn"
          to={`/chores/${chore.id}/record`}
          state={{ from: `/chores/${chore.id}` }}
        >
          日時を指定して記録
        </Link>
        <Link className="btn" to={`/chores/${chore.id}/edit`}>
          編集
        </Link>
        <button
          type="button"
          className={chore.isActive ? "btn btn-danger" : "btn"}
          disabled={busy}
          onClick={() => void handleToggleActive()}
        >
          {chore.isActive ? "無効化する" : "再有効化する"}
        </button>
      </section>

      <section className="detail-block">
        <h2>最近の実施履歴</h2>
        {chore.recentEvents.length === 0 && <p>まだ履歴がありません。</p>}
        {chore.recentEvents.length > 0 && (
          <ul className="history-list">
            {chore.recentEvents.map((event) => (
              <li key={event.id} className="history-item">
                <div className="history-item-main">
                  <span>{formatDateTime(event.occurredAt, timezone)}</span>
                  <span>{memberName(event.actorMemberId)}</span>
                  {event.note && (
                    <span className="history-note">{event.note}</span>
                  )}
                </div>
                {event.voidedAt ? (
                  <span className="history-voided">取消済み</span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={busy}
                    onClick={() => void handleVoidEvent(event.id)}
                  >
                    取消
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
