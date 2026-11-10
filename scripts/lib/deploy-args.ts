/** deploy-firestore-rules.ts の引数解析(純粋関数。テスト可能にするため分離)。 */

export interface DeployArgs {
  project?: string;
  emails?: string;
  generateOnly: boolean;
  yes: boolean;
}

export function parseDeployArgs(argv: string[]): DeployArgs {
  const out: DeployArgs = { generateOnly: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project") out.project = argv[++i];
    else if (a.startsWith("--project="))
      out.project = a.slice("--project=".length);
    else if (a === "--emails") out.emails = argv[++i];
    else if (a.startsWith("--emails="))
      out.emails = a.slice("--emails=".length);
    else if (a === "--generate-only") out.generateOnly = true;
    else if (a === "--yes") out.yes = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

/** `--emails` を優先し、無ければ環境変数 `RULES_ALLOWED_EMAILS` を使う。 */
export function pickEmailsRaw(
  argEmails: string | undefined,
  envEmails: string | undefined,
): string | undefined {
  return argEmails !== undefined ? argEmails : envEmails;
}
