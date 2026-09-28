import type { ChoreStatus } from "./status.js";

/** ホーム・一覧・通知で共通の状態優先順位(設計書 §8.2, §12.3)。数値が小さいほど優先。 */
const STATUS_PRIORITY: Record<ChoreStatus, number> = {
  overdue: 0,
  recommended: 1,
  upcoming: 2,
  never_done: 3,
  not_due: 4,
  inactive: 5,
};

export interface OrderableChore {
  status: ChoreStatus;
  /** ソート用の超過日数(`elapsedDays - intervalDays`)。無ければ最後扱い。 */
  overdueDays: number | null;
  name: string;
}

/**
 * 表示順の比較関数(設計書 §12.3): 状態 → 超過日数の降順 → 家事名の昇順。
 * ホームの各セクション内・通知の対象一覧の並び替えに共通で使う。
 */
export function compareChoresForDisplay(
  a: OrderableChore,
  b: OrderableChore,
): number {
  const statusDiff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
  if (statusDiff !== 0) return statusDiff;

  const aOverdue = a.overdueDays ?? Number.NEGATIVE_INFINITY;
  const bOverdue = b.overdueDays ?? Number.NEGATIVE_INFINITY;
  if (aOverdue !== bOverdue) return bOverdue - aOverdue;

  // 実行環境のICUデータ有無に左右されないよう、コードポイント順の単純比較にする
  // (localeCompareは環境によって「かな順」を再現できないことがある)。
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
}
