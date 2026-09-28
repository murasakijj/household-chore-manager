import { ApiError } from "./api";

/**
 * APIエラーのコード(`api/_lib/apiError.ts`)ごとに、利用者向けの文言へ変換する。
 * 該当が無ければ `fallback` を返す。
 */
export function describeApiError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.code === "already_voided") {
      return "この記録は既に取り消し済みです。";
    }
    if (err.code === "not_found") {
      return "対象が見つかりませんでした。最新の状態に更新してください。";
    }
    if (err.code === "invalid_body" || err.code === "invalid_query") {
      const details = err.details as
        | { reason?: string; field?: string }
        | { index?: number; reason?: string; field?: string }[]
        | undefined;
      const reason = Array.isArray(details) ? undefined : details?.reason;
      if (reason === "future") {
        return "未来の日時は記録できません。";
      }
    }
    if (err.code === "invalid_timezone") {
      return "タイムゾーンの指定が正しくありません。";
    }
  }
  return fallback;
}

/** その `ApiError` が「既に取り消し済み」を表すか。 */
export function isAlreadyVoidedError(err: unknown): boolean {
  return err instanceof ApiError && err.code === "already_voided";
}
