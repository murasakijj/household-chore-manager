import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  addChoreEvent,
  getChore,
  listMembers,
  type ChoreDetailDto,
  type MemberDto,
} from "../lib/api";
import { useAuth } from "../contexts/useAuth";
import { useSettings } from "../contexts/useSettings";
import { useToast } from "../contexts/useToast";
import {
  datetimeLocalToOffsetIso,
  toDatetimeLocalValue,
} from "../lib/datetime";
import PageHeader from "../components/PageHeader";
import Skeleton from "../components/Skeleton";

export default function ChoreRecord() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { member } = useAuth();
  const { timezone } = useSettings();
  const { showToast } = useToast();

  const [chore, setChore] = useState<ChoreDetailDto | null>(null);
  const [members, setMembers] = useState<MemberDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [occurredAtLocal, setOccurredAtLocal] = useState(() =>
    toDatetimeLocalValue(new Date(), timezone),
  );
  const [actorMemberId, setActorMemberId] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    void (async () => {
      if (!id) return;
      try {
        const [detail, memberList] = await Promise.all([
          getChore(id),
          listMembers(),
        ]);
        setChore(detail);
        setMembers(memberList.items);
        setActorMemberId(member?.id ?? memberList.items[0]?.id ?? "");
      } catch {
        setLoadError("読み込みに失敗しました。");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, member]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    const iso = datetimeLocalToOffsetIso(occurredAtLocal, timezone);
    if (new Date(iso).getTime() > Date.now()) {
      setFormError("未来の日時は記録できません。");
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      const clientRequestId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
      const result = await addChoreEvent(id, {
        clientRequestId,
        occurredAt: iso,
        actorMemberId: actorMemberId || undefined,
        note: note.trim() || null,
      });
      if (result.possibleDuplicate) {
        showToast({
          message: "直近10分以内にも記録があります(重複の可能性)。",
          tone: "warning",
        });
      } else {
        showToast({ message: "記録しました。" });
      }
      navigate(`/chores/${id}`);
    } catch {
      setFormError("記録に失敗しました。");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <>
        <PageHeader title="実施記録" back />
        <Skeleton rows={3} />
      </>
    );
  }

  if (loadError || !chore) {
    return (
      <>
        <PageHeader title="実施記録" back />
        <p role="alert">{loadError ?? "家事が見つかりません。"}</p>
      </>
    );
  }

  return (
    <>
      <PageHeader title={`実施記録: ${chore.name}`} back />
      <form className="form" onSubmit={(e) => void handleSubmit(e)}>
        {formError && <p role="alert">{formError}</p>}
        <label className="form-field">
          実施日時
          <input
            type="datetime-local"
            value={occurredAtLocal}
            max={toDatetimeLocalValue(new Date(), timezone)}
            required
            onChange={(e) => setOccurredAtLocal(e.target.value)}
          />
        </label>
        <label className="form-field">
          実施者
          <select
            value={actorMemberId}
            onChange={(e) => setActorMemberId(e.target.value)}
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          メモ(任意)
          <textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "保存中..." : "記録する"}
          </button>
        </div>
      </form>
    </>
  );
}
