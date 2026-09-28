import { compareChoresForDisplay, type OrderableChore } from "./ordering.js";
import type { ChoreStatus } from "./status.js";

export interface TodayChoreInput extends OrderableChore {
  id: string;
  status: ChoreStatus;
  elapsedDays: number | null;
}

export interface TodaySections<T> {
  overdue: T[];
  recommended: T[];
  upcoming: T[];
  neverDone: T[];
  doneToday: T[];
}

export interface BuildTodaySectionsResult<T> {
  sections: TodaySections<T>;
  /** 「まだ不要」の件数(本日実施済みを除く)。設計書 §8.2。 */
  notDueCount: number;
}

/**
 * ホーム画面のセクション分け(設計書 §8.2)。
 * `isActive:false` の家事(status="inactive")は呼び出し側で除外しておくこと。
 * `not_due` のうち本日実施したもの(elapsedDays===0)だけ「本日実施済み」に出し、
 * 残りは件数のみ(`notDueCount`)とする。
 */
export function buildTodaySections<T extends TodayChoreInput>(
  chores: T[],
): BuildTodaySectionsResult<T> {
  const overdue: T[] = [];
  const recommended: T[] = [];
  const upcoming: T[] = [];
  const neverDone: T[] = [];
  const doneToday: T[] = [];
  let notDueCount = 0;

  for (const chore of chores) {
    switch (chore.status) {
      case "overdue":
        overdue.push(chore);
        break;
      case "recommended":
        recommended.push(chore);
        break;
      case "upcoming":
        upcoming.push(chore);
        break;
      case "never_done":
        neverDone.push(chore);
        break;
      case "not_due":
        if (chore.elapsedDays === 0) {
          doneToday.push(chore);
        } else {
          notDueCount += 1;
        }
        break;
      case "inactive":
        // ホームの対象外。呼び出し側で除外されている想定だが、念のため無視する。
        break;
    }
  }

  overdue.sort(compareChoresForDisplay);
  recommended.sort(compareChoresForDisplay);
  upcoming.sort(compareChoresForDisplay);
  neverDone.sort(compareChoresForDisplay);
  doneToday.sort(compareChoresForDisplay);

  return {
    sections: { overdue, recommended, upcoming, neverDone, doneToday },
    notDueCount,
  };
}
