import { invalidBody } from "../apiError.js";
import { householdDto, notificationSettingsDto } from "../dto.js";
import { settingsPatchSchema } from "../validation.js";
import { getSettings, updateSettings } from "../services/settings.js";
import type { RouteCtx, RouteResult } from "./types.js";
import { ok } from "./types.js";

function toDto(result: Awaited<ReturnType<typeof getSettings>>) {
  return {
    household: householdDto(result.household),
    notification: notificationSettingsDto(result.notification),
  };
}

export async function getSettingsRoute(ctx: RouteCtx): Promise<RouteResult> {
  const result = await getSettings(ctx.repo, ctx.householdId, ctx.memberId);
  return ok(toDto(result));
}

export async function patchSettingsRoute(
  ctx: RouteCtx,
  body: unknown,
): Promise<RouteResult> {
  const parsed = settingsPatchSchema.safeParse(body);
  if (!parsed.success) throw invalidBody(parsed.error.issues);
  const result = await updateSettings(
    ctx.repo,
    ctx.householdId,
    ctx.memberId,
    parsed.data,
  );
  return ok(toDto(result));
}
