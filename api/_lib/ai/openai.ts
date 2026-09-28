import { callWithRetry, DEADLINE_MS } from "./retry.js";
import { AiProviderError, type AiProvider, type GenerateJsonRequest } from "./types.js";

/** OpenAI互換API(OpenAI本体・OpenRouter・ローカルLLM等)を fetch のみで呼ぶ。 */
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

function getModel(): string {
  return process.env.AI_MODEL?.trim() || DEFAULT_MODEL;
}

function getBaseUrl(): string {
  return (process.env.OPENAI_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function getApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
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
  // JSON抽出失敗など、attempt内で既に AiProviderError として投げたものはそのまま通す。
  if (err instanceof AiProviderError) return err;
  console.error("[ai:openai] error", {
    name: err instanceof Error ? err.name : undefined,
    status: statusOf(err),
    message: err instanceof Error ? err.message : undefined,
  });
  const status = statusOf(err);
  if (status !== undefined) {
    const code = status === 429 ? "rate_limited" : status === 503 ? "overloaded" : "upstream_error";
    return new AiProviderError(502, code);
  }
  return new AiProviderError(502, "upstream_error");
}

export class OpenAiProvider implements AiProvider {
  async generateJson(req: GenerateJsonRequest): Promise<unknown> {
    const apiKey = getApiKey();
    const model = getModel();
    const baseUrl = getBaseUrl();

    const responseText = await callWithRetry(
      async (signal) => {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: req.system },
              { role: "user", content: req.prompt },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "response",
                schema: req.jsonSchema,
                strict: true,
              },
            },
          }),
          signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new HttpStatusError(res.status, `openai http ${res.status}: ${text.slice(0, 200)}`);
        }
        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = json.choices?.[0]?.message?.content;
        if (!content) throw new AiProviderError(502, "invalid_ai_output");
        return content;
      },
      {
        logTag: "ai:openai",
        statusOf,
        classify,
        deadlineMs: DEADLINE_MS,
        externalSignal: req.signal,
      },
    );

    try {
      return JSON.parse(responseText);
    } catch {
      throw new AiProviderError(502, "invalid_ai_output");
    }
  }
}
