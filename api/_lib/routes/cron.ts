import type { Repo } from "../repo/types.js";
import { runDailySummaryJob } from "../services/dailySummary.js";

/**
 * `GET/POST /api/cron/daily-summary`。CRON_SECRET検証はルーター(`api/router.ts`)側で行う
 * (requireAuth/resolveContext を通さない例外経路のため、`RouteCtx` を使わない)。
 * 応答は件数サマリのみで、個人情報(家庭名・メンバー名・通知文面)は含めない。
 */
export async function dailySummaryCron(
  repo: Repo,
  now: Date,
): Promise<{
  householdsProcessed: number;
  membersConsidered: number;
  notificationsSent: number;
  subscriptionsRemoved: number;
}> {
  return runDailySummaryJob(repo, now);
}
