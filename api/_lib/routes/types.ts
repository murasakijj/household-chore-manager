import type { ZodType } from "zod";
import type { RequestContext } from "../context.js";
import type { Repo } from "../repo/types.js";
import { idSchema } from "../validation.js";
import { invalidId, invalidQuery } from "../apiError.js";

export interface RouteCtx extends RequestContext {
  repo: Repo;
  now: Date;
}

export interface RouteResult {
  status: number;
  body: unknown;
}

export function ok(body: unknown, status = 200): RouteResult {
  return { status, body };
}

/** パス中のID(chore/event/area等)を検証する(レビュー指摘 #11)。不正なら400 invalid_id。 */
export function parsePathId(id: string): string {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw invalidId({ value: id });
  return parsed.data;
}

/**
 * `URLSearchParams` を zod スキーマで検証する。空文字列のキーは未指定として扱う。
 * 失敗時は400 invalid_query(レビュー指摘 #3)。
 */
export function parseQueryParams<T>(schema: ZodType<T>, query: URLSearchParams): T {
  const obj: Record<string, string> = {};
  for (const [k, v] of query.entries()) {
    if (v !== "") obj[k] = v;
  }
  const parsed = schema.safeParse(obj);
  if (!parsed.success) throw invalidQuery(parsed.error.issues);
  return parsed.data;
}
