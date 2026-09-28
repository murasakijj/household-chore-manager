import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { callWithRetry, DEADLINE_MS } from "./retry.js";
import { AiProviderError, type AiProvider, type GenerateJsonRequest, type JsonSchema } from "./types.js";

/** 無料枠の対象モデル(decisions.md「生成AI」。recipe-buddy と同じ)。`AI_MODEL` で上書き可能。 */
const DEFAULT_MODEL = "gemini-3.6-flash";

function getModel(): string {
  return process.env.AI_MODEL?.trim() || DEFAULT_MODEL;
}

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AiProviderError(500, "ai_not_configured");
  }
  return new GoogleGenAI({ apiKey });
}

/**
 * このアプリが渡す JSON Schema(`type`/`properties`/`items`/`enum`/`required`/
 * `nullable` のみを使う単純なもの)を Gemini の `Schema` 形式(`Type` enum)へ変換する。
 */
function toGeminiSchema(schema: JsonSchema): Schema {
  const rawType = schema.type as string | string[] | undefined;
  // 標準JSON Schemaの `type: ["string", "null"]` 形式(nullable許容)にも対応する。
  const isNullableArray = Array.isArray(rawType) && rawType.includes("null");
  const type = Array.isArray(rawType)
    ? rawType.find((t) => t !== "null")
    : rawType;
  const result: Schema = {};
  if (type === "object") {
    result.type = Type.OBJECT;
    const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
    result.properties = Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [key, toGeminiSchema(value)]),
    );
    if (Array.isArray(schema.required)) {
      result.required = schema.required as string[];
    }
  } else if (type === "array") {
    result.type = Type.ARRAY;
    result.items = toGeminiSchema((schema.items ?? {}) as JsonSchema);
  } else if (type === "string") {
    result.type = Type.STRING;
    if (Array.isArray(schema.enum)) result.enum = schema.enum as string[];
  } else if (type === "number" || type === "integer") {
    result.type = type === "integer" ? Type.INTEGER : Type.NUMBER;
  } else if (type === "boolean") {
    result.type = Type.BOOLEAN;
  }
  if (schema.nullable === true || isNullableArray) {
    result.nullable = true;
  }
  return result;
}

function statusOf(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | undefined)?.status;
  return typeof status === "number" ? status : undefined;
}

function classify(err: unknown): AiProviderError {
  const e = err as { name?: unknown; status?: unknown; message?: unknown };
  console.error("[ai:gemini] error", { name: e?.name, status: e?.status, message: e?.message });
  const status = statusOf(err);
  if (status !== undefined) {
    const code = status === 429 ? "rate_limited" : status === 503 ? "overloaded" : "upstream_error";
    return new AiProviderError(502, code);
  }
  return new AiProviderError(502, "upstream_error");
}

export class GeminiProvider implements AiProvider {
  async generateJson(req: GenerateJsonRequest): Promise<unknown> {
    const client = getClient();
    const model = getModel();
    const responseSchema = toGeminiSchema(req.jsonSchema);

    const response = await callWithRetry(
      (signal) =>
        client.models.generateContent({
          model,
          config: {
            systemInstruction: req.system,
            responseMimeType: "application/json",
            responseSchema,
            abortSignal: signal,
          },
          contents: [{ role: "user", parts: [{ text: req.prompt }] }],
        }),
      { logTag: "ai:gemini", statusOf, classify, deadlineMs: DEADLINE_MS },
    );

    const text = response.text;
    if (!text) throw new AiProviderError(502, "invalid_ai_output");
    try {
      return JSON.parse(text);
    } catch {
      throw new AiProviderError(502, "invalid_ai_output");
    }
  }
}
