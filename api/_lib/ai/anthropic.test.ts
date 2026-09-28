import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AnthropicProvider } from "./anthropic.js";

const baseReq = {
  system: "system prompt",
  prompt: "user prompt",
  jsonSchema: { type: "object", properties: {} },
  signal: new AbortController().signal,
};

describe("AnthropicProvider", () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it("APIキー未設定なら ai_not_configured を投げる", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const provider = new AnthropicProvider();
    await expect(provider.generateJson(baseReq)).rejects.toMatchObject({
      statusCode: 500,
      code: "ai_not_configured",
    });
  });

  it("tool_useブロックのinputを返す", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          content: [{ type: "tool_use", name: "emit_result", input: { ok: true } }],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const provider = new AnthropicProvider();
    const result = await provider.generateJson(baseReq);
    expect(result).toEqual({ ok: true });
  });

  it("tool_useブロックが無ければ invalid_ai_output", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: "hi" }] }), {
        status: 200,
      }),
    ) as unknown as typeof fetch;

    const provider = new AnthropicProvider();
    await expect(provider.generateJson(baseReq)).rejects.toMatchObject({
      statusCode: 502,
      code: "invalid_ai_output",
    });
  });

  it("503は overloaded(502)へ正規化する", async () => {
    global.fetch = vi.fn(async () => new Response("overloaded", { status: 503 })) as unknown as typeof fetch;

    const provider = new AnthropicProvider();
    await expect(provider.generateJson(baseReq)).rejects.toMatchObject({
      statusCode: 502,
      code: "overloaded",
    });
  });
});
