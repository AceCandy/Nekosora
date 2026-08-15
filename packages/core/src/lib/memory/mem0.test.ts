import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: {} as Record<string, string | null>,
  models: [] as Array<{ id: string; name: string; enabled: boolean; visibility: string }>,
  resolveRoutesById: vi.fn(),
  createNekosoraLLM: vi.fn((model: unknown) => ({ model })),
  memoryConfig: null as unknown,
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: string, value: unknown) => ({ column, value }),
  and: (...conditions: Array<{ column: string; value: unknown }>) => conditions,
}));

vi.mock("@/lib/infra/db", () => ({
  getSchema: () => ({
    models: { id: "id", name: "name", enabled: "enabled", visibility: "visibility" },
  }),
  getDb: async () => ({
    select: () => ({
      from: () => ({
        where: (conditions: Array<{ column: string; value: unknown }>) => ({
          limit: async (count: number) => mocks.models
            .filter((row) => conditions.every(({ column, value }) => row[column as keyof typeof row] === value))
            .slice(0, count),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/routing", () => ({ resolveRoutesById: mocks.resolveRoutesById }));
vi.mock("@/lib/system-settings/service", () => ({
  getSetting: async (namespace: string, key: string) => mocks.settings[`${namespace}.${key}`] ?? null,
}));
vi.mock("@/lib/rag/embedding", () => ({
  getEmbeddingConfig: async () => ({ apiKey: "test", baseUrl: "https://example.test", model: "embed" }),
}));
vi.mock("./nekosora-llm", () => ({ createNekosoraLLM: mocks.createNekosoraLLM }));
vi.mock("mem0ai/oss", () => ({
  Memory: class {
    constructor(config: unknown) {
      mocks.memoryConfig = config;
    }
  },
}));

import { getMemory, resetMemoryClient } from "./mem0";

describe("mem0 model resolution", () => {
  beforeEach(() => {
    resetMemoryClient();
    mocks.settings = {
      "rag.mem0_llm_model": "legacy-model",
      "task.title_model_id": "title-id",
    };
    mocks.models = [{ id: "legacy-id", name: "legacy-model", enabled: true, visibility: "public" }];
    mocks.resolveRoutesById.mockReset().mockImplementation(async (_ctx, id: string) => {
      if (id === "legacy-id") throw new Error("no route");
      return [{ modelName: "title-model" }];
    });
    mocks.createNekosoraLLM.mockClear();
    mocks.memoryConfig = null;
  });

  it("旧模型名无可用路由时继续回退到标题模型", async () => {
    await getMemory({ refreshModel: true });

    expect(mocks.memoryConfig).toMatchObject({
      disableHistory: true,
      vectorStore: { config: { embeddingModelDims: 1024 } },
      customInstructions: expect.stringContaining("仅提取用户明确表达"),
    });
    expect(
      (mocks.memoryConfig as { customInstructions: string }).customInstructions,
    ).toContain("不得把助手消息");
    expect(
      (mocks.memoryConfig as { embedder: { config: object } }).embedder.config,
    ).not.toHaveProperty("embeddingDims");
    expect(mocks.resolveRoutesById).toHaveBeenCalledTimes(2);
    expect(mocks.createNekosoraLLM).toHaveBeenCalledWith({
      modelId: "title-id",
      modelName: "title-model",
    });
  });
});
