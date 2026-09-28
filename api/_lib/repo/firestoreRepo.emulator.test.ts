import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getApps, initializeApp } from "firebase-admin/app";

/**
 * Firestore エミュレータに実接続する結合テスト(レビュー指摘の追加項目)。
 * `npm test` には含まれない。`npm run test:emulator` で
 * `firebase emulators:exec` 経由(`FIRESTORE_EMULATOR_HOST` 環境変数つき)で実行する。
 * firebase-admin はエミュレータ接続時、サービスアカウント無しで動作する。
 */

const PROJECT_ID = "demo-household-chore-manager";

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      "FIRESTORE_EMULATOR_HOST is not set. Run this via `npm run test:emulator`.",
    );
  }
  if (getApps().length === 0) {
    initializeApp({ projectId: PROJECT_ID });
  }
});

const { FirestoreRepo } = await import("./firestoreRepo.js");

describe("FirestoreRepo(Firestoreエミュレータ)", () => {
  it("イベント追加・取消でlastCompletedAtが正しく再計算される(read-after-writeを起こさない)", async () => {
    const repo = new FirestoreRepo();
    const membership = await repo.bootstrapHouseholdForUser({
      uid: `emu-uid-${randomUUID()}`,
      email: `emu-${randomUUID()}@example.com`,
    });
    const { householdId, memberId } = membership;

    const area = await repo.createArea(householdId, { name: "テスト場所", sortOrder: 0 });
    const chore = await repo.createChore(householdId, {
      name: "テスト家事",
      description: null,
      categoryId: null,
      areaId: area.id,
      resourceId: null,
      scheduleType: "interval",
      intervalDays: 7,
      warningDays: 2,
      graceDays: 3,
      isActive: true,
      createdBy: memberId,
    });
    expect(chore.lastCompletedAt).toBeNull();

    const t1 = new Date("2026-01-01T00:00:00Z");
    const first = await repo.addChoreEvent({
      householdId,
      choreId: chore.id,
      clientRequestId: randomUUID(),
      occurredAt: t1,
      actorMemberId: memberId,
      recordedByMemberId: memberId,
      note: null,
    });
    expect(first.possibleDuplicate).toBe(false);
    expect(first.chore.lastCompletedAt?.toISOString()).toBe(t1.toISOString());

    // 5分後(10分以内)の再記録 → possibleDuplicate=true, lastCompletedAtは新しい方に更新される。
    const t2 = new Date(t1.getTime() + 5 * 60 * 1000);
    const second = await repo.addChoreEvent({
      householdId,
      choreId: chore.id,
      clientRequestId: randomUUID(),
      occurredAt: t2,
      actorMemberId: memberId,
      recordedByMemberId: memberId,
      note: null,
    });
    expect(second.possibleDuplicate).toBe(true);
    expect(second.chore.lastCompletedAt?.toISOString()).toBe(t2.toISOString());

    // 直近(t2)のイベントを取消 → 1つ前(t1)に戻る。
    const voided = await repo.voidChoreEvent({
      householdId,
      eventId: second.event.id,
      voidedByMemberId: memberId,
      voidReason: null,
    });
    expect(voided.chore.lastCompletedAt?.toISOString()).toBe(t1.toISOString());

    // includeVoided=false では1件、true では2件。
    const activeOnly = await repo.listChoreEventsForChore(householdId, chore.id, {
      includeVoided: false,
    });
    expect(activeOnly.items).toHaveLength(1);
    const withVoided = await repo.listChoreEventsForChore(householdId, chore.id, {
      includeVoided: true,
    });
    expect(withVoided.items).toHaveLength(2);

    // areaId絞り込み(in クエリ経由)で正しくヒットする。
    const byArea = await repo.listChoreEvents(householdId, { areaId: area.id });
    expect(byArea.items.map((e) => e.id)).toContain(first.event.id);

    // actorMemberId絞り込み。
    const byActor = await repo.listChoreEvents(householdId, {
      actorMemberId: memberId,
    });
    expect(byActor.items.length).toBeGreaterThanOrEqual(1);
  });

  it("同一clientRequestIdの再送は冪等、他家事への転用は409相当のRepoConflictError", async () => {
    const { RepoConflictError } = await import("./errors.js");
    const repo = new FirestoreRepo();
    const membership = await repo.bootstrapHouseholdForUser({
      uid: `emu-uid-${randomUUID()}`,
      email: `emu-${randomUUID()}@example.com`,
    });
    const { householdId, memberId } = membership;

    const choreA = await repo.createChore(householdId, {
      name: "家事A",
      description: null,
      categoryId: null,
      areaId: null,
      resourceId: null,
      scheduleType: "interval",
      intervalDays: 5,
      warningDays: 1,
      graceDays: 1,
      isActive: true,
      createdBy: memberId,
    });
    const choreB = await repo.createChore(householdId, {
      name: "家事B",
      description: null,
      categoryId: null,
      areaId: null,
      resourceId: null,
      scheduleType: "interval",
      intervalDays: 5,
      warningDays: 1,
      graceDays: 1,
      isActive: true,
      createdBy: memberId,
    });

    const clientRequestId = randomUUID();
    const first = await repo.addChoreEvent({
      householdId,
      choreId: choreA.id,
      clientRequestId,
      occurredAt: new Date(),
      actorMemberId: memberId,
      recordedByMemberId: memberId,
      note: null,
    });
    expect(first.idempotentReplay).toBe(false);

    const replay = await repo.addChoreEvent({
      householdId,
      choreId: choreA.id,
      clientRequestId,
      occurredAt: new Date(),
      actorMemberId: memberId,
      recordedByMemberId: memberId,
      note: null,
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.event.id).toBe(first.event.id);

    await expect(
      repo.addChoreEvent({
        householdId,
        choreId: choreB.id,
        clientRequestId,
        occurredAt: new Date(),
        actorMemberId: memberId,
        recordedByMemberId: memberId,
        note: null,
      }),
    ).rejects.toBeInstanceOf(RepoConflictError);
  });

  it("一括登録(createChoresBulk)は家事と初回イベントを1回のbatchで作成する", async () => {
    const repo = new FirestoreRepo();
    const membership = await repo.bootstrapHouseholdForUser({
      uid: `emu-uid-${randomUUID()}`,
      email: `emu-${randomUUID()}@example.com`,
    });
    const { householdId, memberId } = membership;

    const occurredAt = new Date("2026-02-01T00:00:00Z");
    const created = await repo.createChoresBulk(householdId, [
      {
        name: "一括1",
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
        lastCompletedAt: occurredAt,
      },
      {
        name: "一括2",
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
      },
    ]);

    expect(created).toHaveLength(2);
    expect(created[0].lastCompletedAt?.toISOString()).toBe(occurredAt.toISOString());
    expect(created[1].lastCompletedAt).toBeNull();

    const events1 = await repo.listChoreEventsForChore(householdId, created[0].id, {});
    expect(events1.items).toHaveLength(1);
    const events2 = await repo.listChoreEventsForChore(householdId, created[1].id, {});
    expect(events2.items).toHaveLength(0);
  });

  it("Web Push購読の登録・一覧・削除(バッチ3)", async () => {
    const repo = new FirestoreRepo();
    const membership = await repo.bootstrapHouseholdForUser({
      uid: `emu-uid-${randomUUID()}`,
      email: `emu-${randomUUID()}@example.com`,
    });
    const { householdId, memberId } = membership;

    await repo.upsertPushSubscription(householdId, memberId, {
      endpoint: "https://push.example.com/emu-1",
      keys: { p256dh: "p256dh-value", auth: "auth-value" },
    });
    const list = await repo.listPushSubscriptionsForMember(householdId, memberId);
    expect(list).toHaveLength(1);
    expect(list[0].endpoint).toBe("https://push.example.com/emu-1");

    await repo.deletePushSubscriptionByEndpoint(
      householdId,
      memberId,
      "https://push.example.com/emu-1",
    );
    const afterDelete = await repo.listPushSubscriptionsForMember(householdId, memberId);
    expect(afterDelete).toHaveLength(0);
  });

  it("claimDailySummarySlotは同じlocalDateで一度しか確保できない(二重起動対策)", async () => {
    const repo = new FirestoreRepo();
    const membership = await repo.bootstrapHouseholdForUser({
      uid: `emu-uid-${randomUUID()}`,
      email: `emu-${randomUUID()}@example.com`,
    });
    const { householdId, memberId } = membership;

    const first = await repo.claimDailySummarySlot(householdId, memberId, "2026-03-01");
    expect(first).toBe(true);
    const second = await repo.claimDailySummarySlot(householdId, memberId, "2026-03-01");
    expect(second).toBe(false);
    const nextDay = await repo.claimDailySummarySlot(householdId, memberId, "2026-03-02");
    expect(nextDay).toBe(true);

    const settings = await repo.getNotificationSettings(householdId, memberId);
    expect(settings?.lastSentLocalDate).toBe("2026-03-02");
  });

  it("listHouseholds/listActiveMembersWithNotificationSettingsが動く", async () => {
    const repo = new FirestoreRepo();
    const membership = await repo.bootstrapHouseholdForUser({
      uid: `emu-uid-${randomUUID()}`,
      email: `emu-${randomUUID()}@example.com`,
    });
    const { householdId, memberId } = membership;

    const households = await repo.listHouseholds();
    expect(households.some((h) => h.id === householdId)).toBe(true);

    const entries = await repo.listActiveMembersWithNotificationSettings(householdId);
    expect(entries.some((e) => e.member.id === memberId)).toBe(true);
    const entry = entries.find((e) => e.member.id === memberId);
    expect(entry?.settings.dailySummaryEnabled).toBe(true);
  });
});
