import { timingSafeEqual } from "node:crypto";
import type { ApiRequest, ApiResponse } from "./_lib/types.js";
import { requireAuth, AuthError } from "./_lib/auth.js";
import { sendJson, readJsonBody, parseQuery } from "./_lib/http.js";
import { resolveContext } from "./_lib/context.js";
import { ApiError } from "./_lib/apiError.js";
import type { Repo } from "./_lib/repo/types.js";
import { FirestoreRepo } from "./_lib/repo/firestoreRepo.js";
import type { RouteCtx, RouteResult } from "./_lib/routes/types.js";
import { getAuthCheck } from "./_lib/routes/authCheck.js";
import {
  bulkCreateChores,
  createChore,
  getChore,
  getToday,
  listChores,
  patchChore,
} from "./_lib/routes/chores.js";
import {
  addChoreEvent,
  listAllEvents,
  listEventsForChore,
  voidEvent,
} from "./_lib/routes/choreEvents.js";
import {
  createArea,
  createCategory,
  createResource,
  listAreas,
  listCategories,
  listResources,
  patchArea,
  patchCategory,
  patchResource,
} from "./_lib/routes/masters.js";
import {
  getSettingsRoute,
  patchSettingsRoute,
} from "./_lib/routes/settings.js";
import { listMembersRoute } from "./_lib/routes/members.js";
import { getInitialChoreTemplates } from "./_lib/routes/templates.js";
import { aiChoreListProposal, aiChoreSuggestion } from "./_lib/routes/ai.js";
import {
  createPushSubscription,
  deletePushSubscription,
  sendTestPush,
} from "./_lib/routes/push.js";
import { dailySummaryCron } from "./_lib/routes/cron.js";

/**
 * `req.url`(または `__path` クエリ)から `/api/` 配下のパスを取り出す。
 * Vercel の rewrite (`/api/(.*)` → `/api/router?__path=$1`) を優先し、
 * 無ければ `req.url` から直接パースする(vercel dev 等)。
 */
function resolvePath(req: ApiRequest): string {
  const url = req.url ?? "";
  const query = parseQuery(url);
  const fromQuery = req.query?.__path ?? query.get("__path");
  const raw = Array.isArray(fromQuery) ? fromQuery[0] : fromQuery;
  if (raw !== undefined && raw !== null) return raw;

  const pathname = url.split("?")[0] ?? "";
  return pathname.replace(/^\/?api\/?/, "");
}

/** `?a=b&c=d` 部分だけを `URLSearchParams` として取り出す。 */
function resolveQuery(req: ApiRequest): URLSearchParams {
  const url = req.url ?? "";
  const idx = url.indexOf("?");
  const params =
    idx === -1
      ? new URLSearchParams()
      : new URLSearchParams(url.slice(idx + 1));
  params.delete("__path");
  return params;
}

/**
 * `Authorization: Bearer $CRON_SECRET` を定数時間比較で検証する。
 * `CRON_SECRET` が未設定の場合は常に拒否する(architecture.md セキュリティチェックリスト)。
 */
function verifyCronSecret(
  authorizationHeader: string | string[] | undefined,
): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = Array.isArray(authorizationHeader)
    ? authorizationHeader[0]
    : authorizationHeader;
  if (!header?.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length).trim();

  const expected = Buffer.from(secret);
  const actual = Buffer.from(token);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

type Dispatch = (
  ctx: RouteCtx,
  req: ApiRequest,
  query: URLSearchParams,
  body: unknown,
) => Promise<RouteResult>;

/** パスセグメント配列とメソッドからハンドラを解決する。マッチしなければ null(→404)。 */
function matchRoute(method: string, segments: string[]): Dispatch | null {
  const [s0, s1, s2] = segments;

  if (segments.length === 0 || (segments.length === 1 && s0 === "auth-check")) {
    if (method === "GET") return (ctx) => getAuthCheck(ctx);
  }

  if (s0 === "chores") {
    if (segments.length === 1) {
      if (method === "GET") return (ctx, _req, query) => listChores(ctx, query);
      if (method === "POST")
        return (ctx, _req, _query, body) => createChore(ctx, body);
    }
    if (segments.length === 2 && s1 === "bulk" && method === "POST") {
      return (ctx, _req, _query, body) => bulkCreateChores(ctx, body);
    }
    if (segments.length === 2 && s1 === "today" && method === "GET") {
      return (ctx) => getToday(ctx);
    }
    if (segments.length === 2 && s1) {
      if (method === "GET") return (ctx) => getChore(ctx, s1);
      if (method === "PATCH")
        return (ctx, _req, _query, body) => patchChore(ctx, s1, body);
    }
    if (segments.length === 3 && s1 && s2 === "events") {
      if (method === "GET")
        return (ctx, _req, query) => listEventsForChore(ctx, s1, query);
      if (method === "POST")
        return (ctx, _req, _query, body) => addChoreEvent(ctx, s1, body);
    }
  }

  if (s0 === "chore-events") {
    if (segments.length === 1 && method === "GET") {
      return (ctx, _req, query) => listAllEvents(ctx, query);
    }
    if (segments.length === 3 && s1 && s2 === "void" && method === "POST") {
      return (ctx, _req, _query, body) => voidEvent(ctx, s1, body);
    }
  }

  if (s0 === "areas") {
    if (segments.length === 1) {
      if (method === "GET") return (ctx, _req, query) => listAreas(ctx, query);
      if (method === "POST")
        return (ctx, _req, _query, body) => createArea(ctx, body);
    }
    if (segments.length === 2 && s1 && method === "PATCH") {
      return (ctx, _req, _query, body) => patchArea(ctx, s1, body);
    }
  }

  if (s0 === "resources") {
    if (segments.length === 1) {
      if (method === "GET")
        return (ctx, _req, query) => listResources(ctx, query);
      if (method === "POST")
        return (ctx, _req, _query, body) => createResource(ctx, body);
    }
    if (segments.length === 2 && s1 && method === "PATCH") {
      return (ctx, _req, _query, body) => patchResource(ctx, s1, body);
    }
  }

  if (s0 === "chore-categories") {
    if (segments.length === 1) {
      if (method === "GET")
        return (ctx, _req, query) => listCategories(ctx, query);
      if (method === "POST")
        return (ctx, _req, _query, body) => createCategory(ctx, body);
    }
    if (segments.length === 2 && s1 && method === "PATCH") {
      return (ctx, _req, _query, body) => patchCategory(ctx, s1, body);
    }
  }

  if (s0 === "settings" && segments.length === 1) {
    if (method === "GET") return (ctx) => getSettingsRoute(ctx);
    if (method === "PATCH")
      return (ctx, _req, _query, body) => patchSettingsRoute(ctx, body);
  }

  if (s0 === "members" && segments.length === 1 && method === "GET") {
    return (ctx) => listMembersRoute(ctx);
  }

  if (
    s0 === "templates" &&
    s1 === "initial-chores" &&
    segments.length === 2 &&
    method === "GET"
  ) {
    return () => getInitialChoreTemplates();
  }

  if (s0 === "ai" && segments.length === 2 && method === "POST") {
    if (s1 === "chore-suggestion") {
      return (ctx, _req, _query, body) => aiChoreSuggestion(ctx, body);
    }
    if (s1 === "chore-list-proposal") {
      return (ctx, _req, _query, body) => aiChoreListProposal(ctx, body);
    }
  }

  if (s0 === "push" && s1 === "subscriptions" && segments.length === 2) {
    if (method === "POST")
      return (ctx, _req, _query, body) => createPushSubscription(ctx, body);
    if (method === "DELETE")
      return (ctx, _req, _query, body) => deletePushSubscription(ctx, body);
  }

  if (
    s0 === "push" &&
    s1 === "test" &&
    segments.length === 2 &&
    method === "POST"
  ) {
    return (ctx) => sendTestPush(ctx);
  }

  return null;
}

/**
 * ルーターを組み立てる。本番は `FirestoreRepo`、結合テストは `MemoryRepo` を
 * `repoFactory` として渡す(architecture.md「リポジトリ層」)。
 */
export function createRouter(repoFactory: () => Repo) {
  return async function handler(
    req: ApiRequest,
    res: ApiResponse,
  ): Promise<void> {
    try {
      const path = resolvePath(req);
      const segments = path.split("/").filter(Boolean);
      const method = req.method ?? "GET";

      // cron は requireAuth(Firebase IDトークン)を通さない(設計書 §11.4の例外、
      // architecture.md)。代わりに CRON_SECRET を定数時間比較で検証する。
      if (segments[0] === "cron") {
        if (
          segments.length === 2 &&
          segments[1] === "daily-summary" &&
          (method === "GET" || method === "POST")
        ) {
          if (!verifyCronSecret(req.headers.authorization)) {
            sendJson(res, 401, { error: "unauthorized" });
            return;
          }
          const repo: Repo = repoFactory();
          const result = await dailySummaryCron(repo, new Date());
          sendJson(res, 200, result);
          return;
        }
        sendJson(res, 404, { error: "not_found" });
        return;
      }

      let user;
      try {
        user = await requireAuth(req.headers.authorization);
      } catch (err) {
        if (err instanceof AuthError) {
          sendJson(res, err.statusCode, { error: err.message });
          return;
        }
        throw err;
      }

      const dispatch = matchRoute(method, segments);
      if (!dispatch) {
        sendJson(res, 404, { error: "not_found" });
        return;
      }

      const repo: Repo = repoFactory();
      const context = await resolveContext(repo, user);
      const ctx: RouteCtx = { ...context, repo, now: new Date() };

      const query = resolveQuery(req);
      const body =
        method === "POST" || method === "PATCH" || method === "DELETE"
          ? await readJsonBody(req)
          : undefined;

      let result: RouteResult;
      try {
        result = await dispatch(ctx, req, query, body);
      } catch (err) {
        if (err instanceof ApiError) {
          sendJson(res, err.statusCode, {
            error: err.message,
            details: err.details,
          });
          return;
        }
        throw err;
      }

      sendJson(res, result.status, result.body);
    } catch (err) {
      console.error("[api] unhandled", err);
      sendJson(res, 500, { error: "internal_error" });
    }
  };
}

export default createRouter(() => new FirestoreRepo());
