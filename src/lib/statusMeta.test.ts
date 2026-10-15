import { describe, it, expect } from "vitest";
import { STATUS_META, statusBadgeLabel, statusMeta } from "./statusMeta";

describe("区分名(セクション見出し・フィルタ用)", () => {
  it("設計書 §7.1 の表示名", () => {
    expect(STATUS_META.overdue.label).toBe("優先");
    expect(STATUS_META.recommended.label).toBe("超過");
    expect(STATUS_META.due_today.label).toBe("今日やる日");
    expect(STATUS_META.upcoming.label).toBe("そろそろ");
    expect(STATUS_META.not_due.label).toBe("まだ不要");
    expect(STATUS_META.never_done.label).toBe("初回未実施");
    expect(STATUS_META.inactive.label).toBe("無効");
  });

  it("全状態でアイコンとキーが重複しない", () => {
    const metas = Object.values(STATUS_META);
    expect(new Set(metas.map((m) => m.icon)).size).toBe(metas.length);
    expect(new Set(metas.map((m) => m.key)).size).toBe(metas.length);
  });

  it("状態が無ければ不明", () => {
    expect(statusMeta(null).label).toBe("不明");
  });
});

describe("statusBadgeLabel", () => {
  it("recommended は「○日超過」", () => {
    expect(statusBadgeLabel("recommended", 1)).toBe("1日超過");
    expect(statusBadgeLabel("recommended", 3)).toBe("3日超過");
  });

  it("overdue は「優先・○日超過」", () => {
    expect(statusBadgeLabel("overdue", 1)).toBe("優先・1日超過");
    expect(statusBadgeLabel("overdue", 12)).toBe("優先・12日超過");
  });

  it("その他は区分名と同じ", () => {
    expect(statusBadgeLabel("due_today", 0)).toBe("今日やる日");
    expect(statusBadgeLabel("upcoming", -2)).toBe("そろそろ");
    expect(statusBadgeLabel("not_due", null)).toBe("まだ不要");
    expect(statusBadgeLabel("never_done", null)).toBe("初回未実施");
    expect(statusBadgeLabel("inactive", null)).toBe("無効");
  });

  it("overdueDays が無い場合は区分名にフォールバックする", () => {
    expect(statusBadgeLabel("recommended", null)).toBe("超過");
    expect(statusBadgeLabel("overdue", undefined)).toBe("優先");
  });
});
