import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Vercel の Node.js Functions が req/res に付与するヘルパー
 * (`res.status().json()`, パース済み `req.body`)に依存せず、生の
 * `http.IncomingMessage`/`http.ServerResponse` だけで動くようにするための
 * 最小限のユーティリティ。ランタイムの挙動差(ヘルパーが無い/効かない)で
 * ハンドラ自体が落ちることを避ける。
 */

/**
 * すでにヘッダーを送信済み/レスポンスを終えている場合は何もしない。
 * ハンドラ内の複数のcatchが多重にレスポンスを送ろうとして
 * ERR_HTTP_HEADERS_SENT で例外が飛び、それがさらに未処理rejectionになるのを防ぐ。
 */
export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  if (res.headersSent || res.writableEnded) return;
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

/** リクエストボディの上限(1MiB)。超えたら読み込みを打ち切る。 */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * リクエストボディを読み取ってJSONとしてパースする。
 * - Vercel がすでに `req.body` にパース済みの値を入れていれば、それを使う
 *   (オブジェクトはそのまま、文字列/BufferはtoString+JSON.parse)。
 * - どれでも無ければ生のストリームを読んでJSON.parseする。1MiBを超えたら
 *   読み込みを止めて `undefined` を返す(呼び出し側は 400 invalid_body 扱い)。
 * パースに失敗した場合も `undefined` を返す。
 */
export async function readJsonBody(
  req: IncomingMessage & { body?: unknown },
): Promise<unknown> {
  if (req.body !== undefined && req.body !== null) {
    let text: string;
    if (Buffer.isBuffer(req.body)) {
      text = req.body.toString("utf-8");
    } else if (typeof req.body === "string") {
      text = req.body;
    } else {
      return req.body;
    }
    if (text.length === 0) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of req) {
      const buf: Buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(String(chunk));
      total += buf.length;
      if (total > MAX_BODY_BYTES) {
        req.destroy();
        return undefined;
      }
      chunks.push(buf);
    }
    const raw = Buffer.concat(chunks).toString("utf-8");
    if (raw.length === 0) return undefined;
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** クエリ文字列(`req.url` 由来)を `URLSearchParams` としてパースする。 */
export function parseQuery(url: string | undefined): URLSearchParams {
  if (!url) return new URLSearchParams();
  const idx = url.indexOf("?");
  if (idx === -1) return new URLSearchParams();
  return new URLSearchParams(url.slice(idx + 1));
}
