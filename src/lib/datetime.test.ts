import { describe, expect, it } from "vitest";
import {
  datetimeLocalToDate,
  datetimeLocalToOffsetIso,
  dateToOffsetIsoString,
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
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/,
    );
  });
});
