import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getToday,
  listAreas,
  type AreaDto,
  type ChoreDto,
  type TodayResponse,
} from "../lib/api";
import { useSettings } from "../contexts/useSettings";
import { useCompleteChore } from "../hooks/useCompleteChore";
import ChoreCard from "../components/ChoreCard";
import Skeleton from "../components/Skeleton";
import PageHeader from "../components/PageHeader";
import { STATUS_META } from "../lib/statusMeta";

interface Section {
  key: string;
  title: string;
  items: ChoreDto[];
}

export default function Today() {
  const { timezone } = useSettings();
  const [data, setData] = useState<TodayResponse | null>(null);
  const [areas, setAreas] = useState<AreaDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notDueOpen, setNotDueOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [today, areaList] = await Promise.all([
        getToday(),
        listAreas(true),
      ]);
      setData(today);
      setAreas(areaList.items);
    } catch {
      setError("読み込みに失敗しました。");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // レビュー指摘 #1: 完了/Undo後は today.ts のクライアント側再実装で楽観的に
  // 並び替えるのではなく、`getToday` を再取得してサーバーの分類・並び・
  // notDueCount をそのまま使う。
  const { complete, isPending } = useCompleteChore(() => {
    void load();
  });

  const areaName = (id: string | null) =>
    id ? (areas.find((a) => a.id === id)?.name ?? null) : null;

  if (error) {
    return (
      <>
        <PageHeader title="今日" />
        <p role="alert">{error}</p>
        <button type="button" className="btn" onClick={() => void load()}>
          再読み込み
        </button>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHeader title="今日" />
        <Skeleton rows={4} />
      </>
    );
  }

  const sections: Section[] = [
    {
      key: "overdue",
      title: STATUS_META.overdue.label,
      items: data.sections.overdue,
    },
    {
      key: "recommended",
      title: STATUS_META.recommended.label,
      items: data.sections.recommended,
    },
    {
      key: "upcoming",
      title: STATUS_META.upcoming.label,
      items: data.sections.upcoming,
    },
    {
      key: "neverDone",
      title: STATUS_META.never_done.label,
      items: data.sections.neverDone,
    },
    // 「本日実施済み」は状態そのものではない(not_dueのうち本日分)ため、
    // STATUS_METAのラベルを参照せずここに直接置く(設計書 §8.2)。
    { key: "doneToday", title: "本日実施済み", items: data.sections.doneToday },
  ];

  const hasAny = sections.some((s) => s.items.length > 0);

  return (
    <>
      <PageHeader title="今日" />
      {!hasAny && data.notDueCount === 0 && (
        <p className="empty-state">
          まだ家事が登録されていません。
          <br />
          <Link to="/chores/propose">まとめて登録する</Link>
        </p>
      )}
      {!hasAny && data.notDueCount > 0 && (
        <p className="empty-state">今日、急いでやる家事はありません。</p>
      )}
      {sections.map(
        (section) =>
          section.items.length > 0 && (
            <section key={section.key} className="chore-section">
              <h2 className="chore-section-title">{section.title}</h2>
              <ul className="chore-card-list">
                {section.items.map((chore) => (
                  <ChoreCard
                    key={chore.id}
                    chore={chore}
                    areaName={areaName(chore.areaId)}
                    timezone={timezone}
                    onComplete={(c) => void complete(c)}
                    completing={isPending(chore.id)}
                  />
                ))}
              </ul>
            </section>
          ),
      )}
      {data.notDueCount > 0 && (
        <section className="chore-section">
          <button
            type="button"
            className="collapsible-toggle"
            aria-expanded={notDueOpen}
            onClick={() => setNotDueOpen((v) => !v)}
          >
            まだ不要 {data.notDueCount}件 {notDueOpen ? "▲" : "▼"}
          </button>
          {notDueOpen && (
            <p className="chore-section-note">
              一覧は「家事」タブから状態「まだ不要」で絞り込んで確認できます。
            </p>
          )}
        </section>
      )}
    </>
  );
}
