import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  listAreas,
  listCategories,
  listChores,
  type AreaDto,
  type CategoryDto,
  type ChoreDto,
  type ChoreStatus,
} from "../lib/api";
import { useSettings } from "../contexts/useSettings";
import { useCompleteChore } from "../hooks/useCompleteChore";
import ChoreCard from "../components/ChoreCard";
import Skeleton from "../components/Skeleton";
import PageHeader from "../components/PageHeader";
import { STATUS_META } from "../lib/statusMeta";

const STATUS_OPTIONS: ChoreStatus[] = [
  "overdue",
  "recommended",
  "upcoming",
  "not_due",
  "never_done",
  "inactive",
];

export default function ChoreList() {
  const { timezone } = useSettings();
  const [chores, setChores] = useState<ChoreDto[] | null>(null);
  const [areas, setAreas] = useState<AreaDto[]>([]);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<ChoreStatus | "">("");
  const [areaId, setAreaId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [sort, setSort] = useState<"status" | "elapsed" | "name">("status");

  // レビュー指摘 #5: 場所・カテゴリ(絞り込み用マスタ)は初回1回だけ取得する。
  useEffect(() => {
    void (async () => {
      try {
        const [areaList, categoryList] = await Promise.all([
          listAreas(true),
          listCategories(true),
        ]);
        setAreas(areaList.items);
        setCategories(categoryList.items);
      } catch {
        // フィルタ用マスタの取得失敗は致命的ではないため、一覧自体の読み込みは続行する。
      }
    })();
  }, []);

  // レビュー指摘 #5: フィルタ変更ごとに連番を進め、古い応答が新しい結果を
  // 上書きしないようにする。
  const requestSeqRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestSeqRef.current;
    setError(null);
    try {
      const choreList = await listChores({
        q: q.trim() || undefined,
        status: status || undefined,
        areaId: areaId || undefined,
        categoryId: categoryId || undefined,
        includeInactive,
        sort,
      });
      if (requestSeqRef.current !== requestId) return; // 古い応答は破棄する
      setChores(choreList.items);
    } catch {
      if (requestSeqRef.current !== requestId) return;
      setError("読み込みに失敗しました。");
    }
  }, [q, status, areaId, categoryId, includeInactive, sort]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  const { complete, isPending } = useCompleteChore((updated) => {
    setChores((current) =>
      current
        ? current.map((c) => (c.id === updated.id ? updated : c))
        : current,
    );
  });

  const areaName = (id: string | null) =>
    id ? (areas.find((a) => a.id === id)?.name ?? null) : null;

  // レビュー指摘 #19: 状態「無効」を選んだら、無効な家事も対象に含むよう自動でONにする。
  const handleStatusChange = (value: ChoreStatus | "") => {
    setStatus(value);
    if (value === "inactive") setIncludeInactive(true);
  };

  return (
    <>
      <PageHeader
        title="家事一覧"
        actions={
          <Link to="/chores/new" className="btn btn-primary">
            新規登録
          </Link>
        }
      />
      <form
        className="filter-bar"
        role="search"
        onSubmit={(e) => e.preventDefault()}
      >
        <label className="filter-field">
          <span className="visually-hidden">家事名で検索</span>
          <input
            type="search"
            placeholder="家事名で検索"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <label className="filter-field">
          状態
          <select
            value={status}
            onChange={(e) =>
              handleStatusChange(e.target.value as ChoreStatus | "")
            }
          >
            <option value="">すべて</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
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
          カテゴリ
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">すべて</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          並び替え
          <select
            value={sort}
            onChange={(e) =>
              setSort(e.target.value as "status" | "elapsed" | "name")
            }
          >
            <option value="status">状態順</option>
            <option value="elapsed">経過日数順</option>
            <option value="name">名称順</option>
          </select>
        </label>
        <label className="filter-checkbox">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          無効な家事も表示
        </label>
      </form>

      {error && <p role="alert">{error}</p>}
      {!chores && !error && <Skeleton rows={5} />}
      {chores && chores.length === 0 && (
        <p className="empty-state">条件に一致する家事がありません。</p>
      )}
      {chores && chores.length > 0 && (
        <ul className="chore-card-list">
          {chores.map((chore) => (
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
      )}
    </>
  );
}
