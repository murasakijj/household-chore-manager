import { invalidBody } from "../apiError.js";
import { choreDto, choreEventDto } from "../dto.js";
import {
  choreEventCreateSchema,
  listEventsGlobalQuerySchema,
  listEventsQuerySchema,
  voidChoreEventSchema,
} from "../validation.js";
import {
  addChoreEvent as addChoreEventService,
  listChoreEvents as listChoreEventsService,
  listChoreEventsForChore as listChoreEventsForChoreService,
  voidChoreEvent as voidChoreEventService,
} from "../services/choreEvents.js";
import type { RouteCtx, RouteResult } from "./types.js";
import { ok, parsePathId, parseQueryParams } from "./types.js";

export async function addChoreEvent(
  ctx: RouteCtx,
  rawChoreId: string,
  body: unknown,
): Promise<RouteResult> {
  const choreId = parsePathId(rawChoreId);
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
  rawChoreId: string,
  query: URLSearchParams,
): Promise<RouteResult> {
  const choreId = parsePathId(rawChoreId);
  const q = parseQueryParams(listEventsQuerySchema, query);
  const page = await listChoreEventsForChoreService(ctx.repo, ctx.householdId, choreId, {
    limit: q.limit,
    cursor: q.cursor,
    includeVoided: q.includeVoided === "true",
  });
  return ok({
    items: page.items.map(choreEventDto),
    nextCursor: page.nextCursor,
  });
}

export async function listAllEvents(
  ctx: RouteCtx,
  query: URLSearchParams,
): Promise<RouteResult> {
  const q = parseQueryParams(listEventsGlobalQuerySchema, query);
  const page = await listChoreEventsService(ctx.repo, ctx.householdId, {
    limit: q.limit,
    cursor: q.cursor,
    includeVoided: q.includeVoided === "true",
    choreId: q.choreId,
    areaId: q.areaId,
    actorMemberId: q.actorMemberId,
    from: q.from,
    to: q.to,
  });
  return ok({
    items: page.items.map(choreEventDto),
    nextCursor: page.nextCursor,
  });
}

export async function voidEvent(
  ctx: RouteCtx,
  rawEventId: string,
  body: unknown,
): Promise<RouteResult> {
  const eventId = parsePathId(rawEventId);
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
