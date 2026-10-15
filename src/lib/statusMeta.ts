/**
 * 家事の状態(内部値)の表示名・色・アイコンをまとめて定義する1箇所
 * (設計書 §7.1, §14.4「状態名・色・文言を1箇所で定義する」)。
 * 状態の判定式そのものはここには置かない。サーバー(`api/_lib/domain/status.ts`)が
 * 返した `status` をそのまま使う。
 */
import type { ChoreStatus } from "./api";

export interface StatusMeta {
  /** 区分名(セクション見出し・フィルタ選択肢用)。カード等の状態表示は `statusBadgeLabel` を使う。 */
  label: string;
  /** 文字だけでも状態が伝わるよう、色に依存しないアイコン(絵文字)を添える(設計書 §14.5)。 */
  icon: string;
  /** CSSのステータス系クラス名の接尾辞(`status-badge--${key}` 等)。 */
  key: string;
}

export const STATUS_META: Record<ChoreStatus, StatusMeta> = {
  overdue: { label: "優先", icon: "🔴", key: "overdue" },
  recommended: { label: "超過", icon: "🟠", key: "recommended" },
  due_today: { label: "今日やる日", icon: "📌", key: "due_today" },
  upcoming: { label: "そろそろ", icon: "🟡", key: "upcoming" },
  not_due: { label: "まだ不要", icon: "🟢", key: "not_due" },
  never_done: { label: "初回未実施", icon: "🆕", key: "never_done" },
  inactive: { label: "無効", icon: "⏸️", key: "inactive" },
};

export function statusMeta(status: ChoreStatus | null | undefined): StatusMeta {
  if (!status) return { label: "不明", icon: "❔", key: "unknown" };
  return STATUS_META[status];
}

/**
 * カード・一覧・詳細の状態バッジ文言(設計書 §7.1)。
 * `overdueDays`(= 経過日数 − 推奨間隔)はサーバーが返した値をそのまま使う。
 * 画面側で文言を組み立てず、必ずこの関数を通す。判定式はここに置かない。
 * - recommended: 「○日超過」
 * - overdue: 「優先・○日超過」
 * - その他: 区分名と同じ
 */
export function statusBadgeLabel(
  status: ChoreStatus | null | undefined,
  overdueDays: number | null | undefined,
): string {
  const base = statusMeta(status).label;
  if (
    (status === "recommended" || status === "overdue") &&
    typeof overdueDays === "number"
  ) {
    return status === "overdue"
      ? `${base}・${overdueDays}日超過`
      : `${overdueDays}日超過`;
  }
  return base;
}
