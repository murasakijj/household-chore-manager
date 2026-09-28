import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
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
import { describeApiError } from "../lib/errorMessages";
import { generateUuidV4 } from "../lib/uuid";
import {
  datetimeLocalToOffsetIso,
  toDatetimeLocalValue,
} from "../lib/datetime";
import PageHeader from "../components/PageHeader";
import Skeleton from "../components/Skeleton";

interface RecordLocationState {
  from?: string;
}

export default function ChoreRecord() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { member, household } = useAuth();
  const { settings } = useSettings();
  const { showToast } = useToast();

  // レビュー指摘 #3: タイムゾーンが確定するまで(設定取得前の `Asia/Tokyo` 仮置きで)
  // フォームを描画しない。`household` はログイン時のauth-checkで確定済みの値。
  const timezone = settings?.household.timezone ?? household?.timezone ?? null;

  const [chore, setChore] = useState<ChoreDetailDto | null>(null);
  const [members, setMembers] = useState<MemberDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [occurredAtLocal, setOccurredAtLocal] = useState("");
  const [occurredAtInitialized, setOccurredAtInitialized] = useState(false);
  const [actorMemberId, setActorMemberId] = useState("");
  const [note, setNote] = useState("");

  // レビュー指摘 #6: 冪等キーはマウント時に1回だけ生成し、保存が成功するまで
  // 使い回す(再試行しても同じ `clientRequestId` になり、二重登録を防げる)。
  const clientRequestIdRef = useRef<string>(generateUuidV4());

  useEffect(() => {
    if (!timezone || occurredAtInitialized) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOccurredAtLocal(toDatetimeLocalValue(new Date(), timezone));
    setOccurredAtInitialized(true);
  }, [timezone, occurredAtInitialized]);

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
    if (!id || !timezone) return;
    const iso = datetimeLocalToOffsetIso(occurredAtLocal, timezone);
    if (new Date(iso).getTime() > Date.now()) {
      setFormError("未来の日時は記録できません。");
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      const result = await addChoreEvent(id, {
        clientRequestId: clientRequestIdRef.current,
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
      // レビュー指摘 #18: 遷移元(location.state.from)があればそこへ、無ければ詳細へ。
      const state = location.state as RecordLocationState | null;
      navigate(state?.from ?? `/chores/${id}`, { replace: true });
    } catch (err) {
      setFormError(describeApiError(err, "記録に失敗しました。"));
    } finally {
      setSaving(false);
    }
  };

  if (loading || !timezone || !occurredAtInitialized) {
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
