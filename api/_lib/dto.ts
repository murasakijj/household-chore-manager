/**
 * リポジトリ層のドメイン型(Date)をAPIレスポンス用(ISO 8601文字列)へ変換する。
 * 状態値は内部値のみを返す(表示名・色はフロントの `statusMeta.ts` の責務。architecture.md)。
 */
import type {
  Area,
  Chore,
  ChoreCategory,
  ChoreEvent,
  Household,
  Member,
  NotificationSettings,
  Resource,
} from "./repo/types.js";
import type { ChoreDetail, ChoreWithStatus } from "./services/chores.js";

function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

export function areaDto(area: Area) {
  return {
    id: area.id,
    name: area.name,
    sortOrder: area.sortOrder,
    isActive: area.isActive,
    createdAt: iso(area.createdAt),
    updatedAt: iso(area.updatedAt),
  };
}

export function resourceDto(resource: Resource) {
  return {
    id: resource.id,
    areaId: resource.areaId,
    resourceType: resource.resourceType,
    name: resource.name,
    externalRef: resource.externalRef,
    isActive: resource.isActive,
    createdAt: iso(resource.createdAt),
    updatedAt: iso(resource.updatedAt),
  };
}

export function categoryDto(category: ChoreCategory) {
  return {
    id: category.id,
    name: category.name,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    createdAt: iso(category.createdAt),
    updatedAt: iso(category.updatedAt),
  };
}

export function memberDto(member: Member) {
  return {
    id: member.id,
    displayName: member.displayName,
    isActive: member.isActive,
  };
}

export function householdDto(
  household: Pick<Household, "id" | "name" | "timezone">,
) {
  return {
    id: household.id,
    name: household.name,
    timezone: household.timezone,
  };
}

export function choreDto(chore: ChoreWithStatus | Chore) {
  const withStatus = chore as Partial<ChoreWithStatus>;
  return {
    id: chore.id,
    name: chore.name,
    description: chore.description,
    categoryId: chore.categoryId,
    areaId: chore.areaId,
    resourceId: chore.resourceId,
    scheduleType: chore.scheduleType,
    intervalDays: chore.intervalDays,
    warningDays: chore.warningDays,
    graceDays: chore.graceDays,
    isActive: chore.isActive,
    createdBy: chore.createdBy,
    createdAt: iso(chore.createdAt),
    updatedAt: iso(chore.updatedAt),
    lastCompletedAt: iso(chore.lastCompletedAt),
    status: withStatus.status ?? null,
    elapsedDays: withStatus.elapsedDays ?? null,
    overdueDays: withStatus.overdueDays ?? null,
    nextChangeDate: withStatus.nextChangeDate ?? null,
  };
}

export function choreDetailDto(detail: ChoreDetail) {
  return {
    ...choreDto(detail),
    recentEvents: detail.recentEvents.map(choreEventDto),
    averageIntervalDays: detail.averageIntervalDays,
  };
}

export function choreEventDto(event: ChoreEvent) {
  return {
    id: event.id,
    choreId: event.choreId,
    eventType: event.eventType,
    occurredAt: iso(event.occurredAt),
    actorMemberId: event.actorMemberId,
    recordedByMemberId: event.recordedByMemberId,
    note: event.note,
    voidedAt: iso(event.voidedAt),
    voidedByMemberId: event.voidedByMemberId,
    voidReason: event.voidReason,
    createdAt: iso(event.createdAt),
  };
}

export function notificationSettingsDto(
  settings: Omit<NotificationSettings, "householdId">,
) {
  return {
    memberId: settings.memberId,
    dailySummaryEnabled: settings.dailySummaryEnabled,
    dailySummaryTime: settings.dailySummaryTime,
    includeUpcoming: settings.includeUpcoming,
    oneTapComplete: settings.oneTapComplete,
  };
}
