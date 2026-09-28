import { useCallback, useEffect, useRef, useState } from "react";
import {
  listAllEvents,
  listAreas,
  listChores,
  listMembers,
  voidChoreEvent,
  type AreaDto,
  type ChoreDto,
  type ChoreEventDto,
  type MemberDto,
} from "../lib/api";
import { useSettings } from "../contexts/useSettings";
import { useToast } from "../contexts/useToast";
import { describeApiError, isAlreadyVoidedError } from "../lib/errorMessages";
import {
  datetimeLocalToOffsetIso,
  endOfCalendarDayOffsetIso,
  formatDateTime,
} from "../lib/datetime";
import PageHeader from "../components/PageHeader";
import Skeleton from "../components/Skeleton";

export default function History() {
  const { timezone } = useSettings();
  const { showToast } = useToast();

  const [events, setEvents] = useState<ChoreEventDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [chores, setChores] = useState<ChoreDto[]>([]);
  const [areas, setAreas] = useState<AreaDto[]>([]);
  const [members, setMembers] = useState<MemberDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyEventId, setBusyEventId] = useState<string | null>(null);

  const [choreId, setChoreId] = useState("");
  const [areaId, setAreaId] = useState("");
  const [actorMemberId, setActorMemberId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [includeVoided, setIncludeVoided] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);

  // レビュー指摘 #5: 家事・場所・実施者の一覧(絞り込み用マスタ)は初回1回だけ取得する。
  useEffect(() => {
    void (async () => {
      try {
        const [choreList, areaList, memberList] = await Promise.all([
          listChores({ includeInactive: true }),
          listAreas(true),
          listMembers(),
        ]);
        setChores(choreList.items);
        setAreas(areaList.items);
        setMembers(memberList.items);
      } catch {
        // フィルタ用マスタの取得失敗は致命的ではないため、履歴自体の読み込みは続行する。
      }
    })();
  }, []);

  // レビュー指摘 #12: 開始日 > 終了日は入力エラーとして扱い、取得しない。
  const dateRangeInvalid = Boolean(fromDate && toDate && fromDate > toDate);

  const buildFilterParams = useCallback(
    () => ({
      choreId: choreId || undefined,
      areaId: areaId || undefined,
      actorMemberId: actorMemberId || undefined,
      from: fromDate
        ? datetimeLocalToOffsetIso(`${fromDate}T00:00`, timezone)
        : undefined,
      // レビュー指摘 #12: 終了日は家庭TZでのその日の23:59:59.999まで含める。
      to: toDate ? endOfCalendarDayOffsetIso(toDate, timezone) : undefined,
      includeVoided,
    }),
    [choreId, areaId, actorMemberId, fromDate, toDate, includeVoided, timezone],
  );

  // レビュー指摘 #5: フィルタ変更のたびに連番を進め、古い応答(loadMoreの古い
  // カーソルを含む)を破棄する。
  const requestSeqRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestSeqRef.current;
    setRangeError(
      fromDate && toDate && fromDate > toDate
        ? "開始日は終了日より前の日付にしてください。"
        : null,
    );
    if (fromDate && toDate && fromDate > toDate) {
      setEvents([]);
      setNextCursor(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const page = await listAllEvents({ ...buildFilterParams(), limit: 50 });
      if (requestSeqRef.current !== requestId) return; // 古い応答は破棄する
      setEvents(page.items);
      setNextCursor(page.nextCursor);
    } catch {
      if (requestSeqRef.current !== requestId) return;
      setError("読み込みに失敗しました。");
    } finally {
      if (requestSeqRef.current === requestId) setLoading(false);
    }
  }, [buildFilterParams, fromDate, toDate]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const loadMore = async () => {
    if (!nextCursor || dateRangeInvalid) return;
    const requestId = requestSeqRef.current; // フィルタが変わったら古いカーソルを破棄する
    setLoadingMore(true);
    try {
      const page = await listAllEvents({
        ...buildFilterParams(),
        limit: 50,
        cursor: nextCursor,
      });
      if (requestSeqRef.current !== requestId) return;
      setEvents((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      if (requestSeqRef.current !== requestId) return;
      showToast({ message: "追加読み込みに失敗しました。", tone: "error" });
    } finally {
      if (requestSeqRef.current === requestId) setLoadingMore(false);
    }
  };

  const handleVoid = async (eventId: string) => {
    const confirmed = window.confirm("この記録を取り消しますか？");
    if (!confirmed) return;
    setBusyEventId(eventId);
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
      setBusyEventId(null);
    }
  };

  const choreName = (id: string) => chores.find((c) => c.id === id)?.name ?? id;
  const choreArea = (id: string) => {
    const chore = chores.find((c) => c.id === id);
    if (!chore?.areaId) return null;
    return areas.find((a) => a.id === chore.areaId)?.name ?? null;
  };
  const memberName = (id: string) =>
    members.find((m) => m.id === id)?.displayName ?? id;

  return (
    <>
      <PageHeader title="全体履歴" />
      <form
        className="filter-bar"
        role="search"
        onSubmit={(e) => e.preventDefault()}
      >
        <label className="filter-field">
          家事
          <select value={choreId} onChange={(e) => setChoreId(e.target.value)}>
            <option value="">すべて</option>
            {chores.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          場所
          <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
            <option value="">すべて</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          実施者
          <select
            value={actorMemberId}
            onChange={(e) => setActorMemberId(e.target.value)}
          >
            <option value="">すべて</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          期間(開始)
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </label>
        <label className="filter-field">
          期間(終了)
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </label>
        <label className="filter-checkbox">
          <input
            type="checkbox"
            checked={includeVoided}
            onChange={(e) => setIncludeVoided(e.target.checked)}
          />
          取消済みも表示
        </label>
      </form>

      {rangeError && <p role="alert">{rangeError}</p>}
      {error && <p role="alert">{error}</p>}
      {loading && <Skeleton rows={6} />}
      {!loading && !rangeError && events.length === 0 && (
        <p className="empty-state">該当する履歴がありません。</p>
      )}
      {!loading && events.length > 0 && (
        <>
          <ul className="history-list">
            {events.map((event) => (
              <li key={event.id} className="history-item">
                <div className="history-item-main">
                  <span>{formatDateTime(event.occurredAt, timezone)}</span>
                  <span>{choreName(event.choreId)}</span>
                  {choreArea(event.choreId) && (
                    <span>{choreArea(event.choreId)}</span>
                  )}
                  <span>{memberName(event.actorMemberId)}</span>
                  {event.note && (
                    <span className="history-note">{event.note}</span>
                  )}
                  {event.voidedAt && (
                    <span className="history-voided">取消済み</span>
                  )}
                </div>
                {!event.voidedAt && (
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={busyEventId === event.id}
                    onClick={() => void handleVoid(event.id)}
                  >
                    取消
                  </button>
                )}
              </li>
            ))}
          </ul>
          {nextCursor && (
            <button
              type="button"
              className="btn"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? "読み込み中..." : "さらに読み込む"}
            </button>
          )}
        </>
      )}
    </>
  );
}
