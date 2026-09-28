import { AiProviderError } from "./types.js";

/**
 * プロバイダ非依存のリトライ・デッドライン処理。recipe-buddy の
 * `callGeminiWithRetry`(api/_lib/ai.ts)を、Gemini SDKに依存しない形へ一般化したもの。
 * 429(レート制限)・503(過負荷)のときだけ最大2回リトライする(初回+2 = 最大3試行)。
 */

/** Vercel の maxDuration(60秒)より先に自前で502を返すため、50秒で切る。 */
export const DEADLINE_MS = 50_000;

const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUSES = new Set([429, 503]);
const BACKOFF_SCHEDULE_MS = [1_000, 3_000];
const JITTER_MAX_MS = 300;
const MIN_REMAINING_MS_FOR_RETRY = 12_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `promise` を `ms` ミリ秒の競走タイマーと `Promise.race` させ、SDKがsignalを無視してもデッドラインを保証する。 */
function raceWithDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`ai call exceeded ${ms}ms deadline`);
      err.name = "TimeoutError";
      reject(err);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function isAbortLike(err: unknown): boolean {
  return (
    err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")
  );
}

/**
 * 呼び出し元が生のエラー(SDK例外やHTTPレスポンス)から `AiProviderError` を
 * 組み立てるための分類関数。HTTPステータスが分かれば呼び出し側で渡す。
 */
export type Classifier = (err: unknown) => AiProviderError;

function classifyFinalError(
  err: unknown,
  classify: Classifier,
  lastRetryableStatus: number | undefined,
): AiProviderError {
  const mapped = classify(err);
  if (isAbortLike(err) && lastRetryableStatus !== undefined) {
    const code = lastRetryableStatus === 429 ? "rate_limited" : "overloaded";
    return new AiProviderError(502, code);
  }
  return mapped;
}

export interface CallWithRetryOptions {
  /** ログの識別用プレフィックス(APIキーやプロンプト内容は含めない)。 */
  logTag: string;
  /** 生のエラーからHTTPステータスを取り出す(判定できなければ undefined)。 */
  statusOf: (err: unknown) => number | undefined;
  /** 生のエラーを `AiProviderError` に変換する(リトライ不能/最終失敗時に使う)。 */
  classify: Classifier;
  deadlineMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * `attempt` を実行し、429/503のときだけ最大2回まで(初回+2)リトライする。
 * バックオフは1秒→3秒(+ジッター)。呼び出し全体で `deadlineMs`(既定50秒)を守る。
 */
export async function callWithRetry<T>(
  attempt: (signal: AbortSignal) => Promise<T>,
  options: CallWithRetryOptions,
): Promise<T> {
  const { logTag, statusOf, classify } = options;
  const deadlineMs = options.deadlineMs ?? DEADLINE_MS;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const startedAt = now();

  let lastErr: unknown;
  let lastRetryableStatus: number | undefined;

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const remaining = deadlineMs - (now() - startedAt);
    if (remaining <= 0) {
      throw classifyFinalError(
        lastErr ?? new Error("deadline exceeded before attempt"),
        classify,
        lastRetryableStatus,
      );
    }

    try {
      return await raceWithDeadline(attempt(AbortSignal.timeout(remaining)), remaining);
    } catch (err) {
      lastErr = err;
      const status = statusOf(err);
      const isRetryable = status !== undefined && RETRYABLE_STATUSES.has(status);
      if (isRetryable) lastRetryableStatus = status;

      const isLastAttempt = i === MAX_ATTEMPTS - 1;
      if (!isRetryable || isLastAttempt) {
        throw classifyFinalError(err, classify, lastRetryableStatus);
      }

      const remainingAfterFailure = deadlineMs - (now() - startedAt);
      if (remainingAfterFailure < MIN_REMAINING_MS_FOR_RETRY) {
        throw classifyFinalError(err, classify, lastRetryableStatus);
      }

      const backoff =
        BACKOFF_SCHEDULE_MS[i] ?? BACKOFF_SCHEDULE_MS[BACKOFF_SCHEDULE_MS.length - 1];
      const jitter = Math.floor(Math.random() * JITTER_MAX_MS);
      const waitMs = Math.max(
        Math.min(backoff + jitter, remainingAfterFailure - 1_000),
        0,
      );
      console.error(`[${logTag}] ai retry ${i + 1}/${MAX_ATTEMPTS - 1} after ${status}`);
      await sleep(waitMs);
    }
  }

  throw classifyFinalError(lastErr, classify, lastRetryableStatus);
}
