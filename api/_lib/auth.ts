import { getAuth } from "firebase-admin/auth";
import { getFirebaseApp } from "./firebaseApp.js";

export class AuthError extends Error {
  statusCode: 401 | 403;

  constructor(statusCode: 401 | 403, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export interface AuthedUser {
  uid: string;
  email: string;
}

function parseAllowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Authorization ヘッダの Firebase IDトークンを検証し、
 * ALLOWED_EMAILS に含まれるメールアドレスかどうかを確認する。
 * cron を除く全 /api/* エンドポイントの先頭で必ず呼び出すこと。
 */
export async function requireAuth(
  authorizationHeader: string | string[] | undefined,
): Promise<AuthedUser> {
  const header = Array.isArray(authorizationHeader)
    ? authorizationHeader[0]
    : authorizationHeader;

  if (!header?.startsWith("Bearer ")) {
    throw new AuthError(401, "missing_token");
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    throw new AuthError(401, "missing_token");
  }

  // getFirebaseApp() はtryの外で呼ぶ。FIREBASE_SERVICE_ACCOUNT が未設定/不正
  // という設定ミスは、トークン自体の不正(401 invalid_token)とは区別し、
  // ハンドラのouter catchで 500 internal_error として扱わせる。
  const app = getFirebaseApp();

  let decoded;
  try {
    decoded = await getAuth(app).verifyIdToken(token);
  } catch {
    throw new AuthError(401, "invalid_token");
  }

  const email = decoded.email?.toLowerCase();
  if (!email || !parseAllowedEmails().includes(email)) {
    throw new AuthError(403, "forbidden");
  }

  return { uid: decoded.uid, email };
}
