/**
 * `clientRequestId`(冪等キー)生成用のUUID v4。`crypto.randomUUID` が使えない
 * 環境(古いSafari、非セキュアコンテキスト等)向けに `crypto.getRandomValues` から
 * RFC 4122 v4 形式を組み立てるフォールバックを持つ。
 */
export function generateUuidV4(): string {
  const cryptoObj: Crypto | undefined =
    typeof crypto !== "undefined" ? crypto : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    // RFC 4122 §4.4: バージョン(4)とバリアント(10xx)ビットを設定する。
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
    return (
      hex.slice(0, 4).join("") +
      "-" +
      hex.slice(4, 6).join("") +
      "-" +
      hex.slice(6, 8).join("") +
      "-" +
      hex.slice(8, 10).join("") +
      "-" +
      hex.slice(10, 16).join("")
    );
  }
  // 最終フォールバック(暗号論的に安全ではないが、衝突回避が目的の冪等キーとしては十分)。
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
