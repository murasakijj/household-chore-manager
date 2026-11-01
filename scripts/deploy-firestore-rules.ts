/**
 * 統合 Firestore ルール・インデックスのデプロイ。
 *
 *   npm run deploy:firestore -- --project <PROJECT_ID> --emails a@gmail.com,b@gmail.com
 *
 * 許可メールは `--emails`(カンマ区切り)か環境変数 `RULES_ALLOWED_EMAILS` で指定する
 * (両方あれば `--emails` を優先。Windows でも動くよう引数での指定を基本とする)。
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
import { parseDeployArgs, pickEmailsRaw } from "./lib/deploy-args.js";
import { parseAllowedEmails, renderRules } from "./lib/rules.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const {
    project,
    emails: emailsArg,
    generateOnly,
    yes,
  } = parseDeployArgs(process.argv.slice(2));
  const emails = parseAllowedEmails(
    pickEmailsRaw(emailsArg, process.env.RULES_ALLOWED_EMAILS),
  );
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
