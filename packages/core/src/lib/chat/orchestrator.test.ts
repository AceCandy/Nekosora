import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMemories: vi.fn(),
  recallMemories: vi.fn(),
  maybeCompact: vi.fn(),
  assembleContext: vi.fn(),
  buildTrace: vi.fn(),
  buildMessagesWithFileContext: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((left, right) => ({ op: "eq", left, right })),
  and: vi.fn((...conditions) => ({ op: "and", conditions })),
  or: vi.fn((...conditions) => ({ op: "or", conditions })),
  inArray: vi.fn((left, values) => ({ op: "inArray", left, values })),
  isNull: vi.fn((value) => ({ op: "isNull", value })),
}));
vi.mock("@/lib/memory/service", () => ({ getMemories: mocks.getMemories }));
vi.mock("@/lib/memory/recall", () => ({ recallMemories: mocks.recallMemories }));
vi.mock("@/lib/compact/service", () => ({ maybeCompact: mocks.maybeCompact }));
vi.mock("@/lib/context-assembler", () => ({ assembleContext: mocks.assembleContext }));
vi.mock("@/lib/trace", () => ({ buildTrace: mocks.buildTrace }));
vi.mock("@/lib/rag/context", () => ({
  buildMessagesWithFileContext: mocks.buildMessagesWithFileContext,
}));

import {
  calculateTokenBudgets,
  prepareChatContext,
  resolveModelGenerationSettings,
  selectCurrentBranchMessages,
} from "@/lib/chat/orchestrator";
import { BEST_EFFORT_TIMEOUT_MS } from "@/lib/best-effort";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getMemories.mockResolvedValue([]);
  mocks.recallMemories.mockResolvedValue([]);
  mocks.maybeCompact.mockResolvedValue(null);
  mocks.assembleContext.mockImplementation(({ messages }) => messages);
  mocks.buildTrace.mockReturnValue({ sources: [] });
  mocks.buildMessagesWithFileContext.mockImplementation(async ({ messages }) => ({
    messages,
    ragStatus: "rag_empty",
    sources: [],
  }));
});

afterEach(() => vi.useRealTimers());

describe("calculateTokenBudgets", () => {
  it("小窗口仍为输入和输出各保留有效预算", () => {
    const result = calculateTokenBudgets(1_024, 16_384);

    expect(result.inputBudget).toBeLessThanOrEqual(1_024);
    expect(result.inputBudget).toBeGreaterThan(0);
    expect(result.maxOutputTokens).toBeGreaterThanOrEqual(1);
    expect(result.inputBudget + result.maxOutputTokens).toBeLessThanOrEqual(1_024);
  });

  it("非法目录预算回退到兼容默认值", () => {
    const result = calculateTokenBudgets(Number.NaN, Number.NaN);

    expect(result).toEqual({
      inputBudget: 15_616,
      maxOutputTokens: 16_384,
    });
  });
});

describe("resolveModelGenerationSettings", () => {
  const schema = {
    models: {
      id: "models.id",
      name: "models.name",
      catalogId: "models.catalogId",
      enabled: "models.enabled",
      visibility: "models.visibility",
      ownerUserId: "models.ownerUserId",
    },
    modelCatalog: {
      id: "catalog.id",
      contextWindow: "catalog.contextWindow",
      maxOutputTokens: "catalog.maxOutputTokens",
      capabilities: "catalog.capabilities",
    },
    routes: {
      id: "routes.id",
      modelId: "routes.modelId",
      providerId: "routes.providerId",
      supportsTools: "routes.supportsTools",
      enabled: "routes.enabled",
    },
    providers: {
      id: "providers.id",
      enabled: "providers.enabled",
    },
  };

  function mockSettingsDb(toolRoutes: unknown[]) {
    const responses = [[{
      modelId: "model-a",
      contextWindow: 32_000,
      maxOutputTokens: 4_000,
      capabilities: { tools: true },
    }], toolRoutes];
    return {
      select: vi.fn(() => {
        const rows = responses.shift() ?? [];
        const query = {
          from: vi.fn(() => query),
          innerJoin: vi.fn(() => query),
          where: vi.fn(() => query),
          limit: vi.fn(() => Promise.resolve(rows)),
        };
        return query;
      }),
    };
  }

  it("模型目录与实际路由都支持时才启用工具", async () => {
    await expect(resolveModelGenerationSettings({
      db: mockSettingsDb([{ id: "route-a" }]),
      schema,
      userId: "user-a",
      model: "model-a",
      modelId: "model-a",
    })).resolves.toMatchObject({ modelSupportsTools: true });

    await expect(resolveModelGenerationSettings({
      db: mockSettingsDb([]),
      schema,
      userId: "user-a",
      model: "model-a",
      modelId: "model-a",
    })).resolves.toMatchObject({ modelSupportsTools: false });
  });
});

describe("selectCurrentBranchMessages", () => {
  it("只返回叶节点所在的 parent 链", () => {
    const messages = [
      { id: "u1", publicId: "pub-u1", parentId: null, content: "root" },
      { id: "a1", publicId: "pub-a1", parentId: "u1", content: "answer" },
      { id: "u2", publicId: "pub-u2", parentId: "a1", content: "branch-a" },
      { id: "u3", publicId: "pub-u3", parentId: "a1", content: "branch-b" },
    ];

    expect(selectCurrentBranchMessages(messages, "pub-u3").map((m) => m.id)).toEqual([
      "u1",
      "a1",
      "u3",
    ]);
  });

  it("叶节点不存在时不回退到整段会话", () => {
    expect(selectCurrentBranchMessages([
      { id: "u1", publicId: "pub-u1", parentId: null },
    ], "missing")).toEqual([]);
  });
});

describe("prepareChatContext 降级日志", () => {
  it("将真正使用的 RAG 文件来源写入现有步骤", async () => {
    const recordStep = vi.fn().mockResolvedValue(undefined);
    mocks.buildMessagesWithFileContext.mockResolvedValueOnce({
      messages: [{ role: "user", content: "hello" }],
      ragStatus: "rag_hit",
      sources: [{ fileId: "file-1", filename: "notes.txt", mime: "text/plain" }],
    });
    const schema = {
      fileObjects: {
        id: "files.id",
        userId: "files.userId",
        filename: "files.filename",
        mime: "files.mime",
        storagePath: "files.storagePath",
      },
      userSettings: { userId: "settings.userId", key: "settings.key" },
      messages: {
        conversationId: "messages.conversationId",
        deletedAt: "messages.deletedAt",
        createdAt: "messages.createdAt",
      },
      models: {
        catalogId: "models.catalogId",
        id: "models.id",
        name: "models.name",
        enabled: "models.enabled",
        visibility: "models.visibility",
        ownerUserId: "models.ownerUserId",
      },
      modelCatalog: {
        id: "catalog.id",
        contextWindow: "catalog.contextWindow",
        maxOutputTokens: "catalog.maxOutputTokens",
        capabilities: "catalog.capabilities",
      },
      routes: {},
      providers: {},
    };
    const rowsByTable = new Map<unknown, unknown[]>([
      [schema.fileObjects, []],
      [schema.userSettings, [{ value: "rag" }]],
      [schema.messages, []],
      [schema.models, [{
        modelId: "model-a",
        contextWindow: 32_000,
        maxOutputTokens: 4_000,
        capabilities: { tools: false },
      }]],
    ]);
    const db = {
      select: vi.fn(() => {
        let rows: unknown[] = [];
        const query = {
          from: vi.fn((table: unknown) => {
            rows = rowsByTable.get(table) ?? [];
            return query;
          }),
          innerJoin: vi.fn(() => query),
          where: vi.fn(() => query),
          orderBy: vi.fn(() => Promise.resolve(rows)),
          limit: vi.fn(() => Promise.resolve(rows)),
          then: (
            resolve: (value: unknown[]) => unknown,
            reject: (reason: unknown) => unknown,
          ) => Promise.resolve(rows).then(resolve, reject),
        };
        return query;
      }),
    };

    const result = await prepareChatContext({
      userId: "user-1",
      conversationId: "conversation-1",
      conv: { outputModeId: null },
      userContent: "hello",
      model: "model-a",
      modelId: "model-a",
      messages: [{ role: "user", content: "hello" }],
      branchLeafPublicId: "message-1",
      fileIds: ["file-1"],
      processRecorder: { recordStep },
      db,
      schema,
    });

    expect("error" in result).toBe(false);
    expect(recordStep).toHaveBeenCalledWith({
      id: "rag",
      kind: "rag",
      status: "completed",
      data: {
        fileCount: 1,
        sources: [{ fileId: "file-1", filename: "notes.txt", mime: "text/plain" }],
      },
    });
  });

  it("压缩失败时不暴露原始错误或 provider URL", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const recordStep = vi.fn().mockResolvedValue(undefined);
    mocks.maybeCompact.mockRejectedValueOnce(
      new Error("POST https://provider.example/v1?api_key=secret failed"),
    );
    const createFrom = () => ({
      where: vi.fn(() => ({
        orderBy: vi.fn().mockResolvedValue([]),
        limit: vi.fn().mockResolvedValue([]),
      })),
      innerJoin: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })),
      })),
    });
    const db = {
      select: vi.fn(() => ({ from: vi.fn(createFrom) })),
    };
    const schema = {
      messages: {
        conversationId: "messages.conversationId",
        deletedAt: "messages.deletedAt",
        createdAt: "messages.createdAt",
      },
      models: {
        catalogId: "models.catalogId",
        id: "models.id",
        name: "models.name",
        enabled: "models.enabled",
        visibility: "models.visibility",
        ownerUserId: "models.ownerUserId",
      },
      modelCatalog: {
        id: "catalog.id",
        contextWindow: "catalog.contextWindow",
        maxOutputTokens: "catalog.maxOutputTokens",
      },
    };

    const result = await prepareChatContext({
      userId: "user-1",
      conversationId: "conversation-1",
      conv: { outputModeId: null },
      userContent: "hello",
      model: "model-a",
      messages: [{ role: "user", content: "hello" }],
      branchLeafPublicId: "message-1",
      processRecorder: { recordStep },
      db,
      schema,
    });

    expect("error" in result).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      "[chat] 压缩失败,跳过:",
      "POST [REDACTED] failed",
    );
    expect(recordStep).toHaveBeenCalledWith({
      id: "memory",
      kind: "memory",
      status: "running",
    });
    expect(recordStep).toHaveBeenCalledWith(expect.objectContaining({
      id: "memory",
      kind: "memory",
      status: "completed",
    }));
    expect(recordStep).toHaveBeenCalledWith(expect.objectContaining({
      id: "compaction",
      kind: "compaction",
      status: "completed",
    }));
    expect(recordStep).toHaveBeenCalledWith(expect.objectContaining({
      id: "prompt",
      kind: "prompt",
      status: "completed",
    }));
  });

  it("每轮聊天都注入上海时区的动态日期时间上下文", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T16:30:00.000Z"));
    const createFrom = () => ({
      where: vi.fn(() => ({
        orderBy: vi.fn().mockResolvedValue([]),
        limit: vi.fn().mockResolvedValue([]),
      })),
      innerJoin: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([{
            modelId: "model-a",
            contextWindow: 32_000,
            maxOutputTokens: 4_000,
            capabilities: { tools: false },
          }]),
        })),
      })),
    });
    const db = {
      select: vi.fn(() => ({ from: vi.fn(createFrom) })),
    };
    const schema = {
      messages: {
        conversationId: "messages.conversationId",
        deletedAt: "messages.deletedAt",
        createdAt: "messages.createdAt",
      },
      models: {
        catalogId: "models.catalogId",
        id: "models.id",
        name: "models.name",
        enabled: "models.enabled",
        visibility: "models.visibility",
        ownerUserId: "models.ownerUserId",
      },
      modelCatalog: {
        id: "catalog.id",
        contextWindow: "catalog.contextWindow",
        maxOutputTokens: "catalog.maxOutputTokens",
        capabilities: "catalog.capabilities",
      },
    };

    const result = await prepareChatContext({
      userId: "user-1",
      conversationId: "conversation-1",
      conv: { outputModeId: null },
      userContent: "今天的 AI 新闻",
      model: "model-a",
      messages: [{ role: "user", content: "今天的 AI 新闻" }],
      branchLeafPublicId: "message-1",
      db,
      schema,
    });

    expect("error" in result).toBe(false);
    expect(mocks.assembleContext).toHaveBeenCalledWith(expect.objectContaining({
      templateSystemPrompt: expect.stringContaining("当前日期：2026-08-04"),
    }));
    expect(mocks.assembleContext).toHaveBeenCalledWith(expect.objectContaining({
      templateSystemPrompt: expect.stringContaining("当前时间：00:30:00"),
    }));
    expect(mocks.assembleContext).toHaveBeenCalledWith(expect.objectContaining({
      templateSystemPrompt: expect.stringContaining("当前时区：Asia/Shanghai"),
    }));
    expect(mocks.assembleContext).toHaveBeenCalledWith(expect.objectContaining({
      templateSystemPrompt: expect.stringContaining("freshness 与 dateAfter/dateBefore 不能同时使用"),
    }));

    vi.setSystemTime(new Date("2026-08-04T16:30:00.000Z"));
    await prepareChatContext({
      userId: "user-1",
      conversationId: "conversation-1",
      conv: { outputModeId: null },
      userContent: "今天的 AI 新闻",
      model: "model-a",
      messages: [{ role: "user", content: "今天的 AI 新闻" }],
      branchLeafPublicId: "message-1",
      db,
      schema,
    });

    expect(mocks.assembleContext).toHaveBeenLastCalledWith(expect.objectContaining({
      templateSystemPrompt: expect.stringContaining("当前日期：2026-08-05"),
    }));
  });

  it("长期记忆超时后跳过并继续准备聊天", async () => {
    vi.useFakeTimers();
    const recordStep = vi.fn().mockResolvedValue(undefined);
    let releaseRecall!: () => void;
    mocks.recallMemories.mockImplementationOnce(() => new Promise((resolve) => {
      releaseRecall = () => resolve([]);
    }));
    const createQuery = () => {
      const query = {
        from: vi.fn(() => query),
        innerJoin: vi.fn(() => query),
        where: vi.fn(() => query),
        orderBy: vi.fn().mockResolvedValue([]),
        limit: vi.fn().mockResolvedValue([]),
      };
      return query;
    };
    const db = { select: vi.fn(createQuery) };
    const schema = {
      messages: {
        conversationId: "messages.conversationId",
        deletedAt: "messages.deletedAt",
        createdAt: "messages.createdAt",
      },
      models: {
        catalogId: "models.catalogId",
        id: "models.id",
        name: "models.name",
        enabled: "models.enabled",
        visibility: "models.visibility",
        ownerUserId: "models.ownerUserId",
      },
      modelCatalog: {
        id: "catalog.id",
        contextWindow: "catalog.contextWindow",
        maxOutputTokens: "catalog.maxOutputTokens",
        capabilities: "catalog.capabilities",
      },
    };

    const resultPromise = prepareChatContext({
      userId: "user-1",
      conversationId: "conversation-1",
      conv: { outputModeId: null },
      userContent: "hello",
      model: "model-a",
      messages: [{ role: "user", content: "hello" }],
      branchLeafPublicId: "message-1",
      processRecorder: { recordStep },
      db,
      schema,
    });

    await vi.advanceTimersByTimeAsync(BEST_EFFORT_TIMEOUT_MS);
    await expect(resultPromise).resolves.toMatchObject({ ragStatus: null });
    expect(mocks.recallMemories).toHaveBeenCalledWith("user-1", "hello");
    expect(mocks.assembleContext).toHaveBeenCalledWith(expect.objectContaining({
      memories: [],
      recalledMemories: [],
    }));
    expect(recordStep).toHaveBeenCalledWith({
      id: "memory",
      kind: "memory",
      status: "skipped",
    });
    expect(recordStep).not.toHaveBeenCalledWith(expect.objectContaining({
      id: "memory",
      status: "completed",
    }));

    releaseRecall();
    await Promise.resolve();
    expect(recordStep).not.toHaveBeenCalledWith(expect.objectContaining({
      id: "memory",
      status: "completed",
    }));
  });
});
