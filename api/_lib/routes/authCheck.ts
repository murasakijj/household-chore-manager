import { householdDto, memberDto } from "../dto.js";
import type { RouteCtx, RouteResult } from "./types.js";
import { ok } from "./types.js";

export async function getAuthCheck(ctx: RouteCtx): Promise<RouteResult> {
  return ok({
    ok: true,
    member: memberDto(ctx.member),
    household: householdDto(ctx.household),
  });
}
