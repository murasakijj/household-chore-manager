/**
 * 型付きAPIクライアント(architecture.md「フロントエンド」)。
 * レスポンス型は `api/_lib/dto.ts` と整合させる(`src` から `api/` を import しない)。
 */
import { auth } from "./firebase";

// --- DTO型(api/_lib/dto.ts と整合) ---

export type ChoreStatus =
  | "not_due"
  | "upcoming"
  | "recommended"
  | "overdue"
  | "never_done"
  | "inactive";

export type ResourceType =
  "appliance" | "fixture" | "baby_item" | "pet_item" | "storage" | "other";

export interface AreaDto {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ResourceDto {
  id: string;
  areaId: string | null;
  resourceType: ResourceType;
  name: string;
  externalRef: string | null;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CategoryDto {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface MemberDto {
  id: string;
  displayName: string;
  isActive: boolean;
}

export interface HouseholdDto {
  id: string;
  name: string;
  timezone: string;
}

export interface ChoreDto {
  id: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  areaId: string | null;
  resourceId: string | null;
  scheduleType: "interval";
  intervalDays: number;
  warningDays: number;
  graceDays: number;
  isActive: boolean;
  createdBy: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastCompletedAt: string | null;
  status: ChoreStatus | null;
  elapsedDays: number | null;
  overdueDays: number | null;
  nextChangeDate: string | null;
}

export interface ChoreEventDto {
  id: string;
  choreId: string;
  eventType: "completed";
  occurredAt: string | null;
  actorMemberId: string;
  recordedByMemberId: string;
  note: string | null;
  voidedAt: string | null;
  voidedByMemberId: string | null;
  voidReason: string | null;
  createdAt: string | null;
}

export interface ChoreDetailDto extends ChoreDto {
  recentEvents: ChoreEventDto[];
  averageIntervalDays: number | null;
}

export interface NotificationSettingsDto {
  memberId: string;
  dailySummaryEnabled: boolean;
  dailySummaryTime: string;
  includeUpcoming: boolean;
  oneTapComplete: boolean;
}

export interface TodaySections {
  overdue: ChoreDto[];
  recommended: ChoreDto[];
  upcoming: ChoreDto[];
  neverDone: ChoreDto[];
  doneToday: ChoreDto[];
}

export interface TodayResponse {
  sections: TodaySections;
  notDueCount: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

// --- リクエスト入力型 ---

export interface ChoreCreateInput {
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

export type ChorePatchInput = Partial<
  Omit<ChoreCreateInput, "lastCompletedAt">
> & { isActive?: boolean };

export interface ChoreEventCreateInput {
  clientRequestId: string;
  occurredAt?: string;
  actorMemberId?: string;
  note?: string | null;
}

export interface ListChoresParams {
  status?: ChoreStatus;
  areaId?: string;
  categoryId?: string;
  q?: string;
  includeInactive?: boolean;
  sort?: "status" | "elapsed" | "name";
}

export interface ListEventsForChoreParams {
  limit?: number;
  cursor?: string;
  includeVoided?: boolean;
}

export interface ListAllEventsParams extends ListEventsForChoreParams {
  choreId?: string;
  areaId?: string;
  actorMemberId?: string;
  from?: string;
  to?: string;
}

export interface SettingsResponse {
  household: HouseholdDto;
  notification: NotificationSettingsDto;
}

export interface SettingsPatchInput {
  householdName?: string;
  timezone?: string;
  dailySummaryEnabled?: boolean;
  dailySummaryTime?: string;
  includeUpcoming?: boolean;
  oneTapComplete?: boolean;
}

export interface InitialChoreTemplate {
  name: string;
  areaName: string;
  intervalDays: number;
}

export interface AiChoreSuggestion {
  areaId: string | null;
  categoryId: string | null;
  intervalDays: number;
  warningDays: number;
  graceDays: number;
  description: string | null;
}

export interface AiChoreProposalItem extends AiChoreSuggestion {
  name: string;
  alreadyExists: boolean;
}

export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

// --- HTTPクライアント本体 ---

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, details?: unknown) {
    super(code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function readError(
  res: Response,
): Promise<{ code: string; details?: unknown }> {
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return { code: "server_error" };
  }
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    typeof (parsed as { error?: unknown }).error === "string"
  ) {
    const obj = parsed as { error: string; details?: unknown };
    return { code: obj.error, details: obj.details };
  }
  return { code: "unknown_error" };
}

async function authHeader(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    throw new ApiError(401, "not_authenticated");
  }
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

function toQueryString(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(
    params as Record<string, unknown>,
  )) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

async function request<T>(
  method: string,
  path: string,
  options: { query?: object; body?: unknown } = {},
): Promise<T> {
  const headers = await authHeader();
  const init: RequestInit = { method, headers: { ...headers } };
  if (options.body !== undefined) {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(options.body);
  }
  const query = options.query ? toQueryString(options.query) : "";
  const res = await fetch(`/api/${path}${query}`, init);
  if (!res.ok) {
    const { code, details } = await readError(res);
    throw new ApiError(res.status, code, details);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function checkAuth(): Promise<{
  ok: true;
  member: MemberDto;
  household: HouseholdDto;
}> {
  return request("GET", "auth-check");
}

export async function listChores(
  params: ListChoresParams = {},
): Promise<{ items: ChoreDto[] }> {
  return request("GET", "chores", { query: params });
}

export async function getToday(): Promise<TodayResponse> {
  return request("GET", "chores/today");
}

export async function getChore(id: string): Promise<ChoreDetailDto> {
  return request("GET", `chores/${encodeURIComponent(id)}`);
}

export async function createChore(
  input: ChoreCreateInput,
): Promise<{ chore: ChoreDto; warnings: string[] }> {
  return request("POST", "chores", { body: input });
}

export async function patchChore(
  id: string,
  patch: ChorePatchInput,
): Promise<ChoreDto> {
  return request("PATCH", `chores/${encodeURIComponent(id)}`, { body: patch });
}

export async function addChoreEvent(
  choreId: string,
  input: ChoreEventCreateInput,
): Promise<{
  event: ChoreEventDto;
  chore: ChoreDto;
  idempotentReplay: boolean;
  possibleDuplicate: boolean;
}> {
  return request("POST", `chores/${encodeURIComponent(choreId)}/events`, {
    body: input,
  });
}

export async function listEventsForChore(
  choreId: string,
  params: ListEventsForChoreParams = {},
): Promise<Page<ChoreEventDto>> {
  return request("GET", `chores/${encodeURIComponent(choreId)}/events`, {
    query: params,
  });
}

export async function listAllEvents(
  params: ListAllEventsParams = {},
): Promise<Page<ChoreEventDto>> {
  return request("GET", "chore-events", { query: params });
}

export async function voidChoreEvent(
  eventId: string,
  reason?: string | null,
): Promise<{ event: ChoreEventDto; chore: ChoreDto }> {
  return request("POST", `chore-events/${encodeURIComponent(eventId)}/void`, {
    body: { reason: reason ?? null },
  });
}

export async function listAreas(
  includeInactive = false,
): Promise<{ items: AreaDto[] }> {
  return request("GET", "areas", { query: { includeInactive } });
}

export async function createArea(name: string): Promise<AreaDto> {
  return request("POST", "areas", { body: { name } });
}

export async function patchArea(
  id: string,
  patch: Partial<{ name: string; sortOrder: number; isActive: boolean }>,
): Promise<AreaDto> {
  return request("PATCH", `areas/${encodeURIComponent(id)}`, { body: patch });
}

export async function listResources(
  includeInactive = false,
): Promise<{ items: ResourceDto[] }> {
  return request("GET", "resources", { query: { includeInactive } });
}

export async function createResource(input: {
  name: string;
  areaId?: string | null;
  resourceType?: ResourceType;
  externalRef?: string | null;
}): Promise<ResourceDto> {
  return request("POST", "resources", { body: input });
}

export async function patchResource(
  id: string,
  patch: Partial<{
    name: string;
    areaId: string | null;
    resourceType: ResourceType;
    externalRef: string | null;
    isActive: boolean;
  }>,
): Promise<ResourceDto> {
  return request("PATCH", `resources/${encodeURIComponent(id)}`, {
    body: patch,
  });
}

export async function listCategories(
  includeInactive = false,
): Promise<{ items: CategoryDto[] }> {
  return request("GET", "chore-categories", { query: { includeInactive } });
}

export async function createCategory(name: string): Promise<CategoryDto> {
  return request("POST", "chore-categories", { body: { name } });
}

export async function patchCategory(
  id: string,
  patch: Partial<{ name: string; sortOrder: number; isActive: boolean }>,
): Promise<CategoryDto> {
  return request("PATCH", `chore-categories/${encodeURIComponent(id)}`, {
    body: patch,
  });
}

export async function getSettings(): Promise<SettingsResponse> {
  return request("GET", "settings");
}

export async function patchSettings(
  patch: SettingsPatchInput,
): Promise<SettingsResponse> {
  return request("PATCH", "settings", { body: patch });
}

export async function listMembers(): Promise<{ items: MemberDto[] }> {
  return request("GET", "members");
}

export async function getInitialChoreTemplates(): Promise<{
  items: InitialChoreTemplate[];
}> {
  return request("GET", "templates/initial-chores");
}

export async function bulkCreateChores(
  items: ChoreCreateInput[],
): Promise<{ created: ChoreDto[]; warnings: Array<{ index: number; warnings: string[] }> }> {
  return request("POST", "chores/bulk", { body: { items } });
}

export async function aiChoreSuggestion(
  name: string,
): Promise<AiChoreSuggestion> {
  return request("POST", "ai/chore-suggestion", { body: { name } });
}

export async function aiChoreListProposal(
  context: string,
): Promise<{ items: AiChoreProposalItem[] }> {
  return request("POST", "ai/chore-list-proposal", { body: { context } });
}

export async function subscribePush(
  subscription: PushSubscriptionJson,
): Promise<void> {
  await request("POST", "push/subscriptions", { body: subscription });
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  await request("DELETE", "push/subscriptions", { body: { endpoint } });
}

export async function sendTestPush(): Promise<{
  sent: number;
  removed: number;
  failed: number;
}> {
  return request("POST", "push/test");
}
