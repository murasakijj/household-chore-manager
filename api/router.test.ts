import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ApiRequest, ApiResponse } from "./_lib/types.js";

// firebase-admin をモックする(auth.test.ts と同様)。verifyIdToken はトークン文字列から
// 決定的にuid/emailを作る(結合テストで複数ユーザー=複数家庭を再現するため)。
const verifyIdToken = vi.fn();

vi.mock("firebase-admin/app", () => ({
  getApps: () => [{}],
  initializeApp: vi.fn(),
  cert: vi.fn(),
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken }),
}));

const { createRouter } = await import("./router.js");
const { MemoryRepo } = await import("./_lib/repo/memoryRepo.js");

function tokenFor(user: "u1" | "u2"): string {
  return `token-${user}`;
}

function emailFor(user: "u1" | "u2"): string {
  return user === "u1" ? "u1@example.com" : "u2@example.com";
}

interface CapturedResponse {
  status: number;
  body: unknown;
}

function createResponse(): {
  res: ApiResponse;
  result: Promise<CapturedResponse>;
} {
  let resolve!: (v: CapturedResponse) => void;
  const result = new Promise<CapturedResponse>((r) => (resolve = r));
  let statusCode = 200;
  let ended = false;
  const raw = {
    headersSent: false,
    get writableEnded() {
      return ended;
    },
    setHeader: () => undefined,
    get statusCode() {
      return statusCode;
    },
    set statusCode(v: number) {
      statusCode = v;
    },
    end: (chunk?: string) => {
      ended = true;
      const body = chunk ? JSON.parse(chunk) : undefined;
      resolve({ status: statusCode, body });
    },
  };
  const res = raw as unknown as ApiResponse;
  return { res, result };
}

function createRequest(
  method: string,
  path: string,
  opts: {
    user?: "u1" | "u2";
    body?: unknown;
    query?: Record<string, string>;
  } = {},
): ApiRequest {
  const query = opts.query
    ? "&" + new URLSearchParams(opts.query).toString()
    : "";
  const url = `/api/router?__path=${encodeURIComponent(path)}${query}`;
  const headers: Record<string, string> = {};
  if (opts.user) headers.authorization = `Bearer ${tokenFor(opts.user)}`;
  return {
    method,
    url,
    headers,
    // readJsonBody は req.body が未設定だと生ストリームとして読もうとするため、
    // このテストダブルには常にオブジェクト(既定は空)を積んでおく。
    body: opts.body === undefined ? {} : opts.body,
  } as unknown as ApiRequest;
}

let repo: InstanceType<typeof MemoryRepo>;
let handler: ReturnType<typeof createRouter>;

async function call(
  method: string,
  path: string,
  opts?: { user?: "u1" | "u2"; body?: unknown; query?: Record<string, string> },
): Promise<CapturedResponse> {
  const req = createRequest(method, path, opts);
  const { res, result } = createResponse();
  await handler(req, res);
  return result;
}

beforeEach(() => {
  verifyIdToken.mockReset();
  verifyIdToken.mockImplementation((token: string) => {
    if (token === tokenFor("u1"))
      return Promise.resolve({ uid: "uid-u1", email: emailFor("u1") });
    if (token === tokenFor("u2"))
      return Promise.resolve({ uid: "uid-u2", email: emailFor("u2") });
    return Promise.reject(new Error("unknown token"));
  });
  process.env.ALLOWED_EMAILS = `${emailFor("u1")}, ${emailFor("u2")}`;
  repo = new MemoryRepo();
  handler = createRouter(() => repo);
});

describe("結合テスト(設計書 §16.2, インメモリリポジトリ + サービス層 + ルーター)", () => {
  it("家事登録後、ホームへ正しい状態で表示される", async () => {
    const created = await call("POST", "chores", {
      user: "u1",
      body: { name: "掃除機をかける", intervalDays: 3 },
    });
    expect(created.status).toBe(201);
    const body = created.body as { chore: { id: string } };

    const today = await call("GET", "chores/today", { user: "u1" });
    expect(today.status).toBe(200);
    const sections = (
      today.body as { sections: { neverDone: Array<{ id: string }> } }
    ).sections;
    expect(sections.neverDone.map((c) => c.id)).toContain(body.chore.id);
  });

  it("実施記録後、状態が not_due へ戻る", async () => {
    const created = await call("POST", "chores", {
      user: "u1",
      body: { name: "換気扇掃除", intervalDays: 7 },
    });
    const choreId = (created.body as { chore: { id: string } }).chore.id;

    const recorded = await call("POST", `chores/${choreId}/events`, {
      user: "u1",
      body: { clientRequestId: "2f6a5d7f-d4c0-49f1-b0d6-79af58f67094" },
    });
    expect(recorded.status).toBe(201);

    const detail = await call("GET", `chores/${choreId}`, { user: "u1" });
    expect((detail.body as { status: string }).status).toBe("not_due");
  });

  it("過去記録追加時に最新日時が正しく選ばれる", async () => {
    const created = await call("POST", "chores", {
      user: "u1",
      body: { name: "シーツ交換", intervalDays: 14 },
    });
    const choreId = (created.body as { chore: { id: string } }).chore.id;

    const newer = "2026-01-10T00:00:00Z";
    const older = "2026-01-01T00:00:00Z";

    await call("POST", `chores/${choreId}/events`, {
      user: "u1",
      body: {
        clientRequestId: "4758470c-79bb-4c26-8e34-c4f0447516a3",
        occurredAt: newer,
      },
    });
    await call("POST", `chores/${choreId}/events`, {
      user: "u1",
      body: {
        clientRequestId: "ee58214e-2315-45b5-9d2f-9969006c044e",
        occurredAt: older,
      },
    });

    const detail = await call("GET", `chores/${choreId}`, { user: "u1" });
    expect((detail.body as { lastCompletedAt: string }).lastCompletedAt).toBe(
      new Date(newer).toISOString(),
    );
  });

  it("最新履歴取消時に1つ前の履歴が採用される", async () => {
    const created = await call("POST", "chores", {
      user: "u1",
      body: { name: "冷蔵庫整理", intervalDays: 30 },
    });
    const choreId = (created.body as { chore: { id: string } }).chore.id;

    const older = "2026-01-01T00:00:00Z";
    const newer = "2026-01-10T00:00:00Z";

    await call("POST", `chores/${choreId}/events`, {
      user: "u1",
      body: {
        clientRequestId: "39a59428-5a23-46cb-9a72-6b360e55bdc0",
        occurredAt: older,
      },
    });
    const newerResult = await call("POST", `chores/${choreId}/events`, {
      user: "u1",
      body: {
        clientRequestId: "6acf299d-0586-4398-917f-90f39a110e64",
        occurredAt: newer,
      },
    });
    const newerEventId = (newerResult.body as { event: { id: string } }).event
      .id;

    const voided = await call("POST", `chore-events/${newerEventId}/void`, {
      user: "u1",
    });
    expect(voided.status).toBe(200);

    const detail = await call("GET", `chores/${choreId}`, { user: "u1" });
    expect((detail.body as { lastCompletedAt: string }).lastCompletedAt).toBe(
      new Date(older).toISOString(),
    );
  });

  it("無効家事が通知対象(ホーム表示)にならない", async () => {
    const created = await call("POST", "chores", {
      user: "u1",
      body: { name: "廃止予定の家事", intervalDays: 5 },
    });
    const choreId = (created.body as { chore: { id: string } }).chore.id;

    await call("PATCH", `chores/${choreId}`, {
      user: "u1",
      body: { isActive: false },
    });

    const today = await call("GET", "chores/today", { user: "u1" });
    const sections = (
      today.body as {
        sections: { neverDone: Array<{ id: string }> };
      }
    ).sections;
    expect(sections.neverDone.map((c) => c.id)).not.toContain(choreId);

    const list = await call("GET", "chores", {
      user: "u1",
      query: { includeInactive: "true" },
    });
    const item = (
      list.body as { items: Array<{ id: string; status: string }> }
    ).items.find((c) => c.id === choreId);
    expect(item?.status).toBe("inactive");
  });

  it("他家庭の家事・履歴へアクセスできない", async () => {
    const createdByU1 = await call("POST", "chores", {
      user: "u1",
      body: { name: "u1の家事", intervalDays: 5 },
    });
    const choreId = (createdByU1.body as { chore: { id: string } }).chore.id;

    // u2 は別家庭(初回アクセスで自動作成される)。u1の家事にはアクセスできない。
    const getByOther = await call("GET", `chores/${choreId}`, { user: "u2" });
    expect(getByOther.status).toBe(404);

    const eventByOther = await call("POST", `chores/${choreId}/events`, {
      user: "u2",
      body: { clientRequestId: "aefa909e-2ec4-4d30-aab8-5196032f69e0" },
    });
    expect(eventByOther.status).toBe(404);

    // u2 の一覧には u1 の家事が出ない。
    const listByOther = await call("GET", "chores", { user: "u2" });
    const items = (listByOther.body as { items: Array<{ id: string }> }).items;
    expect(items.map((c) => c.id)).not.toContain(choreId);
  });

  it("同一APIの再送で意図しない重複が発生しない(冪等)", async () => {
    const created = await call("POST", "chores", {
      user: "u1",
      body: { name: "重複防止テスト", intervalDays: 5 },
    });
    const choreId = (created.body as { chore: { id: string } }).chore.id;
    const clientRequestId = "59279ef4-ed2c-45c7-b446-e1da1c5a598a";

    const first = await call("POST", `chores/${choreId}/events`, {
      user: "u1",
      body: { clientRequestId },
    });
    expect(first.status).toBe(201);
    const firstEventId = (first.body as { event: { id: string } }).event.id;

    const second = await call("POST", `chores/${choreId}/events`, {
      user: "u1",
      body: { clientRequestId },
    });
    expect(second.status).toBe(200);
    expect(
      (second.body as { idempotentReplay: boolean }).idempotentReplay,
    ).toBe(true);
    expect((second.body as { event: { id: string } }).event.id).toBe(
      firstEventId,
    );

    const history = await call("GET", `chores/${choreId}/events`, {
      user: "u1",
    });
    expect((history.body as { items: unknown[] }).items).toHaveLength(1);
  });

  it("10分以内の再記録は possibleDuplicate として警告される", async () => {
    const created = await call("POST", "chores", {
      user: "u1",
      body: { name: "重複警告テスト", intervalDays: 5 },
    });
    const choreId = (created.body as { chore: { id: string } }).chore.id;

    await call("POST", `chores/${choreId}/events`, {
      user: "u1",
      body: { clientRequestId: "0550240d-fd42-45fd-b32b-75262b61ab93" },
    });
    const second = await call("POST", `chores/${choreId}/events`, {
      user: "u1",
      body: { clientRequestId: "c76ec297-c596-4925-b31a-b3051e8932d6" },
    });
    expect(
      (second.body as { possibleDuplicate: boolean }).possibleDuplicate,
    ).toBe(true);
  });

  it("未来日時の実施記録は400", async () => {
    const created = await call("POST", "chores", {
      user: "u1",
      body: { name: "未来日時テスト", intervalDays: 5 },
    });
    const choreId = (created.body as { chore: { id: string } }).chore.id;

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const result = await call("POST", `chores/${choreId}/events`, {
      user: "u1",
      body: {
        clientRequestId: "3e761f57-0340-481a-bc38-eaf42f6e93a1",
        occurredAt: future,
      },
    });
    expect(result.status).toBe(400);
  });

  it("同名家事は保存はされるが duplicate_name 警告が付く", async () => {
    await call("POST", "chores", {
      user: "u1",
      body: { name: "同名家事", intervalDays: 5 },
    });
    const second = await call("POST", "chores", {
      user: "u1",
      body: { name: "同名家事", intervalDays: 5 },
    });
    expect(second.status).toBe(201);
    expect((second.body as { warnings: string[] }).warnings).toContain(
      "duplicate_name",
    );
  });
});
