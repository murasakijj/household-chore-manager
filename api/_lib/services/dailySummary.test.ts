import { describe, it, expect, vi, beforeEach } from "vitest";

const sendNotification = vi.fn();
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: (...args: unknown[]) => sendNotification(...args),
  },
}));

const { MemoryRepo } = await import("../repo/memoryRepo.js");
const { runDailySummaryJob } = await import("./dailySummary.js");

/** 家庭タイムゾーン(Asia/Tokyo)の "2026-01-15 09:00" に相当するUTC実時刻。 */
const NOW = new Date("2026-01-15T00:00:00Z");

describe("runDailySummaryJob", () => {
  let repo: InstanceType<typeof MemoryRepo>;
  let householdId: string;
  let memberId: string;

  beforeEach(async () => {
    sendNotification.mockReset();
    sendNotification.mockResolvedValue(undefined);
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    process.env.VAPID_SUBJECT = "mailto:test@example.com";

    repo = new MemoryRepo();
    const membership = await repo.bootstrapHouseholdForUser({
      uid: "u1",
      email: "u1@example.com",
    });
    householdId = membership.householdId;
    memberId = membership.memberId;
    await repo.upsertNotificationSettings(householdId, memberId, {
      dailySummaryEnabled: true,
      dailySummaryTime: "08:00",
    });
    await repo.upsertPushSubscription(householdId, memberId, {
      endpoint: "https://push.example.com/x",
      keys: { p256dh: "p256dh", auth: "auth" },
    });
  });

  it("通知時刻(08:00)より前なら送らない", async () => {
    await repo.upsertNotificationSettings(householdId, memberId, {
      dailySummaryTime: "23:59",
    });
    const result = await runDailySummaryJob(repo, NOW);
    expect(result.notificationsSent).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("dailySummaryEnabled:falseなら送らない", async () => {
    await repo.upsertNotificationSettings(householdId, memberId, {
      dailySummaryEnabled: false,
    });
    const result = await runDailySummaryJob(repo, NOW);
    expect(result.notificationsSent).toBe(0);
  });

  it("overdue対象があれば送信し、lastSentLocalDateを更新して二重送信しない", async () => {
    await repo.createChore(householdId, {
      name: "優先度高い家事",
      description: null,
      categoryId: null,
      areaId: null,
      resourceId: null,
      scheduleType: "interval",
      intervalDays: 3,
      warningDays: 1,
      graceDays: 1,
      isActive: true,
      createdBy: memberId,
      lastCompletedAt: new Date("2025-12-01T00:00:00Z"),
    });

    const first = await runDailySummaryJob(repo, NOW);
    expect(first.notificationsSent).toBe(1);
    expect(sendNotification).toHaveBeenCalledTimes(1);

    const second = await runDailySummaryJob(repo, NOW);
    expect(second.notificationsSent).toBe(0);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("対象0件なら送らないが、lastSentLocalDateは更新される(2回目実行も0件)", async () => {
    await repo.createChore(householdId, {
      name: "最近やった家事",
      description: null,
      categoryId: null,
      areaId: null,
      resourceId: null,
      scheduleType: "interval",
      intervalDays: 30,
      warningDays: 7,
      graceDays: 7,
      isActive: true,
      createdBy: memberId,
      lastCompletedAt: NOW,
    });

    const first = await runDailySummaryJob(repo, NOW);
    expect(first.notificationsSent).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();

    const settings = await repo.getNotificationSettings(householdId, memberId);
    expect(settings?.lastSentLocalDate).toBe("2026-01-15");

    const second = await runDailySummaryJob(repo, NOW);
    expect(second.notificationsSent).toBe(0);
  });

  it("無効化した家事・取消済み履歴は対象外", async () => {
    const chore = await repo.createChore(householdId, {
      name: "無効化家事",
      description: null,
      categoryId: null,
      areaId: null,
      resourceId: null,
      scheduleType: "interval",
      intervalDays: 1,
      warningDays: 0,
      graceDays: 1,
      isActive: false,
      createdBy: memberId,
    });
    expect(chore.isActive).toBe(false);

    const result = await runDailySummaryJob(repo, NOW);
    expect(result.notificationsSent).toBe(0);
  });

  it("404/410応答の購読は削除する", async () => {
    await repo.createChore(householdId, {
      name: "優先度高い家事2",
      description: null,
      categoryId: null,
      areaId: null,
      resourceId: null,
      scheduleType: "interval",
      intervalDays: 3,
      warningDays: 1,
      graceDays: 1,
      isActive: true,
      createdBy: memberId,
      lastCompletedAt: new Date("2025-12-01T00:00:00Z"),
    });
    sendNotification.mockRejectedValueOnce(
      Object.assign(new Error("gone"), { statusCode: 410 }),
    );

    const result = await runDailySummaryJob(repo, NOW);
    expect(result.subscriptionsRemoved).toBe(1);
    const remaining = await repo.listPushSubscriptionsForMember(householdId, memberId);
    expect(remaining).toHaveLength(0);
  });
});
