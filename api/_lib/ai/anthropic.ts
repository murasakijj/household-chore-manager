import { callWithRetry, DEADLINE_MS } from "./retry.js";
import { AiProviderError, type AiProvider, type GenerateJsonRequest } from "./types.js";

/**
 * Anthropic Messages API を fetch のみで呼ぶ。構造化出力は、`jsonSchema` を
 * `input_schema` に持つツールを1つ定義し `tool_choice` で強制することで得る
 * (Claude はネイティブな `response_format` を持たないため)。
 */
const DEFAULT_MODEL = "claude-haiku-4-5";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const TOOL_NAME = "emit_result";

function getModel(): string {
  return process.env.AI_MODEL?.trim() || DEFAULT_MODEL;
}

function getApiKey(): string {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AiProviderError(500, "ai_not_configured");
  return apiKey;
}

class HttpStatusError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function statusOf(err: unknown): number | undefined {
  if (err instanceof HttpStatusError) return err.status;
  return undefined;
}

function classify(err: unknown): AiProviderError {
  if (err instanceof AiProviderError) return err;
  console.error("[ai:anthropic] error", {
    name: err instanceof Error ? err.name : undefined,
    status: statusOf(err),
    message: err instanceof Error ? err.message : undefined,
  });
  const status = statusOf(err);
  if (status !== undefined) {
    // 529 は Anthropic 固有の「過負荷」ステータス(503と同じ扱い)。
    const code =
      status === 429 ? "rate_limited" : status === 503 || status === 529 ? "overloaded" : "upstream_error";
    return new AiProviderError(502, code);
  }
  return new AiProviderError(502, "upstream_error");
}

interface ToolUseBlock {
  type: "tool_use";
  name: string;
  input: unknown;
}

export class AnthropicProvider implements AiProvider {
  async generateJson(req: GenerateJsonRequest): Promise<unknown> {
    const apiKey = getApiKey();
    const model = getModel();

    return callWithRetry(
      async (signal) => {
        const res = await fetch(ANTHROPIC_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model,
            max_tokens: 4096,
            system: req.system,
            messages: [{ role: "user", content: req.prompt }],
            tools: [
              {
                name: TOOL_NAME,
                description: "指定されたJSON Schemaに従う結果を返す。",
                input_schema: req.jsonSchema,
              },
            ],
            tool_choice: { type: "tool", name: TOOL_NAME },
          }),
          signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new HttpStatusError(res.status, `anthropic http ${res.status}: ${text.slice(0, 200)}`);
        }
        const json = (await res.json()) as { content?: unknown[] };
        const toolUse = (json.content ?? []).find(
          (block): block is ToolUseBlock =>
            typeof block === "object" &&
            block !== null &&
            (block as { type?: unknown }).type === "tool_use",
        );
        if (!toolUse) throw new AiProviderError(502, "invalid_ai_output");
        return toolUse.input;
      },
      {
        logTag: "ai:anthropic",
        statusOf,
        classify,
        deadlineMs: DEADLINE_MS,
        externalSignal: req.signal,
        // Anthropicは過負荷時に429/503ではなく529を返すことがあるため、リトライ対象に加える。
        retryableStatuses: [529],
      },
    );
  }
}
