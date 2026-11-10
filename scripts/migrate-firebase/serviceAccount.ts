import { readFileSync } from "node:fs";
import { expandHome } from "../lib/paths.js";

export type ServiceAccount = {
  project_id: string;
  type: string;
  private_key: string;
  client_email: string;
};

export type ServiceAccountResult =
  { ok: true; sa: ServiceAccount } | { ok: false; message: string };

const nonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

/**
 * サービスアカウントJSONを読み込んで検証する(副作用は読み込みのみ)。
 * エラーメッセージにはラベルと展開後のパス・失敗理由だけを含め、
 * ファイルの中身や JSON.parse の例外メッセージは含めない。
 */
export function readServiceAccount(
  label: string,
  rawPath: string,
  home?: string,
): ServiceAccountResult {
  const path = expandHome(rawPath, home);
  const fail = (reason: string): ServiceAccountResult => ({
    ok: false,
    message: `${label} (${path}): ${reason}`,
  });

  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (code === "ENOENT") {
      return fail(
        "file not found. Check the path. On Windows, hidden file extensions can make the real name `.json.json`; list the folder to confirm.",
      );
    }
    return fail(
      `could not read the file (error code: ${typeof code === "string" ? code : "unknown"}).`,
    );
  }

  if (
    buf.length >= 2 &&
    ((buf[0] === 0xff && buf[1] === 0xfe) ||
      (buf[0] === 0xfe && buf[1] === 0xff))
  ) {
    return fail(
      "the file is saved as UTF-16 (re-saved by Notepad or PowerShell Out-File?). Download the key file again and do not re-save it.",
    );
  }

  let text = buf.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail(
      "not valid JSON. Use the key file downloaded from Firebase Console as is.",
    );
  }
  const o: Record<string, unknown> =
    json !== null && typeof json === "object" && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : {};

  if (!nonEmptyString(o.project_id)) return fail("no project_id.");
  if (o.type !== "service_account") {
    return fail('`type` is not "service_account" (wrong kind of JSON file).');
  }
  if (!nonEmptyString(o.private_key) || !nonEmptyString(o.client_email)) {
    return fail("private_key or client_email is missing.");
  }
  return { ok: true, sa: o as unknown as ServiceAccount };
}

/** 旧・新の両方を読み込み、失敗があればまとめて1つの Error にして投げる。 */
export function loadServiceAccounts(
  oldPath: string,
  newPath: string,
  home?: string,
): { oldSa: ServiceAccount; newSa: ServiceAccount } {
  const o = readServiceAccount("--old-service-account", oldPath, home);
  const n = readServiceAccount("--new-service-account", newPath, home);
  if (o.ok && n.ok) return { oldSa: o.sa, newSa: n.sa };
  const messages = [o, n].flatMap((r) => (r.ok ? [] : [r.message]));
  throw new Error(
    `Could not load service account JSON:\n  - ${messages.join("\n  - ")}`,
  );
}
