import webPush from "web-push";
import type { PushSubscriptionRecord } from "../repo/types.js";

/** Web Push送信(VAPID)。`web-push` パッケージのみに依存する。 */

let configured = false;

/** VAPID設定は初回送信時に一度だけ行う(環境変数未設定は呼び出し側で先に検知する)。 */
function ensureConfigured(): void {
  if (configured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new PushNotConfiguredError();
  }
  webPush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export class PushNotConfiguredError extends Error {
  constructor() {
    super("push_not_configured");
  }
}

/** 購読が無効(404/410)なため呼び出し側で購読を削除すべきことを示す。 */
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

/**
 * 1件の購読へ通知を送る。メモ本文(`body`)はログに出さない。
 * 404/410は `PushSubscriptionGoneError` に正規化し、呼び出し側で購読を削除させる。
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
    );
  } catch (err) {
    const statusCode = (err as { statusCode?: unknown } | undefined)?.statusCode;
    if (statusCode === 404 || statusCode === 410) {
      throw new PushSubscriptionGoneError();
    }
    // メモ本文・購読endpointは出さない。
    console.error("[push] send failed", { statusCode });
    throw err;
  }
}
