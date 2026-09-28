import type { Repo } from "../repo/types.js";
import { buildDailySummary } from "../domain/summary.js";
import { localDate } from "../domain/calendar.js";
import { listChoresWithStatus, type ChoreWithStatus } from "./chores.js";
import {
  isPushConfigured,
  PushNotConfiguredError,
  PushSubscriptionGoneError,
  sendPushNotification,
} from "../push/send.js";

/** 朝のまとめ通知ジョブ(architecture.md「朝のまとめ通知ジョブ」、設計書 §12.1)。 */

export interface DailySummaryRunResult {
  householdsProcessed: number;
  membersConsidered: number;
  notificationsSent: number;
  subscriptionsRemoved: number;
}

/** `now` を `timezone` の "HH:mm" に変換する。 */
function localTime(now: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return formatter.format(now);
}

export async function runDailySummaryJob(
  repo: Repo,
  now: Date,
): Promise<DailySummaryRunResult> {
  // VAPID未設定ならどの家庭・メンバーも claim せずに即座に失敗させる
  // (レビュー指摘 #3)。呼び出し側(routes/cron.ts)で 500 push_not_configured に変換する。
  if (!isPushConfigured()) {
    throw new PushNotConfiguredError();
  }

  const households = await repo.listHouseholds();

  let membersConsidered = 0;
  let notificationsSent = 0;
  let subscriptionsRemoved = 0;

  for (const household of households) {
    const timezone = household.timezone;
    const nowLocalTime = localTime(now, timezone);
    const today = localDate(now, timezone);

    const entries = await repo.listActiveMembersWithNotificationSettings(
      household.id,
    );

    // 家事の状態計算は家庭ごとに1回だけ行う(全メンバーで now/timezone が同じため)。
    // 実際に通知を送るメンバーが1人もいなければ計算しない。
    let chores: ChoreWithStatus[] | null = null;

    for (const { member, settings } of entries) {
      membersConsidered++;
      if (!settings.dailySummaryEnabled) continue;
      if (nowLocalTime < settings.dailySummaryTime) continue;
      if (settings.lastSentLocalDate === today) continue;

      // 送信前の値を覚えておく(送信が全滅した場合の補償ロールバック用)。
      const previousLastSentLocalDate = settings.lastSentLocalDate;

      // 二重起動対策: 未送信なら先に lastSentLocalDate を確保してから送る。
      // 確保できなければ(既に他の実行が送信済み)スキップする。
      const claimed = await repo.claimDailySummarySlot(
        household.id,
        member.id,
        today,
      );
      if (!claimed) continue;

      chores ??= await listChoresWithStatus(repo, household.id, timezone, now, {
        includeInactive: false,
      });

      const summary = buildDailySummary({
        chores,
        now,
        timezone,
        includeUpcoming: settings.includeUpcoming,
      });
      // 対象0件は「送信不要で当日完了」扱い。lastSentLocalDateは更新したまま
      // (claimDailySummarySlotで確保済み)にし、ロールバックしない
      // (decisions.md「朝のまとめ通知の再試行方針」)。
      if (!summary) continue;

      const subscriptions = await repo.listPushSubscriptionsForMember(
        household.id,
        member.id,
      );
      // 購読が1件も無い場合も「当日完了」扱い(decisions.md)。
      if (subscriptions.length === 0) continue;

      let deliveredCount = 0;
      let temporaryFailureCount = 0;
      for (const subscription of subscriptions) {
        try {
          await sendPushNotification(subscription, {
            title: "今日の家事",
            body: summary.text,
            url: "/",
          });
          deliveredCount++;
        } catch (err) {
          if (err instanceof PushSubscriptionGoneError) {
            await repo.deletePushSubscriptionById(household.id, subscription.id);
            subscriptionsRemoved++;
            continue;
          }
          // 個々の送信失敗で他のメンバー・家庭への処理を止めない。
          temporaryFailureCount++;
          console.error("[cron:daily-summary] send failed", {
            householdId: household.id,
          });
        }
      }

      if (deliveredCount > 0) {
        notificationsSent++;
      } else if (temporaryFailureCount > 0) {
        // 購読はあったのに1件も届かず、失敗がすべて一時的(404/410等で削除された
        // ものを除く)だった場合は、次の毎時実行で再試行されるよう
        // lastSentLocalDateをclaim前の値へ補償的に戻す(レビュー指摘 #3)。
        await repo.upsertNotificationSettings(household.id, member.id, {
          lastSentLocalDate: previousLastSentLocalDate,
        });
      }
      // deliveredCount===0 && temporaryFailureCount===0(=全購読が404/410で削除
      // された)場合は、送るべき端末が無くなったということなので当日完了扱いのまま。
    }
  }

  return {
    householdsProcessed: households.length,
    membersConsidered,
    notificationsSent,
    subscriptionsRemoved,
  };
}
