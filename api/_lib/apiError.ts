/**
 * サービス層からルート層へ伝えるHTTPエラー。`architecture.md` のエラー応答形式
 * `{ error: "<code>", details?: ... }` に対応する。
 */
export class ApiError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(statusCode: number, code: string, details?: unknown) {
    super(code);
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function notFound(resource: string): ApiError {
  return new ApiError(404, "not_found", { resource });
}

export function invalidBody(details?: unknown): ApiError {
  return new ApiError(400, "invalid_body", details);
}
