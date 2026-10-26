/**
 * 統合 Firestore ルール・インデックスのデプロイ。
 *
 *   RULES_ALLOWED_EMAILS=a@gmail.com,b@gmail.com \
 *     npm run deploy:firestore -- --project <PROJECT_ID>
 *
 * プロジェクトIDは `--project <ID>` か環境変数 FIREBASE_PROJECT_ID。
 * `--generate-only` を付けると生成ファイルを作るだけでデプロイしない。
 * 生成物は `.generated/`(git 管理外)。許可メールが未設定・プレースホルダ残りなら中断する。
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAllowedEmails, renderRules } from "./lib/rules.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv: string[]) {
  let project: string | undefined = process.env.FIREBASE_PROJECT_ID;
  let generateOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project") project = argv[++i];
    else if (a.startsWith("--project=")) project = a.slice("--project=".length);
    else if (a === "--generate-only") generateOnly = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return { project, generateOnly };
}

function main() {
  const { project, generateOnly } = parseArgs(process.argv.slice(2));
  const emails = parseAllowedEmails(process.env.RULES_ALLOWED_EMAILS);
  if (!generateOnly && (!project || !/^[a-z0-9-]+$/.test(project))) {
    throw new Error(
      "Project ID is required: --project <ID> or FIREBASE_PROJECT_ID.",
    );
  }

  const template = readFileSync(
    resolve(root, "firebase/firestore.rules"),
    "utf8",
  );
  const outDir = resolve(root, ".generated");
  mkdirSync(outDir, { recursive: true });
  const rulesPath = resolve(outDir, "firestore.rules");
  writeFileSync(rulesPath, renderRules(template, emails));
  const configPath = resolve(outDir, "firebase.json");
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        firestore: {
          rules: rulesPath,
          indexes: resolve(root, "firebase/firestore.indexes.json"),
        },
      },
      null,
      2,
    ),
  );
  console.log(`Generated ${rulesPath} for ${emails.length} allowed email(s).`);
  if (generateOnly) return;

  const bin = resolve(root, "node_modules/.bin/firebase");
  const res = spawnSync(
    bin,
    [
      "deploy",
      "--only",
      "firestore:rules,firestore:indexes",
      "--project",
      project!,
      "--config",
      configPath,
    ],
    { cwd: root, stdio: "inherit" },
  );
  if (res.status !== 0) process.exit(res.status ?? 1);
}

try {
  main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
