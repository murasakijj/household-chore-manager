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
import {
  RepoConflictError,
  RepoInvalidQueryError,
  RepoNotFoundError,
} from "./errors.js";
import { createHash } from "node:crypto";
import type { PushSubscriptionRecord } from "./types.js";

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

/** Firestore の `in` クエリ1回あたりの最大件数。 */
const IN_QUERY_CHUNK_SIZE = 30;

/** areaId絞り込み(choreId in [...])で処理するチャンク数の安全上限(レビュー指摘 #6)。 */
const MAX_AREA_CHUNKS = 40;

type ChoreCreateInput = Omit<
  Chore,
  "id" | "householdId" | "createdAt" | "updatedAt" | "lastCompletedAt"
> & { lastCompletedAt?: Date | null };

function toDate(ts: Timestamp | null | undefined): Date | null {
  return ts ? ts.toDate() : null;
}

function toTimestampOrNull(date: Date | null | undefined): Timestamp | null {
  return date ? Timestamp.fromDate(date) : null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
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
    name: d.name,
    timezone: d.timezone,
    schemaVersion: d.schemaVersion,
    createdAt: d.createdAt.toDate(),
    updatedAt: d.updatedAt.toDate(),
  };
}

interface MemberDoc {
  householdId: string;
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
  householdId: string;
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
  householdId: string;
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
  householdId: string;
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
  householdId: string;
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

interface PushSubscriptionDoc {
  householdId: string;
  memberId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: Timestamp;
}
function pushSubscriptionFromDoc(
  id: string,
  d: PushSubscriptionDoc,
): PushSubscriptionRecord {
  return {
    id,
    householdId: d.householdId,
    memberId: d.memberId,
    endpoint: d.endpoint,
    keys: d.keys,
    createdAt: d.createdAt.toDate(),
  };
}

interface NotificationSettingsDoc {
  householdId: string;
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
  private pushSubscriptionsCol(householdId: string) {
    return this.householdRef(householdId).collection("pushSubscriptions");
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
      const householdId = householdRef.id;

      tx.set(householdRef, {
        name: "わが家",
        timezone: "Asia/Tokyo",
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      tx.set(memberRef, {
        householdId,
        displayName: params.email,
        userId: params.uid,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      INITIAL_AREAS.forEach((name, index) => {
        const ref = householdRef.collection("areas").doc();
        tx.set(ref, {
          householdId,
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
          householdId,
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
        householdId,
        dailySummaryEnabled: true,
        dailySummaryTime: "08:00",
        includeUpcoming: false,
        oneTapComplete: true,
        lastSentLocalDate: null,
        updatedAt: now,
      });
      tx.set(membershipRef, {
        householdId,
        memberId: memberRef.id,
        email: params.email,
        createdAt: now,
      });

      return {
        uid: params.uid,
        householdId,
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
      householdId,
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
      householdId,
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
      householdId,
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
    input: ChoreCreateInput,
  ): Promise<Chore> {
    const [chore] = await this.createChoresBulk(householdId, [input]);
    return chore;
  }

  async createChoresBulk(
    householdId: string,
    items: ChoreCreateInput[],
  ): Promise<Chore[]> {
    // 事前の読み取りが不要な新規作成のみなので、トランザクションではなく
    // batch(書き込みのみ・原子的にコミット)でまとめる(レビュー指摘 #1, #7, #16)。
    // 家事ドキュメントと初回イベントドキュメントを同じbatchに入れることで、
    // 「家事はあるのにイベントが無い」半端な状態を防ぐ。
    const batch = this.db.batch();
    const now = Timestamp.now();
    const created: Chore[] = [];

    for (const input of items) {
      const choreRef = this.choresCol(householdId).doc();
      const doc: ChoreDoc = {
        householdId,
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
      batch.set(choreRef, doc);

      if (input.lastCompletedAt) {
        const eventRef = this.eventsCol(householdId).doc();
        const eventDoc: ChoreEventDoc = {
          householdId,
          choreId: choreRef.id,
          eventType: "completed",
          occurredAt: Timestamp.fromDate(input.lastCompletedAt),
          actorMemberId: input.createdBy,
          recordedByMemberId: input.createdBy,
          note: null,
          voidedAt: null,
          voidedByMemberId: null,
          voidReason: null,
          createdAt: now,
        };
        batch.set(eventRef, eventDoc);
      }

      created.push(choreFromDoc(choreRef.id, householdId, doc));
    }

    await batch.commit();
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
    const ref = this.choresCol(householdId).doc(id);
    const existing = await ref.get();
    if (!existing.exists) throw new RepoNotFoundError("chore");
    await ref.update({ ...patch, updatedAt: Timestamp.now() });
    const snap = await ref.get();
    return choreFromDoc(id, householdId, snap.data() as ChoreDoc);
  }

  // --- 実施履歴(イベント追加・取消は同一トランザクションで lastCompletedAt を再計算) ---

  /**
   * 指定した家事の「直近1件(有効履歴のMAX occurredAt)」を返す。
   * `choreId ASC, voidedAt ASC, occurredAt DESC` の複合インデックスを使う。
   */
  private async getLatestActiveEventInTx(
    tx: FirebaseFirestore.Transaction,
    householdId: string,
    choreId: string,
  ): Promise<ChoreEvent | null> {
    const snap = await tx.get(
      this.eventsCol(householdId)
        .where("choreId", "==", choreId)
        .where("voidedAt", "==", null)
        .orderBy("occurredAt", "desc")
        .limit(1),
    );
    const doc = snap.docs[0];
    if (!doc) return null;
    return eventFromDoc(doc.id, householdId, doc.data() as ChoreEventDoc);
  }

  async addChoreEvent(
    params: AddChoreEventParams,
  ): Promise<AddChoreEventResult> {
    const choreRef = this.choresCol(params.householdId).doc(params.choreId);
    const eventRef = this.eventsCol(params.householdId).doc(
      params.clientRequestId,
    );

    return this.db.runTransaction(async (tx) => {
      // --- 読み取りはすべてここで行い、書き込みより前に終える ---
      // (firebase-admin は read-after-write を禁止しているため。レビュー指摘 #1)
      const [choreSnap, eventSnap] = await Promise.all([
        tx.get(choreRef),
        tx.get(eventRef),
      ]);
      if (!choreSnap.exists) throw new RepoNotFoundError("chore");

      if (eventSnap.exists) {
        const existingData = eventSnap.data() as ChoreEventDoc;
        if (existingData.choreId !== params.choreId) {
          // 同じ clientRequestId が別の家事に対して使われている(クライアント不具合の可能性)。
          throw new RepoConflictError("client_request_id_conflict");
        }
        // 同じ clientRequestId の再送 → 冪等に既存イベントを返す(decisions.md)。
        const chore = choreFromDoc(
          params.choreId,
          params.householdId,
          choreSnap.data() as ChoreDoc,
        );
        const event = eventFromDoc(eventRef.id, params.householdId, existingData);
        return {
          event,
          chore,
          idempotentReplay: true,
          possibleDuplicate: false,
        };
      }

      // lastCompletedAt 再計算用に「直近の有効履歴1件」だけ読む(全件スキャンしない。レビュー指摘 #1)。
      const latestActive = await this.getLatestActiveEventInTx(
        tx,
        params.householdId,
        params.choreId,
      );

      // possibleDuplicate判定: 新イベントの occurredAt ±10分の範囲に有効履歴があるか、
      // 存在確認だけの limit(1) クエリで調べる(全件スキャンしない。レビュー指摘 #1)。
      const windowStart = Timestamp.fromDate(
        new Date(params.occurredAt.getTime() - DUPLICATE_WINDOW_MS),
      );
      const windowEnd = Timestamp.fromDate(
        new Date(params.occurredAt.getTime() + DUPLICATE_WINDOW_MS),
      );
      const dupSnap = await tx.get(
        this.eventsCol(params.householdId)
          .where("choreId", "==", params.choreId)
          .where("voidedAt", "==", null)
          .where("occurredAt", ">=", windowStart)
          .where("occurredAt", "<=", windowEnd)
          .orderBy("occurredAt", "desc")
          .limit(1),
      );
      const possibleDuplicate = !dupSnap.empty;

      // --- ここから書き込みのみ ---
      const now = Timestamp.now();
      const eventDoc: ChoreEventDoc = {
        householdId: params.householdId,
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

      const newLatest =
        !latestActive || params.occurredAt > latestActive.occurredAt
          ? params.occurredAt
          : latestActive.occurredAt;

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
      // --- 読み取りはすべてここで行い、書き込みより前に終える(レビュー指摘 #1) ---
      const eventSnap = await tx.get(eventRef);
      if (!eventSnap.exists) throw new RepoNotFoundError("chore_event");
      const eventData = eventSnap.data() as ChoreEventDoc;
      if (eventData.voidedAt) throw new RepoConflictError("already_voided");

      const choreRef = this.choresCol(params.householdId).doc(
        eventData.choreId,
      );
      const choreSnap = await tx.get(choreRef);
      if (!choreSnap.exists) throw new RepoNotFoundError("chore");

      // 取消後に残る「直近2件」だけを読む(自分自身が含まれる可能性があるため2件。
      // 全件スキャンしない。レビュー指摘 #1)。取消対象がこの2件の外にいる場合、
      // 最新の有効履歴は取消の影響を受けないので、そのままで正しい。
      const candidatesSnap = await tx.get(
        this.eventsCol(params.householdId)
          .where("choreId", "==", eventData.choreId)
          .where("voidedAt", "==", null)
          .orderBy("occurredAt", "desc")
          .limit(2),
      );
      const remainingLatest = candidatesSnap.docs
        .filter((doc) => doc.id !== eventRef.id)
        .map((doc) =>
          eventFromDoc(doc.id, params.householdId, doc.data() as ChoreEventDoc),
        )[0];
      const latest = remainingLatest?.occurredAt ?? null;

      // --- ここから書き込みのみ ---
      const now = Timestamp.now();
      tx.update(eventRef, {
        voidedAt: now,
        voidedByMemberId: params.voidedByMemberId,
        voidReason: params.voidReason,
      });
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
    // Firestoreの複合インデックスの組み合わせ爆発を避けるため、Firestore側の等価
    // フィルタは「choreId」「areaId(chore由来のin)」「actorMemberId」のうち
    // 優先度が最も高い1つだけに限定し、残りはアプリ側で絞り込む(レビュー指摘 #2, #6)。
    // 個人利用規模(設計書 §14.2)ではこれで十分な性能が出る。
    if (opts?.areaId) {
      return this.listChoreEventsByAreaId(householdId, opts);
    }

    let query = this.eventsCol(householdId) as FirebaseFirestore.Query;
    if (!opts?.includeVoided) query = query.where("voidedAt", "==", null);
    if (opts?.choreId) {
      query = query.where("choreId", "==", opts.choreId);
    } else if (opts?.actorMemberId) {
      query = query.where("actorMemberId", "==", opts.actorMemberId);
    }
    if (opts?.from)
      query = query.where("occurredAt", ">=", Timestamp.fromDate(opts.from));
    if (opts?.to)
      query = query.where("occurredAt", "<=", Timestamp.fromDate(opts.to));
    query = query.orderBy("occurredAt", "desc");

    const page = await this.runPagedQuery(householdId, query, opts);

    // choreId をFirestore側フィルタに使った場合、actorMemberId はアプリ側で絞り込む
    // (逆に actorMemberId を使った場合の choreId 絞り込みも同様)。
    let items = page.items;
    if (opts?.choreId && opts?.actorMemberId) {
      items = items.filter((e) => e.actorMemberId === opts.actorMemberId);
    }
    return { items, nextCursor: page.nextCursor };
  }

  /**
   * areaId 絞り込み: 対象エリアの choreId 一覧を取得し、`in` クエリを
   * `IN_QUERY_CHUNK_SIZE` 件ずつに分割して問い合わせ、occurredAt降順にマージする
   * (レビュー指摘 #6)。チャンク数には安全上限を設ける。
   */
  private async listChoreEventsByAreaId(
    householdId: string,
    opts: ListChoreEventsGlobalOptions,
  ): Promise<Page<ChoreEvent>> {
    const choresSnap = await this.choresCol(householdId)
      .where("areaId", "==", opts.areaId)
      .get();
    const choreIds = choresSnap.docs.map((d) => d.id);
    if (choreIds.length === 0) return { items: [], nextCursor: null };

    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
    const chunks = chunk(choreIds, IN_QUERY_CHUNK_SIZE).slice(0, MAX_AREA_CHUNKS);

    let cursorOccurredAt: Timestamp | null = null;
    if (opts.cursor) {
      const cursorEvent = await this.getChoreEvent(householdId, opts.cursor);
      if (!cursorEvent) throw new RepoInvalidQueryError("cursor");
      cursorOccurredAt = Timestamp.fromDate(cursorEvent.occurredAt);
    }

    const results = await Promise.all(
      chunks.map(async (ids) => {
        let q = this.eventsCol(householdId).where(
          "choreId",
          "in",
          ids,
        ) as FirebaseFirestore.Query;
        if (!opts.includeVoided) q = q.where("voidedAt", "==", null);
        if (opts.from) q = q.where("occurredAt", ">=", Timestamp.fromDate(opts.from));
        if (opts.to) q = q.where("occurredAt", "<=", Timestamp.fromDate(opts.to));
        q = q.orderBy("occurredAt", "desc");
        if (cursorOccurredAt) q = q.startAfter(cursorOccurredAt);
        // 各チャンクから limit+1 件ずつ取れば、マージ後の上位limit(+1)件の正しさが
        // 保証できる(あるチャンク内での順位がlimitを超える結果は、全体順位でも
        // limitを超えるため)。
        q = q.limit(limit + 1);
        const snap = await q.get();
        return snap.docs.map((doc) =>
          eventFromDoc(doc.id, householdId, doc.data() as ChoreEventDoc),
        );
      }),
    );

    let merged = results.flat();
    if (opts.actorMemberId) {
      merged = merged.filter((e) => e.actorMemberId === opts.actorMemberId);
    }
    merged.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

    const items = merged.slice(0, limit);
    const nextCursor =
      merged.length > limit ? (items[items.length - 1]?.id ?? null) : null;
    return { items, nextCursor };
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
      // カーソルが存在しないIDを指している場合は400にする(レビュー指摘 #11)。
      // サイレントに先頭から返すと、クライアントが壊れたカーソルに気づけない。
      if (!cursorSnap.exists) {
        throw new RepoInvalidQueryError("cursor");
      }
      q = q.startAfter(cursorSnap);
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
          householdId,
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
      householdId,
      updatedAt: Timestamp.now(),
    };
    await ref.set(updated);
    return settingsFromDoc(memberId, householdId, updated);
  }

  // --- Web Push購読 ---

  async upsertPushSubscription(
    householdId: string,
    memberId: string,
    sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  ): Promise<PushSubscriptionRecord> {
    const id = createHash("sha256").update(sub.endpoint).digest("hex");
    const doc: PushSubscriptionDoc = {
      householdId,
      memberId,
      endpoint: sub.endpoint,
      keys: sub.keys,
      createdAt: Timestamp.now(),
    };
    await this.pushSubscriptionsCol(householdId).doc(id).set(doc);
    return pushSubscriptionFromDoc(id, doc);
  }

  async deletePushSubscriptionByEndpoint(
    householdId: string,
    memberId: string,
    endpoint: string,
  ): Promise<void> {
    const id = createHash("sha256").update(endpoint).digest("hex");
    const ref = this.pushSubscriptionsCol(householdId).doc(id);
    const snap = await ref.get();
    if (snap.exists && (snap.data() as PushSubscriptionDoc).memberId === memberId) {
      await ref.delete();
    }
  }

  async deletePushSubscriptionById(
    householdId: string,
    id: string,
  ): Promise<void> {
    await this.pushSubscriptionsCol(householdId).doc(id).delete();
  }

  async listPushSubscriptionsForMember(
    householdId: string,
    memberId: string,
  ): Promise<PushSubscriptionRecord[]> {
    const snap = await this.pushSubscriptionsCol(householdId)
      .where("memberId", "==", memberId)
      .get();
    return snap.docs.map((doc) =>
      pushSubscriptionFromDoc(doc.id, doc.data() as PushSubscriptionDoc),
    );
  }

  // --- 朝のまとめ通知(cron) ---

  async listHouseholds(): Promise<Household[]> {
    const snap = await this.db.collection("households").get();
    return snap.docs.map((doc) =>
      householdFromDoc(doc.id, doc.data() as HouseholdDoc),
    );
  }

  async listActiveMembersWithNotificationSettings(
    householdId: string,
  ): Promise<Array<{ member: Member; settings: NotificationSettings }>> {
    const members = await this.listMembers(householdId);
    const active = members.filter((m) => m.isActive);
    return Promise.all(
      active.map(async (member) => {
        const settings =
          (await this.getNotificationSettings(householdId, member.id)) ?? {
            memberId: member.id,
            householdId,
            dailySummaryEnabled: true,
            dailySummaryTime: "08:00",
            includeUpcoming: false,
            oneTapComplete: true,
            lastSentLocalDate: null,
            updatedAt: new Date(),
          };
        return { member, settings };
      }),
    );
  }

  async claimDailySummarySlot(
    householdId: string,
    memberId: string,
    localDate: string,
  ): Promise<boolean> {
    const ref = this.notificationSettingsCol(householdId).doc(memberId);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const base: NotificationSettingsDoc = snap.exists
        ? (snap.data() as NotificationSettingsDoc)
        : {
            householdId,
            dailySummaryEnabled: true,
            dailySummaryTime: "08:00",
            includeUpcoming: false,
            oneTapComplete: true,
            lastSentLocalDate: null,
            updatedAt: Timestamp.now(),
          };
      if (base.lastSentLocalDate === localDate) return false;
      tx.set(ref, { ...base, lastSentLocalDate: localDate, updatedAt: Timestamp.now() });
      return true;
    });
  }
}
