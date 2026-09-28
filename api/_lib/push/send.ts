import webPush from "web-push";
import type { PushSubscriptionRecord } from "../repo/types.js";

/** Web Push送信(VAPID)。`web-push` パッケージのみに依存する。 */

/** 1件あたりの送信タイムアウト(レビュー指摘 #4)。 */
const SEND_TIMEOUT_MS = 10_000;

let configured = false;

/** VAPID環境変数が揃っているか(送信を試みる前に確認する用。副作用なし)。 */
export function isPushConfigured(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT,
  );
}

/** VAPID設定は初回送信時に一度だけ行う。 */
function ensureConfigured(): void {
  if (configured) return;
  if (!isPushConfigured()) {
    throw new PushNotConfiguredError();
  }
  webPush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  configured = true;
}

export class PushNotConfiguredError extends Error {
  constructor() {
    super("push_not_configured");
  }
}

/**
 * 購読が無効なため呼び出し側で購読を削除すべきことを示す。
 * 404/410(購読切れ)に加えて、400/403(endpoint自体が不正・拒否された)や、
 * 暗号化時の例外(鍵(p256dh/auth)が不正な形式で `web-push` が送信前に投げるエラー)も含む
 * (レビュー指摘 #11)。
 */
export class PushSubscriptionGoneError extends Error {
  constructor() {
    super("push_subscription_gone");
  }
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

const GONE_STATUS_CODES = new Set([400, 403, 404, 410]);

/**
 * 暗号化(鍵の解析)段階で `web-push` が投げる、HTTPステータスを持たない
 * 同期的なエラーかどうかを判定する。`web-push` はp256dh/authがbase64urlとして
 * 不正な場合、`web-push` の内部(`vapid-helper`/`web-push-encryption` 相当)で
 * 例外を投げる。メッセージ全文はログに出さず、購読を削除する判断材料にのみ使う。
 */
function isEncryptionKeyError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if ((err as { statusCode?: unknown }).statusCode !== undefined) return false;
  return /key|base64|encod|subscription/i.test(err.message);
}

/**
 * 1件の購読へ通知を送る。メモ本文(`body`)・購読endpointはログに出さない。
 * 購読が無効と判断できる場合は `PushSubscriptionGoneError` に正規化し、
 * 呼び出し側で購読を削除させる。
 */
export async function sendPushNotification(
  subscription: PushSubscriptionRecord,
  payload: PushPayload,
): Promise<void> {
  ensureConfigured();
  try {
    await webPush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      },
      JSON.stringify(payload),
      { timeout: SEND_TIMEOUT_MS },
    );
  } catch (err) {
    const statusCode = (err as { statusCode?: unknown } | undefined)?.statusCode;
    if (
      (typeof statusCode === "number" && GONE_STATUS_CODES.has(statusCode)) ||
      isEncryptionKeyError(err)
    ) {
      throw new PushSubscriptionGoneError();
    }
    // メモ本文・購読endpointは出さない。
    console.error("[push] send failed", { statusCode });
    throw err;
  }
}
