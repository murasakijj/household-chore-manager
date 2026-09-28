import { useCallback, useEffect, useState } from "react";
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

interface Section {
  key: string;
  title: string;
  items: ChoreDto[];
}

function replaceInSections(
  data: TodayResponse,
  updated: ChoreDto,
): TodayResponse {
  // 家事の状態が変わったら「今日」画面全体を再取得するのが最も正確だが、
  // 楽観的にその場で除去して体感速度を優先する(再取得は呼び出し側で行う)。
  const strip = (items: ChoreDto[]) => items.filter((c) => c.id !== updated.id);
  return {
    ...data,
    sections: {
      overdue: strip(data.sections.overdue),
      recommended: strip(data.sections.recommended),
      upcoming: strip(data.sections.upcoming),
      neverDone: strip(data.sections.neverDone),
      doneToday: [...strip(data.sections.doneToday), updated].filter(
        (c) => c.status === "not_due" && c.elapsedDays === 0,
      ),
    },
  };
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
        listAreas(false),
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

  const { complete, pendingId } = useCompleteChore((updated) => {
    setData((current) =>
      current ? replaceInSections(current, updated) : current,
    );
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
    { key: "overdue", title: "優先", items: data.sections.overdue },
    {
      key: "recommended",
      title: "今日やった方がよい",
      items: data.sections.recommended,
    },
    { key: "upcoming", title: "そろそろ", items: data.sections.upcoming },
    { key: "neverDone", title: "初回未実施", items: data.sections.neverDone },
    { key: "doneToday", title: "本日実施済み", items: data.sections.doneToday },
  ];

  const hasAny = sections.some((s) => s.items.length > 0);

  return (
    <>
      <PageHeader title="今日" />
      {!hasAny && (
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
                    completing={pendingId === chore.id}
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
