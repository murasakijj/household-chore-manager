/**
 * 設計書 §7.6: 新規登録時の予告日数・猶予日数の推奨初期値。
 * サーバー側の正本は `api/_lib/domain/status.ts` の `defaultWarningGrace`。
 * フォームの「間隔を変えたら初期値も追従する」体験のためクライアントにも
 * 同じ計算を複製しているが、値がずれないことは
 * `src/lib/choreDefaults.test.ts`(サーバー側関数をテストからのみimportして比較)
 * で保証する。アプリコードからは `api/` を import しない(CLAUDE.mdのルール)。
 */
export function defaultWarningGrace(intervalDays: number): {
  warningDays: number;
  graceDays: number;
} {
  const rawWarning = Math.max(1, Math.round(intervalDays * 0.25));
  const graceDays = Math.max(1, Math.round(intervalDays * 0.25));
  const warningDays = Math.min(rawWarning, Math.max(0, intervalDays - 1));
  return { warningDays, graceDays };
}
