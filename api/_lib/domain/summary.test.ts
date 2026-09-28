import { describe, it, expect } from "vitest";
import { buildDailySummary, type SummaryChoreInput } from "./summary.js";

function chore(
  id: string,
  status: SummaryChoreInput["status"],
  overdueDays: number | null,
  name: string,
  createdAt?: Date,
): SummaryChoreInput {
  return { id, status, overdueDays, name, createdAt };
}

const now = new Date("2026-01-10T00:00:00+09:00");
const TZ = "Asia/Tokyo";

describe("buildDailySummary(設計書 §12.1〜12.3, §7.7)", () => {
  it("対象が0件なら通知しない(null)", () => {
    const result = buildDailySummary({
      chores: [chore("1", "not_due", null, "掃除機")],
      now,
      timezone: TZ,
      includeUpcoming: false,
    });
    expect(result).toBeNull();
  });

  it("文例どおりの本文を生成する(設計書 §12.2)", () => {
    const result = buildDailySummary({
      chores: [
        chore("1", "overdue", 4, "シーツ交換"),
        chore("2", "recommended", 1, "風呂の排水溝"),
        chore("3", "recommended", 3, "冷蔵庫整理"),
      ],
      now,
      timezone: TZ,
      includeUpcoming: false,
    });
    expect(result).not.toBeNull();
    expect(result!.lines[0]).toBe("今日の家事: 優先1件、やった方がよい2件");
    // overdue(シーツ交換) → recommended超過日数降順(冷蔵庫整理3, 風呂の排水溝1)
    expect(result!.lines[1]).toBe("シーツ交換、冷蔵庫整理、風呂の排水溝");
  });

  it("includeUpcoming=false なら upcoming は対象外", () => {
    const result = buildDailySummary({
      chores: [chore("1", "upcoming", -1, "そろそろ家事")],
      now,
      timezone: TZ,
      includeUpcoming: false,
    });
    expect(result).toBeNull();
  });

  it("includeUpcoming=true なら upcoming も対象に含む", () => {
    const result = buildDailySummary({
      chores: [chore("1", "upcoming", -1, "そろそろ家事")],
      now,
      timezone: TZ,
      includeUpcoming: true,
    });
    expect(result).not.toBeNull();
    expect(result!.lines[0]).toBe("今日の家事: そろそろ1件");
  });

  it("4件以上は上位3件名称+残り件数", () => {
    const result = buildDailySummary({
      chores: [
        chore("1", "overdue", 4, "d"),
        chore("2", "overdue", 3, "c"),
        chore("3", "overdue", 2, "b"),
        chore("4", "overdue", 1, "a"),
      ],
      now,
      timezone: TZ,
      includeUpcoming: false,
    });
    expect(result!.lines[1]).toBe("d、c、b、他1件");
  });

  it("無効な家事は呼び出し側で除外される前提(inactiveは対象外)", () => {
    const result = buildDailySummary({
      chores: [chore("1", "inactive", null, "無効家事")],
      now,
      timezone: TZ,
      includeUpcoming: true,
    });
    expect(result).toBeNull();
  });

  it("登録から7日以上未実施の never_done は末尾に「初回記録待ち」を付ける", () => {
    const result = buildDailySummary({
      chores: [
        chore("1", "overdue", 1, "優先家事"),
        chore(
          "2",
          "never_done",
          null,
          "新規家事",
          new Date("2026-01-02T00:00:00+09:00"), // 8日経過
        ),
      ],
      now,
      timezone: TZ,
      includeUpcoming: false,
    });
    expect(result!.lines[2]).toBe("初回記録待ち 1件");
  });

  it("登録から7日未満の never_done は数えない", () => {
    const result = buildDailySummary({
      chores: [
        chore("1", "overdue", 1, "優先家事"),
        chore(
          "2",
          "never_done",
          null,
          "新規家事",
          new Date("2026-01-05T00:00:00+09:00"), // 5日経過
        ),
      ],
      now,
      timezone: TZ,
      includeUpcoming: false,
    });
    expect(result!.lines.length).toBe(2);
  });
});
