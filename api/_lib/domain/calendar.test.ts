import { describe, it, expect } from "vitest";
import {
  localDate,
  diffCalendarDays,
  addCalendarDays,
  elapsedCalendarDays,
} from "./calendar.js";

describe("localDate", () => {
  it("UTCとAsia/Tokyoで日付が異なる時刻を正しく変換する", () => {
    // UTC 2026-01-01 15:30 = JST 2026-01-02 00:30
    const instant = new Date("2026-01-01T15:30:00Z");
    expect(localDate(instant, "UTC")).toBe("2026-01-01");
    expect(localDate(instant, "Asia/Tokyo")).toBe("2026-01-02");
  });

  it("日付変更直前・直後(JST)", () => {
    const before = new Date("2026-03-09T14:59:59Z"); // JST 23:59:59
    const after = new Date("2026-03-09T15:00:00Z"); // JST 00:00:00 (翌日)
    expect(localDate(before, "Asia/Tokyo")).toBe("2026-03-09");
    expect(localDate(after, "Asia/Tokyo")).toBe("2026-03-10");
  });
});

describe("diffCalendarDays", () => {
  it("同日なら0", () => {
    expect(diffCalendarDays("2026-05-01", "2026-05-01")).toBe(0);
  });

  it("うるう年をまたぐ", () => {
    // 2028年はうるう年
    expect(diffCalendarDays("2028-03-01", "2028-02-28")).toBe(2);
  });

  it("月末をまたぐ", () => {
    expect(diffCalendarDays("2026-05-01", "2026-04-30")).toBe(1);
  });

  it("年末年始をまたぐ", () => {
    expect(diffCalendarDays("2027-01-01", "2026-12-31")).toBe(1);
  });
});

describe("addCalendarDays", () => {
  it("うるう年の2月29日をまたいで加算できる", () => {
    expect(addCalendarDays("2028-02-27", 3)).toBe("2028-03-01");
  });

  it("年をまたいで加算できる", () => {
    expect(addCalendarDays("2026-12-30", 5)).toBe("2027-01-04");
  });
});

describe("elapsedCalendarDays", () => {
  it("タイムゾーンにより経過日数が変わる", () => {
    const now = new Date("2026-01-02T00:30:00Z"); // JST 09:30
    const last = new Date("2026-01-01T15:30:00Z"); // JST 2026-01-02 00:30
    // UTC基準: 01-01 -> 01-02 で1日差。JST基準: 01-02 -> 01-02 で0日差。
    expect(elapsedCalendarDays(now, last, "UTC")).toBe(1);
    expect(elapsedCalendarDays(now, last, "Asia/Tokyo")).toBe(0);
  });
});
