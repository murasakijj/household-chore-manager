import { useCallback, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { addChoreEvent, voidChoreEvent, type ChoreDto } from "../lib/api";
import { useSettings } from "../contexts/useSettings";
import { useToast } from "../contexts/useToast";
import { generateUuidV4 } from "../lib/uuid";

/**
 * 「やった」ボタンの共通挙動(設計書 UC-02, architecture.md)。
 * `oneTapComplete` ON なら即記録してUndo付きトーストを出し、OFF なら実施記録画面へ遷移する。
 *
 * 多重実行防止は家事IDごと(レビュー指摘 #15): 別の家事の送信中でも、他の家事の
 * 「やった」は押せる。
 */
export function useCompleteChore(onUpdated?: (chore: ChoreDto) => void) {
  const { settings } = useSettings();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const complete = useCallback(
    async (chore: ChoreDto) => {
      if (!settings || !settings.notification.oneTapComplete) {
        navigate(`/chores/${chore.id}/record`, {
          state: { from: location.pathname },
        });
        return;
      }
      if (pendingIds.has(chore.id)) return;
      setPendingIds((current) => new Set(current).add(chore.id));
      const clientRequestId = generateUuidV4();
      try {
        const result = await addChoreEvent(chore.id, { clientRequestId });
        onUpdated?.(result.chore);
        const eventId = result.event.id;
        showToast({
          message: result.possibleDuplicate
            ? `「${chore.name}」を記録しました。直近10分以内にも記録があります(重複の可能性)。`
            : `「${chore.name}」を記録しました。`,
          tone: result.possibleDuplicate ? "warning" : "info",
          action: {
            label: "取り消す",
            onClick: () => {
              void voidChoreEvent(eventId)
                .then((voidResult) => {
                  onUpdated?.(voidResult.chore);
                  showToast({ message: "記録を取り消しました。" });
                })
                .catch(() => {
                  showToast({
                    message: "取り消しに失敗しました。",
                    tone: "error",
                  });
                });
            },
          },
        });
      } catch {
        showToast({ message: "記録に失敗しました。", tone: "error" });
      } finally {
        setPendingIds((current) => {
          const next = new Set(current);
          next.delete(chore.id);
          return next;
        });
      }
    },
    [settings, pendingIds, navigate, location.pathname, onUpdated, showToast],
  );

  return {
    complete,
    pendingIds,
    isPending: (choreId: string) => pendingIds.has(choreId),
  };
}
