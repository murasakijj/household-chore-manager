import { z } from "zod";

/** ISO 8601 日時文字列(設計書 §11.4)。`Date.parse` で解釈可能かのみ検証する。 */
export const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "invalid_datetime",
  });

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
  areaId: z.string().min(1).nullable().optional(),
  resourceType: resourceTypeSchema.optional().default("other"),
  externalRef: z.string().min(1).nullable().optional(),
});

export const resourcePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    areaId: z.string().min(1).nullable().optional(),
    resourceType: resourceTypeSchema.optional(),
    externalRef: z.string().min(1).nullable().optional(),
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
  categoryId: z.string().min(1).nullable().optional(),
  areaId: z.string().min(1).nullable().optional(),
  resourceId: z.string().min(1).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  lastCompletedAt: isoDateTime.nullable().optional(),
});

export const chorePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    intervalDays: z.number().int().min(1).optional(),
    warningDays: z.number().int().min(0).optional(),
    graceDays: z.number().int().min(0).optional(),
    categoryId: z.string().min(1).nullable().optional(),
    areaId: z.string().min(1).nullable().optional(),
    resourceId: z.string().min(1).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty_patch" });

/** `/api/chores/bulk`: 一括提案からの登録。最大50件(架構.md)。 */
export const choresBulkCreateSchema = z.object({
  items: z.array(choreCreateSchema).min(1).max(50),
});

export const choreEventCreateSchema = z.object({
  clientRequestId: z.string().uuid(),
  occurredAt: isoDateTime.optional(),
  actorMemberId: z.string().min(1).optional(),
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
    timezone: z.string().min(1).max(100).optional(),
    dailySummaryEnabled: z.boolean().optional(),
    dailySummaryTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    includeUpcoming: z.boolean().optional(),
    oneTapComplete: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty_patch" });
