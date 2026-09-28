import { ApiError, invalidBody } from "../apiError.js";
import {
  AiServiceError,
  choreListProposalInputSchema,
  choreSuggestionInputSchema,
  proposeChoreList,
  suggestChore,
} from "../services/ai.js";
import type { RouteCtx, RouteResult } from "./types.js";
import { ok } from "./types.js";

/** AIサービスのエラーを `{error: "<code>"}` の502へ変換する(architecture.md「エラー応答: 502 AI系」)。 */
function toApiError(err: unknown): ApiError {
  if (err instanceof AiServiceError) {
    // ai_not_configured(設定ミス)は502ではなく500として扱う。
    const status = err.code === "ai_not_configured" ? 500 : 502;
    return new ApiError(status, err.code);
  }
  throw err;
}

export async function aiChoreSuggestion(
  ctx: RouteCtx,
  body: unknown,
): Promise<RouteResult> {
  const parsed = choreSuggestionInputSchema.safeParse(body);
  if (!parsed.success) throw invalidBody(parsed.error.issues);

  try {
    const result = await suggestChore(ctx.repo, ctx.householdId, parsed.data.name);
    return ok(result);
  } catch (err) {
    throw toApiError(err);
  }
}

export async function aiChoreListProposal(
  ctx: RouteCtx,
  body: unknown,
): Promise<RouteResult> {
  const parsed = choreListProposalInputSchema.safeParse(body);
  if (!parsed.success) throw invalidBody(parsed.error.issues);

  try {
    const items = await proposeChoreList(ctx.repo, ctx.householdId, parsed.data.context);
    return ok({ items });
  } catch (err) {
    throw toApiError(err);
  }
}
