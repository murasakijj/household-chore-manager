import type { RequestContext } from "../context.js";
import type { Repo } from "../repo/types.js";

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
