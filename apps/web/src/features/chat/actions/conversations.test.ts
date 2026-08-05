import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDb: vi.fn(),
  getSchema: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  and: vi.fn(),
  or: vi.fn(),
  desc: vi.fn((field: unknown) => ({ op: "desc", field })),
  isNull: vi.fn(),
  asc: vi.fn(),
  getConversationTitleState: vi.fn(),
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
  isNull: mocks.isNull,
  asc: mocks.asc,
  sql: mocks.sql,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/infra/db", () => ({
  getDb: mocks.getDb,
  getSchema: mocks.getSchema,
}));
vi.mock("@/lib/conversation-title/service", () => ({
  getConversationTitleState: mocks.getConversationTitleState,
}));

import {
  getConversationTitleStateAction,
  getGeneratingStatuses,
  listConversations,
  saveConversationComposerState,
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
    conversationId: "runs.conversationId",
    status: "runs.status",
    leaseExpiresAt: "runs.leaseExpiresAt",
  },
};

function queryReturning(rows: Record<string, unknown>[]) {
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    orderBy: vi.fn(() => Promise.resolve(rows)),
    then: (
      resolve: (value: Record<string, unknown>[]) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };
  return query;
}

describe("会话 generating 派生", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ id: "user-1" });
    mocks.getSchema.mockReturnValue(schema);
  });

  it("列表与轮询都从 fresh running runs 派生而不读取 legacy boolean", async () => {
    const projections: Array<Record<string, unknown>> = [];
    const resultSets = [
      [{ id: "conversation-1", generating: true }],
      [{ id: "conversation-1", generating: true }],
    ];
    const db = {
      select: vi.fn((projection: Record<string, unknown>) => {
        projections.push(projection);
        return queryReturning(resultSets.shift() ?? []);
      }),
    };
    mocks.getDb.mockResolvedValue(db);

    await expect(listConversations()).resolves.toEqual([
      { id: "conversation-1", generating: true },
    ]);
    await expect(getGeneratingStatuses()).resolves.toEqual([
      { id: "conversation-1", generating: true },
    ]);

    const [listGenerating, statusGenerating] = projections.map(
      (projection) => projection.generating,
    );
    expect(listGenerating).not.toBe(schema.conversations.generating);
    expect(statusGenerating).toEqual(listGenerating);
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
      kbIds: ["kb-a"],
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
        kbIds: ["kb-a"],
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
      kbIds: [],
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
      kbIds: [],
      reasoningByModelId: {},
    })).rejects.toThrow("无权操作");

    expect(update).toHaveBeenCalledOnce();
  });
});
