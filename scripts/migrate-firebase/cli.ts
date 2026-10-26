/**
 * 使い方は README.md。例:
 *   npm run migrate:firebase -- --app recipe-buddy --email me@example.com \
 *     --old-service-account ~/keys/old-sa.json --new-service-account ~/keys/new-sa.json \
 *     [--collections a,b] [--execute] [--overwrite]
 */
import { readFileSync } from "node:fs";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import {
  APP_COLLECTIONS,
  copyUserData,
  MigrationAbort,
  type MigrationApp,
} from "./copy.js";

function parseArgs(argv: string[]) {
  const v: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--execute" || a === "--overwrite") flags.add(a);
    else if (
      [
        "--app",
        "--email",
        "--old-service-account",
        "--new-service-account",
      ].includes(a)
    ) {
      v[a] = argv[++i] ?? "";
    } else throw new Error(`Unknown argument: ${a}`);
  }
  return {
    v,
    execute: flags.has("--execute"),
    overwrite: flags.has("--overwrite"),
  };
}

function loadServiceAccount(path: string) {
  // 失敗時は内容の断片を出さないよう、固定メッセージのみ表示する。
  let json: { project_id?: unknown };
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(
      "Could not read or parse a service account JSON file (check the path and that it is the downloaded key file).",
    );
  }
  if (typeof json?.project_id !== "string" || !json.project_id) {
    throw new Error("A service account JSON file has no project_id.");
  }
  return json as { project_id: string };
}

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
  const oldSa = loadServiceAccount(v["--old-service-account"]);
  const newSa = loadServiceAccount(v["--new-service-account"]);
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
