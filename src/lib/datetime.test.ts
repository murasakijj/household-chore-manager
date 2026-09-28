import { describe, expect, it } from "vitest";
import {
  addOneCalendarDay,
  dateToOffsetIsoString,
  datetimeLocalToDate,
  datetimeLocalToOffsetIso,
  endOfCalendarDayOffsetIso,
  formatCalendarDate,
  toDatetimeLocalValue,
} from "./datetime";

describe("datetimeLocalToOffsetIso", () => {
  it("converts a JST wall-clock time to an offset ISO string (+09:00, no DST)", () => {
    const iso = datetimeLocalToOffsetIso("2026-01-15T08:30", "Asia/Tokyo");
    expect(iso).toBe("2026-01-15T08:30:00+09:00");
  });

  it("round-trips through Date to the correct UTC instant", () => {
    const date = datetimeLocalToDate("2026-01-15T08:30", "Asia/Tokyo");
    // JST is UTC+9, so 08:30 JST == 23:30 UTC the previous day.
    expect(date.toISOString()).toBe("2026-01-14T23:30:00.000Z");
  });

  it("handles UTC (offset +00:00)", () => {
    const iso = datetimeLocalToOffsetIso("2026-06-01T00:00", "UTC");
    expect(iso).toBe("2026-06-01T00:00:00+00:00");
  });

  it("produces a negative offset for US timezones", () => {
    // 2026-01-15 is outside US DST, so America/Los_Angeles is UTC-08:00.
    const iso = datetimeLocalToOffsetIso(
      "2026-01-15T09:00",
      "America/Los_Angeles",
    );
    expect(iso).toBe("2026-01-15T09:00:00-08:00");
  });
});

describe("datetimeLocalToDate: DST disambiguation (compatible, like Temporal)", () => {
  it("America/Los_Angeles spring-forward gap: rolls the nonexistent time forward", () => {
    // 2026-03-08: clocks jump from 02:00 PST to 03:00 PDT. 02:30 doesn't exist.
    const date = datetimeLocalToDate("2026-03-08T02:30", "America/Los_Angeles");
    expect(date.toISOString()).toBe("2026-03-08T10:30:00.000Z");
    // Reformatting in the zone shows it landed at 03:30 PDT (shifted forward by the gap).
    expect(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        hourCycle: "h23",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date),
    ).toBe("03:30");
  });

  it("America/Los_Angeles fall-back overlap: picks the earlier (first) occurrence", () => {
    // 2026-11-01: clocks fall back from 02:00 PDT to 01:00 PST. 01:30 occurs twice.
    const date = datetimeLocalToDate("2026-11-01T01:30", "America/Los_Angeles");
    // The first (PDT, UTC-07:00) occurrence is 2026-11-01T08:30:00Z.
    expect(date.toISOString()).toBe("2026-11-01T08:30:00.000Z");
  });

  it("Europe/London spring-forward gap: rolls forward", () => {
    // 2026-03-29: clocks jump from 01:00 GMT to 02:00 BST. 01:30 doesn't exist.
    const date = datetimeLocalToDate("2026-03-29T01:30", "Europe/London");
    expect(date.toISOString()).toBe("2026-03-29T01:30:00.000Z");
    expect(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        hourCycle: "h23",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date),
    ).toBe("02:30");
  });

  it("Europe/London fall-back overlap: picks the earlier (first, BST) occurrence", () => {
    // 2026-10-25: clocks fall back from 02:00 BST to 01:00 GMT. 01:30 occurs twice.
    const date = datetimeLocalToDate("2026-10-25T01:30", "Europe/London");
    // The first (BST, UTC+01:00) occurrence is 2026-10-25T00:30:00Z.
    expect(date.toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });
});

describe("toDatetimeLocalValue", () => {
  it("formats an ISO instant back into a datetime-local value in the target timezone", () => {
    const value = toDatetimeLocalValue(
      "2026-01-14T23:30:00.000Z",
      "Asia/Tokyo",
    );
    expect(value).toBe("2026-01-15T08:30");
  });

  it("round-trips with datetimeLocalToOffsetIso", () => {
    const original = "2026-03-02T14:45";
    const iso = datetimeLocalToOffsetIso(original, "Asia/Tokyo");
    const back = toDatetimeLocalValue(iso, "Asia/Tokyo");
    expect(back).toBe(original);
  });
});

describe("dateToOffsetIsoString", () => {
  it("matches the API's ISO_DATETIME_WITH_OFFSET regex shape", () => {
    const iso = dateToOffsetIsoString(new Date(), "Asia/Tokyo");
    expect(iso).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/,
    );
  });
});

describe("addOneCalendarDay", () => {
  it("adds a day within a month", () => {
    expect(addOneCalendarDay("2026-01-15")).toBe("2026-01-16");
  });

  it("rolls over month and year boundaries", () => {
    expect(addOneCalendarDay("2026-01-31")).toBe("2026-02-01");
    expect(addOneCalendarDay("2026-12-31")).toBe("2027-01-01");
  });

  it("handles a leap-year February", () => {
    expect(addOneCalendarDay("2028-02-28")).toBe("2028-02-29");
    expect(addOneCalendarDay("2028-02-29")).toBe("2028-03-01");
  });
});

describe("endOfCalendarDayOffsetIso", () => {
  it("returns the last millisecond of the day in the household timezone", () => {
    const iso = endOfCalendarDayOffsetIso("2026-01-15", "Asia/Tokyo");
    expect(iso).toBe("2026-01-15T23:59:59.999+09:00");
    // The instant is exactly 1ms before the next day's midnight in that timezone.
    const startOfNext = datetimeLocalToDate(
      "2026-01-16T00:00:00",
      "Asia/Tokyo",
    );
    expect(new Date(iso).getTime()).toBe(startOfNext.getTime() - 1);
  });

  it("stays correct across a DST transition day", () => {
    // 2026-03-08 in America/Los_Angeles has only 23 wall-clock hours.
    const iso = endOfCalendarDayOffsetIso("2026-03-08", "America/Los_Angeles");
    const startOfNext = datetimeLocalToDate(
      "2026-03-09T00:00:00",
      "America/Los_Angeles",
    );
    expect(new Date(iso).getTime()).toBe(startOfNext.getTime() - 1);
  });
});

describe("formatCalendarDate", () => {
  it("formats a calendar-day string without going through Date/timezone conversion", () => {
    expect(formatCalendarDate("2026-01-05")).toBe("2026/01/05");
  });

  it("returns an empty string for null/undefined", () => {
    expect(formatCalendarDate(null)).toBe("");
    expect(formatCalendarDate(undefined)).toBe("");
  });
});
