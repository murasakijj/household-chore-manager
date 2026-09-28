import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  createChore,
  getChore,
  listAreas,
  listCategories,
  listResources,
  patchChore,
  type AreaDto,
  type CategoryDto,
  type ResourceDto,
} from "../lib/api";
import { useAuth } from "../contexts/useAuth";
import { useSettings } from "../contexts/useSettings";
import { useToast } from "../contexts/useToast";
import { defaultWarningGrace } from "../lib/choreDefaults";
import { describeApiError } from "../lib/errorMessages";
import {
  datetimeLocalToOffsetIso,
  toDatetimeLocalValue,
} from "../lib/datetime";
import PageHeader from "../components/PageHeader";
import Skeleton from "../components/Skeleton";

interface SelectableOption {
  id: string;
  name: string;
  isActive: boolean;
}

/**
 * 選択肢を組み立てる: 有効なものは常に表示し、無効なものは「現在選択中」の場合のみ
 * 「(無効)」付きで表示する(新規の選択肢としては出さない、設計書レビュー指摘 #11)。
 */
function selectableOptions<T extends SelectableOption>(
  items: T[],
  currentValue: string,
): T[] {
  return items.filter((item) => item.isActive || item.id === currentValue);
}

export default function ChoreForm() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { household } = useAuth();
  const { showToast } = useToast();

  // レビュー指摘 #3: 設定取得前に `Asia/Tokyo` を仮置きして描画しない。
  // `household`(ログイン時のauth-checkで確定済み)をフォールバックにし、
  // タイムゾーンが確定するまではフォームを描画しない。
  const timezone = settings?.household.timezone ?? household?.timezone ?? null;

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [areas, setAreas] = useState<AreaDto[]>([]);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [resources, setResources] = useState<ResourceDto[]>([]);

  const [name, setName] = useState("");
  const [intervalDays, setIntervalDays] = useState(7);
  const [warningDays, setWarningDays] = useState(2);
  const [graceDays, setGraceDays] = useState(2);
  const [warningTouched, setWarningTouched] = useState(false);
  const [graceTouched, setGraceTouched] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [areaId, setAreaId] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [description, setDescription] = useState("");
  const [lastCompletedAtLocal, setLastCompletedAtLocal] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const [areaList, categoryList, resourceList] = await Promise.all([
          listAreas(true),
          listCategories(true),
          listResources(true),
        ]);
        setAreas(areaList.items);
        setCategories(categoryList.items);
        setResources(resourceList.items);
        if (isEdit && id) {
          const chore = await getChore(id);
          setName(chore.name);
          setIntervalDays(chore.intervalDays);
          setWarningDays(chore.warningDays);
          setGraceDays(chore.graceDays);
          setWarningTouched(true);
          setGraceTouched(true);
          setCategoryId(chore.categoryId ?? "");
          setAreaId(chore.areaId ?? "");
          setResourceId(chore.resourceId ?? "");
          setDescription(chore.description ?? "");
        }
      } catch {
        setLoadError("読み込みに失敗しました。");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isEdit]);

  // 予告/猶予日数は、利用者が手で変更するまでは推奨間隔の変更に追従して
  // 自動入力する(設計書 §7.6)。編集画面では初回ロード時に touched を true にして
  // 既存値の自動上書きを防ぐ。
  const handleIntervalChange = (value: number) => {
    setIntervalDays(value);
    if (!Number.isFinite(value) || value < 1) return;
    const defaults = defaultWarningGrace(value);
    if (!warningTouched) setWarningDays(defaults.warningDays);
    if (!graceTouched) setGraceDays(defaults.graceDays);
  };

  const validate = (tz: string): string | null => {
    if (!name.trim()) return "家事名を入力してください。";
    if (!Number.isInteger(intervalDays) || intervalDays < 1) {
      return "推奨間隔は1以上の整数で入力してください。";
    }
    if (
      !Number.isInteger(warningDays) ||
      warningDays < 0 ||
      warningDays >= intervalDays
    ) {
      return "予告日数は0以上、推奨間隔未満の整数で入力してください。";
    }
    if (!Number.isInteger(graceDays) || graceDays < 0) {
      return "猶予日数は0以上の整数で入力してください。";
    }
    if (lastCompletedAtLocal) {
      const iso = datetimeLocalToOffsetIso(lastCompletedAtLocal, tz);
      if (new Date(iso).getTime() > Date.now()) {
        return "未来の日時は記録できません。";
      }
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!timezone) return;
    const validationError = validate(timezone);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      if (isEdit && id) {
        await patchChore(id, {
          name: name.trim(),
          intervalDays,
          warningDays,
          graceDays,
          categoryId: categoryId || null,
          areaId: areaId || null,
          resourceId: resourceId || null,
          description: description.trim() || null,
        });
        showToast({ message: "更新しました。" });
        navigate(`/chores/${id}`);
      } else {
        const result = await createChore({
          name: name.trim(),
          intervalDays,
          warningDays,
          graceDays,
          categoryId: categoryId || null,
          areaId: areaId || null,
          resourceId: resourceId || null,
          description: description.trim() || null,
          lastCompletedAt: lastCompletedAtLocal
            ? datetimeLocalToOffsetIso(lastCompletedAtLocal, timezone)
            : null,
        });
        if (result.warnings.includes("duplicate_name")) {
          showToast({
            message: "同じ名前の家事が既にあります。登録は完了しました。",
            tone: "warning",
          });
        } else {
          showToast({ message: "登録しました。" });
        }
        navigate(`/chores/${result.chore.id}`);
      }
    } catch (err) {
      setFormError(describeApiError(err, "保存に失敗しました。"));
    } finally {
      setSaving(false);
    }
  };

  if (loading || !timezone) {
    return (
      <>
        <PageHeader title={isEdit ? "家事を編集" : "家事を登録"} back />
        <Skeleton rows={4} />
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <PageHeader title={isEdit ? "家事を編集" : "家事を登録"} back />
        <p role="alert">{loadError}</p>
      </>
    );
  }

  const areaOptions = selectableOptions(areas, areaId);
  const categoryOptions = selectableOptions(categories, categoryId);
  const resourceOptions = selectableOptions(resources, resourceId);

  return (
    <>
      <PageHeader title={isEdit ? "家事を編集" : "家事を登録"} back />
      <form className="form" onSubmit={(e) => void handleSubmit(e)}>
        {formError && <p role="alert">{formError}</p>}
        <label className="form-field">
          家事名<span aria-hidden="true">*</span>
          <input
            type="text"
            value={name}
            required
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="form-field">
          推奨間隔(日)<span aria-hidden="true">*</span>
          <input
            type="number"
            min={1}
            step={1}
            value={intervalDays}
            required
            onChange={(e) => handleIntervalChange(Number(e.target.value))}
          />
        </label>
        <label className="form-field">
          予告日数
          <input
            type="number"
            min={0}
            step={1}
            value={warningDays}
            onChange={(e) => {
              setWarningTouched(true);
              setWarningDays(Number(e.target.value));
            }}
          />
        </label>
        <label className="form-field">
          猶予日数
          <input
            type="number"
            min={0}
            step={1}
            value={graceDays}
            onChange={(e) => {
              setGraceTouched(true);
              setGraceDays(Number(e.target.value));
            }}
          />
        </label>
        <label className="form-field">
          場所
          <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
            <option value="">未設定</option>
            {areaOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {!a.isActive ? "(無効)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          カテゴリ
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">未設定</option>
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {!c.isActive ? "(無効)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          対象リソース
          <select
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
          >
            <option value="">未設定</option>
            {resourceOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {!r.isActive ? "(無効)" : ""}
              </option>
            ))}
          </select>
        </label>
        {!isEdit && (
          <label className="form-field">
            最終実施日時(任意)
            <input
              type="datetime-local"
              value={lastCompletedAtLocal}
              max={toDatetimeLocalValue(new Date(), timezone)}
              onChange={(e) => setLastCompletedAtLocal(e.target.value)}
            />
          </label>
        )}
        <label className="form-field">
          説明・メモ
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </form>
    </>
  );
}
