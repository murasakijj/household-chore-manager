import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAiProvider } from "./openai.js";
import { AiProviderError } from "./types.js";

const baseReq = {
  system: "system prompt",
  prompt: "user prompt",
  jsonSchema: { type: "object", properties: {} },
  signal: new AbortController().signal,
};

describe("OpenAiProvider", () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.AI_PROVIDER = "openai";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it("APIキー未設定なら ai_not_configured を投げる", async () => {
    delete process.env.OPENAI_API_KEY;
    const provider = new OpenAiProvider();
    await expect(provider.generateJson(baseReq)).rejects.toMatchObject({
      statusCode: 500,
      code: "ai_not_configured",
    });
  });

  it("成功時はJSON本文をパースして返す", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const provider = new OpenAiProvider();
    const result = await provider.generateJson(baseReq);
    expect(result).toEqual({ ok: true });
  });

  it("429は rate_limited(502)へ正規化する", async () => {
    global.fetch = vi.fn(async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch;

    const provider = new OpenAiProvider();
    await expect(provider.generateJson(baseReq)).rejects.toMatchObject({
      statusCode: 502,
      code: "rate_limited",
    });
  });

  it("壊れたJSON本文は invalid_ai_output になる", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "not json" } }] }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const provider = new OpenAiProvider();
    await expect(provider.generateJson(baseReq)).rejects.toMatchObject({
      statusCode: 502,
      code: "invalid_ai_output",
    });
  });

  it("OPENAI_BASE_URL を指定すればそのホストへリクエストする(OpenRouter等)", async () => {
    process.env.OPENAI_BASE_URL = "https://openrouter.ai/api/v1";
    let calledUrl = "";
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      calledUrl = String(url);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const provider = new OpenAiProvider();
    await provider.generateJson(baseReq);
    expect(calledUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  it("strict json_schema向けに additionalProperties:false を含むスキーマをそのままfetch bodyへ転送する", async () => {
    const schemaWithAdditionalProps = {
      type: "object",
      properties: {
        areaName: { type: ["string", "null"] },
      },
      required: ["areaName"],
      additionalProperties: false,
    };
    let capturedBody: Record<string, unknown> | undefined;
    global.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const provider = new OpenAiProvider();
    await provider.generateJson({ ...baseReq, jsonSchema: schemaWithAdditionalProps });

    const responseFormat = capturedBody?.response_format as {
      type: string;
      json_schema: { schema: unknown; strict: boolean };
    };
    expect(responseFormat.type).toBe("json_schema");
    expect(responseFormat.json_schema.strict).toBe(true);
    expect(responseFormat.json_schema.schema).toEqual(schemaWithAdditionalProps);
    expect(
      (responseFormat.json_schema.schema as { additionalProperties?: boolean }).additionalProperties,
    ).toBe(false);
  });

  it("500エラーは upstream_error になる", async () => {
    global.fetch = vi.fn(async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    const provider = new OpenAiProvider();
    await expect(provider.generateJson(baseReq)).rejects.toBeInstanceOf(AiProviderError);
    await expect(provider.generateJson(baseReq)).rejects.toMatchObject({
      code: "upstream_error",
    });
  });
});
