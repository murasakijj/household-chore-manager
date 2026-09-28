import type { Repo } from "../repo/types.js";
import { buildTodaySections } from "../domain/today.js";
import { listChoresWithStatus, type ChoreWithStatus } from "./chores.js";

export interface TodayResult {
  sections: {
    overdue: ChoreWithStatus[];
    recommended: ChoreWithStatus[];
    upcoming: ChoreWithStatus[];
    neverDone: ChoreWithStatus[];
    doneToday: ChoreWithStatus[];
  };
  notDueCount: number;
}

/** ホーム画面/今日の家事候補(設計書 §8.2)。無効化された家事は対象外。 */
export async function getTodayChores(
  repo: Repo,
  householdId: string,
  timezone: string,
  now: Date,
): Promise<TodayResult> {
  const chores = await listChoresWithStatus(repo, householdId, timezone, now, {
    includeInactive: false,
  });
  return buildTodaySections(chores);
}
