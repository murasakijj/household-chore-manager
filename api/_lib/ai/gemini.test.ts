import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const generateContentMock = vi.fn();

vi.mock("@google/genai", async () => {
  const actual = await vi.importActual<typeof import("@google/genai")>("@google/genai");
  return {
    ...actual,
    GoogleGenAI: vi.fn().mockImplementation(function GoogleGenAI() {
      return { models: { generateContent: generateContentMock } };
    }),
  };
});

const baseReq = {
  system: "system prompt",
  prompt: "user prompt",
  jsonSchema: {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
  },
  signal: new AbortController().signal,
};

describe("GeminiProvider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
    generateContentMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("APIキー未設定なら ai_not_configured を投げる", async () => {
    delete process.env.GEMINI_API_KEY;
    const { GeminiProvider } = await import("./gemini.js");
    const provider = new GeminiProvider();
    await expect(provider.generateJson(baseReq)).rejects.toMatchObject({
      statusCode: 500,
      code: "ai_not_configured",
    });
  });

  it("response.textをJSONとしてパースして返す", async () => {
    generateContentMock.mockResolvedValue({ text: JSON.stringify({ name: "掃除" }) });
    const { GeminiProvider } = await import("./gemini.js");
    const provider = new GeminiProvider();
    const result = await provider.generateJson(baseReq);
    expect(result).toEqual({ name: "掃除" });
  });

  it("textが空なら invalid_ai_output", async () => {
    generateContentMock.mockResolvedValue({ text: "" });
    const { GeminiProvider } = await import("./gemini.js");
    const provider = new GeminiProvider();
    await expect(provider.generateJson(baseReq)).rejects.toMatchObject({
      statusCode: 502,
      code: "invalid_ai_output",
    });
  });

  it("status 503のエラーは overloaded へ正規化する", async () => {
    generateContentMock.mockRejectedValue({ status: 503, message: "overloaded" });
    const { GeminiProvider } = await import("./gemini.js");
    const provider = new GeminiProvider();
    await expect(provider.generateJson(baseReq)).rejects.toMatchObject({
      statusCode: 502,
      code: "overloaded",
    });
  });
});
