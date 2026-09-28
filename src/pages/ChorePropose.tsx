import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  aiChoreListProposal,
  bulkCreateChores,
  getInitialChoreTemplates,
  listAreas,
  listChores,
  type AreaDto,
  type ChoreCreateInput,
} from "../lib/api";
import { useToast } from "../contexts/useToast";
import { describeApiError } from "../lib/errorMessages";
import { defaultWarningGrace } from "../lib/choreDefaults";
import PageHeader from "../components/PageHeader";
import Skeleton from "../components/Skeleton";

/** チェックボックス一覧の1行分の候補(推奨初期データ・AI提案共通)。 */
interface ProposalRow {
  key: string;
  checked: boolean;
  name: string;
  intervalDays: number;
  areaId: string | null;
  areaLabel: string | null;
  categoryId: string | null;
  description: string | null;
  alreadyExists: boolean;
}

type Tab = "templates" | "ai";

export default function ChorePropose() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [tab, setTab] = useState<Tab>("templates");
  const [areas, setAreas] = useState<AreaDto[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [templateRows, setTemplateRows] = useState<ProposalRow[] | null>(null);
  const [aiRows, setAiRows] = useState<ProposalRow[] | null>(null);
  const [aiContext, setAiContext] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [areaList, choreList, templates] = await Promise.all([
          listAreas(false),
          listChores({ includeInactive: true }),
          getInitialChoreTemplates(),
        ]);
        setAreas(areaList.items);
        const names = new Set(choreList.items.map((c) => c.name));

        const rows: ProposalRow[] = templates.items.map((t, i) => {
          const area = areaList.items.find((a) => a.name === t.areaName);
          const alreadyExists = names.has(t.name);
          return {
            key: `template-${i}`,
            checked: !alreadyExists,
            name: t.name,
            intervalDays: t.intervalDays,
            areaId: area?.id ?? null,
            areaLabel: t.areaName,
            categoryId: null,
            description: null,
            alreadyExists,
          };
        });
        setTemplateRows(rows);
      } catch {
        setLoadError("読み込みに失敗しました。");
      }
    })();
  }, []);

  const areaLabel = (id: string | null): string | null =>
    id ? (areas.find((a) => a.id === id)?.name ?? null) : null;

  const handleAiPropose = async () => {
    if (!aiContext.trim()) return;
    setAiError(null);
    setAiLoading(true);
    try {
      const result = await aiChoreListProposal(aiContext.trim());
      const rows: ProposalRow[] = result.items.map((item, i) => ({
        key: `ai-${i}`,
        checked: !item.alreadyExists,
        name: item.name,
        intervalDays: item.intervalDays,
        areaId: item.areaId,
        areaLabel: areaLabel(item.areaId),
        categoryId: item.categoryId,
        description: item.description,
        alreadyExists: item.alreadyExists,
      }));
      setAiRows(rows);
      if (rows.length === 0) {
        showToast({ message: "AIから候補が得られませんでした。", tone: "warning" });
      }
    } catch (err) {
      setAiError(describeApiError(err, "AIの提案取得に失敗しました。"));
    } finally {
      setAiLoading(false);
    }
  };

  const rows = tab === "templates" ? templateRows : aiRows;
  const setRows = tab === "templates" ? setTemplateRows : setAiRows;

  const updateRow = (key: string, patch: Partial<ProposalRow>) => {
    setRows((current) =>
      current
        ? current.map((r) => (r.key === key ? { ...r, ...patch } : r))
        : current,
    );
  };

  const handleIntervalChange = (key: string, value: number) => {
    if (!Number.isFinite(value) || value < 1) {
      updateRow(key, { intervalDays: value });
      return;
    }
    updateRow(key, { intervalDays: value });
  };

  const checkedCount = useMemo(
    () => rows?.filter((r) => r.checked).length ?? 0,
    [rows],
  );

  const handleSubmit = async () => {
    if (!rows) return;
    const selected = rows.filter((r) => r.checked && r.name.trim());
    if (selected.length === 0) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const items: ChoreCreateInput[] = selected.map((r) => {
        const intervalDays = Math.max(1, Math.round(r.intervalDays) || 1);
        const defaults = defaultWarningGrace(intervalDays);
        return {
          name: r.name.trim(),
          intervalDays,
          warningDays: defaults.warningDays,
          graceDays: defaults.graceDays,
          areaId: r.areaId,
          categoryId: r.categoryId,
          description: r.description,
        };
      });
      const result = await bulkCreateChores(items);
      showToast({ message: `${result.created.length}件登録しました。` });
      navigate("/chores");
    } catch (err) {
      setSubmitError(describeApiError(err, "登録に失敗しました。"));
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <>
        <PageHeader title="家事をまとめて登録" back />
        <p role="alert">{loadError}</p>
      </>
    );
  }

  return (
    <>
      <PageHeader title="家事をまとめて登録" back />
      <div className="tab-bar" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "templates"}
          className={`tab-btn${tab === "templates" ? " tab-btn-active" : ""}`}
          onClick={() => setTab("templates")}
        >
          推奨初期データ
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "ai"}
          className={`tab-btn${tab === "ai" ? " tab-btn-active" : ""}`}
          onClick={() => setTab("ai")}
        >
          AIに提案してもらう
        </button>
      </div>

      {tab === "ai" && (
        <div className="form" style={{ marginBottom: "1rem" }}>
          {aiError && <p role="alert">{aiError}</p>}
          <label className="form-field">
            家庭の状況(例: 犬がいる、乳児がいる、来客が多い、など)
            <textarea
              value={aiContext}
              maxLength={1000}
              onChange={(e) => setAiContext(e.target.value)}
            />
          </label>
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!aiContext.trim() || aiLoading}
              onClick={() => void handleAiPropose()}
            >
              {aiLoading ? "提案を取得中..." : "AIに提案してもらう"}
            </button>
          </div>
        </div>
      )}

      {tab === "templates" && !templateRows && <Skeleton rows={4} />}

      {rows && rows.length > 0 && (
        <>
          <ul className="propose-list">
            {rows.map((row) => (
              <li key={row.key} className="propose-row">
                <label className="propose-row-checkbox">
                  <input
                    type="checkbox"
                    checked={row.checked}
                    onChange={(e) =>
                      updateRow(row.key, { checked: e.target.checked })
                    }
                  />
                </label>
                <div className="propose-row-fields">
                  <input
                    type="text"
                    className="propose-row-name"
                    value={row.name}
                    onChange={(e) => updateRow(row.key, { name: e.target.value })}
                  />
                  <label className="propose-row-interval">
                    間隔
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={row.intervalDays}
                      onChange={(e) =>
                        handleIntervalChange(row.key, Number(e.target.value))
                      }
                    />
                    日
                  </label>
                  {row.areaLabel && (
                    <span className="propose-row-area">{row.areaLabel}</span>
                  )}
                  {row.alreadyExists && (
                    <span className="propose-row-badge">既に登録済み</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {submitError && <p role="alert">{submitError}</p>}
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={checkedCount === 0 || submitting}
              onClick={() => void handleSubmit()}
            >
              {submitting
                ? "登録中..."
                : `選んだ家事を登録(${checkedCount}件)`}
            </button>
          </div>
        </>
      )}

      {tab === "ai" && aiRows && aiRows.length === 0 && (
        <p className="empty-state">まだ候補がありません。</p>
      )}
    </>
  );
}
