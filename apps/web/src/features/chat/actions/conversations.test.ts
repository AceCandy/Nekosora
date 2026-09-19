import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDb: vi.fn(),
  getSchema: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  or: vi.fn((...conditions: unknown[]) => ({ op: "or", conditions })),
  desc: vi.fn((field: unknown) => ({ op: "desc", field })),
  gt: vi.fn((left: unknown, right: unknown) => ({ op: "gt", left, right })),
  lt: vi.fn((left: unknown, right: unknown) => ({ op: "lt", left, right })),
  isNull: vi.fn(),
  isNotNull: vi.fn(),
  asc: vi.fn((field: unknown) => ({ op: "asc", field })),
  getConversationTitleState: vi.fn(),
  revalidatePath: vi.fn(),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    op: "sql",
    text: strings.join("?"),
    values,
  })),
}));

vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
  and: mocks.and,
  or: mocks.or,
  desc: mocks.desc,
  gt: mocks.gt,
  lt: mocks.lt,
  isNull: mocks.isNull,
  isNotNull: mocks.isNotNull,
  asc: mocks.asc,
  sql: mocks.sql,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@nekusora/core/infra/db", () => ({
  getDb: mocks.getDb,
  getSchema: mocks.getSchema,
}));
vi.mock("@nekusora/core/conversation-title/service", () => ({
  getConversationTitleState: mocks.getConversationTitleState,
}));

import {
  createConversation,
  getImageModels,
  getVisibleModels,
  getConversationComposerState,
  getConversationNavigationItem,
  getConversationGroupSummary,
  getConversationTitleStateAction,
  getGeneratingStatuses,
  listConversations,
  listConversationGroup,
  saveConversationComposerState,
  waitForChatRunCompletion,
} from "./conversations";

const schema = {
  conversations: {
    id: "conversations.id",
    title: "conversations.title",
    pinned: "conversations.pinned",
    archived: "conversations.archived",
    generating: "conversations.generating",
    updatedAt: "conversations.updatedAt",
    userId: "conversations.userId",
    modelName: "conversations.modelName",
    outputModeId: "conversations.outputModeId",
    renderStyleId: "conversations.renderStyleId",
    webSearch: "conversations.webSearch",
    composerState: "conversations.composerState",
  },
  runs: {
    runId: "runs.runId",
    userId: "runs.userId",
    conversationId: "runs.conversationId",
    status: "runs.status",
    leaseExpiresAt: "runs.leaseExpiresAt",
  },
  messages: {
    runId: "messages.runId",
    conversationId: "messages.conversationId",
    publicId: "messages.publicId",
    role: "messages.role",
    deletedAt: "messages.deletedAt",
  },
};

function queryReturning(rows: Record<string, unknown>[]) {
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    innerJoin: vi.fn(() => query),
    leftJoin: vi.fn(() => query),
    groupBy: vi.fn(() => Promise.resolve(rows)),
    orderBy: vi.fn(() => query),
    limit: vi.fn(() => Promise.resolve(rows)),
    then: (
      resolve: (value: Record<string, unknown>[]) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };
  return query;
}

describe("停止后确认 run 与回复提交", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.requireSession.mockResolvedValue({ id: "user-1" });
    mocks.getSchema.mockReturnValue(schema);
  });
  afterEach(() => { vi.useRealTimers(); });

  it("只等待当前用户、当前会话的 run，且回复已提交才返回 ID", async () => {
    const query = queryReturning([]);
    query.limit.mockResolvedValueOnce([{ status: "running", publicId: null }])
      .mockResolvedValueOnce([{ status: "interrupted", publicId: "assistant-saved" }]);
    mocks.getDb.mockResolvedValue({ select: () => query });
    const result = waitForChatRunCompletion("conversation-1", "run-1");
    await vi.advanceTimersByTimeAsync(0);
    expect(query.limit).toHaveBeenCalledTimes(1);
    expect(query.where).toHaveBeenCalledWith({ op: "and", conditions: [
      { op: "eq", left: "runs.runId", right: "run-1" },
      { op: "eq", left: "runs.conversationId", right: "conversation-1" },
      { op: "eq", left: "runs.userId", right: "user-1" },
    ] });
    expect(query.innerJoin).toHaveBeenCalledWith(schema.conversations, { op: "and", conditions: [
      { op: "eq", left: "conversations.id", right: "runs.conversationId" },
      { op: "eq", left: "conversations.userId", right: "user-1" },
    ] });
    expect(query.leftJoin).toHaveBeenCalledWith(schema.messages, { op: "and", conditions: [
      { op: "eq", left: "messages.runId", right: "runs.runId" },
      { op: "eq", left: "messages.conversationId", right: "runs.conversationId" },
      { op: "eq", left: "messages.role", right: "assistant" },
      mocks.isNull.mock.results[0].value,
    ] });
    expect(mocks.isNull).toHaveBeenCalledWith("messages.deletedAt");
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBe("assistant-saved");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { rows: [] },
    { rows: [{ status: "failed", publicId: null }] },
  ])("缺失、无权或未提交回复时不能放行", async ({ rows }) => {
    mocks.getDb.mockResolvedValue({ select: () => queryReturning(rows) });
    await expect(waitForChatRunCompletion("conversation-1", "run-1"))
      .rejects.toThrow("上一轮回复尚未保存");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["running", "query-hung"])("%s 在五秒预算后结束等待", async (kind) => {
    const query = queryReturning([{ status: "running", publicId: null }]);
    const hung = Promise.withResolvers<Record<string, unknown>[]>();
    if (kind === "query-hung") query.limit.mockReturnValue(hung.promise);
    mocks.getDb.mockResolvedValue({ select: () => query });
    const result = expect(waitForChatRunCompletion("conversation-1", "run-1"))
      .rejects.toThrow("上一轮回复尚未保存");
    await vi.advanceTimersByTimeAsync(5_000);
    await result;
    hung.resolve([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(vi.getTimerCount()).toBe(0);
  });
});

it("建会返回真实 ID，不通过整页重验打断当前 Composer", async () => {
  vi.clearAllMocks();
  mocks.requireSession.mockResolvedValue({ id: "user-1" });
  mocks.getSchema.mockReturnValue(schema);
  const values = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: "created" }]) });
  mocks.getDb.mockResolvedValue({ insert: vi.fn().mockReturnValue({ values }) });
  expect(await createConversation("test-model")).toBe("created");
  expect(values).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", modelName: "test-model" }));
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
});

describe("会话输入区读取边界", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ id: "user-1" });
    mocks.getSchema.mockReturnValue(schema);
  });
  it.each([{ rows: [] }, { rows: [{ userId: "another-user", title: "private" }] }])("缺失或非属主不能伪装成新会话", async ({ rows }) => {
    mocks.getDb.mockResolvedValue({ select: () => queryReturning(rows) });
    await expect(getConversationComposerState("conversation")).rejects.toThrow("会话不存在或无权访问");
  });
  it("属主的空设置仍按原缺省值回填", async () => {
    mocks.getDb.mockResolvedValue({ select: () => queryReturning([{ userId: "user-1", title: "真实会话", composerState: null }]) });
    expect(await getConversationComposerState("conversation")).toEqual({
      title: "真实会话", modelName: null, outputModeId: null, renderStyleId: null,
      webSearch: false, cardIds: [], reasoningByModelId: {},
    });
  });
});

describe("会话 generating 派生", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ id: "user-1" });
    mocks.getSchema.mockReturnValue(schema);
  });

  it("列表与轮询都从 fresh running runs 派生而不读取 legacy boolean", async () => {
    const projections: Array<Record<string, unknown>> = [];
    const resultSets = [
      [{
        id: "conversation-1",
        title: "会话一",
        pinned: false,
        archived: false,
        generating: true,
        updatedAt: new Date("2026-08-13T01:00:00.000Z"),
        sortUpdatedAt: "2026-08-13T01:00:00.000000Z",
        rank: 1,
      }],
      [{ id: "conversation-1" }],
    ];
    const db = {
      select: vi.fn((projection: Record<string, unknown>) => {
        projections.push(projection);
        return queryReturning(resultSets.shift() ?? []);
      }),
    };
    mocks.getDb.mockResolvedValue(db);

    await expect(listConversations()).resolves.toEqual({
      items: [{
        id: "conversation-1",
        title: "会话一",
        pinned: false,
        archived: false,
        generating: true,
        updatedAt: Date.parse("2026-08-13T01:00:00.000Z"),
        sortUpdatedAt: "2026-08-13T01:00:00.000000Z",
        rank: 1,
      }],
      nextCursor: null,
    });
    await expect(getGeneratingStatuses()).resolves.toEqual([
      { id: "conversation-1", generating: true },
    ]);

    const listGenerating = projections[0].generating;
    expect(listGenerating).not.toBe(schema.conversations.generating);
    expect(listGenerating).toEqual(expect.objectContaining({
      op: "sql",
      text: expect.stringMatching(/exists[\s\S]*running[\s\S]*now\(\)/),
      values: expect.arrayContaining([
        schema.runs.conversationId,
        schema.conversations.id,
        schema.runs.status,
        schema.runs.leaseExpiresAt,
      ]),
    }));
    expect(projections[1]).toEqual({ id: schema.runs.conversationId });
  });

  it("固定取 31 行并用完整最后一行生成下一页游标", async () => {
    const rows = Array.from({ length: 31 }, (_, index) => ({
      id: `conversation-${String(31 - index).padStart(2, "0")}`,
      title: `会话 ${index}`,
      pinned: false,
      archived: false,
      generating: false,
      updatedAt: new Date(`2026-08-13T00:${String(59 - index).padStart(2, "0")}:00.000Z`),
      sortUpdatedAt: `2026-08-13T00:${String(59 - index).padStart(2, "0")}:00.000000Z`,
      rank: 1,
    }));
    const query = queryReturning(rows);
    mocks.getDb.mockResolvedValue({ select: vi.fn(() => query) });

    const first = await listConversations();
    expect(first.items).toHaveLength(30);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(query.limit).toHaveBeenCalledWith(31);
    expect(query.orderBy).toHaveBeenCalledWith(
      expect.objectContaining({ op: "asc" }),
      expect.objectContaining({ op: "desc", field: schema.conversations.updatedAt }),
      expect.objectContaining({ op: "desc", field: schema.conversations.id }),
    );

    const nextQuery = queryReturning([]);
    mocks.getDb.mockResolvedValue({ select: vi.fn(() => nextQuery) });
    await listConversations(first.nextCursor);
    const rankExpression = expect.objectContaining({ op: "sql" });
    expect(mocks.gt).toHaveBeenCalledWith(rankExpression, 1);
    expect(mocks.eq).toHaveBeenCalledWith(rankExpression, 1);
    expect(mocks.lt).toHaveBeenCalledWith(schema.conversations.updatedAt, expect.objectContaining({
      op: "sql",
      values: [rows[29].sortUpdatedAt],
    }));
    expect(mocks.eq).toHaveBeenCalledWith(schema.conversations.updatedAt, expect.objectContaining({
      op: "sql",
      values: [rows[29].sortUpdatedAt],
    }));
    expect(mocks.lt).toHaveBeenCalledWith(schema.conversations.id, rows[29].id);
    expect(mocks.eq).toHaveBeenCalledWith(schema.conversations.userId, "user-1");
    expect(nextQuery.where).toHaveBeenCalledWith({
      op: "and",
      conditions: [
        { op: "eq", left: schema.conversations.userId, right: "user-1" },
        {
          op: "or",
          conditions: [
            expect.objectContaining({ op: "gt" }),
            expect.objectContaining({ op: "and" }),
            expect.objectContaining({ op: "and" }),
          ],
        },
      ],
    });
  });

  it("拒绝无法解析的分页游标", async () => {
    mocks.getDb.mockResolvedValue({ select: vi.fn() });
    await expect(listConversations("not-a-cursor")).rejects.toThrow("会话分页游标无效");
    const invalidDate = Buffer.from(JSON.stringify({
      rank: 1,
      updatedAt: "2026-99-99T00:00:00.000000Z",
      id: "conversation-1",
    })).toString("base64url");
    await expect(listConversations(invalidDate)).rejects.toThrow("会话分页游标无效");
  });

  it("深链补入同时按会话 id 与当前属主隔离", async () => {
    const row = {
      id: "conversation-1",
      title: "会话一",
      pinned: false,
      archived: false,
      generating: false,
      updatedAt: new Date("2026-08-13T01:00:00.000Z"),
      sortUpdatedAt: "2026-08-13T01:00:00.000001Z",
      rank: 1,
    };
    mocks.getDb.mockResolvedValue({ select: vi.fn(() => queryReturning([row])) });

    await expect(getConversationNavigationItem("conversation-1")).resolves.toEqual({
      ...row,
      updatedAt: row.updatedAt.getTime(),
    });
    expect(mocks.eq).toHaveBeenCalledWith(schema.conversations.id, "conversation-1");
    expect(mocks.eq).toHaveBeenCalledWith(schema.conversations.userId, "user-1");
  });

  it("按单个分组固定取 21 行并按用户隔离", async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      id: `conversation-${index}`,
      title: `会话 ${index}`,
      pinned: false,
      archived: false,
      generating: false,
      updatedAt: new Date(`2026-08-14T00:${String(40 - index).padStart(2, "0")}:00.000Z`),
      sortUpdatedAt: `2026-08-14T00:${String(40 - index).padStart(2, "0")}:00.000000Z`,
      rank: 1,
    }));
    const query = queryReturning(rows);
    mocks.getDb.mockResolvedValue({ select: vi.fn(() => query) });
    const boundaries = {
      todayStart: "2026-08-14T00:00:00.000Z",
      yesterdayStart: "2026-08-13T00:00:00.000Z",
      dayBeforeYesterdayStart: "2026-08-12T00:00:00.000Z",
      sevenDaysAgoStart: "2026-08-07T00:00:00.000Z",
      thirtyDaysAgoStart: "2026-07-15T00:00:00.000Z",
    };

    const page = await listConversationGroup("today", boundaries);
    expect(page.items).toHaveLength(20);
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(query.limit).toHaveBeenCalledWith(21);
    expect(mocks.eq).toHaveBeenCalledWith(schema.conversations.userId, "user-1");
  });

  it("摘要返回所有分组真实总数并拒绝乱序边界", async () => {
    const query = queryReturning([{ pinned: "2", today: 3, yesterday: 0 }]);
    mocks.getDb.mockResolvedValue({ select: vi.fn(() => query) });
    const boundaries = {
      todayStart: "2026-08-14T00:00:00.000Z",
      yesterdayStart: "2026-08-13T00:00:00.000Z",
      dayBeforeYesterdayStart: "2026-08-12T00:00:00.000Z",
      sevenDaysAgoStart: "2026-08-07T00:00:00.000Z",
      thirtyDaysAgoStart: "2026-07-15T00:00:00.000Z",
    };
    const summary = await getConversationGroupSummary(boundaries);
    expect(summary).toHaveLength(8);
    expect(summary.find(({ key }) => key === "pinned")?.total).toBe(2);
    expect(summary.find(({ key }) => key === "today")?.total).toBe(3);
    await expect(getConversationGroupSummary({ ...boundaries, yesterdayStart: boundaries.todayStart })).rejects.toThrow();
  });
});

describe("会话标题状态 action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ id: "user-1" });
    mocks.getConversationTitleState.mockResolvedValue({ title: "最终标题", pending: false });
  });

  it("使用当前会话用户查询标题状态", async () => {
    await expect(getConversationTitleStateAction("conversation-1")).resolves.toEqual({
      title: "最终标题",
      pending: false,
    });

    expect(mocks.requireSession).toHaveBeenCalledOnce();
    expect(mocks.getConversationTitleState).toHaveBeenCalledWith("user-1", "conversation-1");
  });
});

function composerActionDb(updatedRows: Record<string, unknown>[]) {
  const select = vi.fn();
  const returning = vi.fn().mockResolvedValue(updatedRows);
  const updateWhere = vi.fn(() => ({ returning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  return { db: { select, update }, select, update, updateSet, updateWhere, returning };
}

describe("Composer 完整快照 action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ id: "user-1" });
    mocks.getSchema.mockReturnValue(schema);
  });

  it("校验属主后用一次 UPDATE 原子替换完整快照且不预读 JSON", async () => {
    const { db, select, update, updateSet } = composerActionDb([{ id: "conversation-1" }]);
    mocks.getDb.mockResolvedValue(db);

    await saveConversationComposerState("conversation-1", {
      modelName: "provider/model-a",
      outputModeId: null,
      renderStyleId: "style-a",
      webSearch: true,
      cardIds: ["card-a"],
      reasoningByModelId: { "model-a": "high", "model-b": "off" },
    });

    expect(select).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledOnce();
    expect(updateSet).toHaveBeenCalledWith({
      modelName: "provider/model-a",
      outputModeId: null,
      renderStyleId: "style-a",
      webSearch: true,
      composerState: {
        cardIds: ["card-a"],
        reasoningByModelId: { "model-a": "high", "model-b": "off" },
      },
    });
  });

  it("拒绝非法快照且不查询数据库", async () => {
    await expect(saveConversationComposerState("conversation-1", {
      modelName: "",
      outputModeId: null,
      renderStyleId: null,
      webSearch: false,
      cardIds: [],
      reasoningByModelId: { "model-a": "invalid" },
    } as never)).rejects.toThrow("会话输入区状态无效");

    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("非属主不能写入", async () => {
    const { db, update } = composerActionDb([]);
    mocks.getDb.mockResolvedValue(db);

    await expect(saveConversationComposerState("conversation-1", {
      modelName: "provider/model-a",
      outputModeId: null,
      renderStyleId: null,
      webSearch: false,
      cardIds: [],
      reasoningByModelId: {},
    })).rejects.toThrow("无权操作");

    expect(update).toHaveBeenCalledOnce();
  });
});

describe("双能力模型入口", () => {
  it.each([true, false])("图像生成标记为 %s 时聊天入口始终保留，绘图入口按能力筛选", async (imageGeneration) => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ id: "user-1" });
    mocks.getSchema.mockReturnValue({
      models: { id: "id", catalogId: "catalogId", visibility: "visibility", ownerUserId: "ownerUserId", enabled: "enabled" },
      modelCatalog: { id: "catalogId", capabilities: "capabilities" },
      routes: { modelId: "modelId", enabled: "enabled" },
    });
    const model = { id: "dual", name: "dual", visibility: "private", modelType: "chat" };
    const query = queryReturning([{ model, capabilities: { imageGeneration, vision: true } }]);
    const cte = { modelId: "modelId" };
    const db = {
      $with: () => ({ as: () => cte }),
      select: () => query,
      with: () => ({ select: () => query }),
    };
    mocks.getDb.mockResolvedValue(db);

    expect(await getVisibleModels()).toEqual([{ ...model, capabilities: { imageGeneration, vision: true } }]);
    const images = await getImageModels();
    expect(images).toEqual(imageGeneration ? [{ ...model, capabilities: { imageGeneration, vision: true } }] : []);
    expect(query.where).toHaveBeenCalledWith({ op: "and", conditions: [
      { op: "or", conditions: [
        { op: "eq", left: "visibility", right: "public" },
        { op: "eq", left: "ownerUserId", right: "user-1" },
      ] },
      { op: "eq", left: "enabled", right: true },
    ] });
  });
});
