import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { addChoreEvent, voidChoreEvent, type ChoreDto } from "../lib/api";
import { useSettings } from "../contexts/useSettings";
import { useToast } from "../contexts/useToast";

/**
 * 「やった」ボタンの共通挙動(設計書 UC-02, architecture.md)。
 * `oneTapComplete` ON なら即記録してUndo付きトーストを出し、OFF なら実施記録画面へ遷移する。
 */
export function useCompleteChore(onUpdated?: (chore: ChoreDto) => void) {
  const { settings } = useSettings();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const complete = useCallback(
    async (chore: ChoreDto) => {
      if (!settings || !settings.notification.oneTapComplete) {
        navigate(`/chores/${chore.id}/record`);
        return;
      }
      if (pendingId) return;
      setPendingId(chore.id);
      const clientRequestId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
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
        setPendingId(null);
      }
    },
    [settings, pendingId, navigate, onUpdated, showToast],
  );

  return { complete, pendingId };
}
