/**
 * 統合 Firestore ルール・インデックスのデプロイ。
 *
 *   RULES_ALLOWED_EMAILS=a@gmail.com,b@gmail.com \
 *     npm run deploy:firestore -- --project <PROJECT_ID>
 *
 * `--project <ID>` は必須(環境変数からの暗黙の補完はしない。誤デプロイ防止)。
 * デプロイ前に対象プロジェクトIDと許可メール件数を表示し、プロジェクトIDの再入力で
 * 確認する(一致しなければ中断。非対話で使う場合は `--yes`)。
 * `--generate-only` を付けると生成ファイルを作るだけでデプロイしない。
 * 生成物は `.generated/`(git 管理外)。許可メールが未設定・プレースホルダ残りなら中断する。
 */
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAllowedEmails, renderRules } from "./lib/rules.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv: string[]) {
  let project: string | undefined;
  let generateOnly = false;
  let yes = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project") project = argv[++i];
    else if (a.startsWith("--project=")) project = a.slice("--project=".length);
    else if (a === "--generate-only") generateOnly = true;
    else if (a === "--yes") yes = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return { project, generateOnly, yes };
}

async function main() {
  const { project, generateOnly, yes } = parseArgs(process.argv.slice(2));
  const emails = parseAllowedEmails(process.env.RULES_ALLOWED_EMAILS);
  if (!generateOnly && (!project || !/^[a-z0-9-]+$/.test(project))) {
    throw new Error(
      "--project <ID> is required (no implicit fallback to environment variables).",
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

  console.log(
    `About to deploy Firestore rules and indexes to project "${project}" ` +
      `(${emails.length} allowed email(s)). Note: this replaces the rules used by all 4 apps.`,
  );
  if (!yes) {
    if (!process.stdin.isTTY) {
      throw new Error(
        "Not an interactive terminal. Re-run with --yes to confirm.",
      );
    }
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await rl.question("Type the project ID again to confirm: ");
    rl.close();
    if (answer.trim() !== project)
      throw new Error("Project ID did not match. Aborted.");
  }

  const win = process.platform === "win32";
  const bin = resolve(root, `node_modules/.bin/firebase${win ? ".cmd" : ""}`);
  // Windows では shell 経由になるため、空白を含みうるパスは引用符で囲む。
  const q = (v: string) => (win ? `"${v}"` : v);
  const res = spawnSync(
    q(bin),
    [
      "deploy",
      "--only",
      "firestore:rules,firestore:indexes",
      "--project",
      project!,
      "--config",
      q(configPath),
    ],
    { cwd: root, stdio: "inherit", shell: win },
  );
  if (res.error)
    console.error(`Failed to run firebase CLI: ${res.error.message}`);
  if (res.status !== 0) process.exit(res.status ?? 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
