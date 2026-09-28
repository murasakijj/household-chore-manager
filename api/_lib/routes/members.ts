import { memberDto } from "../dto.js";
import { listMembers } from "../services/members.js";
import type { RouteCtx, RouteResult } from "./types.js";
import { ok } from "./types.js";

export async function listMembersRoute(ctx: RouteCtx): Promise<RouteResult> {
  const members = await listMembers(ctx.repo, ctx.householdId);
  return ok({ items: members.map(memberDto) });
}
