import { describe, it, expect } from "vitest";
import {
  computeChoreStatus,
  defaultWarningGrace,
  validateIntervals,
  InvalidIntervalError,
} from "./status.js";

/** Asia/Tokyo はDSTが無いため固定オフセット+09:00で日時を組み立てられる。 */
function jst(dateStr: string, time = "12:00:00"): Date {
  return new Date(`${dateStr}T${time}+09:00`);
}

const TZ = "Asia/Tokyo";

describe("computeChoreStatus 境界値(設計書 §16.1, interval=7 warning=2 grace=3)", () => {
  const base = {
    isActive: true,
    intervalDays: 7,
    warningDays: 2,
    graceDays: 3,
    timezone: TZ,
  };

  const cases: Array<[number, string]> = [
    [0, "not_due"],
    [4, "not_due"],
    [5, "upcoming"],
    [7, "upcoming"],
    [8, "recommended"],
    [10, "recommended"],
    [11, "overdue"],
  ];

  for (const [elapsed, expected] of cases) {
    it(`経過${elapsed}日 → ${expected}`, () => {
      const last = jst("2026-01-10");
      const day = String(10 + elapsed).padStart(2, "0");
      const now = jst(`2026-01-${day}`);
      // 2026-01-10 + elapsed日 は最大21日で1月に収まる
      const result = computeChoreStatus({
        ...base,
        lastCompletedAt: last,
        now,
      });
      expect(result.status).toBe(expected);
      expect(result.elapsedDays).toBe(elapsed);
    });
  }
});

describe("computeChoreStatus 追加ケース", () => {
  it("実施履歴が無ければ never_done", () => {
    const result = computeChoreStatus({
      isActive: true,
      lastCompletedAt: null,
      intervalDays: 7,
      warningDays: 2,
      graceDays: 3,
      now: jst("2026-01-10"),
      timezone: TZ,
    });
    expect(result.status).toBe("never_done");
    expect(result.elapsedDays).toBeNull();
  });

  it("無効化済みなら inactive(履歴があっても)", () => {
    const result = computeChoreStatus({
      isActive: false,
      lastCompletedAt: jst("2026-01-01"),
      intervalDays: 7,
      warningDays: 2,
      graceDays: 3,
      now: jst("2026-01-30"),
      timezone: TZ,
    });
    expect(result.status).toBe("inactive");
  });

  it("猶予0日で推奨間隔を超過すると overdue", () => {
    const result = computeChoreStatus({
      isActive: true,
      lastCompletedAt: jst("2026-01-01"),
      intervalDays: 7,
      warningDays: 2,
      graceDays: 0,
      now: jst("2026-01-09"), // elapsed=8, interval+grace=7
      timezone: TZ,
    });
    expect(result.elapsedDays).toBe(8);
    expect(result.status).toBe("overdue");
  });

  it("日付変更直前(JST 23:59:59)は前日扱いで elapsed=0", () => {
    const last = jst("2026-01-10", "00:00:01");
    const now = jst("2026-01-10", "23:59:59");
    const result = computeChoreStatus({
      isActive: true,
      lastCompletedAt: last,
      intervalDays: 7,
      warningDays: 2,
      graceDays: 3,
      now,
      timezone: TZ,
    });
    expect(result.elapsedDays).toBe(0);
    expect(result.status).toBe("not_due");
  });

  it("日付変更直後(JST 00:00:00)は elapsed=1", () => {
    const last = jst("2026-01-10", "23:59:59");
    const now = jst("2026-01-11", "00:00:00");
    const result = computeChoreStatus({
      isActive: true,
      lastCompletedAt: last,
      intervalDays: 7,
      warningDays: 2,
      graceDays: 3,
      now,
      timezone: TZ,
    });
    expect(result.elapsedDays).toBe(1);
  });

  it("UTCとAsia/Tokyoで日付が異なる時刻では状態が変わりうる", () => {
    // last: UTC 2025-12-31 20:00 = JST 2026-01-01 05:00
    // now : UTC 2026-01-01 10:00 = JST 2026-01-01 19:00 (UTC基準では1日経過、JST基準では0日)
    const last = new Date("2025-12-31T20:00:00Z");
    const now = new Date("2026-01-01T10:00:00Z");
    const utcResult = computeChoreStatus({
      isActive: true,
      lastCompletedAt: last,
      intervalDays: 1,
      warningDays: 0,
      graceDays: 0,
      now,
      timezone: "UTC",
    });
    const jstResult = computeChoreStatus({
      isActive: true,
      lastCompletedAt: last,
      intervalDays: 1,
      warningDays: 0,
      graceDays: 0,
      now,
      timezone: "Asia/Tokyo",
    });
    expect(utcResult.elapsedDays).toBe(1);
    expect(utcResult.status).toBe("upcoming"); // elapsed(1) <= interval(1)
    expect(jstResult.elapsedDays).toBe(0);
    expect(jstResult.status).toBe("not_due"); // elapsed(0) < interval-warning(1)
  });

  it("うるう年(2028-02-29)をまたぐ経過日数", () => {
    const last = jst("2028-02-27");
    const now = jst("2028-03-01");
    const result = computeChoreStatus({
      isActive: true,
      lastCompletedAt: last,
      intervalDays: 7,
      warningDays: 2,
      graceDays: 3,
      now,
      timezone: TZ,
    });
    expect(result.elapsedDays).toBe(3); // 27,28,29,03-01 -> 3日
  });

  it("月末をまたぐ経過日数(2026年は平年、2月28日まで)", () => {
    const last = jst("2026-02-26");
    const now = jst("2026-03-01");
    const result = computeChoreStatus({
      isActive: true,
      lastCompletedAt: last,
      intervalDays: 7,
      warningDays: 2,
      graceDays: 3,
      now,
      timezone: TZ,
    });
    expect(result.elapsedDays).toBe(3);
  });

  it("年末年始をまたぐ経過日数", () => {
    const last = jst("2026-12-30");
    const now = jst("2027-01-02");
    const result = computeChoreStatus({
      isActive: true,
      lastCompletedAt: last,
      intervalDays: 7,
      warningDays: 2,
      graceDays: 3,
      now,
      timezone: TZ,
    });
    expect(result.elapsedDays).toBe(3);
    expect(result.status).toBe("not_due");
  });

  it("nextChangeDate は overdue/never_done/inactive で null", () => {
    const overdue = computeChoreStatus({
      isActive: true,
      lastCompletedAt: jst("2026-01-01"),
      intervalDays: 7,
      warningDays: 2,
      graceDays: 3,
      now: jst("2026-01-20"),
      timezone: TZ,
    });
    expect(overdue.status).toBe("overdue");
    expect(overdue.nextChangeDate).toBeNull();
  });

  it("not_due の nextChangeDate は upcoming に切り替わる日", () => {
    const result = computeChoreStatus({
      isActive: true,
      lastCompletedAt: jst("2026-01-01"),
      intervalDays: 7,
      warningDays: 2,
      graceDays: 3,
      now: jst("2026-01-02"),
      timezone: TZ,
    });
    expect(result.status).toBe("not_due");
    expect(result.nextChangeDate).toBe("2026-01-06"); // elapsed=5から upcoming
  });
});

describe("validateIntervals", () => {
  it("intervalDays が1未満なら例外", () => {
    expect(() =>
      validateIntervals({ intervalDays: 0, warningDays: 0, graceDays: 0 }),
    ).toThrow(InvalidIntervalError);
  });

  it("warningDays が intervalDays 以上なら例外", () => {
    expect(() =>
      validateIntervals({ intervalDays: 3, warningDays: 3, graceDays: 0 }),
    ).toThrow(InvalidIntervalError);
  });

  it("warningDays が負なら例外", () => {
    expect(() =>
      validateIntervals({ intervalDays: 3, warningDays: -1, graceDays: 0 }),
    ).toThrow(InvalidIntervalError);
  });

  it("graceDays が負なら例外", () => {
    expect(() =>
      validateIntervals({ intervalDays: 3, warningDays: 1, graceDays: -1 }),
    ).toThrow(InvalidIntervalError);
  });

  it("有効な値なら例外を投げない", () => {
    expect(() =>
      validateIntervals({ intervalDays: 7, warningDays: 2, graceDays: 3 }),
    ).not.toThrow();
  });
});

describe("defaultWarningGrace 推奨初期値(設計書 §7.6)", () => {
  it("interval=7 → warning=2, grace=2", () => {
    // round(7*0.25)=round(1.75)=2
    expect(defaultWarningGrace(7)).toEqual({ warningDays: 2, graceDays: 2 });
  });

  it("interval=1 のとき warning は 0 に補正される", () => {
    // round(1*0.25)=0 -> max(1,0)=1 -> min(1, intervalDays-1=0) = 0
    expect(defaultWarningGrace(1)).toEqual({ warningDays: 0, graceDays: 1 });
  });

  it("interval=2 のとき warning は intervalDays-1=1 に補正される", () => {
    // round(2*0.25)=round(0.5)=1(Math.roundは0.5切り上げ) -> max(1,1)=1 -> min(1,1)=1
    expect(defaultWarningGrace(2)).toEqual({ warningDays: 1, graceDays: 1 });
  });

  it("interval=30 → warning=8, grace=8", () => {
    // round(30*0.25)=round(7.5)=8
    expect(defaultWarningGrace(30)).toEqual({ warningDays: 8, graceDays: 8 });
  });
});
