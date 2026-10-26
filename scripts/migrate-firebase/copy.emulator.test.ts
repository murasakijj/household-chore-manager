import { beforeAll, describe, expect, it } from "vitest";
import {
  deleteApp,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import {
  getFirestore,
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";
import { APP_COLLECTIONS, copyUserData, MigrationAbort } from "./copy.js";

/**
 * 移行コアのテスト。同一エミュレータ内で2つの projectId を使って旧・新を模擬する。
 * `npm run test:emulator` で実行(FIRESTORE_EMULATOR_HOST 必須)。
 */

let oldApp: App;
let newApp: App;
let oldDb: Firestore;
let newDb: Firestore;
let n = 0;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      "FIRESTORE_EMULATOR_HOST is not set. Run this via `npm run test:emulator`.",
    );
  }
  oldApp = initializeApp({ projectId: "demo-migrate-old" }, "migrate-old");
  newApp = initializeApp({ projectId: "demo-migrate-new" }, "migrate-new");
  oldDb = getFirestore(oldApp);
  newDb = getFirestore(newApp);
  return async () => {
    await Promise.all(
      getApps()
        .filter((a) => a.name.startsWith("migrate-"))
        .map(deleteApp),
    );
  };
});

/** テスト間で衝突しないよう uid を毎回変える。 */
function uids() {
  n++;
  return { srcUid: `old-uid-${n}`, dstUid: `new-uid-${n}` };
}

const ts = Timestamp.fromDate(new Date("2026-01-02T03:04:05Z"));

async function seedFridge(srcUid: string, count: number) {
  const user = oldDb.collection("users").doc(srcUid);
  await user.set({ marker: true });
  let batch = oldDb.batch();
  for (let i = 0; i < count; i++) {
    batch.set(user.collection("foodItems").doc(`f${i}`), {
      name: `n${i}`,
      created_at: ts,
      nested: { a: [1, 2] },
    });
    if ((i + 1) % 400 === 0) {
      await batch.commit();
      batch = oldDb.batch();
    }
  }
  await batch.commit();
  await user
    .collection("inventoryEvents")
    .doc("e1")
    .set({ quantity_delta: 1, occurred_at: ts });
  await user
    .collection("recipes")
    .doc("should-not-copy")
    .set({ title: "other app" });
  await oldDb.collection("households").doc("h-old").set({ x: 1 }); // 無関係なトップレベル
}

describe("copyUserData", () => {
  it("旧uid→新uidへ対象コレクションだけコピーし件数が一致する(型保持・再帰・対象外は無視)", async () => {
    const { srcUid, dstUid } = uids();
    await seedFridge(srcUid, 1201); // 500件バッチを複数回またぐ
    await oldDb
      .collection("users")
      .doc(srcUid)
      .collection("foodItems")
      .doc("f0")
      .collection("sub")
      .doc("s1")
      .set({ deep: true });
    const logs: string[] = [];

    const report = await copyUserData({
      srcDb: oldDb,
      dstDb: newDb,
      srcUid,
      dstUid,
      collections: APP_COLLECTIONS["fridge-track"],
      execute: true,
      overwrite: false,
      log: (l) => logs.push(l),
    });

    expect(report.srcCounts.foodItems).toBe(1202);
    expect(report.dstCounts).toEqual(report.srcCounts);
    const copied = await newDb
      .collection("users")
      .doc(dstUid)
      .collection("foodItems")
      .doc("f7")
      .get();
    expect(copied.data()?.created_at).toBeInstanceOf(Timestamp);
    expect((copied.data()?.created_at as Timestamp).isEqual(ts)).toBe(true);
    expect((await newDb.doc(`users/${dstUid}`).get()).data()).toEqual({
      marker: true,
    });
    expect(
      (await newDb.doc(`users/${dstUid}/foodItems/f0/sub/s1`).get()).exists,
    ).toBe(true);
    // 対象外(recipe-buddy のコレクション・無関係なトップレベル)はコピーされない。
    expect((await newDb.collection(`users/${dstUid}/recipes`).get()).size).toBe(
      0,
    );
    expect((await newDb.doc("households/h-old").get()).exists).toBe(false);
    // 旧側は変更されない。
    expect(
      (await oldDb.collection(`users/${srcUid}/foodItems`).get()).size,
    ).toBe(1201);
    // ログに本文を出さない。
    expect(logs.join("\n")).not.toMatch(/n7|other app/);
  });

  it("dry-run(既定)では書き込まない", async () => {
    const { srcUid, dstUid } = uids();
    await seedFridge(srcUid, 3);
    const report = await copyUserData({
      srcDb: oldDb,
      dstDb: newDb,
      srcUid,
      dstUid,
      collections: APP_COLLECTIONS["fridge-track"],
      execute: false,
      overwrite: false,
    });
    expect(report.executed).toBe(false);
    expect(report.srcCounts.foodItems).toBe(3);
    expect(
      (await newDb.collection(`users/${dstUid}/foodItems`).get()).size,
    ).toBe(0);
    expect((await newDb.doc(`users/${dstUid}`).get()).exists).toBe(false);
  });

  it("再実行(--overwrite)しても重複せず件数は変わらない", async () => {
    const { srcUid, dstUid } = uids();
    await seedFridge(srcUid, 5);
    const base = {
      srcDb: oldDb,
      dstDb: newDb,
      srcUid,
      dstUid,
      collections: APP_COLLECTIONS["fridge-track"],
      execute: true,
    };
    await copyUserData({ ...base, overwrite: false });
    const again = await copyUserData({ ...base, overwrite: true });
    expect(again.dstCounts).toEqual(again.srcCounts);
    expect(
      (await newDb.collection(`users/${dstUid}/foodItems`).get()).size,
    ).toBe(5);
  });

  it("コピー先に既存データがあり --overwrite 無しなら中断し、何も書かない", async () => {
    const { srcUid, dstUid } = uids();
    await seedFridge(srcUid, 3);
    await newDb.doc(`users/${dstUid}/foodItems/existing`).set({ name: "keep" });
    await expect(
      copyUserData({
        srcDb: oldDb,
        dstDb: newDb,
        srcUid,
        dstUid,
        collections: APP_COLLECTIONS["fridge-track"],
        execute: true,
        overwrite: false,
      }),
    ).rejects.toBeInstanceOf(MigrationAbort);
    expect(
      (await newDb.collection(`users/${dstUid}/foodItems`).get()).size,
    ).toBe(1);
  });

  it("アプリ指定で他アプリのコレクションは対象にならない(recipe-buddy)", async () => {
    const { srcUid, dstUid } = uids();
    await seedFridge(srcUid, 2);
    const report = await copyUserData({
      srcDb: oldDb,
      dstDb: newDb,
      srcUid,
      dstUid,
      collections: APP_COLLECTIONS["recipe-buddy"],
      execute: true,
      overwrite: false,
    });
    expect(report.dstCounts).toEqual({ recipes: 1, techniques: 0 });
    expect(
      (await newDb.collection(`users/${dstUid}/foodItems`).get()).size,
    ).toBe(0);
  });

  it("無料枠を超える見込みなら中断し、書き込まない", async () => {
    const { srcUid, dstUid } = uids();
    await seedFridge(srcUid, 10);
    await expect(
      copyUserData({
        srcDb: oldDb,
        dstDb: newDb,
        srcUid,
        dstUid,
        collections: APP_COLLECTIONS["fridge-track"],
        execute: true,
        overwrite: false,
        freeTier: { reads: 1000, writes: 5 },
      }),
    ).rejects.toThrow(/free tier/);
    expect(
      (await newDb.collection(`users/${dstUid}/foodItems`).get()).size,
    ).toBe(0);
  });
});
