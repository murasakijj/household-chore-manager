import { describe, it, expect } from "vitest";
import { compareChoresForDisplay, type OrderableChore } from "./ordering.js";

function chore(
  status: OrderableChore["status"],
  overdueDays: number | null,
  name: string,
): OrderableChore {
  return { status, overdueDays, name };
}

describe("compareChoresForDisplay(設計書 §12.3)", () => {
  it("状態順: overdue → recommended → upcoming", () => {
    const items = [
      chore("upcoming", -1, "b"),
      chore("overdue", 5, "a"),
      chore("recommended", 1, "c"),
    ];
    const sorted = [...items].sort(compareChoresForDisplay);
    expect(sorted.map((c) => c.status)).toEqual([
      "overdue",
      "recommended",
      "upcoming",
    ]);
  });

  it("同一状態内は超過日数の降順", () => {
    const items = [
      chore("overdue", 2, "a"),
      chore("overdue", 10, "b"),
      chore("overdue", 5, "c"),
    ];
    const sorted = [...items].sort(compareChoresForDisplay);
    expect(sorted.map((c) => c.overdueDays)).toEqual([10, 5, 2]);
  });

  it("状態・超過日数が同じなら名称の昇順", () => {
    const items = [
      chore("overdue", 3, "冷蔵庫整理"),
      chore("overdue", 3, "シーツ交換"),
      chore("overdue", 3, "風呂の排水溝"),
    ];
    const sorted = [...items].sort(compareChoresForDisplay);
    expect(sorted.map((c) => c.name)).toEqual([
      "シーツ交換",
      "冷蔵庫整理",
      "風呂の排水溝",
    ]);
  });
});
