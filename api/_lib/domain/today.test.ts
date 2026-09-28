import { describe, it, expect } from "vitest";
import { buildTodaySections, type TodayChoreInput } from "./today.js";

function chore(
  id: string,
  status: TodayChoreInput["status"],
  elapsedDays: number | null,
  overdueDays: number | null = null,
  name = id,
): TodayChoreInput {
  return { id, status, elapsedDays, overdueDays, name };
}

describe("buildTodaySections(設計書 §8.2)", () => {
  it("状態ごとにセクション分けする", () => {
    const { sections } = buildTodaySections([
      chore("1", "overdue", 11, 4),
      chore("2", "recommended", 8, 1),
      chore("3", "upcoming", 5, -2),
      chore("4", "never_done", null),
    ]);
    expect(sections.overdue.map((c) => c.id)).toEqual(["1"]);
    expect(sections.recommended.map((c) => c.id)).toEqual(["2"]);
    expect(sections.upcoming.map((c) => c.id)).toEqual(["3"]);
    expect(sections.neverDone.map((c) => c.id)).toEqual(["4"]);
  });

  it("not_due のうち本日実施済み(elapsedDays=0)は doneToday、それ以外は件数のみ", () => {
    const { sections, notDueCount } = buildTodaySections([
      chore("1", "not_due", 0),
      chore("2", "not_due", 2),
      chore("3", "not_due", 3),
    ]);
    expect(sections.doneToday.map((c) => c.id)).toEqual(["1"]);
    expect(notDueCount).toBe(2);
  });

  it("inactive は無視する", () => {
    const { sections, notDueCount } = buildTodaySections([
      chore("1", "inactive", null),
    ]);
    expect(sections.overdue).toEqual([]);
    expect(sections.recommended).toEqual([]);
    expect(sections.upcoming).toEqual([]);
    expect(sections.neverDone).toEqual([]);
    expect(sections.doneToday).toEqual([]);
    expect(notDueCount).toBe(0);
  });

  it("空配列なら空状態", () => {
    const { sections, notDueCount } = buildTodaySections([]);
    expect(sections.overdue).toEqual([]);
    expect(notDueCount).toBe(0);
  });
});
