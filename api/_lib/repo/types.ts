/**
 * リポジトリ層の型定義(設計書 §10)。日時はすべて `Date`(UTC実時刻)として扱う。
 * ISO 8601文字列への変換はAPI境界(routes層)で行う。
 */

export type ResourceType =
  "appliance" | "fixture" | "baby_item" | "pet_item" | "storage" | "other";

export interface UserMembership {
  uid: string;
  householdId: string;
  memberId: string;
  email: string;
  createdAt: Date;
}

export interface Household {
  id: string;
  name: string;
  timezone: string;
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Member {
  id: string;
  householdId: string;
  displayName: string;
  userId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Area {
  id: string;
  householdId: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Resource {
  id: string;
  householdId: string;
  areaId: string | null;
  resourceType: ResourceType;
  name: string;
  externalRef: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChoreCategory {
  id: string;
  householdId: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Chore {
  id: string;
  householdId: string;
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
  createdAt: Date;
  updatedAt: Date;
  /** 最新の有効な実施日時のキャッシュ(decisions.md「最終実施日時キャッシュ」)。正本は choreEvents。 */
  lastCompletedAt: Date | null;
}

export interface ChoreEvent {
  id: string;
  householdId: string;
  choreId: string;
  eventType: "completed";
  occurredAt: Date;
  actorMemberId: string;
  recordedByMemberId: string;
  note: string | null;
  voidedAt: Date | null;
  voidedByMemberId: string | null;
  voidReason: string | null;
  createdAt: Date;
}

export interface PushSubscriptionRecord {
  /** `sha256(endpoint)` をIDとして使う(architecture.md)。 */
  id: string;
  householdId: string;
  memberId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: Date;
}

export interface NotificationSettings {
  memberId: string;
  householdId: string;
  dailySummaryEnabled: boolean;
  dailySummaryTime: string;
  includeUpcoming: boolean;
  oneTapComplete: boolean;
  lastSentLocalDate: string | null;
  updatedAt: Date;
}

export interface ListChoreEventsOptions {
  limit?: number;
  cursor?: string | null;
  includeVoided?: boolean;
}

export interface ListChoreEventsGlobalOptions extends ListChoreEventsOptions {
  choreId?: string;
  areaId?: string;
  actorMemberId?: string;
  from?: Date;
  to?: Date;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface AddChoreEventParams {
  householdId: string;
  choreId: string;
  /** クライアント生成の冪等キー。イベントIDとして使う(decisions.md)。 */
  clientRequestId: string;
  occurredAt: Date;
  actorMemberId: string;
  recordedByMemberId: string;
  note: string | null;
}

export interface AddChoreEventResult {
  event: ChoreEvent;
  chore: Chore;
  /** 同じIDで既存イベントを返した場合(冪等な再送) true。 */
  idempotentReplay: boolean;
  /** 同じ家事に10分以内の有効履歴が既にあった場合 true(decisions.md)。 */
  possibleDuplicate: boolean;
}

export interface VoidChoreEventParams {
  householdId: string;
  eventId: string;
  voidedByMemberId: string;
  voidReason: string | null;
}

export interface VoidChoreEventResult {
  event: ChoreEvent;
  chore: Chore;
}

/**
 * リポジトリインターフェース。サービス層はこれだけに依存する。
 * 本番実装は `firestoreRepo.ts`、テスト用実装は `memoryRepo.ts`。
 */
export interface Repo {
  // --- 家庭・メンバー(初回セットアップ含む) ---
  getUserMembership(uid: string): Promise<UserMembership | null>;
  /** 許可済み利用者の初回アクセス時に家庭一式を作成する(decisions.md「家庭の自動作成」)。 */
  bootstrapHouseholdForUser(params: {
    uid: string;
    email: string;
  }): Promise<UserMembership>;
  getHousehold(householdId: string): Promise<Household | null>;
  updateHousehold(
    householdId: string,
    patch: Partial<Pick<Household, "name" | "timezone">>,
  ): Promise<Household>;

  getMember(householdId: string, memberId: string): Promise<Member | null>;
  listMembers(householdId: string): Promise<Member[]>;

  // --- マスタ ---
  listAreas(
    householdId: string,
    opts?: { includeInactive?: boolean },
  ): Promise<Area[]>;
  getArea(householdId: string, id: string): Promise<Area | null>;
  createArea(
    householdId: string,
    input: { name: string; sortOrder: number },
  ): Promise<Area>;
  updateArea(
    householdId: string,
    id: string,
    patch: Partial<Pick<Area, "name" | "sortOrder" | "isActive">>,
  ): Promise<Area>;

  listResources(
    householdId: string,
    opts?: { includeInactive?: boolean },
  ): Promise<Resource[]>;
  getResource(householdId: string, id: string): Promise<Resource | null>;
  createResource(
    householdId: string,
    input: {
      areaId: string | null;
      resourceType: ResourceType;
      name: string;
      externalRef: string | null;
    },
  ): Promise<Resource>;
  updateResource(
    householdId: string,
    id: string,
    patch: Partial<
      Pick<
        Resource,
        "areaId" | "resourceType" | "name" | "externalRef" | "isActive"
      >
    >,
  ): Promise<Resource>;

  listChoreCategories(
    householdId: string,
    opts?: { includeInactive?: boolean },
  ): Promise<ChoreCategory[]>;
  getChoreCategory(
    householdId: string,
    id: string,
  ): Promise<ChoreCategory | null>;
  createChoreCategory(
    householdId: string,
    input: { name: string; sortOrder: number },
  ): Promise<ChoreCategory>;
  updateChoreCategory(
    householdId: string,
    id: string,
    patch: Partial<Pick<ChoreCategory, "name" | "sortOrder" | "isActive">>,
  ): Promise<ChoreCategory>;

  // --- 家事 ---
  listChores(
    householdId: string,
    opts?: { includeInactive?: boolean },
  ): Promise<Chore[]>;
  getChore(householdId: string, id: string): Promise<Chore | null>;
  createChore(
    householdId: string,
    input: Omit<
      Chore,
      "id" | "householdId" | "createdAt" | "updatedAt" | "lastCompletedAt"
    > & { lastCompletedAt?: Date | null },
  ): Promise<Chore>;
  /**
   * `/api/chores/bulk`: 複数件を1回の書き込みでまとめて作成する(設計書レビュー指摘 #7)。
   * 呼び出し側(サービス層)が参照・間隔の検証を全件先に済ませてから呼ぶこと。
   * `lastCompletedAt` を指定した項目は、家事作成と初回イベント追加を同じ書き込み単位で行う。
   */
  createChoresBulk(
    householdId: string,
    items: Array<
      Omit<
        Chore,
        "id" | "householdId" | "createdAt" | "updatedAt" | "lastCompletedAt"
      > & { lastCompletedAt?: Date | null }
    >,
  ): Promise<Chore[]>;
  updateChore(
    householdId: string,
    id: string,
    patch: Partial<
      Pick<
        Chore,
        | "name"
        | "description"
        | "categoryId"
        | "areaId"
        | "resourceId"
        | "intervalDays"
        | "warningDays"
        | "graceDays"
        | "isActive"
      >
    >,
  ): Promise<Chore>;

  // --- 実施履歴 ---
  addChoreEvent(params: AddChoreEventParams): Promise<AddChoreEventResult>;
  getChoreEvent(householdId: string, id: string): Promise<ChoreEvent | null>;
  voidChoreEvent(params: VoidChoreEventParams): Promise<VoidChoreEventResult>;
  listChoreEventsForChore(
    householdId: string,
    choreId: string,
    opts?: ListChoreEventsOptions,
  ): Promise<Page<ChoreEvent>>;
  listChoreEvents(
    householdId: string,
    opts?: ListChoreEventsGlobalOptions,
  ): Promise<Page<ChoreEvent>>;

  // --- 通知設定 ---
  getNotificationSettings(
    householdId: string,
    memberId: string,
  ): Promise<NotificationSettings | null>;
  upsertNotificationSettings(
    householdId: string,
    memberId: string,
    patch: Partial<
      Pick<
        NotificationSettings,
        | "dailySummaryEnabled"
        | "dailySummaryTime"
        | "includeUpcoming"
        | "oneTapComplete"
        | "lastSentLocalDate"
      >
    >,
  ): Promise<NotificationSettings>;

  // --- Web Push購読 ---
  /** 同じ `endpoint`(= id)なら上書きする(ブラウザの再購読)。 */
  upsertPushSubscription(
    householdId: string,
    memberId: string,
    sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  ): Promise<PushSubscriptionRecord>;
  deletePushSubscriptionByEndpoint(
    householdId: string,
    memberId: string,
    endpoint: string,
  ): Promise<void>;
  /** 404/410応答時の購読削除に使う(architecture.md「朝のまとめ通知ジョブ」)。 */
  deletePushSubscriptionById(householdId: string, id: string): Promise<void>;
  listPushSubscriptionsForMember(
    householdId: string,
    memberId: string,
  ): Promise<PushSubscriptionRecord[]>;

  // --- 朝のまとめ通知(cron) ---
  listHouseholds(): Promise<Household[]>;
  /** 家庭内の有効なメンバーと、その通知設定(無ければ既定値)を一括取得する。 */
  listActiveMembersWithNotificationSettings(
    householdId: string,
  ): Promise<Array<{ member: Member; settings: NotificationSettings }>>;
  /**
   * その日まだ送っていなければ `lastSentLocalDate` を `localDate` に更新して
   * `true` を返す(トランザクションで「未送信なら確保してから送る」。二重起動対策)。
   * 既に送信済み(`lastSentLocalDate === localDate`)なら何もせず `false` を返す。
   */
  claimDailySummarySlot(
    householdId: string,
    memberId: string,
    localDate: string,
  ): Promise<boolean>;
}
