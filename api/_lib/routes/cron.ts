import type { Repo } from "../repo/types.js";
import { runDailySummaryJob } from "../services/dailySummary.js";
import { PushNotConfiguredError } from "../push/send.js";

/**
 * `GET/POST /api/cron/daily-summary`。CRON_SECRET検証はルーター(`api/router.ts`)側で行う
 * (requireAuth/resolveContext を通さない例外経路のため、`RouteCtx` を使わない)。
 * 応答は件数サマリのみで、個人情報(家庭名・メンバー名・通知文面)は含めない。
 * VAPID未設定時は何も claim せずに 500 `push_not_configured` を返す(レビュー指摘 #3)。
 */
export async function dailySummaryCron(
  repo: Repo,
  now: Date,
): Promise<{
  status: number;
  body:
    | {
        householdsProcessed: number;
        membersConsidered: number;
        notificationsSent: number;
        subscriptionsRemoved: number;
      }
    | { error: string };
}> {
  try {
    const result = await runDailySummaryJob(repo, now);
    return { status: 200, body: result };
  } catch (err) {
    if (err instanceof PushNotConfiguredError) {
      return { status: 500, body: { error: "push_not_configured" } };
    }
    throw err;
  }
}
