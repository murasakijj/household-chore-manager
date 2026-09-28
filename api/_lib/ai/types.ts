/**
 * AIプロバイダ抽象(decisions.md「生成AI」)。`AI_PROVIDER` で gemini/openai/anthropic を
 * 切り替えられるよう、各プロバイダ実装はこのインターフェースだけを満たせばよい。
 */

/** JSON Schema(サブセット)。各プロバイダのSDK/APIが期待する形へは実装側で変換する。 */
export type JsonSchema = Record<string, unknown>;

export interface GenerateJsonRequest {
  /** システムプロンプト(役割・出力形式の指示)。利用者入力を含めない。 */
  system: string;
  /** 利用者入力を含むプロンプト本文。呼び出し側で「ここはデータ」と区切って埋め込む。 */
  prompt: string;
  /** 期待する出力のJSON Schema。 */
  jsonSchema: JsonSchema;
  signal: AbortSignal;
}

export interface AiProvider {
  /** JSON Schemaに従う構造化出力を1回のリクエストで得る。パース済みの値(型は未検証)を返す。 */
  generateJson(req: GenerateJsonRequest): Promise<unknown>;
}

/**
 * 各プロバイダ呼び出しが上流エラーを正規化して投げるための共通エラー型。
 * `statusCode` はこのアプリのHTTPレスポンスに使う値(常に502)、`code` が
 * `{error: "<code>"}` に入る値(rate_limited/overloaded/upstream_error/invalid_ai_output/
 * ai_not_configured)。
 */
export class AiProviderError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string) {
    super(code);
    this.statusCode = statusCode;
    this.code = code;
  }
}
