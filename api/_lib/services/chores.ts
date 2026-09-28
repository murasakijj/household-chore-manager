import type { Area, Chore, ChoreCategory, ChoreEvent, Repo, Resource } from "../repo/types.js";
import {
  computeChoreStatus,
  defaultWarningGrace,
  validateIntervals,
  InvalidIntervalError,
  type ChoreStatus,
} from "../domain/status.js";
import { compareChoresForDisplay } from "../domain/ordering.js";
import { ApiError, notFound } from "../apiError.js";
import { RepoNotFoundError } from "../repo/errors.js";

export interface ChoreWithStatus extends Chore {
  status: ChoreStatus;
  elapsedDays: number | null;
  overdueDays: number | null;
  nextChangeDate: string | null;
}

export interface ListChoresFilter {
  status?: ChoreStatus;
  areaId?: string;
  categoryId?: string;
  q?: string;
  includeInactive?: boolean;
  sort?: "status" | "elapsed" | "name";
}

function attachStatus(
  chore: Chore,
  now: Date,
  timezone: string,
): ChoreWithStatus {
  const result = computeChoreStatus({
    isActive: chore.isActive,
    lastCompletedAt: chore.lastCompletedAt,
    intervalDays: chore.intervalDays,
    warningDays: chore.warningDays,
    graceDays: chore.graceDays,
    now,
    timezone,
  });
  return { ...chore, ...result };
}

export async function listChoresWithStatus(
  repo: Repo,
  householdId: string,
  timezone: string,
  now: Date,
  filter: ListChoresFilter,
): Promise<ChoreWithStatus[]> {
  const chores = await repo.listChores(householdId, {
    includeInactive: filter.includeInactive,
  });
  let withStatus = chores.map((c) => attachStatus(c, now, timezone));

  if (filter.status) {
    withStatus = withStatus.filter((c) => c.status === filter.status);
  }
  if (filter.areaId) {
    withStatus = withStatus.filter((c) => c.areaId === filter.areaId);
  }
  if (filter.categoryId) {
    withStatus = withStatus.filter((c) => c.categoryId === filter.categoryId);
  }
  if (filter.q) {
    const q = filter.q.toLowerCase();
    withStatus = withStatus.filter((c) => c.name.toLowerCase().includes(q));
  }

  const sort = filter.sort ?? "status";
  if (sort === "name") {
    withStatus.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  } else if (sort === "elapsed") {
    withStatus.sort((a, b) => (b.elapsedDays ?? -1) - (a.elapsedDays ?? -1));
  } else {
    withStatus.sort(compareChoresForDisplay);
  }

  return withStatus;
}

export async function getChoreWithStatus(
  repo: Repo,
  householdId: string,
  id: string,
  timezone: string,
  now: Date,
): Promise<ChoreWithStatus> {
  const chore = await repo.getChore(householdId, id);
  if (!chore) throw notFound("chore");
  return attachStatus(chore, now, timezone);
}

export interface ChoreDetail extends ChoreWithStatus {
  recentEvents: ChoreEvent[];
  averageIntervalDays: number | null;
}

/** 家事詳細(設計書 §8.4): 最近の履歴20件・平均実施間隔(有効履歴2件以上)。 */
export async function getChoreDetail(
  repo: Repo,
  householdId: string,
  id: string,
  timezone: string,
  now: Date,
): Promise<ChoreDetail> {
  const withStatus = await getChoreWithStatus(
    repo,
    householdId,
    id,
    timezone,
    now,
  );
  // 表示用(最近20件)と平均実施間隔の算出を1回の読み取りで済ませる
  // (直近最大100件の有効履歴から算出する参考値。全履歴は読まない)。
  const page = await repo.listChoreEventsForChore(householdId, id, {
    limit: 100,
    includeVoided: false,
  });
  const recentEvents = page.items.slice(0, 20);
  const averageIntervalDays = computeAverageIntervalDays(page.items);

  return { ...withStatus, recentEvents, averageIntervalDays };
}

function computeAverageIntervalDays(events: ChoreEvent[]): number | null {
  if (events.length < 2) return null;
  const sorted = [...events].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
  const spans: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const diffMs =
      sorted[i].occurredAt.getTime() - sorted[i - 1].occurredAt.getTime();
    spans.push(diffMs / (24 * 60 * 60 * 1000));
  }
  const avg = spans.reduce((sum, v) => sum + v, 0) / spans.length;
  return Math.round(avg * 10) / 10;
}

export interface CreateChoreInput {
  name: string;
  intervalDays: number;
  warningDays?: number;
  graceDays?: number;
  categoryId?: string | null;
  areaId?: string | null;
  resourceId?: string | null;
  description?: string | null;
  lastCompletedAt?: string | null;
}

export interface CreateChoreResult {
  chore: ChoreWithStatus;
  warnings: string[];
}

/** 参照先(場所・カテゴリ・対象リソース)が同一家庭に存在するか検証する(設計書 §10.6 制約)。 */
async function validateReferences(
  repo: Repo,
  householdId: string,
  input: {
    categoryId?: string | null;
    areaId?: string | null;
    resourceId?: string | null;
  },
): Promise<void> {
  if (input.categoryId) {
    const category = await repo.getChoreCategory(householdId, input.categoryId);
    if (!category) throw invalidReference("categoryId");
  }
  if (input.areaId) {
    const area = await repo.getArea(householdId, input.areaId);
    if (!area) throw invalidReference("areaId");
  }
  if (input.resourceId) {
    const resource = await repo.getResource(householdId, input.resourceId);
    if (!resource) throw invalidReference("resourceId");
  }
}

function invalidReference(field: string): ApiError {
  return new ApiError(400, "invalid_reference", { field });
}

export async function createChore(
  repo: Repo,
  householdId: string,
  createdBy: string,
  timezone: string,
  now: Date,
  input: CreateChoreInput,
): Promise<CreateChoreResult> {
  await validateReferences(repo, householdId, input);

  const defaults = defaultWarningGrace(input.intervalDays);
  const warningDays = input.warningDays ?? defaults.warningDays;
  const graceDays = input.graceDays ?? defaults.graceDays;

  try {
    validateIntervals({
      intervalDays: input.intervalDays,
      warningDays,
      graceDays,
    });
  } catch (err) {
    if (err instanceof InvalidIntervalError) {
      throw new ApiError(400, "invalid_body", { message: err.message });
    }
    throw err;
  }

  let lastCompletedAt: Date | null = null;
  if (input.lastCompletedAt) {
    lastCompletedAt = new Date(input.lastCompletedAt);
    if (lastCompletedAt.getTime() > now.getTime()) {
      throw new ApiError(400, "invalid_body", {
        field: "lastCompletedAt",
        reason: "future",
      });
    }
  }

  const existing = await repo.listChores(householdId, {
    includeInactive: true,
  });
  const warnings: string[] = [];
  if (existing.some((c) => c.name === input.name)) {
    warnings.push("duplicate_name");
  }

  // 家事作成 + (指定があれば)初回イベント追加は、リポジトリ側で1回の書き込み単位に
  // まとめる(レビュー指摘 #16)。
  const chore = await repo.createChore(householdId, {
    name: input.name,
    description: input.description ?? null,
    categoryId: input.categoryId ?? null,
    areaId: input.areaId ?? null,
    resourceId: input.resourceId ?? null,
    scheduleType: "interval",
    intervalDays: input.intervalDays,
    warningDays,
    graceDays,
    isActive: true,
    createdBy,
    lastCompletedAt,
  });

  return { chore: attachStatus(chore, now, timezone), warnings };
}

export interface BulkCreateResult {
  created: ChoreWithStatus[];
  warnings: Array<{ index: number; warnings: string[] }>;
}

/**
 * `/api/chores/bulk`: 一括提案からの登録。最大50件(architecture.md)。
 * 参照先・間隔の検証は全件を先に行い、1件でも不正なら書き込みを一切行わない
 * (レビュー指摘 #7)。既存の家事名は1回だけ読み、Firestoreへの書き込みも
 * `repo.createChoresBulk` で1回にまとめる。
 */
export async function bulkCreateChores(
  repo: Repo,
  householdId: string,
  createdBy: string,
  timezone: string,
  now: Date,
  items: CreateChoreInput[],
): Promise<BulkCreateResult> {
  // 参照先(場所・カテゴリ・対象リソース)は家庭あたり1回ずつ読み、以降はSetで検証する。
  const [areas, categories, resources, existingChores] = await Promise.all([
    repo.listAreas(householdId, { includeInactive: true }),
    repo.listChoreCategories(householdId, { includeInactive: true }),
    repo.listResources(householdId, { includeInactive: true }),
    repo.listChores(householdId, { includeInactive: true }),
  ]);
  const areaIds = new Set<string>(areas.map((a: Area) => a.id));
  const categoryIds = new Set<string>(categories.map((c: ChoreCategory) => c.id));
  const resourceIds = new Set<string>(resources.map((r: Resource) => r.id));
  const existingNames = new Set<string>(existingChores.map((c) => c.name));

  const prepared: Array<{
    input: Omit<
      Chore,
      "id" | "householdId" | "createdAt" | "updatedAt" | "lastCompletedAt"
    > & { lastCompletedAt: Date | null };
    warnings: string[];
  }> = [];
  const seenNamesInBatch = new Set<string>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (item.categoryId && !categoryIds.has(item.categoryId)) {
      throw new ApiError(400, "invalid_reference", { index: i, field: "categoryId" });
    }
    if (item.areaId && !areaIds.has(item.areaId)) {
      throw new ApiError(400, "invalid_reference", { index: i, field: "areaId" });
    }
    if (item.resourceId && !resourceIds.has(item.resourceId)) {
      throw new ApiError(400, "invalid_reference", { index: i, field: "resourceId" });
    }

    const defaults = defaultWarningGrace(item.intervalDays);
    const warningDays = item.warningDays ?? defaults.warningDays;
    const graceDays = item.graceDays ?? defaults.graceDays;
    try {
      validateIntervals({ intervalDays: item.intervalDays, warningDays, graceDays });
    } catch (err) {
      if (err instanceof InvalidIntervalError) {
        throw new ApiError(400, "invalid_body", { index: i, message: err.message });
      }
      throw err;
    }

    let lastCompletedAt: Date | null = null;
    if (item.lastCompletedAt) {
      lastCompletedAt = new Date(item.lastCompletedAt);
      if (lastCompletedAt.getTime() > now.getTime()) {
        throw new ApiError(400, "invalid_body", {
          index: i,
          field: "lastCompletedAt",
          reason: "future",
        });
      }
    }

    const warnings: string[] = [];
    if (existingNames.has(item.name) || seenNamesInBatch.has(item.name)) {
      warnings.push("duplicate_name");
    }
    seenNamesInBatch.add(item.name);

    prepared.push({
      input: {
        name: item.name,
        description: item.description ?? null,
        categoryId: item.categoryId ?? null,
        areaId: item.areaId ?? null,
        resourceId: item.resourceId ?? null,
        scheduleType: "interval",
        intervalDays: item.intervalDays,
        warningDays,
        graceDays,
        isActive: true,
        createdBy,
        lastCompletedAt,
      },
      warnings,
    });
  }

  const createdChores = await repo.createChoresBulk(
    householdId,
    prepared.map((p) => p.input),
  );

  const warnings: Array<{ index: number; warnings: string[] }> = [];
  prepared.forEach((p, i) => {
    if (p.warnings.length > 0) warnings.push({ index: i, warnings: p.warnings });
  });

  return {
    created: createdChores.map((c) => attachStatus(c, now, timezone)),
    warnings,
  };
}

export interface UpdateChoreInput {
  name?: string;
  intervalDays?: number;
  warningDays?: number;
  graceDays?: number;
  categoryId?: string | null;
  areaId?: string | null;
  resourceId?: string | null;
  description?: string | null;
  isActive?: boolean;
}

export async function updateChore(
  repo: Repo,
  householdId: string,
  id: string,
  timezone: string,
  now: Date,
  patch: UpdateChoreInput,
): Promise<ChoreWithStatus> {
  const current = await repo.getChore(householdId, id);
  if (!current) throw notFound("chore");

  await validateReferences(repo, householdId, patch);

  const intervalDays = patch.intervalDays ?? current.intervalDays;
  const warningDays = patch.warningDays ?? current.warningDays;
  const graceDays = patch.graceDays ?? current.graceDays;
  try {
    validateIntervals({ intervalDays, warningDays, graceDays });
  } catch (err) {
    if (err instanceof InvalidIntervalError) {
      throw new ApiError(400, "invalid_body", { message: err.message });
    }
    throw err;
  }

  try {
    const updated = await repo.updateChore(householdId, id, {
      ...patch,
      intervalDays,
      warningDays,
      graceDays,
    });
    return attachStatus(updated, now, timezone);
  } catch (err) {
    if (err instanceof RepoNotFoundError) throw notFound("chore");
    throw err;
  }
}
