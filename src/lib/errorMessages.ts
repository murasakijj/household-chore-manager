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
    if (err.code === "rate_limited") {
      return "AIが混み合っています。しばらくしてから試してください。";
    }
    if (err.code === "overloaded") {
      return "AIサービスが混み合っています。しばらくしてから試してください。";
    }
    if (err.code === "upstream_error" || err.code === "invalid_ai_output") {
      return "AIからの応答を取得できませんでした。時間を置いて試してください。";
    }
    if (err.code === "ai_not_configured") {
      return "AI機能が設定されていません(管理者にお問い合わせください)。";
    }
    if (err.code === "push_not_configured") {
      return "通知機能が設定されていません(管理者にお問い合わせください)。";
    }
  }
  return fallback;
}

/** その `ApiError` が「既に取り消し済み」を表すか。 */
export function isAlreadyVoidedError(err: unknown): boolean {
  return err instanceof ApiError && err.code === "already_voided";
}
