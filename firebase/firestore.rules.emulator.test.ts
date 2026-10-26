import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { renderRules } from "../scripts/lib/rules.js";

/**
 * 統合 Firestore ルール(firebase/firestore.rules)のテスト。`npm run test:emulator` で実行。
 * 観点: docs/firebase-consolidation.md §2.2。
 */

const ME = "me@example.test";
const UID = "uid-me";
const OTHER_UID = "uid-other";

let env: RulesTestEnvironment;

beforeAll(async () => {
  const rules = renderRules(readFileSync("firebase/firestore.rules", "utf8"), [
    ME,
  ]);
  env = await initializeTestEnvironment({
    projectId: "demo-rules-test",
    firestore: { rules },
  });
});
afterAll(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
});

type Claims = {
  email?: string;
  email_verified?: boolean;
  provider?: "google.com" | "password";
};
function ctx(uid: string, c: Claims = {}) {
  return env
    .authenticatedContext(uid, {
      email: c.email ?? ME,
      email_verified: c.email_verified ?? true,
      firebase: {
        sign_in_provider: c.provider ?? "google.com",
        identities: {},
      },
    })
    .firestore();
}
const me = () => ctx(UID);
const now = () => Timestamp.now();

const foodItem = () => ({
  name: "にんじん",
  base_unit: "g",
  created_at: now(),
  updated_at: now(),
});
const lot = () => ({
  food_item_id: "f1",
  purchased_at: now(),
  created_at: now(),
  updated_at: now(),
});
const event = (over: Record<string, unknown> = {}) => ({
  inventory_lot_id: "l1",
  food_item_id: "f1",
  event_type: "PURCHASE",
  quantity_delta: 100,
  source_type: "MANUAL",
  source_id: null,
  occurred_at: now(),
  created_at: now(),
  ...over,
});

async function seed(path: string, data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), path), data);
  });
}

describe("fridge-track", () => {
  it("本人は foodItems を作成でき、読める", async () => {
    await assertSucceeds(
      setDoc(doc(me(), `users/${UID}/foodItems/f1`), foodItem()),
    );
    await assertSucceeds(getDoc(doc(me(), `users/${UID}/foodItems/f1`)));
  });

  it("foodItems: 余計なフィールド・不正カテゴリは拒否、base_unit 変更・delete は拒否", async () => {
    const d = doc(me(), `users/${UID}/foodItems/f1`);
    await assertFails(setDoc(d, { ...foodItem(), extra: 1 }));
    await assertFails(setDoc(d, { ...foodItem(), category: "bogus" }));
    await assertSucceeds(setDoc(d, { ...foodItem(), category: "vegetable" }));
    await assertFails(updateDoc(d, { base_unit: "ml", updated_at: now() }));
    await assertSucceeds(updateDoc(d, { name: "玉ねぎ", updated_at: now() }));
    await assertFails(deleteDoc(d));
  });

  it("inventoryEvents は追記専用(update / delete 禁止)で符号が検証される", async () => {
    const d = doc(me(), `users/${UID}/inventoryEvents/e1`);
    await assertSucceeds(setDoc(d, event()));
    await assertFails(updateDoc(d, { note: "x" }));
    await assertFails(deleteDoc(d));
    const e2 = doc(me(), `users/${UID}/inventoryEvents/e2`);
    await assertFails(
      setDoc(e2, event({ event_type: "CONSUME", quantity_delta: 5 })),
    );
    await assertFails(
      setDoc(e2, event({ event_type: "PURCHASE", quantity_delta: -5 })),
    );
    await assertFails(setDoc(e2, event({ extra: true })));
    await assertSucceeds(
      setDoc(e2, event({ event_type: "CONSUME", quantity_delta: -5 })),
    );
  });

  it("foodItems: created_at の変更は拒否される", async () => {
    const d = doc(me(), `users/${UID}/foodItems/f1`);
    await assertSucceeds(setDoc(d, foodItem()));
    await assertFails(
      updateDoc(d, {
        created_at: Timestamp.fromMillis(1_000),
        updated_at: now(),
      }),
    );
  });

  it("inventoryEvents: ADJUST は数量 0 を拒否、非 0 は許可", async () => {
    const e = (id: string) => doc(me(), `users/${UID}/inventoryEvents/${id}`);
    await assertFails(
      setDoc(e("a0"), event({ event_type: "ADJUST", quantity_delta: 0 })),
    );
    await assertSucceeds(
      setDoc(e("a1"), event({ event_type: "ADJUST", quantity_delta: -3 })),
    );
  });

  it("receipts / receiptItems は create のみ、制約違反は拒否", async () => {
    const r = doc(me(), `users/${UID}/receipts/r1`);
    const receipt = {
      image_reference: null,
      purchased_at: now(),
      created_at: now(),
    };
    await assertFails(setDoc(r, { ...receipt, extra: 1 }));
    await assertFails(setDoc(r, { ...receipt, purchased_at: "2026-01-01" }));
    await assertSucceeds(setDoc(r, receipt));
    await assertFails(updateDoc(r, { image_reference: "x" }));
    await assertFails(deleteDoc(r));

    const i = doc(me(), `users/${UID}/receiptItems/i1`);
    const item = {
      receipt_id: "r1",
      raw_name: "にんじん",
      food_item_id: null,
      quantity: 2,
      unit: "個",
      confirmed: false,
      ai_quantity: 2,
      ai_unit: "個",
    };
    await assertFails(setDoc(i, { ...item, quantity: -1 }));
    await assertFails(setDoc(i, { ...item, confirmed: "no" }));
    await assertFails(setDoc(i, { ...item, extra: 1 }));
    await assertSucceeds(setDoc(i, item));
    await assertFails(updateDoc(i, { confirmed: true }));
    await assertFails(deleteDoc(i));
  });

  it("receiptFoodMappings は upsert 可・delete 不可、制約違反は拒否", async () => {
    const m = doc(me(), `users/${UID}/receiptFoodMappings/m1`);
    const mapping = {
      raw_name: "ﾆﾝｼﾞﾝ",
      food_item_id: "f1",
      created_at: now(),
      updated_at: now(),
    };
    await assertFails(setDoc(m, { ...mapping, extra: 1 }));
    await assertFails(setDoc(m, { ...mapping, food_item_id: null }));
    await assertSucceeds(setDoc(m, mapping));
    await assertSucceeds(updateDoc(m, { updated_at: now() }));
    await assertFails(deleteDoc(m));
  });

  it("inventoryLots は create のみ、recipeConsumptions はクライアント書き込み不可", async () => {
    const l = doc(me(), `users/${UID}/inventoryLots/l1`);
    await assertSucceeds(setDoc(l, lot()));
    await assertFails(updateDoc(l, { updated_at: now() }));
    await assertFails(deleteDoc(l));
    await assertFails(
      setDoc(doc(me(), `users/${UID}/recipeConsumptions/r1`), { a: 1 }),
    );
    await seed(`users/${UID}/recipeConsumptions/r2`, { a: 1 });
    await assertSucceeds(
      getDoc(doc(me(), `users/${UID}/recipeConsumptions/r2`)),
    );
  });

  it("consumptionProfiles は本人が自由に読み書きできる", async () => {
    const d = doc(me(), `users/${UID}/consumptionProfiles/f1`);
    await assertSucceeds(setDoc(d, { anything: 1 }));
    await assertSucceeds(deleteDoc(d));
  });
});

describe("recipe-buddy", () => {
  it("本人は recipes / techniques(サブコレクション含む)を読み書き・削除できる", async () => {
    for (const col of ["recipes", "techniques"]) {
      const d = doc(me(), `users/${UID}/${col}/x1`);
      await assertSucceeds(setDoc(d, { title: "t", anything: [1, 2] }));
      await assertSucceeds(getDoc(d));
      await assertSucceeds(updateDoc(d, { title: "u" }));
      await assertSucceeds(
        setDoc(doc(me(), `users/${UID}/${col}/x1/sub/s1`), { a: 1 }),
      );
      await assertSucceeds(deleteDoc(d));
    }
  });

  it("fridge-track のコレクションには書けない(ワイルドカード許可が無い)", async () => {
    for (const col of [
      "foodItems",
      "inventoryLots",
      "inventoryEvents",
      "receipts",
      "receiptItems",
      "receiptFoodMappings",
      "recipeConsumptions",
    ]) {
      // 制約を満たさない任意データは、どのコレクションでも拒否される。
      await assertFails(
        setDoc(doc(me(), `users/${UID}/${col}/free`), { title: "recipe-like" }),
      );
    }
    // 既存イベントの改ざん・削除も拒否される。
    await seed(`users/${UID}/inventoryEvents/e1`, event());
    await assertFails(
      updateDoc(doc(me(), `users/${UID}/inventoryEvents/e1`), {
        quantity_delta: 1,
      }),
    );
    await assertFails(deleteDoc(doc(me(), `users/${UID}/inventoryEvents/e1`)));
  });

  it("未知のコレクション・users/{uid} ドキュメント自体は拒否", async () => {
    await assertFails(setDoc(doc(me(), `users/${UID}/unknown/x`), { a: 1 }));
    await assertFails(setDoc(doc(me(), `users/${UID}`), { a: 1 }));
    await assertFails(getDoc(doc(me(), `users/${UID}`)));
  });
});

describe("household-chore-manager のコレクション", () => {
  it("userMemberships / households はクライアントから読めない・書けない", async () => {
    await seed(`userMemberships/${UID}`, { householdId: "h1" });
    await seed("households/h1", { name: "家" });
    await seed("households/h1/chores/c1", { name: "掃除" });
    await assertFails(getDoc(doc(me(), `userMemberships/${UID}`)));
    await assertFails(getDoc(doc(me(), "households/h1")));
    await assertFails(getDoc(doc(me(), "households/h1/chores/c1")));
    await assertFails(
      setDoc(doc(me(), `userMemberships/${UID}`), { householdId: "h2" }),
    );
    await assertFails(
      setDoc(doc(me(), "households/h1/chores/c2"), { name: "x" }),
    );
    await assertFails(deleteDoc(doc(me(), "households/h1")));
  });
});

describe("本人判定", () => {
  const path = `users/${UID}/recipes/r1`;

  it("他人の uid 配下は読み書き不可", async () => {
    await seed(`users/${OTHER_UID}/recipes/r1`, { a: 1 });
    await assertFails(getDoc(doc(me(), `users/${OTHER_UID}/recipes/r1`)));
    await assertFails(
      setDoc(doc(me(), `users/${OTHER_UID}/recipes/r2`), { a: 1 }),
    );
    await assertFails(
      setDoc(doc(me(), `users/${OTHER_UID}/foodItems/f1`), foodItem()),
    );
  });

  it("未ログインは拒否", async () => {
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, path)));
    await assertFails(setDoc(doc(anon, path), { a: 1 }));
    await assertFails(
      setDoc(doc(anon, `users/${UID}/foodItems/f1`), foodItem()),
    );
  });

  it("許可メール以外は拒否", async () => {
    const stranger = ctx(UID, { email: "stranger@example.test" });
    await assertFails(setDoc(doc(stranger, path), { a: 1 }));
    await assertFails(
      setDoc(doc(stranger, `users/${UID}/foodItems/f1`), foodItem()),
    );
  });

  it("email 未検証は拒否", async () => {
    const unverified = ctx(UID, { email_verified: false });
    await assertFails(setDoc(doc(unverified, path), { a: 1 }));
    await assertFails(
      setDoc(doc(unverified, `users/${UID}/foodItems/f1`), foodItem()),
    );
  });

  it("Google 以外のサインインプロバイダは拒否", async () => {
    const pw = ctx(UID, { provider: "password" });
    await assertFails(setDoc(doc(pw, path), { a: 1 }));
  });

  it("ルール外のパスは全拒否", async () => {
    await assertFails(setDoc(doc(me(), "other/x"), { a: 1 }));
    await assertFails(getDoc(doc(me(), "other/x")));
  });
});
