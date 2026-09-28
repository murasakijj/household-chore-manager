import { diffCalendarDays, localDate } from "./calendar.js";
import { compareChoresForDisplay, type OrderableChore } from "./ordering.js";
import type { ChoreStatus } from "./status.js";

/** 表示件数がこれを超える場合は上位のみ名称表示し、残りは件数で示す(設計書 §12.2)。 */
const MAX_NAMED_ITEMS = 3;

/** 初回未実施が「初回記録待ち」として通知末尾に出るまでの経過日数(設計書 §7.7)。 */
const NEVER_DONE_WAITING_DAYS = 7;

export interface SummaryChoreInput extends OrderableChore {
  id: string;
  status: ChoreStatus;
  /** never_done の場合のみ使う、家事の登録日時。 */
  createdAt?: Date;
}

export interface BuildDailySummaryInput {
  /** 通知対象家庭の、無効化されていない全家事の現在状態。 */
  chores: SummaryChoreInput[];
  now: Date;
  timezone: string;
  /** 通知設定の `includeUpcoming`(設計書 §8.8, §12.1)。 */
  includeUpcoming: boolean;
}

export interface DailySummaryResult {
  /** 通知本文の各行。1行目: 件数サマリ、2行目: 上位項目名、(あれば)3行目: 初回記録待ち。 */
  lines: string[];
  /** `lines.join("\n")`。 */
  text: string;
  /** 通知対象となった家事ID(overdue/recommended/(upcoming))。表示順。 */
  targetChoreIds: string[];
}

const STATUS_LABEL: Record<"overdue" | "recommended" | "upcoming", string> = {
  overdue: "優先",
  recommended: "やった方がよい",
  upcoming: "そろそろ",
};

/**
 * 朝のまとめ通知の対象抽出と文面生成(設計書 §12.1〜12.3, §7.7)。
 * 対象(overdue/recommended、設定により+upcoming)が0件なら通知しない(null)。
 * 「初回記録待ち」は、通知対象が1件以上あるときにのみ末尾に付与する
 * (設計書は「まとめ通知の末尾に」とあり、通知そのものが無ければ末尾も無い前提の実装)。
 */
export function buildDailySummary(
  input: BuildDailySummaryInput,
): DailySummaryResult | null {
  const { chores, now, timezone, includeUpcoming } = input;

  const targets = chores.filter((chore) => {
    if (chore.status === "overdue" || chore.status === "recommended") {
      return true;
    }
    if (chore.status === "upcoming" && includeUpcoming) {
      return true;
    }
    return false;
  });

  if (targets.length === 0) {
    return null;
  }

  const sorted = [...targets].sort(compareChoresForDisplay);

  const counts: Partial<
    Record<"overdue" | "recommended" | "upcoming", number>
  > = {};
  for (const chore of sorted) {
    if (
      chore.status === "overdue" ||
      chore.status === "recommended" ||
      chore.status === "upcoming"
    ) {
      counts[chore.status] = (counts[chore.status] ?? 0) + 1;
    }
  }

  const summarySegments = (["overdue", "recommended", "upcoming"] as const)
    .filter((status) => (counts[status] ?? 0) > 0)
    .map((status) => `${STATUS_LABEL[status]}${counts[status]}件`);
  const line1 = `今日の家事: ${summarySegments.join("、")}`;

  const namedCount = Math.min(MAX_NAMED_ITEMS, sorted.length);
  const names = sorted.slice(0, namedCount).map((c) => c.name);
  const remaining = sorted.length - namedCount;
  const line2 =
    remaining > 0 ? `${names.join("、")}、他${remaining}件` : names.join("、");

  const lines = [line1, line2];

  const neverDoneWaitingCount = chores.filter((chore) => {
    if (chore.status !== "never_done" || !chore.createdAt) return false;
    const elapsed = diffCalendarDays(
      localDate(now, timezone),
      localDate(chore.createdAt, timezone),
    );
    return elapsed >= NEVER_DONE_WAITING_DAYS;
  }).length;

  if (neverDoneWaitingCount > 0) {
    lines.push(`初回記録待ち ${neverDoneWaitingCount}件`);
  }

  return {
    lines,
    text: lines.join("\n"),
    targetChoreIds: sorted.map((c) => c.id),
  };
}
