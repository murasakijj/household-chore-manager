import { useEffect, useRef, useState } from "react";
import {
  createResource,
  listAreas,
  listResources,
  patchResource,
  type AreaDto,
  type ResourceDto,
  type ResourceType,
} from "../../lib/api";
import { useToast } from "../../contexts/useToast";
import PageHeader from "../../components/PageHeader";
import Skeleton from "../../components/Skeleton";

const RESOURCE_TYPES: { value: ResourceType; label: string }[] = [
  { value: "appliance", label: "家電" },
  { value: "fixture", label: "設備" },
  { value: "baby_item", label: "赤ちゃん用品" },
  { value: "pet_item", label: "ペット用品" },
  { value: "storage", label: "収納" },
  { value: "other", label: "その他" },
];

export default function ResourcesSettings() {
  const { showToast } = useToast();
  const [items, setItems] = useState<ResourceDto[] | null>(null);
  const [areas, setAreas] = useState<AreaDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newAreaId, setNewAreaId] = useState("");
  const [newType, setNewType] = useState<ResourceType>("other");
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  // レビュー指摘 #16: Enterキー確定後のblurによる二重送信を防ぐ同期フラグ。
  const renameInFlightRef = useRef(false);

  const load = async () => {
    setError(null);
    try {
      const [resourceList, areaList] = await Promise.all([
        listResources(true),
        listAreas(true),
      ]);
      setItems(resourceList.items);
      setAreas(areaList.items);
    } catch {
      setError("読み込みに失敗しました。");
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await createResource({
        name: newName.trim(),
        areaId: newAreaId || null,
        resourceType: newType,
      });
      setNewName("");
      await load();
    } catch {
      showToast({ message: "追加に失敗しました。", tone: "error" });
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async (id: string, originalName: string) => {
    if (renameInFlightRef.current) return; // 送信中は再入禁止
    const trimmed = editingName.trim();
    if (!trimmed) {
      setEditingId(null);
      return;
    }
    if (trimmed === originalName) {
      setEditingId(null);
      return;
    }
    renameInFlightRef.current = true;
    setBusyId(id);
    try {
      await patchResource(id, { name: trimmed });
      setEditingId(null);
      await load();
    } catch {
      showToast({ message: "名前の変更に失敗しました。", tone: "error" });
    } finally {
      renameInFlightRef.current = false;
      setBusyId(null);
    }
  };

  const handleAreaChange = async (id: string, areaId: string) => {
    setBusyId(id);
    try {
      await patchResource(id, { areaId: areaId || null });
      await load();
    } catch {
      showToast({ message: "更新に失敗しました。", tone: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleActive = async (item: ResourceDto) => {
    setBusyId(item.id);
    try {
      await patchResource(item.id, { isActive: !item.isActive });
      await load();
    } catch {
      showToast({ message: "更新に失敗しました。", tone: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const areaName = (id: string | null) =>
    id ? (areas.find((a) => a.id === id)?.name ?? "") : "";

  // レビュー指摘 #11: 無効な場所は新規選択肢として出さない(既存参照は表示する)。
  const activeAreas = areas.filter((a) => a.isActive);
  const areaOptionsFor = (currentAreaId: string | null) =>
    areas.filter((a) => a.isActive || a.id === currentAreaId);

  return (
    <>
      <PageHeader title="対象リソースの管理" back />
      <form className="form-inline" onSubmit={(e) => void handleCreate(e)}>
        <input
          type="text"
          value={newName}
          placeholder="新しい名前"
          aria-label="新しいリソース名"
          onChange={(e) => setNewName(e.target.value)}
        />
        <select
          value={newAreaId}
          aria-label="場所"
          onChange={(e) => setNewAreaId(e.target.value)}
        >
          <option value="">場所未設定</option>
          {activeAreas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          value={newType}
          aria-label="種別"
          onChange={(e) => setNewType(e.target.value as ResourceType)}
        >
          {RESOURCE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary" disabled={creating}>
          追加
        </button>
      </form>

      {error && <p role="alert">{error}</p>}
      {!items && !error && <Skeleton rows={4} />}
      {items && items.length === 0 && (
        <p className="empty-state">まだ登録がありません。</p>
      )}
      {items && items.length > 0 && (
        <ul className="master-list">
          {items.map((item) => (
            <li key={item.id} className="master-list-item">
              {editingId === item.id ? (
                <input
                  type="text"
                  value={editingName}
                  autoFocus
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => void handleRename(item.id, item.name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleRename(item.id, item.name);
                    }
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="master-list-name"
                  onClick={() => {
                    setEditingId(item.id);
                    setEditingName(item.name);
                  }}
                  aria-label={`「${item.name}」の名前を変更`}
                >
                  {item.name}
                  {!item.isActive && (
                    <span className="master-list-inactive">(無効)</span>
                  )}
                </button>
              )}
              <div className="master-list-actions">
                <select
                  value={item.areaId ?? ""}
                  aria-label={`「${item.name}」の場所`}
                  disabled={busyId === item.id}
                  onChange={(e) =>
                    void handleAreaChange(item.id, e.target.value)
                  }
                >
                  <option value="">場所未設定</option>
                  {areaOptionsFor(item.areaId).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {!a.isActive ? "(無効)" : ""}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busyId === item.id}
                  onClick={() => void handleToggleActive(item)}
                >
                  {item.isActive ? "無効化" : "有効化"}
                </button>
              </div>
              {areaName(item.areaId) && (
                <span className="master-list-note">
                  {areaName(item.areaId)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
