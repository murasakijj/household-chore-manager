/**
 * 使い方は README.md。例:
 *   npm run migrate:firebase -- --app recipe-buddy --email me@example.com --old-service-account C:\keys\old-sa.json --new-service-account C:\keys\new-sa.json [--collections a,b] [--execute] [--overwrite]
 * パス先頭の `~` はホームディレクトリに展開する。
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import {
  APP_COLLECTIONS,
  copyUserData,
  MigrationAbort,
  type MigrationApp,
} from "./copy.js";
import { parseArgs } from "./args.js";
import { loadServiceAccounts } from "./serviceAccount.js";

async function resolveUid(
  auth: ReturnType<typeof getAuth>,
  email: string,
  label: string,
): Promise<string> {
  try {
    return (await auth.getUserByEmail(email)).uid;
  } catch (e) {
    if ((e as { code?: string }).code === "auth/user-not-found") {
      if (label === "new") {
        throw new MigrationAbort(
          "The user does not exist in the shared project. Sign in once to the new app (e.g. household-chore-manager) and re-run.",
        );
      }
      throw new MigrationAbort("The user does not exist in the old project.");
    }
    throw e;
  }
}

async function main() {
  const { v, execute, overwrite } = parseArgs(process.argv.slice(2));
  const app = v["--app"] as MigrationApp;
  if (!(app in APP_COLLECTIONS)) {
    throw new Error(
      `--app must be one of: ${Object.keys(APP_COLLECTIONS).join(", ")}`,
    );
  }
  const all: readonly string[] = APP_COLLECTIONS[app];
  const collections = v["--collections"]
    ? v["--collections"]
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
    : [...all];
  const unknown = collections.filter((c) => !all.includes(c));
  if (unknown.length > 0 || collections.length === 0) {
    throw new Error(`--collections must be a subset of: ${all.join(", ")}`);
  }
  for (const k of [
    "--email",
    "--old-service-account",
    "--new-service-account",
  ]) {
    if (!v[k]) throw new Error(`${k} is required`);
  }
  if (
    process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST
  ) {
    throw new Error(
      "Emulator environment variables are set; unset them to run against real projects.",
    );
  }
  const { oldSa, newSa } = loadServiceAccounts(
    v["--old-service-account"],
    v["--new-service-account"],
  );
  if (oldSa.project_id === newSa.project_id) {
    throw new Error("Old and new service accounts belong to the same project.");
  }

  // 旧・新を別名の App として初期化する。
  const oldApp = initializeApp({ credential: cert(oldSa as never) }, "old");
  const newApp = initializeApp({ credential: cert(newSa as never) }, "new");

  const srcUid = await resolveUid(getAuth(oldApp), v["--email"], "old");
  const dstUid = await resolveUid(getAuth(newApp), v["--email"], "new");
  console.log(
    `[uid] resolved old and new uid (${srcUid === dstUid ? "identical" : "different"})`,
  );
  console.log(
    `[mode] ${execute ? "EXECUTE" : "dry-run"}${overwrite ? " (overwrite)" : ""} app=${app} collections=${collections.join(",")}`,
  );

  await copyUserData({
    srcDb: getFirestore(oldApp),
    dstDb: getFirestore(newApp),
    srcUid,
    dstUid,
    collections,
    execute,
    overwrite,
    log: (l) => console.log(l),
  });
  console.log(execute ? "Done." : "Dry-run finished.");
}

main().catch((e) => {
  // 本文を出さないため、Error の message のみ表示する。
  console.error(
    e instanceof MigrationAbort
      ? `Aborted: ${e.message}`
      : `Error: ${e instanceof Error ? e.message : "unknown"}`,
  );
  process.exit(1);
});
