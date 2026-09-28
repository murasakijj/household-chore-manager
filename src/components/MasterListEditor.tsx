import { useEffect, useState } from "react";
import { useToast } from "../contexts/useToast";
import PageHeader from "./PageHeader";
import Skeleton from "./Skeleton";

export interface MasterItem {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface MasterListEditorProps<T extends MasterItem> {
  title: string;
  list: (includeInactive: boolean) => Promise<{ items: T[] }>;
  create: (name: string) => Promise<T>;
  patch: (
    id: string,
    patch: Partial<{ name: string; sortOrder: number; isActive: boolean }>,
  ) => Promise<T>;
}

/** 場所・カテゴリ共通の管理画面(追加・名前変更・並び順・無効化)。 */
export default function MasterListEditor<T extends MasterItem>({
  title,
  list,
  create,
  patch,
}: MasterListEditorProps<T>) {
  const { showToast } = useToast();
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const load = async () => {
    setError(null);
    try {
      const result = await list(true);
      setItems([...result.items].sort((a, b) => a.sortOrder - b.sortOrder));
    } catch {
      setError("読み込みに失敗しました。");
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await create(newName.trim());
      setNewName("");
      await load();
    } catch {
      showToast({ message: "追加に失敗しました。", tone: "error" });
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async (id: string) => {
    if (!editingName.trim()) return;
    setBusyId(id);
    try {
      await patch(id, { name: editingName.trim() });
      setEditingId(null);
      await load();
    } catch {
      showToast({ message: "名前の変更に失敗しました。", tone: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleActive = async (item: T) => {
    setBusyId(item.id);
    try {
      await patch(item.id, { isActive: !item.isActive });
      await load();
    } catch {
      showToast({ message: "更新に失敗しました。", tone: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const handleMove = async (item: T, direction: -1 | 1) => {
    if (!items) return;
    const index = items.findIndex((i) => i.id === item.id);
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= items.length) return;
    const target = items[targetIndex];
    setBusyId(item.id);
    try {
      await Promise.all([
        patch(item.id, { sortOrder: target.sortOrder }),
        patch(target.id, { sortOrder: item.sortOrder }),
      ]);
      await load();
    } catch {
      showToast({ message: "並び替えに失敗しました。", tone: "error" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader title={title} back />
      <form className="form-inline" onSubmit={(e) => void handleCreate(e)}>
        <label className="visually-hidden" htmlFor="master-new-name">
          新規追加
        </label>
        <input
          id="master-new-name"
          type="text"
          value={newName}
          placeholder="新しい名前"
          onChange={(e) => setNewName(e.target.value)}
        />
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
          {items.map((item, index) => (
            <li key={item.id} className="master-list-item">
              {editingId === item.id ? (
                <input
                  type="text"
                  value={editingName}
                  autoFocus
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => void handleRename(item.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleRename(item.id);
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
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="上に移動"
                  disabled={index === 0 || busyId === item.id}
                  onClick={() => void handleMove(item, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="下に移動"
                  disabled={index === items.length - 1 || busyId === item.id}
                  onClick={() => void handleMove(item, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busyId === item.id}
                  onClick={() => void handleToggleActive(item)}
                >
                  {item.isActive ? "無効化" : "有効化"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
