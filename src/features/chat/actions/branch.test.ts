import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDb: vi.fn(),
  getSchema: vi.fn(),
  findConversationMessage: vi.fn(),
  withConversationMessageWrite: vi.fn(),
  assertVisionModel: vi.fn(),
  loadMessageAttachmentsByMessageIds: vi.fn(),
  replaceMessageAttachments: vi.fn(),
  resolveChatImageAttachments: vi.fn(),
  toChatMessageAttachments: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  isNull: vi.fn((field: unknown) => ({ op: "isNull", field })),
  inArray: vi.fn((field: unknown, values: unknown) => ({ op: "inArray", field, values })),
}));

vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
  and: mocks.and,
  isNull: mocks.isNull,
  inArray: mocks.inArray,
}));
vi.mock("@/lib/session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/infra/db", () => ({ getDb: mocks.getDb, getSchema: mocks.getSchema }));
vi.mock("@/lib/chat/message-reference", () => ({
  findConversationMessage: mocks.findConversationMessage,
  withConversationMessageWrite: mocks.withConversationMessageWrite,
}));
vi.mock("@/lib/chat/message-attachments", () => ({
  assertVisionModel: mocks.assertVisionModel,
  loadMessageAttachmentsByMessageIds: mocks.loadMessageAttachmentsByMessageIds,
  replaceMessageAttachments: mocks.replaceMessageAttachments,
  resolveChatImageAttachments: mocks.resolveChatImageAttachments,
  toChatMessageAttachments: mocks.toChatMessageAttachments,
}));

import {
  continueMessage,
  editMessage,
  getMessageSiblings,
  getVisibleBranch,
  retryFromMessage,
  softDeleteMessage,
} from "./branch";

const schema = {
  conversations: { id: "conversations.id", userId: "conversations.userId" },
  messages: {
    id: "messages.id",
    publicId: "messages.publicId",
    conversationId: "messages.conversationId",
    parentId: "messages.parentId",
    role: "messages.role",
    createdAt: "messages.createdAt",
    deletedAt: "messages.deletedAt",
    runId: "messages.runId",
  },
  runs: {
    runId: "runs.runId",
    conversationId: "runs.conversationId",
    platformModelName: "runs.platformModelName",
    tokenUsage: "runs.tokenUsage",
    durationMs: "runs.durationMs",
    completedAt: "runs.completedAt",
  },
  toolCalls: {
    runId: "toolCalls.runId",
    toolCallId: "toolCalls.toolCallId",
    toolName: "toolCalls.toolName",
    status: "toolCalls.status",
    inputJson: "toolCalls.inputJson",
    createdAt: "toolCalls.createdAt",
  },
  messageFeedback: {
    messageId: "messageFeedback.messageId",
    rating: "messageFeedback.rating",
    reason: "messageFeedback.reason",
    userId: "messageFeedback.userId",
    conversationId: "messageFeedback.conversationId",
  },
};

function queryReturning(rows: Record<string, unknown>[]) {
  const query = {
    where: vi.fn(() => query),
    limit: vi.fn(() => Promise.resolve(rows.slice(0, 1))),
    orderBy: vi.fn(() => Promise.resolve(rows)),
    innerJoin: vi.fn(() => query),
    // drizzle 查询在 where 后可直接 await(thenable);feedback 批量加载不带 orderBy
    then: (
      resolve: (value: Record<string, unknown>[]) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };
  return query;
}

/** 按调用次序返回不同结果集;支持 where/limit/orderBy/innerJoin 链式。 */
function selectQueue(responses: Record<string, unknown>[][]) {
  const queue = [...responses];
  return vi.fn(() => {
    const rows = queue.shift() ?? [];
    return { from: vi.fn(() => queryReturning(rows)) };
  });
}

beforeEach(() => {
  mocks.assertVisionModel.mockResolvedValue(undefined);
  mocks.loadMessageAttachmentsByMessageIds.mockResolvedValue(new Map());
  mocks.replaceMessageAttachments.mockResolvedValue(undefined);
  mocks.resolveChatImageAttachments.mockResolvedValue([]);
  mocks.toChatMessageAttachments.mockImplementation((attachments) =>
    attachments.map(({ fileId, filename, mime }: { fileId: string; filename: string; mime: string }) => ({
      fileId,
      filename,
      mime,
    })),
  );
});

describe("聊天分支消息属主隔离", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ id: "user-1" });
    mocks.getSchema.mockReturnValue(schema);
    mocks.loadMessageAttachmentsByMessageIds.mockResolvedValue(new Map());
    mocks.replaceMessageAttachments.mockResolvedValue(undefined);
    mocks.resolveChatImageAttachments.mockResolvedValue([]);
    mocks.toChatMessageAttachments.mockImplementation((attachments) =>
      attachments.map(({ fileId, filename, mime }: { fileId: string; filename: string; mime: string }) => ({
        fileId,
        filename,
        mime,
      })),
    );
    mocks.assertVisionModel.mockResolvedValue(undefined);
    mocks.withConversationMessageWrite.mockImplementation(
      async (
        db: unknown,
        _schema: unknown,
        _conversationId: string,
        _userId: string,
        operation: (transactionDb: unknown) => Promise<unknown>,
      ) => operation(db),
    );
  });

  it("编辑时拒绝当前会话之外的消息且不执行写操作", async () => {
    const update = vi.fn();
    const remove = vi.fn();
    const db = {
      select: vi.fn(() => ({ from: vi.fn(() => queryReturning([
        { id: "conversation-1", userId: "user-1" },
      ])) })),
      update,
      delete: remove,
    };
    mocks.getDb.mockResolvedValue(db);
    mocks.findConversationMessage.mockResolvedValue(null);

    await expect(editMessage(
      "conversation-1",
      "foreign-message",
      "new content",
      [],
      "model-1",
      "model-id-1",
    ))
      .rejects.toThrow("消息不存在");

    expect(mocks.findConversationMessage).toHaveBeenCalledWith(
      db,
      schema,
      "conversation-1",
      { publicId: "foreign-message" },
    );
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("编辑等待写锁后会话失效时不执行消息写入", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const remove = vi.fn();
    const db = {
      select: selectQueue([
        [{ id: "conversation-1", userId: "user-1" }],
        [{ id: "user-message-1", parentId: null }],
      ]),
      update,
      delete: remove,
    };
    mocks.getDb.mockResolvedValue(db);
    mocks.findConversationMessage.mockResolvedValue({
      id: "user-message-1",
      publicId: "user-public-1",
      parentId: null,
      role: "user",
      content: "old content",
    });
    mocks.withConversationMessageWrite.mockResolvedValueOnce(null);

    await expect(
      editMessage(
        "conversation-1",
        "user-public-1",
        "new content",
        [],
        "model-1",
        "model-id-1",
      ),
    ).rejects.toThrow("无权操作");

    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("编辑目标有效时在写锁内条件更新并返回新消息", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: "user-message-1" }]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const remove = vi.fn();
    const db = {
      select: selectQueue([
        [{ id: "user-message-1", parentId: null }],
      ]),
      update,
      delete: remove,
    };
    mocks.getDb.mockResolvedValue(db);
    mocks.findConversationMessage.mockResolvedValueOnce({
      id: "user-message-1",
      publicId: "user-public-1",
      parentId: null,
      role: "user",
      content: "old content",
    });
    mocks.resolveChatImageAttachments.mockResolvedValueOnce([{
      fileId: "file-1",
      filename: "one.png",
      mime: "image/png",
      storagePath: "user-1/one.png",
    }]);

    await expect(
      editMessage(
        "conversation-1",
        "user-public-1",
        "new content",
        ["file-1"],
        "model-1",
        "model-id-1",
      ),
    ).resolves.toEqual({
      messages: [{ role: "user", content: "new content" }],
      attachments: [{ fileId: "file-1", filename: "one.png", mime: "image/png" }],
    });

    expect(mocks.withConversationMessageWrite).toHaveBeenCalledWith(
      db,
      schema,
      "conversation-1",
      "user-1",
      expect.any(Function),
    );
    expect(mocks.eq).toHaveBeenCalledWith(schema.messages.conversationId, "conversation-1");
    expect(mocks.eq).toHaveBeenCalledWith(schema.messages.role, "user");
    expect(mocks.isNull).toHaveBeenCalledWith(schema.messages.deletedAt);
    expect(returning).toHaveBeenCalledWith({ id: schema.messages.id });
    expect(mocks.replaceMessageAttachments).toHaveBeenCalledWith(
      db,
      schema,
      "user-message-1",
      [expect.objectContaining({ fileId: "file-1" })],
    );
    expect(mocks.assertVisionModel).toHaveBeenCalledWith(db, schema, {
      userId: "user-1",
      model: "model-1",
      modelId: "model-id-1",
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it("编辑图片消息时模型不支持 vision 不改写消息树", async () => {
    const update = vi.fn();
    const remove = vi.fn();
    const db = { update, delete: remove };
    mocks.getDb.mockResolvedValue(db);
    mocks.findConversationMessage.mockResolvedValueOnce({
      id: "user-message-1",
      publicId: "user-public-1",
      parentId: null,
      role: "user",
      content: "old content",
    });
    mocks.resolveChatImageAttachments.mockResolvedValueOnce([{
      fileId: "file-1",
      filename: "one.png",
      mime: "image/png",
      storagePath: "user-1/one.png",
    }]);
    mocks.assertVisionModel.mockRejectedValueOnce(new Error("当前模型不支持图片输入"));

    await expect(editMessage(
      "conversation-1",
      "user-public-1",
      "new content",
      ["file-1"],
      "text-model",
      "text-model-id",
    )).rejects.toThrow("当前模型不支持图片输入");

    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(mocks.replaceMessageAttachments).not.toHaveBeenCalled();
  });

  it("删除其他用户的 assistant 消息时不泄露消息角色", async () => {
    const update = vi.fn();
    const db = {
      select: selectQueue([[]]),
      update,
    };
    mocks.getDb.mockResolvedValue(db);

    await expect(softDeleteMessage("assistant-public-1")).rejects.toThrow("消息不存在");

    expect(mocks.and).toHaveBeenCalledWith(
      { op: "eq", left: schema.conversations.id, right: schema.messages.conversationId },
      { op: "eq", left: schema.conversations.userId, right: "user-1" },
    );
    expect(mocks.eq).toHaveBeenCalledWith(schema.messages.publicId, "assistant-public-1");
    expect(update).not.toHaveBeenCalled();
  });

  it("删除其他用户的 user 消息时不泄露消息是否存在", async () => {
    const update = vi.fn();
    const select = selectQueue([[]]);
    const db = {
      select,
      update,
    };
    mocks.getDb.mockResolvedValue(db);

    await expect(softDeleteMessage("user-public-1")).rejects.toThrow("消息不存在");

    expect(select).toHaveBeenCalledTimes(1);
    expect(mocks.and).toHaveBeenCalledWith(
      { op: "eq", left: schema.conversations.id, right: schema.messages.conversationId },
      { op: "eq", left: schema.conversations.userId, right: "user-1" },
    );
    expect(mocks.eq).toHaveBeenCalledWith(schema.messages.publicId, "user-public-1");
    expect(update).not.toHaveBeenCalled();
  });

  it("删除不存在的消息时返回相同错误且不写库", async () => {
    const update = vi.fn();
    const select = selectQueue([[]]);
    mocks.getDb.mockResolvedValue({ select, update });

    await expect(softDeleteMessage("missing-message")).rejects.toThrow("消息不存在");

    expect(select).toHaveBeenCalledTimes(1);
    expect(mocks.and).toHaveBeenCalledWith(
      { op: "eq", left: schema.conversations.id, right: schema.messages.conversationId },
      { op: "eq", left: schema.conversations.userId, right: "user-1" },
    );
    expect(mocks.eq).toHaveBeenCalledWith(schema.messages.publicId, "missing-message");
    expect(update).not.toHaveBeenCalled();
  });

  it("会话属主删除 assistant 消息时保留角色校验", async () => {
    const update = vi.fn();
    const select = selectQueue([
      [{ id: "assistant-1", conversationId: "conversation-1", role: "assistant" }],
    ]);
    mocks.getDb.mockResolvedValue({
      select,
      update,
    });

    await expect(softDeleteMessage("assistant-public-1"))
      .rejects.toThrow("仅支持删除用户消息");

    expect(select).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it("会话属主删除 user 消息时保留子树软删除行为", async () => {
    const allMessages = [
      { id: "user-1", publicId: "user-public-1", parentId: null },
      { id: "assistant-1", publicId: "assistant-public-1", parentId: "user-1" },
      { id: "user-2", publicId: "user-public-2", parentId: "assistant-1" },
      { id: "other-root", publicId: "other-public", parentId: null },
    ];
    const returning = vi.fn().mockResolvedValue(
      allMessages.slice(0, 3).map((message) => ({
        id: message.id,
        publicId: message.publicId,
      })),
    );
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    mocks.getDb.mockResolvedValue({
      select: selectQueue([
        [{ id: "user-1", conversationId: "conversation-1", role: "user" }],
        allMessages,
      ]),
      update,
    });
    mocks.findConversationMessage.mockResolvedValueOnce({
      id: "user-1",
      publicId: "user-public-1",
      conversationId: "conversation-1",
      role: "user",
    });

    await expect(softDeleteMessage("user-public-1")).resolves.toEqual([
      "user-public-1",
      "assistant-public-1",
      "user-public-2",
    ]);

    expect(update).toHaveBeenCalledWith(schema.messages);
    expect(set).toHaveBeenCalledWith({ deletedAt: expect.any(Date) });
    expect(mocks.inArray).toHaveBeenCalledWith(
      schema.messages.id,
      expect.arrayContaining(["user-1", "assistant-1", "user-2"]),
    );
    expect(where).toHaveBeenCalledTimes(1);
  });

  it("软删除只更新部分子树时拒绝返回成功", async () => {
    const allMessages = [
      { id: "user-1", publicId: "user-public-1", parentId: null },
      { id: "assistant-1", publicId: "assistant-public-1", parentId: "user-1" },
    ];
    const returning = vi.fn().mockResolvedValue([
      { id: "user-1", publicId: "user-public-1" },
    ]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    mocks.getDb.mockResolvedValue({
      select: selectQueue([
        [{ id: "user-1", conversationId: "conversation-1", role: "user" }],
        allMessages,
      ]),
      update,
    });
    mocks.findConversationMessage.mockResolvedValueOnce({
      id: "user-1",
      publicId: "user-public-1",
      conversationId: "conversation-1",
      role: "user",
    });

    await expect(softDeleteMessage("user-public-1"))
      .rejects.toThrow("消息树已发生变化");
  });

  it("软删除等待写锁后目标失效时不更新消息", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    mocks.getDb.mockResolvedValue({
      select: selectQueue([
        [{ id: "user-1", conversationId: "conversation-1", role: "user" }],
        [{ id: "user-1", publicId: "user-public-1", parentId: null }],
      ]),
      update,
    });
    mocks.withConversationMessageWrite.mockResolvedValueOnce(null);

    await expect(softDeleteMessage("user-public-1")).rejects.toThrow("消息不存在");

    expect(update).not.toHaveBeenCalled();
  });

  it("查询同父兄弟时排除软删除目标并限制消息所属会话", async () => {
    const queries = [
      queryReturning([{ id: "assistant-1", publicId: "public-1", conversationId: "conversation-1", parentId: "parent-1" }]),
      queryReturning([{ id: "conversation-1", userId: "user-1" }]),
      queryReturning([]),
    ];
    const firstQuery = queries[0];
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => queries.shift() ?? queryReturning([])),
      })),
    };
    mocks.getDb.mockResolvedValue(db);

    await getMessageSiblings("public-1");

    expect(firstQuery.where).toHaveBeenCalledWith({
      op: "and",
      conditions: [
        { op: "eq", left: schema.messages.publicId, right: "public-1" },
        { op: "isNull", field: schema.messages.deletedAt },
      ],
    });
    expect(mocks.eq).toHaveBeenCalledWith(schema.messages.conversationId, "conversation-1");
  });

  it("兄弟版本目标不可见时不继续读取关联数据", async () => {
    const select = selectQueue([[]]);
    mocks.getDb.mockResolvedValue({ select });

    await expect(getMessageSiblings("deleted-public-1")).resolves.toEqual({
      current: null,
      siblings: [],
    });

    expect(select).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["重试", retryFromMessage],
    ["续写", continueMessage],
  ])("%s 时在当前会话内解析 assistant 及其父消息", async (_name, action) => {
    const selectedRows = [
      [{ id: "conversation-1", userId: "user-1" }],
      [{ id: "parent-1", publicId: "parent-public-1", parentId: null, role: "user", content: "hello" }],
    ];
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => queryReturning(selectedRows.shift() ?? [])),
      })),
    };
    mocks.getDb.mockResolvedValue(db);
    mocks.findConversationMessage
      .mockResolvedValueOnce({
        id: "assistant-1",
        publicId: "assistant-public-1",
        parentId: "parent-1",
        role: "assistant",
        content: "response",
      })
      .mockResolvedValueOnce({
        id: "parent-1",
        publicId: "parent-public-1",
        role: "user",
      });

    await action("conversation-1", "assistant-public-1");

    expect(mocks.findConversationMessage).toHaveBeenNthCalledWith(
      1,
      db,
      schema,
      "conversation-1",
      { publicId: "assistant-public-1" },
    );
    expect(mocks.findConversationMessage).toHaveBeenNthCalledWith(
      2,
      db,
      schema,
      "conversation-1",
      { id: "parent-1" },
    );
  });
});

describe("getVisibleBranch 历史 toolCalls 回填", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ id: "user-1" });
    mocks.getSchema.mockReturnValue(schema);
  });

  const baseMsgs = [
    {
      id: "user-1-msg",
      publicId: "pub-user-1",
      role: "user",
      content: "hello",
      parentId: null,
      createdAt: "2026-07-25T00:00:00.000Z",
      runId: null,
    },
    {
      id: "asst-1",
      publicId: "pub-asst-1",
      role: "assistant",
      content: "done",
      parentId: "user-1-msg",
      createdAt: "2026-07-25T00:00:01.000Z",
      runId: "run_a",
    },
  ];

  it("一次批量投影主线用户消息附件", async () => {
    mocks.loadMessageAttachmentsByMessageIds.mockResolvedValueOnce(new Map([[
      "user-1-msg",
      [{
        fileId: "file-1",
        filename: "one.png",
        mime: "image/png",
        storagePath: "user-1/one.png",
      }],
    ]]));
    mocks.getDb.mockResolvedValue({
      select: selectQueue([
        [{ id: "conversation-1", userId: "user-1" }],
        baseMsgs,
        [],
        [],
        [],
      ]),
    });

    const result = await getVisibleBranch("conversation-1");
    expect(result.messages[0]).toMatchObject({
      id: "user-1-msg",
      attachments: [{ fileId: "file-1", filename: "one.png", mime: "image/png" }],
    });
    expect(mocks.loadMessageAttachmentsByMessageIds).toHaveBeenCalledWith(
      expect.anything(),
      schema,
      {
        userId: "user-1",
        conversationId: "conversation-1",
        messageIds: ["user-1-msg"],
      },
    );
  });

  it("按 runId 批量回填会话内运行元数据,保留真实零值", async () => {
    const completedAt = new Date("2026-07-25T00:00:02.000Z");
    const select = selectQueue([
      [{ id: "conversation-1", userId: "user-1" }],
      baseMsgs,
      [{
        runId: "run_a",
        model: "GPT Test",
        tokenUsage: {
          promptTokens: 12,
          completionTokens: 0,
          cacheReadTokens: 3,
          reasoningTokens: 0,
        },
        durationMs: 0,
        completedAt,
      }],
      [], // tool_calls
      [], // feedback
    ]);
    mocks.getDb.mockResolvedValue({ select });

    const result = await getVisibleBranch("conversation-1");
    const assistant = result.messages.find((message) => message.id === "asst-1");

    expect(assistant?.runMetadata).toEqual({
      model: "GPT Test",
      tokenUsage: {
        promptTokens: 12,
        completionTokens: 0,
        cacheReadTokens: 3,
        reasoningTokens: 0,
      },
      durationMs: 0,
      completedAt: "2026-07-25T00:00:02.000Z",
    });
    expect(mocks.eq).toHaveBeenCalledWith(schema.runs.conversationId, "conversation-1");
    expect(mocks.inArray).toHaveBeenCalledWith(schema.runs.runId, ["run_a"]);
    expect(select).toHaveBeenNthCalledWith(3, {
      runId: schema.runs.runId,
      model: schema.runs.platformModelName,
      tokenUsage: schema.runs.tokenUsage,
      durationMs: schema.runs.durationMs,
      completedAt: schema.runs.completedAt,
    });
  });

  it("按主线 runId 批量关联 tool_calls,并映射 status/args", async () => {
    const toolRows = [
      {
        runId: "run_a",
        toolCallId: "tc-search",
        toolName: "search",
        status: "success",
        inputJson: { q: "nekosora" },
        createdAt: "2026-07-25T00:00:01.100Z",
      },
      {
        runId: "run_a",
        toolCallId: "tc-read",
        toolName: "read_file",
        status: "running",
        inputJson: { path: "/a" },
        createdAt: "2026-07-25T00:00:01.200Z",
      },
      {
        runId: "run_a",
        toolCallId: "tc-write",
        toolName: "write_file",
        status: "failed",
        inputJson: { path: "/b" },
        createdAt: "2026-07-25T00:00:01.300Z",
      },
      {
        runId: "run_a",
        toolCallId: "tc-pending",
        toolName: "pending_tool",
        status: "pending",
        inputJson: null,
        createdAt: "2026-07-25T00:00:01.400Z",
      },
    ];
    const db = {
      select: selectQueue([
        [{ id: "conversation-1", userId: "user-1" }],
        baseMsgs,
        [], // run metadata
        toolRows,
        [], // feedback
      ]),
    };
    mocks.getDb.mockResolvedValue(db);

    const result = await getVisibleBranch("conversation-1");

    expect(result.messages).toHaveLength(2);
    const asst = result.messages.find((m) => m.id === "asst-1");
    expect(asst?.toolCalls).toEqual([
      { toolCallId: "tc-search", toolName: "search", status: "done", args: { q: "nekosora" } },
      { toolCallId: "tc-read", toolName: "read_file", status: "calling", args: { path: "/a" } },
      { toolCallId: "tc-write", toolName: "write_file", status: "error", args: { path: "/b" } },
      { toolCallId: "tc-pending", toolName: "pending_tool", status: "calling" },
    ]);
    // 不暴露 output/error 字段
    for (const tc of asst?.toolCalls as Record<string, unknown>[]) {
      expect(tc).not.toHaveProperty("outputJson");
      expect(tc).not.toHaveProperty("errorJson");
      expect(tc).toHaveProperty("toolCallId");
    }
    // 查询必须 join runs 并用 conversationId 限定
    expect(mocks.eq).toHaveBeenCalledWith(schema.runs.conversationId, "conversation-1");
    expect(mocks.inArray).toHaveBeenCalledWith(schema.toolCalls.runId, ["run_a"]);
  });

  it("仅从成功搜索 trace 恢复引用并按 URL 去重", async () => {
    const messages = baseMsgs.map((message) => message.id === "asst-1"
      ? {
          ...message,
          processTrace: {
            webSearch: {
              calls: [
                {
                  status: "success",
                  backend: { type: "provider", id: "tavily", name: "Tavily" },
                  citations: [
                    {
                      title: "First",
                      url: "https://example.com",
                      snippet: "one",
                      publishedAt: "2026-08-03T00:00:00.000Z",
                    },
                    { title: "Updated", url: "https://example.com" },
                  ],
                },
                {
                  status: "failed",
                  citations: [{ title: "Ignored", url: "https://ignored.example" }],
                },
              ],
            },
          },
        }
      : message);
    mocks.getDb.mockResolvedValue({
      select: selectQueue([
        [{ id: "conversation-1", userId: "user-1" }],
        messages,
        [],
        [],
        [],
      ]),
    });

    const result = await getVisibleBranch("conversation-1");
    expect(result.messages.find((message) => message.id === "asst-1")?.searchResults)
      .toEqual([{
        title: "Updated",
        url: "https://example.com",
        publishedAt: "2026-08-03T00:00:00.000Z",
      }]);
    expect(result.messages.find((message) => message.id === "asst-1")?.searchBackends)
      .toEqual([{ type: "provider", id: "tavily", name: "Tavily" }]);
  });

  it("跨会话隔离:tool_calls 查询带 runs.conversationId,不串入外会话数据", async () => {
    // mock 只返回本会话 join 结果;断言 where 约束含 conversationId + runIds
    const db = {
      select: selectQueue([
        [{ id: "conversation-1", userId: "user-1" }],
        baseMsgs,
        [], // run metadata
        // 即使 DB 层若未约束会返回外会话行,本实现 where 已限定;此处模拟空(外会话被过滤)
        [],
        [], // feedback
      ]),
    };
    mocks.getDb.mockResolvedValue(db);

    const result = await getVisibleBranch("conversation-1");
    const asst = result.messages.find((m) => m.id === "asst-1");
    expect(asst?.toolCalls).toBeUndefined();

    const andCalls = mocks.and.mock.calls;
    const toolWhere = andCalls.find(
      (call) =>
        JSON.stringify(call).includes("runs.conversationId") ||
        call.some(
          (c) =>
            typeof c === "object" &&
            c !== null &&
            "left" in c &&
            (c as { left: unknown }).left === schema.runs.conversationId,
        ),
    );
    expect(toolWhere).toBeTruthy();
    expect(mocks.eq).toHaveBeenCalledWith(schema.runs.conversationId, "conversation-1");
    // 会话属主校验仍生效
    expect(mocks.eq).toHaveBeenCalledWith(schema.conversations.id, "conversation-1");
  });

  it("无 runId 的 assistant 不查 tool_calls,返回结构兼容", async () => {
    const msgsNoRun = [
      {
        id: "user-1-msg",
        publicId: "pub-user-1",
        role: "user",
        content: "hello",
        parentId: null,
        createdAt: "2026-07-25T00:00:00.000Z",
      },
      {
        id: "asst-1",
        publicId: "pub-asst-1",
        role: "assistant",
        content: "hi",
        parentId: "user-1-msg",
        createdAt: "2026-07-25T00:00:01.000Z",
        // 无 runId
      },
    ];
    const select = selectQueue([
      [{ id: "conversation-1", userId: "user-1" }],
      msgsNoRun,
      [], // feedback(仍批量查询,无记录兼容)
    ]);
    const db = { select };
    mocks.getDb.mockResolvedValue(db);

    const result = await getVisibleBranch("conversation-1");

    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].toolCalls).toBeUndefined();
    expect(result.messages[1].feedback).toBeUndefined();
    expect(result.versionMap).toEqual({});
    // 会话 + 消息 + feedback,无 tool_calls 查询
    expect(select).toHaveBeenCalledTimes(3);
    expect(mocks.inArray).not.toHaveBeenCalledWith(schema.toolCalls.runId, expect.anything());
  });

  it("同名工具多次调用按 createdAt 顺序保留,且同 toolCallId 不跨 run 合并", async () => {
    const msgs = [
      {
        id: "user-1-msg",
        role: "user",
        content: "a",
        parentId: null,
        createdAt: "2026-07-25T00:00:00.000Z",
      },
      {
        id: "asst-1",
        role: "assistant",
        content: "r1",
        parentId: "user-1-msg",
        createdAt: "2026-07-25T00:00:01.000Z",
        runId: "run_1",
      },
      {
        id: "user-2-msg",
        role: "user",
        content: "b",
        parentId: "asst-1",
        createdAt: "2026-07-25T00:00:02.000Z",
      },
      {
        id: "asst-2",
        role: "assistant",
        content: "r2",
        parentId: "user-2-msg",
        createdAt: "2026-07-25T00:00:03.000Z",
        runId: "run_2",
      },
    ];
    const toolRows = [
      {
        runId: "run_1",
        toolName: "search",
        status: "success",
        inputJson: { q: "first" },
        createdAt: "2026-07-25T00:00:01.100Z",
      },
      {
        runId: "run_1",
        toolName: "search",
        status: "success",
        inputJson: { q: "second" },
        createdAt: "2026-07-25T00:00:01.200Z",
      },
      // 与 run_1 相同 toolCallId 语义的同名工具,但属 run_2,不得并入 run_1
      {
        runId: "run_2",
        toolName: "search",
        status: "failed",
        inputJson: { q: "other-run" },
        createdAt: "2026-07-25T00:00:03.100Z",
      },
    ];
    const db = {
      select: selectQueue([
        [{ id: "conversation-1", userId: "user-1" }],
        msgs,
        [], // run metadata
        toolRows,
        [], // feedback
      ]),
    };
    mocks.getDb.mockResolvedValue(db);

    const result = await getVisibleBranch("conversation-1");
    const asst1 = result.messages.find((m) => m.id === "asst-1");
    const asst2 = result.messages.find((m) => m.id === "asst-2");

    expect(asst1?.toolCalls).toEqual([
      { toolName: "search", status: "done", args: { q: "first" } },
      { toolName: "search", status: "done", args: { q: "second" } },
    ]);
    expect(asst2?.toolCalls).toEqual([
      { toolName: "search", status: "error", args: { q: "other-run" } },
    ]);
    expect(mocks.inArray).toHaveBeenCalledWith(
      schema.toolCalls.runId,
      expect.arrayContaining(["run_1", "run_2"]),
    );
  });

  it("无权访问会话时抛错且不查询 tool_calls", async () => {
    const select = selectQueue([[{ id: "conversation-1", userId: "other-user" }]]);
    mocks.getDb.mockResolvedValue({ select });

    await expect(getVisibleBranch("conversation-1")).rejects.toThrow("会话不存在或无权访问");
    expect(select).toHaveBeenCalledTimes(1);
  });
});

describe("getVisibleBranch / getMessageSiblings feedback 回填", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ id: "user-1" });
    mocks.getSchema.mockReturnValue(schema);
  });

  it("主线批量回填当前用户 feedback,无反馈兼容", async () => {
    const msgs = [
      {
        id: "user-1-msg",
        publicId: "pub-user-1",
        role: "user",
        content: "hello",
        parentId: null,
        createdAt: "2026-07-25T00:00:00.000Z",
      },
      {
        id: "asst-1",
        publicId: "pub-asst-1",
        role: "assistant",
        content: "done",
        parentId: "user-1-msg",
        createdAt: "2026-07-25T00:00:01.000Z",
      },
      {
        id: "asst-2",
        publicId: "pub-asst-2",
        role: "assistant",
        content: "plain",
        parentId: "user-1-msg",
        createdAt: "2026-07-25T00:00:02.000Z",
      },
    ];
    // 最新叶子 asst-2 → 主线 user + asst-2;asst-1 不在主线
    const db = {
      select: selectQueue([
        [{ id: "conversation-1", userId: "user-1" }],
        msgs,
        [
          { messageId: "asst-2", rating: "down", reason: "outdated" },
          // 外会话/他用户行不应出现;此处模拟仅本查询结果
        ],
      ]),
    };
    mocks.getDb.mockResolvedValue(db);

    const result = await getVisibleBranch("conversation-1");
    const asst2 = result.messages.find((m) => m.id === "asst-2");
    const user = result.messages.find((m) => m.id === "user-1-msg");

    expect(asst2?.feedback).toEqual({ rating: "down", reason: "outdated" });
    expect(user?.feedback).toBeUndefined();
    expect(mocks.eq).toHaveBeenCalledWith(schema.messageFeedback.userId, "user-1");
    expect(mocks.eq).toHaveBeenCalledWith(schema.messageFeedback.conversationId, "conversation-1");
    expect(mocks.inArray).toHaveBeenCalledWith(
      schema.messageFeedback.messageId,
      expect.arrayContaining(["user-1-msg", "asst-2"]),
    );
  });

  it("兄弟版本各自 feedback,切换数据不串", async () => {
    const currentMsg = {
      id: "asst-v1",
      publicId: "pub-v1",
      conversationId: "conversation-1",
      parentId: "parent-user",
      role: "assistant",
      content: "v1",
      reasoning: null,
      branchReason: null,
      runId: null,
    };
    const siblingRows = [
      {
        id: "asst-v1",
        publicId: "pub-v1",
        conversationId: "conversation-1",
        parentId: "parent-user",
        role: "assistant",
        content: "v1 answer",
        reasoning: null,
        branchReason: null,
        runId: null,
        createdAt: "2026-07-25T00:00:01.000Z",
      },
      {
        id: "asst-v2",
        publicId: "pub-v2",
        conversationId: "conversation-1",
        parentId: "parent-user",
        role: "assistant",
        content: "v2 answer",
        reasoning: null,
        branchReason: "retry",
        runId: null,
        createdAt: "2026-07-25T00:00:02.000Z",
      },
    ];
    const select = selectQueue([
      [currentMsg],
      [{ id: "conversation-1", userId: "user-1" }],
      siblingRows,
      [
        { messageId: "asst-v1", rating: "up", reason: null },
        { messageId: "asst-v2", rating: "down", reason: "incorrect" },
      ],
    ]);
    mocks.getDb.mockResolvedValue({ select });

    const result = await getMessageSiblings("pub-v1");

    expect(result.siblings[0].feedback).toEqual({ rating: "up" });
    expect(result.siblings[1].feedback).toEqual({ rating: "down", reason: "incorrect" });
    expect(mocks.eq).toHaveBeenCalledWith(schema.messageFeedback.conversationId, "conversation-1");
    expect(mocks.eq).toHaveBeenCalledWith(schema.messageFeedback.userId, "user-1");
  });
});

describe("getMessageSiblings 版本切换 toolCalls 回填", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ id: "user-1" });
    mocks.getSchema.mockReturnValue(schema);
  });

  it("各兄弟版本按自身 runId 返回 toolCalls,不同 run 不串数据", async () => {
    const currentMsg = {
      id: "asst-v1",
      publicId: "pub-v1",
      conversationId: "conversation-1",
      parentId: "parent-user",
      role: "assistant",
      content: "v1",
      reasoning: null,
      branchReason: "retry",
      runId: "run_v1",
    };
    const siblingRows = [
      {
        id: "asst-v1",
        publicId: "pub-v1",
        conversationId: "conversation-1",
        parentId: "parent-user",
        role: "assistant",
        content: "v1 answer",
        reasoning: "think-1",
        branchReason: null,
        runId: "run_v1",
        createdAt: "2026-07-25T00:00:01.000Z",
        processTrace: {
          webSearch: {
            calls: [{
              status: "success",
              citations: [{ title: "V1 source", url: "https://v1.example" }],
            }],
          },
        },
      },
      {
        id: "asst-v2",
        publicId: "pub-v2",
        conversationId: "conversation-1",
        parentId: "parent-user",
        role: "assistant",
        content: "v2 answer",
        reasoning: "think-2",
        branchReason: "retry",
        runId: "run_v2",
        createdAt: "2026-07-25T00:00:02.000Z",
        processTrace: {
          webSearch: {
            calls: [{
              status: "success",
              citations: [{ title: "V2 source", url: "https://v2.example" }],
            }],
          },
        },
      },
      // 同 parent 下的 user 消息不应进入 siblings
      {
        id: "parent-user",
        publicId: "pub-user",
        conversationId: "conversation-1",
        parentId: null,
        role: "user",
        content: "q",
        reasoning: null,
        branchReason: null,
        runId: null,
        createdAt: "2026-07-25T00:00:00.000Z",
      },
    ];
    const toolRows = [
      {
        runId: "run_v1",
        toolName: "search",
        status: "success",
        inputJson: { q: "v1" },
        createdAt: "2026-07-25T00:00:01.100Z",
      },
      {
        runId: "run_v2",
        toolName: "read_file",
        status: "failed",
        inputJson: { path: "/v2" },
        createdAt: "2026-07-25T00:00:02.100Z",
      },
      {
        runId: "run_v2",
        toolName: "search",
        status: "running",
        inputJson: { q: "v2" },
        createdAt: "2026-07-25T00:00:02.200Z",
      },
    ];
    const runRows = [
      {
        runId: "run_v1",
        model: "Model V1",
        tokenUsage: { promptTokens: 8, completionTokens: 4 },
        durationMs: 900,
        completedAt: new Date("2026-07-25T00:00:01.900Z"),
      },
      {
        runId: "run_v2",
        model: "Model V2",
        tokenUsage: null,
        durationMs: null,
        completedAt: null,
      },
    ];
    const select = selectQueue([
      [currentMsg],
      [{ id: "conversation-1", userId: "user-1" }],
      siblingRows,
      runRows,
      toolRows,
      [], // feedback
    ]);
    mocks.getDb.mockResolvedValue({ select });

    const result = await getMessageSiblings("pub-v1");

    expect(result.current).toEqual({ publicId: "pub-v1", parentId: "parent-user" });
    // 仅 assistant,且保持 createdAt 升序
    expect(result.siblings.map((s) => s.publicId)).toEqual(["pub-v1", "pub-v2"]);
    expect(result.siblings[0]).toEqual({
      publicId: "pub-v1",
      content: "v1 answer",
      createdAt: "2026-07-25T00:00:01.000Z",
      reasoning: "think-1",
      branchReason: null,
      runMetadata: {
        model: "Model V1",
        tokenUsage: { promptTokens: 8, completionTokens: 4 },
        durationMs: 900,
        completedAt: "2026-07-25T00:00:01.900Z",
      },
      toolCalls: [{ toolName: "search", status: "done", args: { q: "v1" } }],
      searchResults: [{ title: "V1 source", url: "https://v1.example" }],
    });
    expect(result.siblings[1]).toEqual({
      publicId: "pub-v2",
      content: "v2 answer",
      createdAt: "2026-07-25T00:00:02.000Z",
      reasoning: "think-2",
      branchReason: "retry",
      runMetadata: { model: "Model V2" },
      toolCalls: [
        { toolName: "read_file", status: "error", args: { path: "/v2" } },
        { toolName: "search", status: "calling", args: { q: "v2" } },
      ],
      searchResults: [{ title: "V2 source", url: "https://v2.example" }],
    });
    // 消息 + 会话 + 兄弟 + run metadata + tool_calls + feedback
    expect(select).toHaveBeenCalledTimes(6);
    expect(mocks.eq).toHaveBeenCalledWith(schema.runs.conversationId, "conversation-1");
    expect(mocks.inArray).toHaveBeenCalledWith(
      schema.toolCalls.runId,
      expect.arrayContaining(["run_v1", "run_v2"]),
    );
  });

  it("无 runId 的兄弟不查 tool_calls,返回结构兼容", async () => {
    const currentMsg = {
      id: "asst-1",
      publicId: "pub-1",
      conversationId: "conversation-1",
      parentId: "parent-1",
      role: "assistant",
      content: "a",
      reasoning: null,
      branchReason: null,
      // 无 runId
    };
    const siblingRows = [
      {
        publicId: "pub-1",
        parentId: "parent-1",
        role: "assistant",
        content: "a",
        reasoning: null,
        branchReason: null,
        createdAt: "2026-07-25T00:00:01.000Z",
      },
      {
        publicId: "pub-2",
        parentId: "parent-1",
        role: "assistant",
        content: "b",
        reasoning: null,
        branchReason: "retry",
        createdAt: "2026-07-25T00:00:02.000Z",
      },
    ];
    const select = selectQueue([
      [currentMsg],
      [{ id: "conversation-1", userId: "user-1" }],
      siblingRows,
    ]);
    mocks.getDb.mockResolvedValue({ select });

    const result = await getMessageSiblings("pub-1");

    expect(result.siblings).toEqual([
      {
        publicId: "pub-1",
        content: "a",
        createdAt: "2026-07-25T00:00:01.000Z",
        reasoning: null,
        branchReason: null,
      },
      {
        publicId: "pub-2",
        content: "b",
        createdAt: "2026-07-25T00:00:02.000Z",
        reasoning: null,
        branchReason: "retry",
      },
    ]);
    expect(result.siblings[0].toolCalls).toBeUndefined();
    expect(result.siblings[1].toolCalls).toBeUndefined();
    // 仅 3 次 select(消息 + 会话 + 兄弟),无 tool_calls 查询
    expect(select).toHaveBeenCalledTimes(3);
    expect(mocks.inArray).not.toHaveBeenCalledWith(schema.toolCalls.runId, expect.anything());
  });

  it("无权访问时不返回兄弟且不查询 tool_calls", async () => {
    const select = selectQueue([
      [{ id: "asst-1", publicId: "pub-1", conversationId: "conversation-1", parentId: "p" }],
      [{ id: "conversation-1", userId: "other-user" }],
    ]);
    mocks.getDb.mockResolvedValue({ select });

    const result = await getMessageSiblings("pub-1");

    expect(result).toEqual({ current: null, siblings: [] });
    expect(select).toHaveBeenCalledTimes(2);
    expect(mocks.inArray).not.toHaveBeenCalledWith(schema.toolCalls.runId, expect.anything());
  });
});
