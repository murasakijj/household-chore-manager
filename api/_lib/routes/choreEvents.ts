import { invalidBody } from "../apiError.js";
import { choreDto, choreEventDto } from "../dto.js";
import { choreEventCreateSchema, voidChoreEventSchema } from "../validation.js";
import {
  addChoreEvent as addChoreEventService,
  listChoreEvents as listChoreEventsService,
  listChoreEventsForChore as listChoreEventsForChoreService,
  voidChoreEvent as voidChoreEventService,
} from "../services/choreEvents.js";
import type { RouteCtx, RouteResult } from "./types.js";
import { ok } from "./types.js";

function parseListQuery(query: URLSearchParams) {
  const limitParam = query.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;
  return {
    limit: limit && Number.isFinite(limit) ? limit : undefined,
    cursor: query.get("cursor") ?? undefined,
    includeVoided: query.get("includeVoided") === "true",
  };
}

export async function addChoreEvent(
  ctx: RouteCtx,
  choreId: string,
  body: unknown,
): Promise<RouteResult> {
  const parsed = choreEventCreateSchema.safeParse(body);
  if (!parsed.success) throw invalidBody(parsed.error.issues);

  const result = await addChoreEventService(
    ctx.repo,
    ctx.householdId,
    ctx.memberId,
    ctx.household.timezone,
    ctx.now,
    { choreId, ...parsed.data },
  );

  return ok(
    {
      event: choreEventDto(result.event),
      chore: choreDto(result.chore),
      idempotentReplay: result.idempotentReplay,
      possibleDuplicate: result.possibleDuplicate,
    },
    result.idempotentReplay ? 200 : 201,
  );
}

export async function listEventsForChore(
  ctx: RouteCtx,
  choreId: string,
  query: URLSearchParams,
): Promise<RouteResult> {
  const page = await listChoreEventsForChoreService(
    ctx.repo,
    ctx.householdId,
    choreId,
    parseListQuery(query),
  );
  return ok({
    items: page.items.map(choreEventDto),
    nextCursor: page.nextCursor,
  });
}

export async function listAllEvents(
  ctx: RouteCtx,
  query: URLSearchParams,
): Promise<RouteResult> {
  const page = await listChoreEventsService(ctx.repo, ctx.householdId, {
    ...parseListQuery(query),
    choreId: query.get("choreId") ?? undefined,
    areaId: query.get("areaId") ?? undefined,
    actorMemberId: query.get("actorMemberId") ?? undefined,
    from: query.get("from") ?? undefined,
    to: query.get("to") ?? undefined,
  });
  return ok({
    items: page.items.map(choreEventDto),
    nextCursor: page.nextCursor,
  });
}

export async function voidEvent(
  ctx: RouteCtx,
  eventId: string,
  body: unknown,
): Promise<RouteResult> {
  const parsed = voidChoreEventSchema.safeParse(body ?? {});
  if (!parsed.success) throw invalidBody(parsed.error.issues);

  const result = await voidChoreEventService(
    ctx.repo,
    ctx.householdId,
    ctx.memberId,
    ctx.household.timezone,
    ctx.now,
    eventId,
    parsed.data?.reason ?? null,
  );
  return ok({
    event: choreEventDto(result.event),
    chore: choreDto(result.chore),
  });
}
