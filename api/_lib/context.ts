import type { AuthedUser } from "./auth.js";
import type { Household, Member, Repo } from "./repo/types.js";

export interface RequestContext {
  householdId: string;
  memberId: string;
  household: Household;
  member: Member;
}

/**
 * 認証済み利用者から家庭コンテキストを解決する。
 * `userMemberships/{uid}` が無ければ初回セットアップ(家庭・メンバー・通知設定・
 * 推奨初期データの場所/カテゴリ)をトランザクションで行う(decisions.md「家庭の自動作成」)。
 *
 * householdId はここ以外(リクエストボディ・クエリ等)から取得してはならない
 * (設計書 §11.4, .claude/CLAUDE.md ルール3)。
 */
export async function resolveContext(
  repo: Repo,
  user: AuthedUser,
): Promise<RequestContext> {
  let membership = await repo.getUserMembership(user.uid);
  if (!membership) {
    membership = await repo.bootstrapHouseholdForUser({
      uid: user.uid,
      email: user.email,
    });
  }

  const [household, member] = await Promise.all([
    repo.getHousehold(membership.householdId),
    repo.getMember(membership.householdId, membership.memberId),
  ]);

  if (!household || !member) {
    // bootstrap直後は必ず存在するはずだが、データ不整合時は内部エラーとして扱う。
    throw new Error("household_context_inconsistent");
  }

  return {
    householdId: membership.householdId,
    memberId: membership.memberId,
    household,
    member,
  };
}
