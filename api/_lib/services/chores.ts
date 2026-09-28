import { randomUUID } from "node:crypto";
import type { Chore, ChoreEvent, Repo } from "../repo/types.js";
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
  const page = await repo.listChoreEventsForChore(householdId, id, {
    limit: 20,
    includeVoided: false,
  });
  const recentEvents = page.items;

  // 平均実施間隔は「有効履歴が2件以上」の場合のみ、全有効履歴から算出する参考値。
  const allActive = await repo.listChoreEventsForChore(householdId, id, {
    limit: 100,
    includeVoided: false,
  });
  const averageIntervalDays = computeAverageIntervalDays(allActive.items);

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
  });

  let finalChore = chore;
  if (lastCompletedAt) {
    const result = await repo.addChoreEvent({
      householdId,
      choreId: chore.id,
      clientRequestId: randomUUID(),
      occurredAt: lastCompletedAt,
      actorMemberId: createdBy,
      recordedByMemberId: createdBy,
      note: null,
    });
    finalChore = result.chore;
  }

  return { chore: attachStatus(finalChore, now, timezone), warnings };
}

export interface BulkCreateResult {
  created: ChoreWithStatus[];
  warnings: Array<{ index: number; warnings: string[] }>;
}

/** `/api/chores/bulk`: 一括提案からの登録。最大50件(architecture.md)。 */
export async function bulkCreateChores(
  repo: Repo,
  householdId: string,
  createdBy: string,
  timezone: string,
  now: Date,
  items: CreateChoreInput[],
): Promise<BulkCreateResult> {
  const created: ChoreWithStatus[] = [];
  const warnings: Array<{ index: number; warnings: string[] }> = [];
  for (let i = 0; i < items.length; i++) {
    const result = await createChore(
      repo,
      householdId,
      createdBy,
      timezone,
      now,
      items[i],
    );
    created.push(result.chore);
    if (result.warnings.length > 0)
      warnings.push({ index: i, warnings: result.warnings });
  }
  return { created, warnings };
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
