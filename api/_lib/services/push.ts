import type { Repo } from "../repo/types.js";
import {
  PushSubscriptionGoneError,
  sendPushNotification,
} from "../push/send.js";

export async function subscribePush(
  repo: Repo,
  householdId: string,
  memberId: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
): Promise<void> {
  await repo.upsertPushSubscription(householdId, memberId, sub);
}

export async function unsubscribePush(
  repo: Repo,
  householdId: string,
  memberId: string,
  endpoint: string,
): Promise<void> {
  await repo.deletePushSubscriptionByEndpoint(householdId, memberId, endpoint);
}

export interface SendTestPushResult {
  sent: number;
  removed: number;
  /** 一時的な失敗(404/410以外)で届かなかった件数(レビュー指摘 #11)。 */
  failed: number;
}

/**
 * 自分宛てのテスト通知(architecture.md `POST /api/push/test`)。
 * 1件の送信失敗で他の購読への送信を止めない。届かなかった件数も含めて
 * 常に200で返し(送信そのものは実行できたため)、UI側で表示する。
 */
export async function sendTestPushToMember(
  repo: Repo,
  householdId: string,
  memberId: string,
): Promise<SendTestPushResult> {
  const subscriptions = await repo.listPushSubscriptionsForMember(
    householdId,
    memberId,
  );
  let sent = 0;
  let removed = 0;
  let failed = 0;
  for (const subscription of subscriptions) {
    try {
      await sendPushNotification(subscription, {
        title: "テスト通知",
        body: "この端末は通知を受け取れます。",
        url: "/",
      });
      sent++;
    } catch (err) {
      if (err instanceof PushSubscriptionGoneError) {
        await repo.deletePushSubscriptionById(householdId, subscription.id);
        removed++;
        continue;
      }
      failed++;
      console.error("[push:test] send failed", { householdId });
    }
  }
  return { sent, removed, failed };
}
