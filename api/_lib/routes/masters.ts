import { invalidBody } from "../apiError.js";
import { areaDto, categoryDto, resourceDto } from "../dto.js";
import {
  areaCreateSchema,
  areaPatchSchema,
  categoryCreateSchema,
  categoryPatchSchema,
  listMastersQuerySchema,
  resourceCreateSchema,
  resourcePatchSchema,
} from "../validation.js";
import * as masters from "../services/masters.js";
import type { RouteCtx, RouteResult } from "./types.js";
import { ok, parsePathId, parseQueryParams } from "./types.js";

// --- 場所(areas) ---

export async function listAreas(
  ctx: RouteCtx,
  query: URLSearchParams,
): Promise<RouteResult> {
  const q = parseQueryParams(listMastersQuerySchema, query);
  const items = await masters.listAreas(
    ctx.repo,
    ctx.householdId,
    q.includeInactive === "true",
  );
  return ok({ items: items.map(areaDto) });
}

export async function createArea(
  ctx: RouteCtx,
  body: unknown,
): Promise<RouteResult> {
  const parsed = areaCreateSchema.safeParse(body);
  if (!parsed.success) throw invalidBody(parsed.error.issues);
  const area = await masters.createArea(ctx.repo, ctx.householdId, parsed.data);
  return ok(areaDto(area), 201);
}

export async function patchArea(
  ctx: RouteCtx,
  rawId: string,
  body: unknown,
): Promise<RouteResult> {
  const id = parsePathId(rawId);
  const parsed = areaPatchSchema.safeParse(body);
  if (!parsed.success) throw invalidBody(parsed.error.issues);
  const area = await masters.updateArea(
    ctx.repo,
    ctx.householdId,
    id,
    parsed.data,
  );
  return ok(areaDto(area));
}

// --- 対象リソース(resources) ---

export async function listResources(
  ctx: RouteCtx,
  query: URLSearchParams,
): Promise<RouteResult> {
  const q = parseQueryParams(listMastersQuerySchema, query);
  const items = await masters.listResources(
    ctx.repo,
    ctx.householdId,
    q.includeInactive === "true",
  );
  return ok({ items: items.map(resourceDto) });
}

export async function createResource(
  ctx: RouteCtx,
  body: unknown,
): Promise<RouteResult> {
  const parsed = resourceCreateSchema.safeParse(body);
  if (!parsed.success) throw invalidBody(parsed.error.issues);
  const resource = await masters.createResource(
    ctx.repo,
    ctx.householdId,
    parsed.data,
  );
  return ok(resourceDto(resource), 201);
}

export async function patchResource(
  ctx: RouteCtx,
  rawId: string,
  body: unknown,
): Promise<RouteResult> {
  const id = parsePathId(rawId);
  const parsed = resourcePatchSchema.safeParse(body);
  if (!parsed.success) throw invalidBody(parsed.error.issues);
  const resource = await masters.updateResource(
    ctx.repo,
    ctx.householdId,
    id,
    parsed.data,
  );
  return ok(resourceDto(resource));
}

// --- カテゴリ(chore-categories) ---

export async function listCategories(
  ctx: RouteCtx,
  query: URLSearchParams,
): Promise<RouteResult> {
  const q = parseQueryParams(listMastersQuerySchema, query);
  const items = await masters.listChoreCategories(
    ctx.repo,
    ctx.householdId,
    q.includeInactive === "true",
  );
  return ok({ items: items.map(categoryDto) });
}

export async function createCategory(
  ctx: RouteCtx,
  body: unknown,
): Promise<RouteResult> {
  const parsed = categoryCreateSchema.safeParse(body);
  if (!parsed.success) throw invalidBody(parsed.error.issues);
  const category = await masters.createChoreCategory(
    ctx.repo,
    ctx.householdId,
    parsed.data,
  );
  return ok(categoryDto(category), 201);
}

export async function patchCategory(
  ctx: RouteCtx,
  rawId: string,
  body: unknown,
): Promise<RouteResult> {
  const id = parsePathId(rawId);
  const parsed = categoryPatchSchema.safeParse(body);
  if (!parsed.success) throw invalidBody(parsed.error.issues);
  const category = await masters.updateChoreCategory(
    ctx.repo,
    ctx.householdId,
    id,
    parsed.data,
  );
  return ok(categoryDto(category));
}
