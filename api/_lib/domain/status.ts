import { addCalendarDays, elapsedCalendarDays, localDate } from "./calendar.js";

/** 設計書 §7.1 の内部値。 */
export type ChoreStatus =
  | "not_due"
  | "upcoming"
  | "recommended"
  | "overdue"
  | "never_done"
  | "inactive";

export interface ComputeChoreStatusInput {
  isActive: boolean;
  lastCompletedAt: Date | null;
  intervalDays: number;
  warningDays: number;
  graceDays: number;
  now: Date;
  timezone: string;
}

export interface ComputeChoreStatusResult {
  status: ChoreStatus;
  /** 前回実施からの経過日数(暦日)。履歴が無い/無効の場合は null。 */
  elapsedDays: number | null;
  /** `elapsedDays - intervalDays`。ソート用。履歴が無い/無効の場合は null。 */
  overdueDays: number | null;
  /** 次に状態が変わる日付("YYYY-MM-DD"、家庭のタイムゾーン)。overdue/never_done/inactive は null。 */
  nextChangeDate: string | null;
}

export class InvalidIntervalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidIntervalError";
  }
}

/** 設計書 §7.4 の制約を検証する。違反時は `InvalidIntervalError` を投げる。 */
export function validateIntervals(params: {
  intervalDays: number;
  warningDays: number;
  graceDays: number;
}): void {
  const { intervalDays, warningDays, graceDays } = params;
  if (!Number.isInteger(intervalDays) || intervalDays < 1) {
    throw new InvalidIntervalError("intervalDays must be an integer >= 1");
  }
  if (
    !Number.isInteger(warningDays) ||
    warningDays < 0 ||
    warningDays >= intervalDays
  ) {
    throw new InvalidIntervalError(
      "warningDays must be an integer in [0, intervalDays)",
    );
  }
  if (!Number.isInteger(graceDays) || graceDays < 0) {
    throw new InvalidIntervalError("graceDays must be an integer >= 0");
  }
}

/**
 * 新規登録時の予告日数・猶予日数の推奨初期値(設計書 §7.6)。
 * warningDays は必ず `intervalDays - 1` 以下に補正する
 * (intervalDays=1 のときは自動的に 0 になる)。
 */
export function defaultWarningGrace(intervalDays: number): {
  warningDays: number;
  graceDays: number;
} {
  const rawWarning = Math.max(1, Math.round(intervalDays * 0.25));
  const graceDays = Math.max(1, Math.round(intervalDays * 0.25));
  const warningDays = Math.min(rawWarning, intervalDays - 1);
  return { warningDays, graceDays };
}

/** 設計書 §7.4 の判定式。境界値を厳守する。クライアント側で再実装しないこと。 */
export function computeChoreStatus(
  input: ComputeChoreStatusInput,
): ComputeChoreStatusResult {
  const {
    isActive,
    lastCompletedAt,
    intervalDays,
    warningDays,
    graceDays,
    now,
    timezone,
  } = input;

  if (!isActive) {
    return {
      status: "inactive",
      elapsedDays: null,
      overdueDays: null,
      nextChangeDate: null,
    };
  }

  validateIntervals({ intervalDays, warningDays, graceDays });

  if (!lastCompletedAt) {
    return {
      status: "never_done",
      elapsedDays: null,
      overdueDays: null,
      nextChangeDate: null,
    };
  }

  const elapsedDays = elapsedCalendarDays(now, lastCompletedAt, timezone);
  const overdueDays = elapsedDays - intervalDays;
  const lastDate = localDate(lastCompletedAt, timezone);

  let status: ChoreStatus;
  let nextChangeDate: string | null;

  if (elapsedDays < intervalDays - warningDays) {
    status = "not_due";
    nextChangeDate = addCalendarDays(lastDate, intervalDays - warningDays);
  } else if (elapsedDays <= intervalDays) {
    status = "upcoming";
    nextChangeDate = addCalendarDays(lastDate, intervalDays + 1);
  } else if (elapsedDays <= intervalDays + graceDays) {
    status = "recommended";
    nextChangeDate = addCalendarDays(lastDate, intervalDays + graceDays + 1);
  } else {
    status = "overdue";
    nextChangeDate = null;
  }

  return { status, elapsedDays, overdueDays, nextChangeDate };
}
