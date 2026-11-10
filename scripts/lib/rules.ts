/** Firestore ルールのプレースホルダ置換(純粋関数。deploy スクリプトとテストが使う)。 */

export const PLACEHOLDER_EMAIL = "you@example.com";

// 引用符・バックスラッシュ・`$`・バッククォートはルール文の破壊や置換パターンの
// 誤解釈につながるため拒否する。
const EMAIL_RE = /^[^\s'"\\,@$`]+@[^\s'"\\,@$`]+\.[^\s'"\\,@$`]+$/;

/** カンマ区切りのメールを検証して配列にする。小文字に正規化し重複を除く。不正・空・プレースホルダなら例外。 */
export function parseAllowedEmails(raw: string | undefined): string[] {
  const emails = (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  if (emails.length === 0) {
    throw new Error(
      "Allowed emails are not set. Pass --emails a@x.com,b@y.com " +
        "or set the RULES_ALLOWED_EMAILS environment variable (comma-separated).",
    );
  }
  for (const e of emails) {
    if (!EMAIL_RE.test(e)) {
      throw new Error(`Invalid allowed email: ${JSON.stringify(e)}`);
    }
    if (e.toLowerCase() === PLACEHOLDER_EMAIL) {
      throw new Error(
        `Allowed emails still contain the placeholder ${PLACEHOLDER_EMAIL}.`,
      );
    }
  }
  return [...new Set(emails)];
}

/** ルール文中の `'you@example.com'` を許可メール一覧に置き換える。 */
export function renderRules(template: string, emails: string[]): string {
  const token = `'${PLACEHOLDER_EMAIL}'`;
  const count = template.split(token).length - 1;
  if (count !== 1) {
    throw new Error(
      `Expected exactly one ${token} in the rules template, found ${count}.`,
    );
  }
  const list = emails.map((e) => `'${e}'`).join(", ");
  // 置換関数を使い、`$&` 等の特殊パターンとして解釈されないようにする。
  const rendered = template.replace(token, () => list);
  if (rendered.includes(PLACEHOLDER_EMAIL)) {
    throw new Error("Placeholder email remains after rendering; aborting.");
  }
  return rendered;
}
