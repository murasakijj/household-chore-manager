import type {
  Repo,
  Area,
  Resource,
  ChoreCategory,
  ResourceType,
} from "../repo/types.js";
import { ApiError, notFound } from "../apiError.js";
import { RepoNotFoundError } from "../repo/errors.js";

/** 場所・カテゴリ共通: 新規作成時の `sortOrder` は既存最大+1。 */
async function nextSortOrder(
  existing: { sortOrder: number }[],
): Promise<number> {
  return existing.reduce((max, x) => Math.max(max, x.sortOrder), -1) + 1;
}

// --- 場所(areas) ---

export async function listAreas(
  repo: Repo,
  householdId: string,
  includeInactive: boolean,
): Promise<Area[]> {
  return repo.listAreas(householdId, { includeInactive });
}

export async function createArea(
  repo: Repo,
  householdId: string,
  input: { name: string },
): Promise<Area> {
  const existing = await repo.listAreas(householdId, { includeInactive: true });
  const sortOrder = await nextSortOrder(existing);
  return repo.createArea(householdId, { name: input.name, sortOrder });
}

export async function updateArea(
  repo: Repo,
  householdId: string,
  id: string,
  patch: Partial<Pick<Area, "name" | "sortOrder" | "isActive">>,
): Promise<Area> {
  try {
    return await repo.updateArea(householdId, id, patch);
  } catch (err) {
    throw toApiError(err, "area");
  }
}

// --- 対象リソース(resources) ---

export async function listResources(
  repo: Repo,
  householdId: string,
  includeInactive: boolean,
): Promise<Resource[]> {
  return repo.listResources(householdId, { includeInactive });
}

export async function createResource(
  repo: Repo,
  householdId: string,
  input: {
    name: string;
    areaId?: string | null;
    resourceType?: ResourceType;
    externalRef?: string | null;
  },
): Promise<Resource> {
  const areaId = input.areaId ?? null;
  if (areaId) {
    const area = await repo.getArea(householdId, areaId);
    if (!area) throw invalidReference("areaId");
  }
  return repo.createResource(householdId, {
    name: input.name,
    areaId,
    resourceType: input.resourceType ?? "other",
    externalRef: input.externalRef ?? null,
  });
}

export async function updateResource(
  repo: Repo,
  householdId: string,
  id: string,
  patch: Partial<
    Pick<
      Resource,
      "name" | "areaId" | "resourceType" | "externalRef" | "isActive"
    >
  >,
): Promise<Resource> {
  if (patch.areaId) {
    const area = await repo.getArea(householdId, patch.areaId);
    if (!area) throw invalidReference("areaId");
  }
  try {
    return await repo.updateResource(householdId, id, patch);
  } catch (err) {
    throw toApiError(err, "resource");
  }
}

// --- カテゴリ(choreCategories) ---

export async function listChoreCategories(
  repo: Repo,
  householdId: string,
  includeInactive: boolean,
): Promise<ChoreCategory[]> {
  return repo.listChoreCategories(householdId, { includeInactive });
}

export async function createChoreCategory(
  repo: Repo,
  householdId: string,
  input: { name: string },
): Promise<ChoreCategory> {
  const existing = await repo.listChoreCategories(householdId, {
    includeInactive: true,
  });
  const sortOrder = await nextSortOrder(existing);
  return repo.createChoreCategory(householdId, { name: input.name, sortOrder });
}

export async function updateChoreCategory(
  repo: Repo,
  householdId: string,
  id: string,
  patch: Partial<Pick<ChoreCategory, "name" | "sortOrder" | "isActive">>,
): Promise<ChoreCategory> {
  try {
    return await repo.updateChoreCategory(householdId, id, patch);
  } catch (err) {
    throw toApiError(err, "chore_category");
  }
}

function invalidReference(field: string): ApiError {
  return new ApiError(400, "invalid_reference", { field });
}

function toApiError(err: unknown, resource: string): unknown {
  if (err instanceof RepoNotFoundError) return notFound(resource);
  return err;
}
