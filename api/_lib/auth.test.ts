import { describe, it, expect, vi, beforeEach } from "vitest";

// firebase-admin をモックする。getApps が初期化済みアプリを返すことで、
// getFirebaseApp が FIREBASE_SERVICE_ACCOUNT env を要求せず既存アプリを使う。
const verifyIdToken = vi.fn();

vi.mock("firebase-admin/app", () => ({
  getApps: () => [{}],
  initializeApp: vi.fn(),
  cert: vi.fn(),
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken }),
}));

// モック定義後に import する。
const { requireAuth } = await import("./auth.js");

describe("requireAuth", () => {
  beforeEach(() => {
    verifyIdToken.mockReset();
    process.env.ALLOWED_EMAILS = "ok@example.com, two@example.com";
  });

  it("Authorization ヘッダが無ければ 401", async () => {
    await expect(requireAuth(undefined)).rejects.toMatchObject({
      statusCode: 401,
      message: "missing_token",
    });
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it("Bearer 形式でなければ 401", async () => {
    await expect(requireAuth("Basic abc123")).rejects.toMatchObject({
      statusCode: 401,
      message: "missing_token",
    });
  });

  it("トークンが空文字なら 401", async () => {
    await expect(requireAuth("Bearer   ")).rejects.toMatchObject({
      statusCode: 401,
      message: "missing_token",
    });
  });

  it("トークン検証に失敗したら 401", async () => {
    verifyIdToken.mockRejectedValue(new Error("bad token"));
    await expect(requireAuth("Bearer sometoken")).rejects.toMatchObject({
      statusCode: 401,
      message: "invalid_token",
    });
  });

  it("許可リスト外のメールなら 403", async () => {
    verifyIdToken.mockResolvedValue({
      uid: "u1",
      email: "stranger@example.com",
    });
    await expect(requireAuth("Bearer sometoken")).rejects.toMatchObject({
      statusCode: 403,
      message: "forbidden",
    });
  });

  it("メールが無いトークンなら 403", async () => {
    verifyIdToken.mockResolvedValue({ uid: "u1" });
    await expect(requireAuth("Bearer sometoken")).rejects.toMatchObject({
      statusCode: 403,
      message: "forbidden",
    });
  });

  it("許可リスト内のメール(大文字小文字・前後空白を無視)なら通す", async () => {
    verifyIdToken.mockResolvedValue({ uid: "u1", email: "OK@Example.com" });
    await expect(requireAuth("Bearer sometoken")).resolves.toEqual({
      uid: "u1",
      email: "ok@example.com",
    });
  });

  it("配列で渡された Authorization ヘッダも先頭要素で判定する", async () => {
    verifyIdToken.mockResolvedValue({ uid: "u2", email: "two@example.com" });
    await expect(
      requireAuth(["Bearer sometoken", "Bearer other"]),
    ).resolves.toEqual({ uid: "u2", email: "two@example.com" });
  });

  it("ALLOWED_EMAILS が未設定なら全員 403", async () => {
    delete process.env.ALLOWED_EMAILS;
    verifyIdToken.mockResolvedValue({ uid: "u1", email: "ok@example.com" });
    await expect(requireAuth("Bearer sometoken")).rejects.toMatchObject({
      statusCode: 403,
      message: "forbidden",
    });
  });
});
