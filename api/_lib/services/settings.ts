import type { Household, NotificationSettings, Repo } from "../repo/types.js";

export interface SettingsResult {
  household: Pick<Household, "id" | "name" | "timezone">;
  notification: Omit<NotificationSettings, "householdId">;
}

export async function getSettings(
  repo: Repo,
  householdId: string,
  memberId: string,
): Promise<SettingsResult> {
  const [household, existing] = await Promise.all([
    repo.getHousehold(householdId),
    repo.getNotificationSettings(householdId, memberId),
  ]);
  if (!household) throw new Error("household_not_found");

  const notification =
    existing ??
    (await repo.upsertNotificationSettings(householdId, memberId, {}));

  return {
    household: {
      id: household.id,
      name: household.name,
      timezone: household.timezone,
    },
    notification: {
      memberId: notification.memberId,
      dailySummaryEnabled: notification.dailySummaryEnabled,
      dailySummaryTime: notification.dailySummaryTime,
      includeUpcoming: notification.includeUpcoming,
      oneTapComplete: notification.oneTapComplete,
      lastSentLocalDate: notification.lastSentLocalDate,
      updatedAt: notification.updatedAt,
    },
  };
}

export interface UpdateSettingsInput {
  householdName?: string;
  timezone?: string;
  dailySummaryEnabled?: boolean;
  dailySummaryTime?: string;
  includeUpcoming?: boolean;
  oneTapComplete?: boolean;
}

export async function updateSettings(
  repo: Repo,
  householdId: string,
  memberId: string,
  input: UpdateSettingsInput,
): Promise<SettingsResult> {
  const householdPatch: Partial<Pick<Household, "name" | "timezone">> = {};
  if (input.householdName !== undefined)
    householdPatch.name = input.householdName;
  if (input.timezone !== undefined) householdPatch.timezone = input.timezone;
  if (Object.keys(householdPatch).length > 0) {
    await repo.updateHousehold(householdId, householdPatch);
  }

  const notificationPatch: Partial<
    Pick<
      NotificationSettings,
      | "dailySummaryEnabled"
      | "dailySummaryTime"
      | "includeUpcoming"
      | "oneTapComplete"
    >
  > = {};
  if (input.dailySummaryEnabled !== undefined)
    notificationPatch.dailySummaryEnabled = input.dailySummaryEnabled;
  if (input.dailySummaryTime !== undefined)
    notificationPatch.dailySummaryTime = input.dailySummaryTime;
  if (input.includeUpcoming !== undefined)
    notificationPatch.includeUpcoming = input.includeUpcoming;
  if (input.oneTapComplete !== undefined)
    notificationPatch.oneTapComplete = input.oneTapComplete;
  if (Object.keys(notificationPatch).length > 0) {
    await repo.upsertNotificationSettings(
      householdId,
      memberId,
      notificationPatch,
    );
  }

  return getSettings(repo, householdId, memberId);
}
