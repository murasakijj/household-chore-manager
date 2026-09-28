import {
  getFirestore,
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";
import { getFirebaseApp } from "../firebaseApp.js";
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
import { RepoConflictError, RepoNotFoundError } from "./errors.js";

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

function toDate(ts: Timestamp | null | undefined): Date | null {
  return ts ? ts.toDate() : null;
}

function toTimestampOrNull(date: Date | null | undefined): Timestamp | null {
  return date ? Timestamp.fromDate(date) : null;
}

// --- Firestore ドキュメント⇔ドメイン型 変換 ---

interface HouseholdDoc {
  name: string;
  timezone: string;
  schemaVersion: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
function householdFromDoc(id: string, d: HouseholdDoc): Household {
  return {
    id,
    ...d,
    createdAt: d.createdAt.toDate(),
    updatedAt: d.updatedAt.toDate(),
  };
}

interface MemberDoc {
  displayName: string;
  userId: string | null;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
function memberFromDoc(id: string, householdId: string, d: MemberDoc): Member {
  return {
    id,
    householdId,
    displayName: d.displayName,
    userId: d.userId,
    isActive: d.isActive,
    createdAt: d.createdAt.toDate(),
    updatedAt: d.updatedAt.toDate(),
  };
}

interface AreaDoc {
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
function areaFromDoc(id: string, householdId: string, d: AreaDoc): Area {
  return {
    id,
    householdId,
    name: d.name,
    sortOrder: d.sortOrder,
    isActive: d.isActive,
    createdAt: d.createdAt.toDate(),
    updatedAt: d.updatedAt.toDate(),
  };
}

interface ResourceDoc {
  areaId: string | null;
  resourceType: ResourceType;
  name: string;
  externalRef: string | null;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
function resourceFromDoc(
  id: string,
  householdId: string,
  d: ResourceDoc,
): Resource {
  return {
    id,
    householdId,
    areaId: d.areaId,
    resourceType: d.resourceType,
    name: d.name,
    externalRef: d.externalRef,
    isActive: d.isActive,
    createdAt: d.createdAt.toDate(),
    updatedAt: d.updatedAt.toDate(),
  };
}

interface CategoryDoc {
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
function categoryFromDoc(
  id: string,
  householdId: string,
  d: CategoryDoc,
): ChoreCategory {
  return {
    id,
    householdId,
    name: d.name,
    sortOrder: d.sortOrder,
    isActive: d.isActive,
    createdAt: d.createdAt.toDate(),
    updatedAt: d.updatedAt.toDate(),
  };
}

interface ChoreDoc {
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
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastCompletedAt: Timestamp | null;
}
function choreFromDoc(id: string, householdId: string, d: ChoreDoc): Chore {
  return {
    id,
    householdId,
    name: d.name,
    description: d.description,
    categoryId: d.categoryId,
    areaId: d.areaId,
    resourceId: d.resourceId,
    scheduleType: d.scheduleType,
    intervalDays: d.intervalDays,
    warningDays: d.warningDays,
    graceDays: d.graceDays,
    isActive: d.isActive,
    createdBy: d.createdBy,
    createdAt: d.createdAt.toDate(),
    updatedAt: d.updatedAt.toDate(),
    lastCompletedAt: toDate(d.lastCompletedAt),
  };
}

interface ChoreEventDoc {
  choreId: string;
  eventType: "completed";
  occurredAt: Timestamp;
  actorMemberId: string;
  recordedByMemberId: string;
  note: string | null;
  voidedAt: Timestamp | null;
  voidedByMemberId: string | null;
  voidReason: string | null;
  createdAt: Timestamp;
}
function eventFromDoc(
  id: string,
  householdId: string,
  d: ChoreEventDoc,
): ChoreEvent {
  return {
    id,
    householdId,
    choreId: d.choreId,
    eventType: d.eventType,
    occurredAt: d.occurredAt.toDate(),
    actorMemberId: d.actorMemberId,
    recordedByMemberId: d.recordedByMemberId,
    note: d.note,
    voidedAt: toDate(d.voidedAt),
    voidedByMemberId: d.voidedByMemberId,
    voidReason: d.voidReason,
    createdAt: d.createdAt.toDate(),
  };
}

interface NotificationSettingsDoc {
  dailySummaryEnabled: boolean;
  dailySummaryTime: string;
  includeUpcoming: boolean;
  oneTapComplete: boolean;
  lastSentLocalDate: string | null;
  updatedAt: Timestamp;
}
function settingsFromDoc(
  memberId: string,
  householdId: string,
  d: NotificationSettingsDoc,
): NotificationSettings {
  return {
    memberId,
    householdId,
    dailySummaryEnabled: d.dailySummaryEnabled,
    dailySummaryTime: d.dailySummaryTime,
    includeUpcoming: d.includeUpcoming,
    oneTapComplete: d.oneTapComplete,
    lastSentLocalDate: d.lastSentLocalDate,
    updatedAt: d.updatedAt.toDate(),
  };
}

/** 本番用リポジトリ。`firebase-admin` の Firestore にのみアクセスする(クライアント直アクセスは禁止)。 */
export class FirestoreRepo implements Repo {
  private db: Firestore;

  constructor() {
    this.db = getFirestore(getFirebaseApp());
  }

  private householdRef(householdId: string) {
    return this.db.collection("households").doc(householdId);
  }
  private membersCol(householdId: string) {
    return this.householdRef(householdId).collection("members");
  }
  private areasCol(householdId: string) {
    return this.householdRef(householdId).collection("areas");
  }
  private resourcesCol(householdId: string) {
    return this.householdRef(householdId).collection("resources");
  }
  private categoriesCol(householdId: string) {
    return this.householdRef(householdId).collection("choreCategories");
  }
  private choresCol(householdId: string) {
    return this.householdRef(householdId).collection("chores");
  }
  private eventsCol(householdId: string) {
    return this.householdRef(householdId).collection("choreEvents");
  }
  private notificationSettingsCol(householdId: string) {
    return this.householdRef(householdId).collection("notificationSettings");
  }

  async getUserMembership(uid: string): Promise<UserMembership | null> {
    const snap = await this.db.collection("userMemberships").doc(uid).get();
    if (!snap.exists) return null;
    const d = snap.data() as {
      householdId: string;
      memberId: string;
      email: string;
      createdAt: Timestamp;
    };
    return {
      uid,
      householdId: d.householdId,
      memberId: d.memberId,
      email: d.email,
      createdAt: d.createdAt.toDate(),
    };
  }

  async bootstrapHouseholdForUser(params: {
    uid: string;
    email: string;
  }): Promise<UserMembership> {
    const membershipRef = this.db.collection("userMemberships").doc(params.uid);
    return this.db.runTransaction(async (tx) => {
      const existing = await tx.get(membershipRef);
      if (existing.exists) {
        const d = existing.data() as {
          householdId: string;
          memberId: string;
          email: string;
          createdAt: Timestamp;
        };
        return {
          uid: params.uid,
          householdId: d.householdId,
          memberId: d.memberId,
          email: d.email,
          createdAt: d.createdAt.toDate(),
        };
      }

      const now = Timestamp.now();
      const householdRef = this.db.collection("households").doc();
      const memberRef = householdRef.collection("members").doc();

      tx.set(householdRef, {
        name: "わが家",
        timezone: "Asia/Tokyo",
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      tx.set(memberRef, {
        displayName: params.email,
        userId: params.uid,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      INITIAL_AREAS.forEach((name, index) => {
        const ref = householdRef.collection("areas").doc();
        tx.set(ref, {
          name,
          sortOrder: index,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
      });
      INITIAL_CATEGORIES.forEach((name, index) => {
        const ref = householdRef.collection("choreCategories").doc();
        tx.set(ref, {
          name,
          sortOrder: index,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
      });
      const settingsRef = householdRef
        .collection("notificationSettings")
        .doc(memberRef.id);
      tx.set(settingsRef, {
        dailySummaryEnabled: true,
        dailySummaryTime: "08:00",
        includeUpcoming: false,
        oneTapComplete: true,
        lastSentLocalDate: null,
        updatedAt: now,
      });
      tx.set(membershipRef, {
        householdId: householdRef.id,
        memberId: memberRef.id,
        email: params.email,
        createdAt: now,
      });

      return {
        uid: params.uid,
        householdId: householdRef.id,
        memberId: memberRef.id,
        email: params.email,
        createdAt: now.toDate(),
      };
    });
  }

  async getHousehold(householdId: string): Promise<Household | null> {
    const snap = await this.householdRef(householdId).get();
    if (!snap.exists) return null;
    return householdFromDoc(householdId, snap.data() as HouseholdDoc);
  }

  async updateHousehold(
    householdId: string,
    patch: Partial<Pick<Household, "name" | "timezone">>,
  ): Promise<Household> {
    const ref = this.householdRef(householdId);
    await ref.update({ ...patch, updatedAt: Timestamp.now() });
    const snap = await ref.get();
    if (!snap.exists) throw new RepoNotFoundError("household");
    return householdFromDoc(householdId, snap.data() as HouseholdDoc);
  }

  async getMember(
    householdId: string,
    memberId: string,
  ): Promise<Member | null> {
    const snap = await this.membersCol(householdId).doc(memberId).get();
    if (!snap.exists) return null;
    return memberFromDoc(memberId, householdId, snap.data() as MemberDoc);
  }

  async listMembers(householdId: string): Promise<Member[]> {
    const snap = await this.membersCol(householdId).get();
    return snap.docs.map((doc) =>
      memberFromDoc(doc.id, householdId, doc.data() as MemberDoc),
    );
  }

  // --- 場所 ---

  async listAreas(
    householdId: string,
    opts?: { includeInactive?: boolean },
  ): Promise<Area[]> {
    const snap = await this.areasCol(householdId).get();
    return snap.docs
      .map((doc) => areaFromDoc(doc.id, householdId, doc.data() as AreaDoc))
      .filter((a) => opts?.includeInactive || a.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async getArea(householdId: string, id: string): Promise<Area | null> {
    const snap = await this.areasCol(householdId).doc(id).get();
    if (!snap.exists) return null;
    return areaFromDoc(id, householdId, snap.data() as AreaDoc);
  }

  async createArea(
    householdId: string,
    input: { name: string; sortOrder: number },
  ): Promise<Area> {
    const now = Timestamp.now();
    const ref = this.areasCol(householdId).doc();
    const doc: AreaDoc = {
      name: input.name,
      sortOrder: input.sortOrder,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    await ref.set(doc);
    return areaFromDoc(ref.id, householdId, doc);
  }

  async updateArea(
    householdId: string,
    id: string,
    patch: Partial<Pick<Area, "name" | "sortOrder" | "isActive">>,
  ): Promise<Area> {
    const ref = this.areasCol(householdId).doc(id);
    const existing = await ref.get();
    if (!existing.exists) throw new RepoNotFoundError("area");
    await ref.update({ ...patch, updatedAt: Timestamp.now() });
    const snap = await ref.get();
    return areaFromDoc(id, householdId, snap.data() as AreaDoc);
  }

  // --- 対象リソース ---

  async listResources(
    householdId: string,
    opts?: { includeInactive?: boolean },
  ): Promise<Resource[]> {
    const snap = await this.resourcesCol(householdId).get();
    return snap.docs
      .map((doc) =>
        resourceFromDoc(doc.id, householdId, doc.data() as ResourceDoc),
      )
      .filter((r) => opts?.includeInactive || r.isActive);
  }

  async getResource(householdId: string, id: string): Promise<Resource | null> {
    const snap = await this.resourcesCol(householdId).doc(id).get();
    if (!snap.exists) return null;
    return resourceFromDoc(id, householdId, snap.data() as ResourceDoc);
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
    const now = Timestamp.now();
    const ref = this.resourcesCol(householdId).doc();
    const doc: ResourceDoc = {
      ...input,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    await ref.set(doc);
    return resourceFromDoc(ref.id, householdId, doc);
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
    const ref = this.resourcesCol(householdId).doc(id);
    const existing = await ref.get();
    if (!existing.exists) throw new RepoNotFoundError("resource");
    await ref.update({ ...patch, updatedAt: Timestamp.now() });
    const snap = await ref.get();
    return resourceFromDoc(id, householdId, snap.data() as ResourceDoc);
  }

  // --- カテゴリ ---

  async listChoreCategories(
    householdId: string,
    opts?: { includeInactive?: boolean },
  ): Promise<ChoreCategory[]> {
    const snap = await this.categoriesCol(householdId).get();
    return snap.docs
      .map((doc) =>
        categoryFromDoc(doc.id, householdId, doc.data() as CategoryDoc),
      )
      .filter((c) => opts?.includeInactive || c.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async getChoreCategory(
    householdId: string,
    id: string,
  ): Promise<ChoreCategory | null> {
    const snap = await this.categoriesCol(householdId).doc(id).get();
    if (!snap.exists) return null;
    return categoryFromDoc(id, householdId, snap.data() as CategoryDoc);
  }

  async createChoreCategory(
    householdId: string,
    input: { name: string; sortOrder: number },
  ): Promise<ChoreCategory> {
    const now = Timestamp.now();
    const ref = this.categoriesCol(householdId).doc();
    const doc: CategoryDoc = {
      name: input.name,
      sortOrder: input.sortOrder,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    await ref.set(doc);
    return categoryFromDoc(ref.id, householdId, doc);
  }

  async updateChoreCategory(
    householdId: string,
    id: string,
    patch: Partial<Pick<ChoreCategory, "name" | "sortOrder" | "isActive">>,
  ): Promise<ChoreCategory> {
    const ref = this.categoriesCol(householdId).doc(id);
    const existing = await ref.get();
    if (!existing.exists) throw new RepoNotFoundError("chore_category");
    await ref.update({ ...patch, updatedAt: Timestamp.now() });
    const snap = await ref.get();
    return categoryFromDoc(id, householdId, snap.data() as CategoryDoc);
  }

  // --- 家事 ---

  async listChores(
    householdId: string,
    opts?: { includeInactive?: boolean },
  ): Promise<Chore[]> {
    const snap = await this.choresCol(householdId).get();
    return snap.docs
      .map((doc) => choreFromDoc(doc.id, householdId, doc.data() as ChoreDoc))
      .filter((c) => opts?.includeInactive || c.isActive);
  }

  async getChore(householdId: string, id: string): Promise<Chore | null> {
    const snap = await this.choresCol(householdId).doc(id).get();
    if (!snap.exists) return null;
    return choreFromDoc(id, householdId, snap.data() as ChoreDoc);
  }

  async createChore(
    householdId: string,
    input: Omit<
      Chore,
      "id" | "householdId" | "createdAt" | "updatedAt" | "lastCompletedAt"
    > & {
      lastCompletedAt?: Date | null;
    },
  ): Promise<Chore> {
    const now = Timestamp.now();
    const ref = this.choresCol(householdId).doc();
    const doc: ChoreDoc = {
      name: input.name,
      description: input.description,
      categoryId: input.categoryId,
      areaId: input.areaId,
      resourceId: input.resourceId,
      scheduleType: input.scheduleType,
      intervalDays: input.intervalDays,
      warningDays: input.warningDays,
      graceDays: input.graceDays,
      isActive: input.isActive,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      lastCompletedAt: toTimestampOrNull(input.lastCompletedAt ?? null),
    };
    await ref.set(doc);
    return choreFromDoc(ref.id, householdId, doc);
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
    const ref = this.choresCol(householdId).doc(id);
    const existing = await ref.get();
    if (!existing.exists) throw new RepoNotFoundError("chore");
    await ref.update({ ...patch, updatedAt: Timestamp.now() });
    const snap = await ref.get();
    return choreFromDoc(id, householdId, snap.data() as ChoreDoc);
  }

  // --- 実施履歴(イベント追加・取消は同一トランザクションで lastCompletedAt を再計算) ---

  async addChoreEvent(
    params: AddChoreEventParams,
  ): Promise<AddChoreEventResult> {
    const choreRef = this.choresCol(params.householdId).doc(params.choreId);
    const eventRef = this.eventsCol(params.householdId).doc(
      params.clientRequestId,
    );

    return this.db.runTransaction(async (tx) => {
      const [choreSnap, eventSnap] = await Promise.all([
        tx.get(choreRef),
        tx.get(eventRef),
      ]);
      if (!choreSnap.exists) throw new RepoNotFoundError("chore");

      if (eventSnap.exists) {
        // 同じ clientRequestId の再送 → 冪等に既存イベントを返す(decisions.md)。
        const chore = choreFromDoc(
          params.choreId,
          params.householdId,
          choreSnap.data() as ChoreDoc,
        );
        const event = eventFromDoc(
          eventRef.id,
          params.householdId,
          eventSnap.data() as ChoreEventDoc,
        );
        return {
          event,
          chore,
          idempotentReplay: true,
          possibleDuplicate: false,
        };
      }

      // possibleDuplicate判定用に、同一家事の有効履歴を取得する(トランザクション内)。
      const activeSnap = await tx.get(
        this.eventsCol(params.householdId)
          .where("choreId", "==", params.choreId)
          .where("voidedAt", "==", null),
      );
      const activeEvents = activeSnap.docs.map((doc) =>
        eventFromDoc(doc.id, params.householdId, doc.data() as ChoreEventDoc),
      );
      const possibleDuplicate = activeEvents.some(
        (e) =>
          Math.abs(e.occurredAt.getTime() - params.occurredAt.getTime()) <=
          DUPLICATE_WINDOW_MS,
      );

      const now = Timestamp.now();
      const eventDoc: ChoreEventDoc = {
        choreId: params.choreId,
        eventType: "completed",
        occurredAt: Timestamp.fromDate(params.occurredAt),
        actorMemberId: params.actorMemberId,
        recordedByMemberId: params.recordedByMemberId,
        note: params.note,
        voidedAt: null,
        voidedByMemberId: null,
        voidReason: null,
        createdAt: now,
      };
      tx.set(eventRef, eventDoc);

      const latest = activeEvents.reduce<Date | null>((max, e) => {
        if (!max || e.occurredAt > max) return e.occurredAt;
        return max;
      }, null);
      const newLatest =
        !latest || params.occurredAt > latest ? params.occurredAt : latest;

      tx.update(choreRef, {
        lastCompletedAt: Timestamp.fromDate(newLatest),
        updatedAt: now,
      });

      const chore = choreFromDoc(params.choreId, params.householdId, {
        ...(choreSnap.data() as ChoreDoc),
        lastCompletedAt: Timestamp.fromDate(newLatest),
        updatedAt: now,
      });
      const event = eventFromDoc(eventRef.id, params.householdId, eventDoc);
      return { event, chore, idempotentReplay: false, possibleDuplicate };
    });
  }

  async getChoreEvent(
    householdId: string,
    id: string,
  ): Promise<ChoreEvent | null> {
    const snap = await this.eventsCol(householdId).doc(id).get();
    if (!snap.exists) return null;
    return eventFromDoc(id, householdId, snap.data() as ChoreEventDoc);
  }

  async voidChoreEvent(
    params: VoidChoreEventParams,
  ): Promise<VoidChoreEventResult> {
    const eventRef = this.eventsCol(params.householdId).doc(params.eventId);

    return this.db.runTransaction(async (tx) => {
      const eventSnap = await tx.get(eventRef);
      if (!eventSnap.exists) throw new RepoNotFoundError("chore_event");
      const eventData = eventSnap.data() as ChoreEventDoc;
      if (eventData.voidedAt) throw new RepoConflictError("already_voided");

      const choreRef = this.choresCol(params.householdId).doc(
        eventData.choreId,
      );
      const choreSnap = await tx.get(choreRef);
      if (!choreSnap.exists) throw new RepoNotFoundError("chore");

      const now = Timestamp.now();
      tx.update(eventRef, {
        voidedAt: now,
        voidedByMemberId: params.voidedByMemberId,
        voidReason: params.voidReason,
      });

      // 取消後に残る有効履歴から MAX(occurredAt) を再計算する。
      const remainingSnap = await tx.get(
        this.eventsCol(params.householdId)
          .where("choreId", "==", eventData.choreId)
          .where("voidedAt", "==", null),
      );
      const remaining = remainingSnap.docs
        .filter((doc) => doc.id !== eventRef.id)
        .map((doc) =>
          eventFromDoc(doc.id, params.householdId, doc.data() as ChoreEventDoc),
        );
      const latest = remaining.reduce<Date | null>((max, e) => {
        if (!max || e.occurredAt > max) return e.occurredAt;
        return max;
      }, null);

      tx.update(choreRef, {
        lastCompletedAt: toTimestampOrNull(latest),
        updatedAt: now,
      });

      const updatedEvent = eventFromDoc(eventRef.id, params.householdId, {
        ...eventData,
        voidedAt: now,
        voidedByMemberId: params.voidedByMemberId,
        voidReason: params.voidReason,
      });
      const updatedChore = choreFromDoc(eventData.choreId, params.householdId, {
        ...(choreSnap.data() as ChoreDoc),
        lastCompletedAt: toTimestampOrNull(latest),
        updatedAt: now,
      });
      return { event: updatedEvent, chore: updatedChore };
    });
  }

  async listChoreEventsForChore(
    householdId: string,
    choreId: string,
    opts?: ListChoreEventsOptions,
  ): Promise<Page<ChoreEvent>> {
    let query = this.eventsCol(householdId).where(
      "choreId",
      "==",
      choreId,
    ) as FirebaseFirestore.Query;
    if (!opts?.includeVoided) query = query.where("voidedAt", "==", null);
    query = query.orderBy("occurredAt", "desc");
    return this.runPagedQuery(householdId, query, opts);
  }

  async listChoreEvents(
    householdId: string,
    opts?: ListChoreEventsGlobalOptions,
  ): Promise<Page<ChoreEvent>> {
    let query = this.eventsCol(householdId) as FirebaseFirestore.Query;
    if (!opts?.includeVoided) query = query.where("voidedAt", "==", null);
    if (opts?.choreId) query = query.where("choreId", "==", opts.choreId);
    if (opts?.actorMemberId)
      query = query.where("actorMemberId", "==", opts.actorMemberId);
    if (opts?.from)
      query = query.where("occurredAt", ">=", Timestamp.fromDate(opts.from));
    if (opts?.to)
      query = query.where("occurredAt", "<=", Timestamp.fromDate(opts.to));
    query = query.orderBy("occurredAt", "desc");

    const page = await this.runPagedQuery(householdId, query, opts);
    if (!opts?.areaId) return page;

    // areaId 絞り込みはchore側の属性のため、アプリ側でフィルタする
    // (対象家事数は家庭あたり最大1,000件程度を想定。設計書 §14.2)。
    const choresSnap = await this.choresCol(householdId)
      .where("areaId", "==", opts.areaId)
      .get();
    const choreIds = new Set(choresSnap.docs.map((d) => d.id));
    return {
      items: page.items.filter((e) => choreIds.has(e.choreId)),
      nextCursor: page.nextCursor,
    };
  }

  private async runPagedQuery(
    householdId: string,
    query: FirebaseFirestore.Query,
    opts?: { limit?: number; cursor?: string | null },
  ): Promise<Page<ChoreEvent>> {
    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 100);
    let q = query.limit(limit + 1);
    if (opts?.cursor) {
      const cursorSnap = await this.eventsCol(householdId)
        .doc(opts.cursor)
        .get();
      if (cursorSnap.exists) {
        q = q.startAfter(cursorSnap);
      }
    }
    const snap = await q.get();
    const docs = snap.docs.slice(0, limit);
    const items = docs.map((doc) =>
      eventFromDoc(doc.id, householdId, doc.data() as ChoreEventDoc),
    );
    const nextCursor =
      snap.docs.length > limit ? (docs[docs.length - 1]?.id ?? null) : null;
    return { items, nextCursor };
  }

  // --- 通知設定 ---

  async getNotificationSettings(
    householdId: string,
    memberId: string,
  ): Promise<NotificationSettings | null> {
    const snap = await this.notificationSettingsCol(householdId)
      .doc(memberId)
      .get();
    if (!snap.exists) return null;
    return settingsFromDoc(
      memberId,
      householdId,
      snap.data() as NotificationSettingsDoc,
    );
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
    const ref = this.notificationSettingsCol(householdId).doc(memberId);
    const existing = await ref.get();
    const base: NotificationSettingsDoc = existing.exists
      ? (existing.data() as NotificationSettingsDoc)
      : {
          dailySummaryEnabled: true,
          dailySummaryTime: "08:00",
          includeUpcoming: false,
          oneTapComplete: true,
          lastSentLocalDate: null,
          updatedAt: Timestamp.now(),
        };
    const updated: NotificationSettingsDoc = {
      ...base,
      ...patch,
      updatedAt: Timestamp.now(),
    };
    await ref.set(updated);
    return settingsFromDoc(memberId, householdId, updated);
  }
}
