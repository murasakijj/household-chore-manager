import { AiProviderError, type AiProvider } from "./types.js";
import { GeminiProvider } from "./gemini.js";
import { OpenAiProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";

export type { AiProvider, GenerateJsonRequest, JsonSchema } from "./types.js";
export { AiProviderError };

/**
 * `AI_PROVIDER` 環境変数でプロバイダを選ぶ(既定 gemini。decisions.md「生成AI」)。
 * 未設定・不明な値、または選んだプロバイダのAPIキー未設定は 500系の設定エラー
 * (`ai_not_configured`)として扱い、キーの値自体はログに出さない。
 */
export function getAiProvider(): AiProvider {
  const raw = process.env.AI_PROVIDER?.trim().toLowerCase() || "gemini";
  switch (raw) {
    case "gemini":
      return new GeminiProvider();
    case "openai":
      return new OpenAiProvider();
    case "anthropic":
      return new AnthropicProvider();
    default:
      console.error(`[ai] unknown AI_PROVIDER: ${raw}`);
      throw new AiProviderError(500, "ai_not_configured");
  }
}
