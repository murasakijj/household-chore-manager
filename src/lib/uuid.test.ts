import { afterEach, describe, expect, it, vi } from "vitest";
import { generateUuidV4 } from "./uuid";

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("generateUuidV4", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses crypto.randomUUID when available", () => {
    const spy = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("11111111-1111-4111-8111-111111111111");
    expect(generateUuidV4()).toBe("11111111-1111-4111-8111-111111111111");
    expect(spy).toHaveBeenCalledOnce();
  });

  it("falls back to crypto.getRandomValues and produces a valid RFC4122 v4 string", () => {
    // randomUUID を消してフォールバック経路を通す。
    const original = crypto.randomUUID;
    // @ts-expect-error テストのため一時的に削除する
    delete crypto.randomUUID;
    try {
      const id = generateUuidV4();
      expect(id).toMatch(UUID_V4_RE);
    } finally {
      crypto.randomUUID = original;
    }
  });

  it("generates distinct ids across calls", () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateUuidV4()));
    expect(ids.size).toBe(20);
  });
});
