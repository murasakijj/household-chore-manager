/**
 * 旧 Firebase プロジェクト → 共有プロジェクトへのデータコピー(コア処理)。
 * 旧 `users/{旧uid}` 配下の対象アプリのコレクションだけを、新 `users/{新uid}` 配下へ
 * 同じドキュメントIDで再帰コピーする。ログに出すのは件数とコレクション名のみ。
 * 詳細は docs/firebase-consolidation.md §2.3。
 */
import type {
  DocumentReference,
  DocumentSnapshot,
  Firestore,
} from "firebase-admin/firestore";

/** 移行対象アプリ → `users/{uid}` 直下のコレクション名(計画書 §1)。 */
export const APP_COLLECTIONS = {
  "recipe-buddy": ["recipes", "techniques"],
  "fridge-track": [
    "foodItems",
    "inventoryLots",
    "inventoryEvents",
    "receipts",
    "receiptItems",
    "receiptFoodMappings",
    "consumptionProfiles",
    "recipeConsumptions",
  ],
} as const satisfies Record<string, readonly string[]>;

export type MigrationApp = keyof typeof APP_COLLECTIONS;

/** Spark プランの1日あたり無料枠。 */
export const FREE_TIER = { reads: 50_000, writes: 20_000 } as const;
export const BATCH_SIZE = 500;

export interface CopyOptions {
  srcDb: Firestore;
  dstDb: Firestore;
  srcUid: string;
  dstUid: string;
  collections: readonly string[];
  /** false(既定の dry-run)なら書き込まない。 */
  execute: boolean;
  /** コピー先に既存データがあっても続行する。 */
  overwrite: boolean;
  /** 無料枠の上限(テスト用に差し替え可能)。 */
  freeTier?: { reads: number; writes: number };
  log?: (line: string) => void;
}

export interface CopyReport {
  executed: boolean;
  /** コレクション名 → 再帰ドキュメント数(コピー元)。 */
  srcCounts: Record<string, number>;
  /** コレクション名 → コピー先の既存ドキュメント数(コピー前)。 */
  dstExistingCounts: Record<string, number>;
  /** 実行後のコピー先の件数(execute 時のみ)。 */
  dstCounts?: Record<string, number>;
  copyUserDoc: boolean;
  estimate: { srcReads: number; dstReads: number; dstWrites: number };
}

export class MigrationAbort extends Error {}

const CHUNK = 100;

/** コレクション配下を再帰的に列挙する(サブコレクション含む)。 */
async function walk(
  db: Firestore,
  col: FirebaseFirestore.CollectionReference,
  visit: (snap: DocumentSnapshot) => void,
): Promise<void> {
  // listDocuments は子コレクションだけを持つ「欠けた親」も返すので取りこぼさない。
  const refs = await col.listDocuments();
  for (let i = 0; i < refs.length; i += CHUNK) {
    const chunk = refs.slice(i, i + CHUNK);
    const snaps = await db.getAll(...chunk);
    for (const snap of snaps) if (snap.exists) visit(snap);
    const subs = await Promise.all(chunk.map((r) => r.listCollections()));
    for (const list of subs) for (const sub of list) await walk(db, sub, visit);
  }
}

async function scan(
  db: Firestore,
  uid: string,
  collections: readonly string[],
) {
  const userRef = db.collection("users").doc(uid);
  const snaps: DocumentSnapshot[] = [];
  const counts: Record<string, number> = {};
  for (const name of collections) {
    counts[name] = 0;
    await walk(db, userRef.collection(name), (s) => {
      snaps.push(s);
      counts[name]++;
    });
  }
  const userSnap = await userRef.get();
  return { snaps, counts, userSnap };
}

export function sum(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

function mapRef(
  dstDb: Firestore,
  srcPath: string,
  srcUid: string,
  dstUid: string,
): DocumentReference {
  const prefix = `users/${srcUid}`;
  if (srcPath !== prefix && !srcPath.startsWith(`${prefix}/`)) {
    throw new Error("unexpected source path");
  }
  return dstDb.doc(`users/${dstUid}${srcPath.slice(prefix.length)}`);
}

export async function copyUserData(opts: CopyOptions): Promise<CopyReport> {
  const { srcDb, dstDb, srcUid, dstUid, collections, execute, overwrite } =
    opts;
  const log = opts.log ?? (() => {});
  const tier = opts.freeTier ?? FREE_TIER;

  const src = await scan(srcDb, srcUid, collections);
  const dst = await scan(dstDb, dstUid, collections);
  const copyUserDoc = src.userSnap.exists;
  const dstUserExists = dst.userSnap.exists;

  const srcTotal = sum(src.counts) + (copyUserDoc ? 1 : 0);
  const dstExisting = sum(dst.counts) + (copyUserDoc && dstUserExists ? 1 : 0);

  for (const name of collections) {
    log(
      `[scan] ${name}: source ${src.counts[name]} / destination existing ${dst.counts[name]}`,
    );
  }
  log(`[scan] users doc: ${copyUserDoc ? "present (will copy)" : "absent"}`);

  // 無料枠見積もり(プロジェクトごと・1日)。コピー元は走査分、コピー先は事前走査+事後検証。
  const estimate = {
    srcReads: srcTotal + collections.length * 2,
    dstReads: 2 * dstExisting + srcTotal + 2,
    dstWrites: srcTotal,
  };
  log(
    `[estimate] source reads ~${estimate.srcReads} / destination reads ~${estimate.dstReads}, writes ~${estimate.dstWrites} ` +
      `(daily free tier: reads ${tier.reads}, writes ${tier.writes})`,
  );
  if (
    estimate.srcReads > tier.reads ||
    estimate.dstReads > tier.reads ||
    estimate.dstWrites > tier.writes
  ) {
    throw new MigrationAbort(
      "Estimated usage exceeds the daily free tier. Split the run per collection across days " +
        "(or temporarily enable billing).",
    );
  }

  const report: CopyReport = {
    executed: false,
    srcCounts: src.counts,
    dstExistingCounts: dst.counts,
    copyUserDoc,
    estimate,
  };

  if (dstExisting > 0 && !overwrite) {
    throw new MigrationAbort(
      `Destination already has ${dstExisting} document(s) in the target collections. ` +
        "Re-run with --overwrite to continue (existing documents with the same IDs are replaced).",
    );
  }
  if (!execute) {
    log("[dry-run] nothing written. Re-run with --execute to copy.");
    return report;
  }

  // 書き込み(500件ずつ。同一IDへの set なので再実行しても重複しない)。
  const writes: Array<{ ref: DocumentReference; snap: DocumentSnapshot }> = [];
  if (copyUserDoc)
    writes.push({
      ref: mapRef(dstDb, src.userSnap.ref.path, srcUid, dstUid),
      snap: src.userSnap,
    });
  for (const snap of src.snaps) {
    writes.push({ ref: mapRef(dstDb, snap.ref.path, srcUid, dstUid), snap });
  }
  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const batch = dstDb.batch();
    for (const { ref, snap } of writes.slice(i, i + BATCH_SIZE)) {
      batch.set(ref, snap.data()!);
    }
    await batch.commit();
    log(
      `[write] ${Math.min(i + BATCH_SIZE, writes.length)} / ${writes.length}`,
    );
  }

  // 検証: コレクションごとに旧・新の件数を比較。
  const after = await scan(dstDb, dstUid, collections);
  report.executed = true;
  report.dstCounts = after.counts;
  let ok = true;
  for (const name of collections) {
    const match = src.counts[name] === after.counts[name];
    if (!match) ok = false;
    log(
      `[verify] ${name}: source ${src.counts[name]} / destination ${after.counts[name]} ${match ? "OK" : "MISMATCH"}`,
    );
  }
  if (!ok)
    throw new MigrationAbort(
      "Count mismatch after copy. Investigate before switching the app over.",
    );
  return report;
}
