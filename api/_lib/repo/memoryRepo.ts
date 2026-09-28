import { randomUUID } from "node:crypto";
import type {
  AddChoreEventParams,
  AddChoreEventResult,
  Area,
  Chore,
  ChoreCategory,
  ChoreEvent,
  Household,
  ListChoreEventsGlobalOptions,
  ListChoreEventsOptions,
  Member,
  NotificationSettings,
  Page,
  Repo,
  Resource,
  ResourceType,
  UserMembership,
  VoidChoreEventParams,
  VoidChoreEventResult,
} from "./types.js";
import { RepoConflictError, RepoInvalidQueryError, RepoNotFoundError } from "./errors.js";

/** 設計書 §18 の推奨初期データ(場所)。decisions.md「家庭の自動作成」で使う。 */
const INITIAL_AREAS = [
  "キッチン",
  "浴室",
  "洗面所",
  "トイレ",
  "リビング",
  "寝室",
  "玄関",
  "物干部屋",
  "犬用品",
  "赤ちゃん用品",
];

/** 設計書 §18 の推奨初期データ(カテゴリ)。 */
const INITIAL_CATEGORIES = [
  "掃除",
  "洗濯",
  "交換",
  "補充",
  "整理",
  "犬",
  "赤ちゃん用品",
  "その他",
];

/** 10分以内の再記録を possibleDuplicate として警告する(decisions.md)。 */
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

/** 家庭をまたいだキー衝突が起きないよう、Mapのキーは `${householdId}/${id}` にする(レビュー指摘 #10)。 */
function key(householdId: string, id: string): string {
  return `${householdId}/${id}`;
}

type ChoreCreateInput = Omit<
  Chore,
  "id" | "householdId" | "createdAt" | "updatedAt" | "lastCompletedAt"
> & { lastCompletedAt?: Date | null };

/**
 * テスト・結合テスト用のインメモリリポジトリ。`firestoreRepo.ts` と同じ
 * `Repo` インターフェースを実装し、サービス層のロジックをFirestore無しで検証できる。
 */
export class MemoryRepo implements Repo {
  private memberships = new Map<string, UserMembership>();
  private households = new Map<string, Household>();
  private members = new Map<string, Member>();
  private areas = new Map<string, Area>();
  private resources = new Map<string, Resource>();
  private categories = new Map<string, ChoreCategory>();
  private chores = new Map<string, Chore>();
  private events = new Map<string, ChoreEvent>();
  private notificationSettings = new Map<string, NotificationSettings>();

  async getUserMembership(uid: string): Promise<UserMembership | null> {
    return this.memberships.get(uid) ?? null;
  }

  async bootstrapHouseholdForUser(params: {
    uid: string;
    email: string;
  }): Promise<UserMembership> {
    const existing = this.memberships.get(params.uid);
    if (existing) return existing;

    const now = new Date();
    const householdId = randomUUID();
    const memberId = randomUUID();

    const household: Household = {
      id: householdId,
      name: "わが家",
      timezone: "Asia/Tokyo",
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.households.set(householdId, household);

    const member: Member = {
      id: memberId,
      householdId,
      displayName: params.email,
      userId: params.uid,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    this.members.set(key(householdId, memberId), member);

    INITIAL_AREAS.forEach((name, index) => {
      const id = randomUUID();
      this.areas.set(key(householdId, id), {
        id,
        householdId,
        name,
        sortOrder: index,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    });

    INITIAL_CATEGORIES.forEach((name, index) => {
      const id = randomUUID();
      this.categories.set(key(householdId, id), {
        id,
        householdId,
        name,
        sortOrder: index,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    });

    const settings: NotificationSettings = {
      memberId,
      householdId,
      dailySummaryEnabled: true,
      dailySummaryTime: "08:00",
      includeUpcoming: false,
      oneTapComplete: true,
      lastSentLocalDate: null,
      updatedAt: now,
    };
    this.notificationSettings.set(key(householdId, memberId), settings);

    const membership: UserMembership = {
      uid: params.uid,
      householdId,
      memberId,
      email: params.email,
      createdAt: now,
    };
    this.memberships.set(params.uid, membership);
    return membership;
  }

  async getHousehold(householdId: string): Promise<Household | null> {
    return this.households.get(householdId) ?? null;
  }

  async updateHousehold(
    householdId: string,
    patch: Partial<Pick<Household, "name" | "timezone">>,
  ): Promise<Household> {
    const current = this.requireHousehold(householdId);
    const updated: Household = { ...current, ...patch, updatedAt: new Date() };
    this.households.set(householdId, updated);
    return updated;
  }

  async getMember(
    householdId: string,
    memberId: string,
  ): Promise<Member | null> {
    return this.members.get(key(householdId, memberId)) ?? null;
  }

  async listMembers(householdId: string): Promise<Member[]> {
    return [...this.members.values()].filter(
      (m) => m.householdId === householdId,
    );
  }

  // --- 場所 ---

  async listAreas(
    householdId: string,
    opts?: { includeInactive?: boolean },
  ): Promise<Area[]> {
    return [...this.areas.values()]
      .filter((a) => a.householdId === householdId)
      .filter((a) => opts?.includeInactive || a.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async getArea(householdId: string, id: string): Promise<Area | null> {
    return this.areas.get(key(householdId, id)) ?? null;
  }

  async createArea(
    householdId: string,
    input: { name: string; sortOrder: number },
  ): Promise<Area> {
    const now = new Date();
    const area: Area = {
      id: randomUUID(),
      householdId,
      name: input.name,
      sortOrder: input.sortOrder,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    this.areas.set(key(householdId, area.id), area);
    return area;
  }

  async updateArea(
    householdId: string,
    id: string,
    patch: Partial<Pick<Area, "name" | "sortOrder" | "isActive">>,
  ): Promise<Area> {
    const current = this.requireArea(householdId, id);
    const updated: Area = { ...current, ...patch, updatedAt: new Date() };
    this.areas.set(key(householdId, id), updated);
    return updated;
  }

  // --- 対象リソース ---

  async listResources(
    householdId: string,
    opts?: { includeInactive?: boolean },
  ): Promise<Resource[]> {
    return [...this.resources.values()]
      .filter((r) => r.householdId === householdId)
      .filter((r) => opts?.includeInactive || r.isActive);
  }

  async getResource(householdId: string, id: string): Promise<Resource | null> {
    return this.resources.get(key(householdId, id)) ?? null;
  }

  async createResource(
    householdId: string,
    input: {
      areaId: string | null;
      resourceType: ResourceType;
      name: string;
      externalRef: string | null;
    },
  ): Promise<Resource> {
    const now = new Date();
    const resource: Resource = {
      id: randomUUID(),
      householdId,
      areaId: input.areaId,
      resourceType: input.resourceType,
      name: input.name,
      externalRef: input.externalRef,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    this.resources.set(key(householdId, resource.id), resource);
    return resource;
  }

  async updateResource(
    householdId: string,
    id: string,
    patch: Partial<
      Pick<
        Resource,
        "areaId" | "resourceType" | "name" | "externalRef" | "isActive"
      >
    >,
  ): Promise<Resource> {
    const current = this.requireResource(householdId, id);
    const updated: Resource = { ...current, ...patch, updatedAt: new Date() };
    this.resources.set(key(householdId, id), updated);
    return updated;
  }

  // --- カテゴリ ---

  async listChoreCategories(
    householdId: string,
    opts?: { includeInactive?: boolean },
  ): Promise<ChoreCategory[]> {
    return [...this.categories.values()]
      .filter((c) => c.householdId === householdId)
      .filter((c) => opts?.includeInactive || c.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async getChoreCategory(
    householdId: string,
    id: string,
  ): Promise<ChoreCategory | null> {
    return this.categories.get(key(householdId, id)) ?? null;
  }

  async createChoreCategory(
    householdId: string,
    input: { name: string; sortOrder: number },
  ): Promise<ChoreCategory> {
    const now = new Date();
    const category: ChoreCategory = {
      id: randomUUID(),
      householdId,
      name: input.name,
      sortOrder: input.sortOrder,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    this.categories.set(key(householdId, category.id), category);
    return category;
  }

  async updateChoreCategory(
    householdId: string,
    id: string,
    patch: Partial<Pick<ChoreCategory, "name" | "sortOrder" | "isActive">>,
  ): Promise<ChoreCategory> {
    const current = this.requireCategory(householdId, id);
    const updated: ChoreCategory = {
      ...current,
      ...patch,
      updatedAt: new Date(),
    };
    this.categories.set(key(householdId, id), updated);
    return updated;
  }

  // --- 家事 ---

  async listChores(
    householdId: string,
    opts?: { includeInactive?: boolean },
  ): Promise<Chore[]> {
    return [...this.chores.values()]
      .filter((c) => c.householdId === householdId)
      .filter((c) => opts?.includeInactive || c.isActive);
  }

  async getChore(householdId: string, id: string): Promise<Chore | null> {
    return this.chores.get(key(householdId, id)) ?? null;
  }

  async createChore(
    householdId: string,
    input: ChoreCreateInput,
  ): Promise<Chore> {
    const [chore] = await this.createChoresBulk(householdId, [input]);
    return chore;
  }

  async createChoresBulk(
    householdId: string,
    items: ChoreCreateInput[],
  ): Promise<Chore[]> {
    // Firestoreのbatch書き込みと同様、家事作成+初回イベント追加を1回の操作としてまとめる
    // (レビュー指摘 #7, #16)。インメモリなので実際の原子性は不要だが、挙動をそろえる。
    const now = new Date();
    const created: Chore[] = [];
    for (const input of items) {
      const chore: Chore = {
        ...input,
        id: randomUUID(),
        householdId,
        lastCompletedAt: input.lastCompletedAt ?? null,
        createdAt: now,
        updatedAt: now,
      };
      this.chores.set(key(householdId, chore.id), chore);

      if (input.lastCompletedAt) {
        const event: ChoreEvent = {
          id: randomUUID(),
          householdId,
          choreId: chore.id,
          eventType: "completed",
          occurredAt: input.lastCompletedAt,
          actorMemberId: input.createdBy,
          recordedByMemberId: input.createdBy,
          note: null,
          voidedAt: null,
          voidedByMemberId: null,
          voidReason: null,
          createdAt: now,
        };
        this.events.set(key(householdId, event.id), event);
      }

      created.push(chore);
    }
    return created;
  }

  async updateChore(
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
  ): Promise<Chore> {
    const current = this.requireChore(householdId, id);
    const updated: Chore = { ...current, ...patch, updatedAt: new Date() };
    this.chores.set(key(householdId, id), updated);
    return updated;
  }

  // --- 実施履歴 ---

  async addChoreEvent(
    params: AddChoreEventParams,
  ): Promise<AddChoreEventResult> {
    const chore = this.requireChore(params.householdId, params.choreId);

    const existing = this.events.get(key(params.householdId, params.clientRequestId));
    if (existing) {
      if (existing.choreId !== params.choreId) {
        // 同じ clientRequestId が別の家事に対して使われている(クライアント不具合の可能性)。
        throw new RepoConflictError("client_request_id_conflict");
      }
      // 同じ clientRequestId の再送 → 冪等に既存イベントを返す(decisions.md)。
      return {
        event: existing,
        chore,
        idempotentReplay: true,
        possibleDuplicate: false,
      };
    }

    const now = new Date();
    const event: ChoreEvent = {
      id: params.clientRequestId,
      householdId: params.householdId,
      choreId: params.choreId,
      eventType: "completed",
      occurredAt: params.occurredAt,
      actorMemberId: params.actorMemberId,
      recordedByMemberId: params.recordedByMemberId,
      note: params.note,
      voidedAt: null,
      voidedByMemberId: null,
      voidReason: null,
      createdAt: now,
    };

    // possibleDuplicate: 同じ家事に10分以内の有効履歴が既にあるか(新イベント追加前に判定)。
    const possibleDuplicate = this.activeEventsForChore(
      params.householdId,
      params.choreId,
    ).some(
      (e) =>
        Math.abs(e.occurredAt.getTime() - event.occurredAt.getTime()) <=
        DUPLICATE_WINDOW_MS,
    );

    this.events.set(key(params.householdId, event.id), event);

    const updatedChore = this.recomputeLastCompletedAt(
      params.householdId,
      params.choreId,
    );

    return {
      event,
      chore: updatedChore,
      idempotentReplay: false,
      possibleDuplicate,
    };
  }

  async getChoreEvent(
    householdId: string,
    id: string,
  ): Promise<ChoreEvent | null> {
    return this.events.get(key(householdId, id)) ?? null;
  }

  async voidChoreEvent(
    params: VoidChoreEventParams,
  ): Promise<VoidChoreEventResult> {
    const event = this.events.get(key(params.householdId, params.eventId));
    if (!event) {
      throw new RepoNotFoundError("chore_event");
    }
    if (event.voidedAt) {
      throw new RepoConflictError("already_voided");
    }

    const now = new Date();
    const updatedEvent: ChoreEvent = {
      ...event,
      voidedAt: now,
      voidedByMemberId: params.voidedByMemberId,
      voidReason: params.voidReason,
    };
    this.events.set(key(params.householdId, event.id), updatedEvent);

    const chore = this.recomputeLastCompletedAt(
      params.householdId,
      event.choreId,
    );
    return { event: updatedEvent, chore };
  }

  async listChoreEventsForChore(
    householdId: string,
    choreId: string,
    opts?: ListChoreEventsOptions,
  ): Promise<Page<ChoreEvent>> {
    const all = [...this.events.values()]
      .filter((e) => e.householdId === householdId && e.choreId === choreId)
      .filter((e) => opts?.includeVoided || !e.voidedAt)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
    return this.paginate(householdId, all, opts);
  }

  async listChoreEvents(
    householdId: string,
    opts?: ListChoreEventsGlobalOptions,
  ): Promise<Page<ChoreEvent>> {
    let all = [...this.events.values()].filter(
      (e) => e.householdId === householdId,
    );
    if (!opts?.includeVoided) all = all.filter((e) => !e.voidedAt);
    if (opts?.choreId) all = all.filter((e) => e.choreId === opts.choreId);
    if (opts?.actorMemberId)
      all = all.filter((e) => e.actorMemberId === opts.actorMemberId);
    if (opts?.areaId) {
      const choreIdsInArea = new Set(
        [...this.chores.values()]
          .filter(
            (c) => c.householdId === householdId && c.areaId === opts.areaId,
          )
          .map((c) => c.id),
      );
      all = all.filter((e) => choreIdsInArea.has(e.choreId));
    }
    if (opts?.from) all = all.filter((e) => e.occurredAt >= opts.from!);
    if (opts?.to) all = all.filter((e) => e.occurredAt <= opts.to!);
    all.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
    return this.paginate(householdId, all, opts);
  }

  // --- 通知設定 ---

  async getNotificationSettings(
    householdId: string,
    memberId: string,
  ): Promise<NotificationSettings | null> {
    return this.notificationSettings.get(key(householdId, memberId)) ?? null;
  }

  async upsertNotificationSettings(
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
  ): Promise<NotificationSettings> {
    const current = this.notificationSettings.get(key(householdId, memberId)) ?? {
      memberId,
      householdId,
      dailySummaryEnabled: true,
      dailySummaryTime: "08:00",
      includeUpcoming: false,
      oneTapComplete: true,
      lastSentLocalDate: null,
      updatedAt: new Date(),
    };
    const updated: NotificationSettings = {
      ...current,
      ...patch,
      memberId,
      householdId,
      updatedAt: new Date(),
    };
    this.notificationSettings.set(key(householdId, memberId), updated);
    return updated;
  }

  // --- ヘルパー ---

  private activeEventsForChore(
    householdId: string,
    choreId: string,
  ): ChoreEvent[] {
    return [...this.events.values()].filter(
      (e) =>
        e.householdId === householdId && e.choreId === choreId && !e.voidedAt,
    );
  }

  /** 有効履歴の MAX(occurredAt) を再計算し `chore.lastCompletedAt` を更新する(decisions.md)。 */
  private recomputeLastCompletedAt(
    householdId: string,
    choreId: string,
  ): Chore {
    const chore = this.requireChore(householdId, choreId);
    const active = this.activeEventsForChore(householdId, choreId);
    const latest = active.reduce<Date | null>((max, e) => {
      if (!max || e.occurredAt > max) return e.occurredAt;
      return max;
    }, null);
    const updated: Chore = {
      ...chore,
      lastCompletedAt: latest,
      updatedAt: new Date(),
    };
    this.chores.set(key(householdId, choreId), updated);
    return updated;
  }

  /** `cursor` が指定されているのに解決できない場合は `RepoInvalidQueryError` を投げる(レビュー指摘 #11)。 */
  private paginate(
    householdId: string,
    items: ChoreEvent[],
    opts?: { limit?: number; cursor?: string | null },
  ): Page<ChoreEvent> {
    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 100);
    let startIndex = 0;
    if (opts?.cursor) {
      const idx = items.findIndex((i) => i.id === opts.cursor);
      if (idx === -1) {
        // カーソルが存在する(=household内に実在する)イベントを指しているかも確認する。
        // 存在しないIDなら400、存在するが今回の絞り込み結果に無いだけなら先頭から返す。
        if (!this.events.has(key(householdId, opts.cursor))) {
          throw new RepoInvalidQueryError("cursor");
        }
        startIndex = 0;
      } else {
        startIndex = idx + 1;
      }
    }
    const page = items.slice(startIndex, startIndex + limit);
    const nextCursor =
      startIndex + limit < items.length
        ? (page[page.length - 1]?.id ?? null)
        : null;
    return { items: page, nextCursor };
  }

  private requireHousehold(householdId: string): Household {
    const household = this.households.get(householdId);
    if (!household) throw new RepoNotFoundError("household");
    return household;
  }

  private requireArea(householdId: string, id: string): Area {
    const area = this.areas.get(key(householdId, id));
    if (!area) {
      throw new RepoNotFoundError("area");
    }
    return area;
  }

  private requireResource(householdId: string, id: string): Resource {
    const resource = this.resources.get(key(householdId, id));
    if (!resource) {
      throw new RepoNotFoundError("resource");
    }
    return resource;
  }

  private requireCategory(householdId: string, id: string): ChoreCategory {
    const category = this.categories.get(key(householdId, id));
    if (!category) {
      throw new RepoNotFoundError("chore_category");
    }
    return category;
  }

  private requireChore(householdId: string, id: string): Chore {
    const chore = this.chores.get(key(householdId, id));
    if (!chore) {
      throw new RepoNotFoundError("chore");
    }
    return chore;
  }
}
