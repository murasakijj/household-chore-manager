import { describe, it, expect, vi } from "vitest";
import { callWithRetry } from "./retry.js";
import { AiProviderError } from "./types.js";

/**
 * recipe-buddy の `api/_lib/ai.test.ts`(callGeminiWithRetry)を、プロバイダ非依存の
 * `callWithRetry` 向けに移植したもの。エラーは `{status}` を持つ単純なオブジェクトにし、
 * `statusOf`/`classify` はそれを見て分類する。
 */

function fakeSleep(): { sleep: (ms: number) => Promise<void>; calls: number[] } {
  const calls: number[] = [];
  const sleep = (ms: number) => {
    calls.push(ms);
    return Promise.resolve();
  };
  return { sleep, calls };
}

function fakeClock(stepMs: number): () => number {
  let current = 0;
  return () => {
    const value = current;
    current += stepMs;
    return value;
  };
}

function scriptedClock(values: number[]): () => number {
  let i = 0;
  return () => {
    const value = values[Math.min(i, values.length - 1)];
    i++;
    return value;
  };
}

interface StatusError {
  status: number;
}

function statusOf(err: unknown): number | undefined {
  const status = (err as Partial<StatusError> | undefined)?.status;
  return typeof status === "number" ? status : undefined;
}

function classify(err: unknown): AiProviderError {
  if (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  ) {
    return new AiProviderError(502, "upstream_error");
  }
  const status = statusOf(err);
  const code =
    status === 429 ? "rate_limited" : status === 503 ? "overloaded" : "upstream_error";
  return new AiProviderError(502, code);
}

const defaultOptions = { logTag: "test", statusOf, classify };

function overloadedError(): StatusError {
  return { status: 503 };
}
function rateLimitedError(): StatusError {
  return { status: 429 };
}
function badRequestError(): StatusError {
  return { status: 400 };
}
function timeoutError(): Error {
  const err = new Error("timeout");
  err.name = "TimeoutError";
  return err;
}
function hangingAttempt(): Promise<never> {
  return new Promise<never>(() => {});
}

describe("callWithRetry", () => {
  it("503が返っても指定回数までリトライし、成功したら結果を返す", async () => {
    const { sleep, calls } = fakeSleep();
    let callCount = 0;
    const attempt = vi.fn(async () => {
      callCount++;
      if (callCount < 3) throw overloadedError();
      return "ok";
    });

    const result = await callWithRetry(attempt, {
      ...defaultOptions,
      sleep,
      now: fakeClock(1_000),
    });

    expect(result).toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBeGreaterThanOrEqual(1_000);
    expect(calls[0]).toBeLessThanOrEqual(1_300);
    expect(calls[1]).toBeGreaterThanOrEqual(3_000);
    expect(calls[1]).toBeLessThanOrEqual(3_300);
  });

  it("3回とも503なら overloaded の AiProviderError を投げる", async () => {
    const { sleep } = fakeSleep();
    const attempt = vi.fn(async () => {
      throw overloadedError();
    });

    await expect(
      callWithRetry(attempt, { ...defaultOptions, sleep, now: fakeClock(1_000) }),
    ).rejects.toMatchObject({ statusCode: 502, code: "overloaded" });
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("429も同様にリトライされ、最終的に rate_limited になる", async () => {
    const { sleep } = fakeSleep();
    const attempt = vi.fn(async () => {
      throw rateLimitedError();
    });

    await expect(
      callWithRetry(attempt, { ...defaultOptions, sleep, now: fakeClock(1_000) }),
    ).rejects.toMatchObject({ statusCode: 502, code: "rate_limited" });
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("400系はリトライせず1回で終わる", async () => {
    const { sleep } = fakeSleep();
    const attempt = vi.fn(async () => {
      throw badRequestError();
    });

    await expect(
      callWithRetry(attempt, { ...defaultOptions, sleep, now: fakeClock(1_000) }),
    ).rejects.toMatchObject({ statusCode: 502, code: "upstream_error" });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("残り時間が12秒未満のときはリトライしない", async () => {
    const { sleep } = fakeSleep();
    const attempt = vi.fn(async () => {
      throw overloadedError();
    });

    let called = 0;
    const now = () => {
      const value = called === 0 ? 0 : 39_000;
      called++;
      return value;
    };

    await expect(
      callWithRetry(attempt, { ...defaultOptions, deadlineMs: 50_000, sleep, now }),
    ).rejects.toMatchObject({ statusCode: 502, code: "overloaded" });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("成功した1回目でリトライは発生しない", async () => {
    const { sleep, calls } = fakeSleep();
    const attempt = vi.fn(async () => "ok");

    const result = await callWithRetry(attempt, {
      ...defaultOptions,
      sleep,
      now: fakeClock(1_000),
    });

    expect(result).toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });

  it("残りがちょうど12000msのときはリトライする(境界値)", async () => {
    const { sleep } = fakeSleep();
    const attempt = vi.fn(async () => {
      throw overloadedError();
    });
    const now = scriptedClock([0, 0, 38_000, 38_000, 45_000]);

    await expect(
      callWithRetry(attempt, { ...defaultOptions, deadlineMs: 50_000, sleep, now }),
    ).rejects.toMatchObject({ statusCode: 502, code: "overloaded" });
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("残りが11999msのときはリトライしない(境界値)", async () => {
    const { sleep } = fakeSleep();
    const attempt = vi.fn(async () => {
      throw overloadedError();
    });
    const now = scriptedClock([0, 0, 38_001]);

    await expect(
      callWithRetry(attempt, { ...defaultOptions, deadlineMs: 50_000, sleep, now }),
    ).rejects.toMatchObject({ statusCode: 502, code: "overloaded" });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("タイムアウト(TimeoutError)はリトライ対象にならず1回で終わる", async () => {
    const { sleep } = fakeSleep();
    const attempt = vi.fn(async () => {
      throw timeoutError();
    });

    await expect(
      callWithRetry(attempt, { ...defaultOptions, sleep, now: fakeClock(1_000) }),
    ).rejects.toMatchObject({ statusCode: 502, code: "upstream_error" });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("attemptがAbortSignalを無視してハングしても、デッドラインで強制的に打ち切られる", async () => {
    const { sleep } = fakeSleep();
    const attempt = vi.fn(() => hangingAttempt());
    const startedAt = Date.now();

    await expect(
      callWithRetry(attempt, { ...defaultOptions, deadlineMs: 20, sleep }),
    ).rejects.toMatchObject({ statusCode: 502, code: "upstream_error" });

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("直前に503を観測していれば、リトライがデッドラインで中断されても overloaded に分類する", async () => {
    const { sleep } = fakeSleep();
    let callCount = 0;
    const attempt = vi.fn(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(overloadedError());
      return hangingAttempt();
    });

    const now = scriptedClock([0, 0, 1_000, 49_985]);

    await expect(
      callWithRetry(attempt, { ...defaultOptions, deadlineMs: 50_000, sleep, now }),
    ).rejects.toMatchObject({ statusCode: 502, code: "overloaded" });
    expect(attempt).toHaveBeenCalledTimes(2);
  });
});
