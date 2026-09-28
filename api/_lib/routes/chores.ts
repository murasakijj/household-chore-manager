import { invalidBody } from "../apiError.js";
import { choreDetailDto, choreDto } from "../dto.js";
import {
  choreCreateSchema,
  chorePatchSchema,
  choresBulkCreateSchema,
  listChoresQuerySchema,
} from "../validation.js";
import {
  bulkCreateChores as bulkCreateChoresService,
  createChore as createChoreService,
  getChoreDetail,
  listChoresWithStatus,
  updateChore as updateChoreService,
} from "../services/chores.js";
import { getTodayChores } from "../services/today.js";
import type { RouteCtx, RouteResult } from "./types.js";
import { ok, parsePathId, parseQueryParams } from "./types.js";

export async function listChores(
  ctx: RouteCtx,
  query: URLSearchParams,
): Promise<RouteResult> {
  const q = parseQueryParams(listChoresQuerySchema, query);

  const chores = await listChoresWithStatus(
    ctx.repo,
    ctx.householdId,
    ctx.household.timezone,
    ctx.now,
    {
      status: q.status,
      areaId: q.areaId,
      categoryId: q.categoryId,
      q: q.q,
      includeInactive: q.includeInactive === "true",
      sort: q.sort,
    },
  );

  return ok({ items: chores.map(choreDto) });
}

export async function getToday(ctx: RouteCtx): Promise<RouteResult> {
  const result = await getTodayChores(
    ctx.repo,
    ctx.householdId,
    ctx.household.timezone,
    ctx.now,
  );
  return ok({
    sections: {
      overdue: result.sections.overdue.map(choreDto),
      recommended: result.sections.recommended.map(choreDto),
      upcoming: result.sections.upcoming.map(choreDto),
      neverDone: result.sections.neverDone.map(choreDto),
      doneToday: result.sections.doneToday.map(choreDto),
    },
    notDueCount: result.notDueCount,
  });
}

export async function getChore(
  ctx: RouteCtx,
  rawId: string,
): Promise<RouteResult> {
  const id = parsePathId(rawId);
  const detail = await getChoreDetail(
    ctx.repo,
    ctx.householdId,
    id,
    ctx.household.timezone,
    ctx.now,
  );
  return ok(choreDetailDto(detail));
}

export async function createChore(
  ctx: RouteCtx,
  body: unknown,
): Promise<RouteResult> {
  const parsed = choreCreateSchema.safeParse(body);
  if (!parsed.success) throw invalidBody(parsed.error.issues);

  const result = await createChoreService(
    ctx.repo,
    ctx.householdId,
    ctx.memberId,
    ctx.household.timezone,
    ctx.now,
    parsed.data,
  );
  return ok({ chore: choreDto(result.chore), warnings: result.warnings }, 201);
}

export async function bulkCreateChores(
  ctx: RouteCtx,
  body: unknown,
): Promise<RouteResult> {
  const parsed = choresBulkCreateSchema.safeParse(body);
  if (!parsed.success) throw invalidBody(parsed.error.issues);

  const result = await bulkCreateChoresService(
    ctx.repo,
    ctx.householdId,
    ctx.memberId,
    ctx.household.timezone,
    ctx.now,
    parsed.data.items,
  );
  return ok(
    { created: result.created.map(choreDto), warnings: result.warnings },
    201,
  );
}

export async function patchChore(
  ctx: RouteCtx,
  rawId: string,
  body: unknown,
): Promise<RouteResult> {
  const id = parsePathId(rawId);
  const parsed = chorePatchSchema.safeParse(body);
  if (!parsed.success) throw invalidBody(parsed.error.issues);

  const updated = await updateChoreService(
    ctx.repo,
    ctx.householdId,
    id,
    ctx.household.timezone,
    ctx.now,
    parsed.data,
  );
  return ok(choreDto(updated));
}
