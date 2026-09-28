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
}

/** 自分宛てのテスト通知(architecture.md `POST /api/push/test`)。 */
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
      throw err;
    }
  }
  return { sent, removed };
}
