import { describe, it, expect, vi, beforeEach } from "vitest";

const generateJson = vi.fn();

vi.mock("../ai/index.js", async () => {
  const actual = await vi.importActual<typeof import("../ai/index.js")>("../ai/index.js");
  return {
    ...actual,
    getAiProvider: () => ({ generateJson }),
  };
});

const { MemoryRepo } = await import("../repo/memoryRepo.js");
const { suggestChore, proposeChoreList, AiServiceError } = await import("./ai.js");
const { AiProviderError } = await import("../ai/index.js");

describe("suggestChore", () => {
  let repo: InstanceType<typeof MemoryRepo>;
  let householdId: string;

  beforeEach(async () => {
    generateJson.mockReset();
    repo = new MemoryRepo();
    const membership = await repo.bootstrapHouseholdForUser({
      uid: "u1",
      email: "u1@example.com",
    });
    householdId = membership.householdId;
  });

  it("存在する場所・カテゴリ名をIDへ解決し、間隔はサーバー側でwarning/graceを算出する", async () => {
    const areas = await repo.listAreas(householdId);
    const categories = await repo.listChoreCategories(householdId);
    generateJson.mockResolvedValue({
      areaName: areas[0].name,
      categoryName: categories[0].name,
      intervalDays: 10,
      description: "  説明文  ",
    });

    const result = await suggestChore(repo, householdId, "掃除機をかける");
    expect(result.areaId).toBe(areas[0].id);
    expect(result.categoryId).toBe(categories[0].id);
    expect(result.intervalDays).toBe(10);
    expect(result.warningDays).toBeGreaterThanOrEqual(1);
    expect(result.graceDays).toBeGreaterThanOrEqual(1);
    expect(result.description).toBe("説明文");
  });

  it("AIへ渡すJSON SchemaはOpenAI strict出力向けに additionalProperties:false を持つ", async () => {
    generateJson.mockResolvedValue({
      areaName: null,
      categoryName: null,
      intervalDays: 7,
      description: null,
    });
    await suggestChore(repo, householdId, "テスト家事");
    const call = generateJson.mock.calls.at(-1)?.[0] as { jsonSchema: Record<string, unknown> };
    expect(call.jsonSchema.additionalProperties).toBe(false);
    expect(call.jsonSchema.required).toEqual(
      expect.arrayContaining(["areaName", "categoryName", "intervalDays", "description"]),
    );
  });

  it("存在しない場所・カテゴリ名はnullに落とす", async () => {
    generateJson.mockResolvedValue({
      areaName: "存在しない場所",
      categoryName: "存在しないカテゴリ",
      intervalDays: 7,
      description: null,
    });

    const result = await suggestChore(repo, householdId, "テスト家事");
    expect(result.areaId).toBeNull();
    expect(result.categoryId).toBeNull();
  });

  it("intervalDaysは1〜365に丸める", async () => {
    generateJson.mockResolvedValue({
      areaName: null,
      categoryName: null,
      intervalDays: 5000,
      description: null,
    });
    const result = await suggestChore(repo, householdId, "テスト家事");
    expect(result.intervalDays).toBe(365);
  });

  it("AI出力がスキーマ不正なら invalid_ai_output", async () => {
    generateJson.mockResolvedValue({ notMatching: true });
    await expect(suggestChore(repo, householdId, "テスト家事")).rejects.toMatchObject({
      code: "invalid_ai_output",
    });
  });

  it("AIプロバイダエラーは AiServiceError へ変換する", async () => {
    generateJson.mockRejectedValue(new AiProviderError(502, "overloaded"));
    await expect(suggestChore(repo, householdId, "テスト家事")).rejects.toBeInstanceOf(
      AiServiceError,
    );
    await expect(suggestChore(repo, householdId, "テスト家事")).rejects.toMatchObject({
      code: "overloaded",
    });
  });
});

describe("proposeChoreList", () => {
  let repo: InstanceType<typeof MemoryRepo>;
  let householdId: string;

  beforeEach(async () => {
    generateJson.mockReset();
    repo = new MemoryRepo();
    const membership = await repo.bootstrapHouseholdForUser({
      uid: "u1",
      email: "u1@example.com",
    });
    householdId = membership.householdId;
  });

  it("既存と同名の項目に alreadyExists:true を付ける", async () => {
    await repo.createChore(householdId, {
      name: "掃除機をかける",
      description: null,
      categoryId: null,
      areaId: null,
      resourceId: null,
      scheduleType: "interval",
      intervalDays: 3,
      warningDays: 1,
      graceDays: 1,
      isActive: true,
      createdBy: "member-1",
    });

    generateJson.mockResolvedValue({
      items: [
        { name: "掃除機をかける", areaName: null, categoryName: null, intervalDays: 3, description: null },
        { name: "新しい家事", areaName: null, categoryName: null, intervalDays: 7, description: null },
      ],
    });

    const items = await proposeChoreList(repo, householdId, "犬がいる家庭");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ name: "掃除機をかける", alreadyExists: true });
    expect(items[1]).toMatchObject({ name: "新しい家事", alreadyExists: false });
  });

  it("重複名・空名を除去し、最大30件に丸める", async () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      name: i % 2 === 0 ? "重複家事" : `家事${i}`,
      areaName: null,
      categoryName: null,
      intervalDays: 7,
      description: null,
    }));
    generateJson.mockResolvedValue({ items });

    const result = await proposeChoreList(repo, householdId, "テスト状況");
    expect(result.length).toBeLessThanOrEqual(30);
    const names = result.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("AIへ渡すJSON Schemaは最上位・items要素objectの両方に additionalProperties:false を持つ", async () => {
    generateJson.mockResolvedValue({ items: [] });
    await proposeChoreList(repo, householdId, "テスト状況");
    const call = generateJson.mock.calls.at(-1)?.[0] as { jsonSchema: Record<string, unknown> };
    expect(call.jsonSchema.additionalProperties).toBe(false);
    const items = call.jsonSchema.properties as {
      items: { items: Record<string, unknown> };
    };
    expect(items.items.items.additionalProperties).toBe(false);
  });
});
