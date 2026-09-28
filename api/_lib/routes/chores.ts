import { invalidBody } from "../apiError.js";
import { choreDetailDto, choreDto } from "../dto.js";
import {
  choreCreateSchema,
  chorePatchSchema,
  choresBulkCreateSchema,
} from "../validation.js";
import {
  bulkCreateChores as bulkCreateChoresService,
  createChore as createChoreService,
  getChoreDetail,
  listChoresWithStatus,
  updateChore as updateChoreService,
} from "../services/chores.js";
import { getTodayChores } from "../services/today.js";
import type { ChoreStatus } from "../domain/status.js";
import type { RouteCtx, RouteResult } from "./types.js";
import { ok } from "./types.js";

const VALID_STATUSES: ChoreStatus[] = [
  "not_due",
  "upcoming",
  "recommended",
  "overdue",
  "never_done",
  "inactive",
];

export async function listChores(
  ctx: RouteCtx,
  query: URLSearchParams,
): Promise<RouteResult> {
  const statusParam = query.get("status");
  if (statusParam && !VALID_STATUSES.includes(statusParam as ChoreStatus)) {
    throw invalidBody({ field: "status" });
  }
  const sortParam = query.get("sort");
  if (sortParam && !["status", "elapsed", "name"].includes(sortParam)) {
    throw invalidBody({ field: "sort" });
  }

  const chores = await listChoresWithStatus(
    ctx.repo,
    ctx.householdId,
    ctx.household.timezone,
    ctx.now,
    {
      status: (statusParam as ChoreStatus) ?? undefined,
      areaId: query.get("areaId") ?? undefined,
      categoryId: query.get("categoryId") ?? undefined,
      q: query.get("q") ?? undefined,
      includeInactive: query.get("includeInactive") === "true",
      sort: (sortParam as "status" | "elapsed" | "name") ?? undefined,
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
  id: string,
): Promise<RouteResult> {
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
  id: string,
  body: unknown,
): Promise<RouteResult> {
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
