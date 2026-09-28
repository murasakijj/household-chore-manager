import type { ChoreEvent, Page, Repo } from "../repo/types.js";
import { ApiError, invalidQuery, notFound } from "../apiError.js";
import {
  RepoConflictError,
  RepoInvalidQueryError,
  RepoNotFoundError,
} from "../repo/errors.js";
import type { ChoreWithStatus } from "./chores.js";
import { getChoreWithStatus } from "./chores.js";

/** サーバー時刻に対して許容する数秒の時計ずれ(設計書 §11.4 未来日時は保存不可)。 */
const CLOCK_SKEW_TOLERANCE_MS = 5_000;

export interface AddChoreEventInput {
  choreId: string;
  clientRequestId: string;
  occurredAt?: string;
  actorMemberId?: string;
  note?: string | null;
}

export interface AddChoreEventOutcome {
  event: ChoreEvent;
  chore: ChoreWithStatus;
  idempotentReplay: boolean;
  possibleDuplicate: boolean;
}

export async function addChoreEvent(
  repo: Repo,
  householdId: string,
  recordedByMemberId: string,
  timezone: string,
  now: Date,
  input: AddChoreEventInput,
): Promise<AddChoreEventOutcome> {
  const chore = await repo.getChore(householdId, input.choreId);
  if (!chore) throw notFound("chore");

  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : now;
  if (occurredAt.getTime() - now.getTime() > CLOCK_SKEW_TOLERANCE_MS) {
    throw new ApiError(400, "invalid_body", {
      field: "occurredAt",
      reason: "future",
    });
  }

  const actorMemberId = input.actorMemberId ?? recordedByMemberId;
  if (input.actorMemberId) {
    const actor = await repo.getMember(householdId, input.actorMemberId);
    if (!actor)
      throw new ApiError(400, "invalid_reference", { field: "actorMemberId" });
  }

  let result;
  try {
    result = await repo.addChoreEvent({
      householdId,
      choreId: input.choreId,
      clientRequestId: input.clientRequestId,
      occurredAt,
      actorMemberId,
      recordedByMemberId,
      note: input.note ?? null,
    });
  } catch (err) {
    if (err instanceof RepoConflictError) throw new ApiError(409, err.code);
    throw err;
  }

  const choreWithStatus = await getChoreWithStatus(
    repo,
    householdId,
    input.choreId,
    timezone,
    now,
  );

  return {
    event: result.event,
    chore: choreWithStatus,
    idempotentReplay: result.idempotentReplay,
    possibleDuplicate: result.possibleDuplicate,
  };
}

export async function voidChoreEvent(
  repo: Repo,
  householdId: string,
  voidedByMemberId: string,
  timezone: string,
  now: Date,
  eventId: string,
  reason: string | null,
): Promise<{ event: ChoreEvent; chore: ChoreWithStatus }> {
  try {
    const result = await repo.voidChoreEvent({
      householdId,
      eventId,
      voidedByMemberId,
      voidReason: reason,
    });
    const chore = await getChoreWithStatus(
      repo,
      householdId,
      result.chore.id,
      timezone,
      now,
    );
    return { event: result.event, chore };
  } catch (err) {
    if (err instanceof RepoNotFoundError) throw notFound(err.resource);
    if (err instanceof RepoConflictError) {
      throw new ApiError(409, err.code);
    }
    throw err;
  }
}

export interface ListEventsQuery {
  limit?: number;
  cursor?: string | null;
  includeVoided?: boolean;
}

export async function listChoreEventsForChore(
  repo: Repo,
  householdId: string,
  choreId: string,
  query: ListEventsQuery,
): Promise<Page<ChoreEvent>> {
  const chore = await repo.getChore(householdId, choreId);
  if (!chore) throw notFound("chore");
  try {
    return await repo.listChoreEventsForChore(householdId, choreId, query);
  } catch (err) {
    if (err instanceof RepoInvalidQueryError) throw invalidQuery({ field: err.field });
    throw err;
  }
}

export interface ListEventsGlobalQuery extends ListEventsQuery {
  choreId?: string;
  areaId?: string;
  actorMemberId?: string;
  from?: string;
  to?: string;
}

export async function listChoreEvents(
  repo: Repo,
  householdId: string,
  query: ListEventsGlobalQuery,
): Promise<Page<ChoreEvent>> {
  // choreId/areaId は「一覧の対象資源」として404、actorMemberId は「絞り込み条件」
  // として400にする(レビュー指摘 #3, #8)。
  if (query.choreId) {
    const chore = await repo.getChore(householdId, query.choreId);
    if (!chore) throw notFound("chore");
  }
  if (query.areaId) {
    const area = await repo.getArea(householdId, query.areaId);
    if (!area) throw notFound("area");
  }
  if (query.actorMemberId) {
    const member = await repo.getMember(householdId, query.actorMemberId);
    if (!member) throw invalidQuery({ field: "actorMemberId" });
  }
  try {
    return await repo.listChoreEvents(householdId, {
      limit: query.limit,
      cursor: query.cursor,
      includeVoided: query.includeVoided,
      choreId: query.choreId,
      areaId: query.areaId,
      actorMemberId: query.actorMemberId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  } catch (err) {
    if (err instanceof RepoInvalidQueryError) throw invalidQuery({ field: err.field });
    throw err;
  }
}
