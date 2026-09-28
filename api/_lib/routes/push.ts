import { invalidBody } from "../apiError.js";
import { pushSubscriptionSchema, pushUnsubscribeSchema } from "../validation.js";
import { PushNotConfiguredError } from "../push/send.js";
import { sendTestPushToMember, subscribePush, unsubscribePush } from "../services/push.js";
import type { RouteCtx, RouteResult } from "./types.js";
import { ok } from "./types.js";
import { ApiError } from "../apiError.js";

export async function createPushSubscription(
  ctx: RouteCtx,
  body: unknown,
): Promise<RouteResult> {
  const parsed = pushSubscriptionSchema.safeParse(body);
  if (!parsed.success) throw invalidBody(parsed.error.issues);

  await subscribePush(ctx.repo, ctx.householdId, ctx.memberId, parsed.data);
  return ok({ ok: true }, 201);
}

export async function deletePushSubscription(
  ctx: RouteCtx,
  body: unknown,
): Promise<RouteResult> {
  const parsed = pushUnsubscribeSchema.safeParse(body);
  if (!parsed.success) throw invalidBody(parsed.error.issues);

  await unsubscribePush(ctx.repo, ctx.householdId, ctx.memberId, parsed.data.endpoint);
  return ok({ ok: true });
}

export async function sendTestPush(ctx: RouteCtx): Promise<RouteResult> {
  try {
    const result = await sendTestPushToMember(ctx.repo, ctx.householdId, ctx.memberId);
    return ok(result);
  } catch (err) {
    if (err instanceof PushNotConfiguredError) {
      throw new ApiError(500, "push_not_configured");
    }
    throw err;
  }
}
