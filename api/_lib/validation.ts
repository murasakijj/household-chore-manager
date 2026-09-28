import { z } from "zod";

/**
 * ISO 8601 日時文字列(設計書 §11.4)。オフセット(`Z` または `+09:00` 等)を必須にする。
 * タイムゾーン無しの文字列(例: `2026-01-01T00:00:00`)はサーバーの実行環境依存で
 * 解釈が変わるため受け付けない。
 */
const ISO_DATETIME_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

export const isoDateTime = z
  .string()
  .regex(ISO_DATETIME_WITH_OFFSET, { message: "invalid_datetime" })
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "invalid_datetime",
  });

/**
 * リソースID(家事・イベント・場所・カテゴリ・リソース・メンバー等)の形式。
 * `randomUUID()` 由来の値を主に想定するが、パス走査や不正文字の混入を防ぐため
 * 英数字・アンダースコア・ハイフンのみを許可する(設計書レビュー指摘 #11)。
 */
export const idSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,128}$/, { message: "invalid_id" });

/** IANA タイムゾーン名として `Intl.DateTimeFormat` が受理できるかを検証する。 */
export const timezoneSchema = z.string().refine(
  (value) => {
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  },
  { message: "invalid_timezone" },
);

const resourceTypeSchema = z.enum([
  "appliance",
  "fixture",
  "baby_item",
  "pet_item",
  "storage",
  "other",
]);

export const areaCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const areaPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty_patch" });

export const resourceCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  areaId: idSchema.nullable().optional(),
  resourceType: resourceTypeSchema.optional().default("other"),
  externalRef: z.string().min(1).max(200).nullable().optional(),
});

export const resourcePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    areaId: idSchema.nullable().optional(),
    resourceType: resourceTypeSchema.optional(),
    externalRef: z.string().min(1).max(200).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty_patch" });

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const categoryPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty_patch" });

/** 設計書 §8.5 必須項目: 家事名、推奨間隔。 */
export const choreCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  intervalDays: z.number().int().min(1),
  warningDays: z.number().int().min(0).optional(),
  graceDays: z.number().int().min(0).optional(),
  categoryId: idSchema.nullable().optional(),
  areaId: idSchema.nullable().optional(),
  resourceId: idSchema.nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  lastCompletedAt: isoDateTime.nullable().optional(),
});

export const chorePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    intervalDays: z.number().int().min(1).optional(),
    warningDays: z.number().int().min(0).optional(),
    graceDays: z.number().int().min(0).optional(),
    categoryId: idSchema.nullable().optional(),
    areaId: idSchema.nullable().optional(),
    resourceId: idSchema.nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty_patch" });

/** `/api/chores/bulk`: 一括提案からの登録。最大50件(architecture.md)。 */
export const choresBulkCreateSchema = z.object({
  items: z.array(choreCreateSchema).min(1).max(50),
});

export const choreEventCreateSchema = z.object({
  clientRequestId: z.string().uuid(),
  occurredAt: isoDateTime.optional(),
  actorMemberId: idSchema.optional(),
  note: z.string().max(500).nullable().optional(),
});

export const voidChoreEventSchema = z
  .object({
    reason: z.string().max(500).nullable().optional(),
  })
  .optional();

export const settingsPatchSchema = z
  .object({
    householdName: z.string().trim().min(1).max(100).optional(),
    timezone: timezoneSchema.optional(),
    dailySummaryEnabled: z.boolean().optional(),
    // 00:00〜23:00に制限する(レビュー指摘 #5): cronは毎時7分頃に実行されるため、
    // 23:xx台の途中の時刻を許すと、その日最後の実行までに間に合わず翌日扱いに
    // なりかねない。23:00なら23:07頃の実行で当日中に届く。
    dailySummaryTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .refine((v) => v <= "23:00", { message: "invalid_daily_summary_time" })
      .optional(),
    includeUpcoming: z.boolean().optional(),
    oneTapComplete: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty_patch" });

/**
 * Push購読先(ブラウザの `PushManager` が返すendpoint)のホスト許可リスト
 * (レビュー指摘 #4)。既知のPushサービスのみを許可し、任意のURLへ通知を
 * 送信させられる(SSRF的な)経路を塞ぐ。`*.` はサブドメインを含む接尾一致。
 */
const ALLOWED_PUSH_HOST_SUFFIXES = [
  "fcm.googleapis.com",
  "push.apple.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "notify.windows.com",
];

function isAllowedPushHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ALLOWED_PUSH_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

function isValidPushEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return isAllowedPushHost(url.hostname);
}

/** `PushSubscriptionJSON`(ブラウザの `PushSubscription.toJSON()`)。 */
export const pushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(2000)
    .refine(isValidPushEndpoint, { message: "invalid_push_endpoint" }),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
});

export const pushUnsubscribeSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(2000)
    .refine(isValidPushEndpoint, { message: "invalid_push_endpoint" }),
});

// --- クエリパラメータ(一覧・絞り込み系) ---

/** `limit` クエリ: 文字列を数値化し、既定50・最大100 の範囲に収める。 */
const limitQuerySchema = z
  .string()
  .regex(/^\d+$/)
  .transform((v) => Number(v))
  .pipe(z.number().int().min(1).max(100))
  .optional();

/** `true`/`false` の文字列を真偽値へ。指定が無ければ false 扱い(呼び出し側で解釈)。 */
const booleanQuerySchema = z.enum(["true", "false"]).optional();

export const listEventsQuerySchema = z.object({
  limit: limitQuerySchema,
  cursor: idSchema.optional(),
  includeVoided: booleanQuerySchema,
});

export const listEventsGlobalQuerySchema = listEventsQuerySchema.extend({
  choreId: idSchema.optional(),
  areaId: idSchema.optional(),
  actorMemberId: idSchema.optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
});

const CHORE_STATUS_VALUES = [
  "not_due",
  "upcoming",
  "recommended",
  "overdue",
  "never_done",
  "inactive",
] as const;

export const listChoresQuerySchema = z.object({
  status: z.enum(CHORE_STATUS_VALUES).optional(),
  areaId: idSchema.optional(),
  categoryId: idSchema.optional(),
  q: z.string().trim().min(1).max(200).optional(),
  includeInactive: booleanQuerySchema,
  sort: z.enum(["status", "elapsed", "name"]).optional(),
});

export const listMastersQuerySchema = z.object({
  includeInactive: booleanQuerySchema,
});
