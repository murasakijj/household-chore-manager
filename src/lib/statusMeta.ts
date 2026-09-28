/**
 * 家事の状態(内部値)の表示名・色・アイコンをまとめて定義する1箇所
 * (設計書 §7.1, §14.4「状態名・色・文言を1箇所で定義する」)。
 * 状態の判定式そのものはここには置かない。サーバー(`api/_lib/domain/status.ts`)が
 * 返した `status` をそのまま使う。
 */
import type { ChoreStatus } from "./api";

export interface StatusMeta {
  label: string;
  /** 文字だけでも状態が伝わるよう、色に依存しないアイコン(絵文字)を添える(設計書 §14.5)。 */
  icon: string;
  /** CSSのステータス系クラス名の接尾辞(`status-badge--${key}` 等)。 */
  key: string;
}

export const STATUS_META: Record<ChoreStatus, StatusMeta> = {
  overdue: { label: "優先", icon: "🔴", key: "overdue" },
  recommended: { label: "今日やった方がよい", icon: "🟠", key: "recommended" },
  upcoming: { label: "そろそろ", icon: "🟡", key: "upcoming" },
  not_due: { label: "まだ不要", icon: "🟢", key: "not_due" },
  never_done: { label: "初回未実施", icon: "🆕", key: "never_done" },
  inactive: { label: "無効", icon: "⏸️", key: "inactive" },
};

export function statusMeta(status: ChoreStatus | null | undefined): StatusMeta {
  if (!status) return { label: "不明", icon: "❔", key: "unknown" };
  return STATUS_META[status];
}
