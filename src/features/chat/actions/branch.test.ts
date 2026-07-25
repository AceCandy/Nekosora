import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDb: vi.fn(),
  getSchema: vi.fn(),
  findConversationMessage: vi.fn(),
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
  },
  toolCalls: {
    runId: "toolCalls.runId",
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

describe("聊天分支消息属主隔离", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ id: "user-1" });
    mocks.getSchema.mockReturnValue(schema);
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

    await expect(editMessage("conversation-1", "foreign-message", "new content"))
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
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    mocks.getDb.mockResolvedValue({
      select: selectQueue([
        [{ id: "user-1", conversationId: "conversation-1", role: "user" }],
        allMessages,
      ]),
      update,
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

  it("查询同父兄弟时额外限制消息所属会话", async () => {
    const selectRows = [
      [{ id: "assistant-1", publicId: "public-1", conversationId: "conversation-1", parentId: "parent-1" }],
      [{ id: "conversation-1", userId: "user-1" }],
      [],
    ];
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => queryReturning(selectRows.shift() ?? [])),
      })),
    };
    mocks.getDb.mockResolvedValue(db);

    await getMessageSiblings("public-1");

    expect(mocks.eq).toHaveBeenCalledWith(schema.messages.conversationId, "conversation-1");
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

  it("按主线 runId 批量关联 tool_calls,并映射 status/args", async () => {
    const toolRows = [
      {
        runId: "run_a",
        toolName: "search",
        status: "success",
        inputJson: { q: "nekosora" },
        createdAt: "2026-07-25T00:00:01.100Z",
      },
      {
        runId: "run_a",
        toolName: "read_file",
        status: "running",
        inputJson: { path: "/a" },
        createdAt: "2026-07-25T00:00:01.200Z",
      },
      {
        runId: "run_a",
        toolName: "write_file",
        status: "failed",
        inputJson: { path: "/b" },
        createdAt: "2026-07-25T00:00:01.300Z",
      },
      {
        runId: "run_a",
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
        toolRows,
        [], // feedback
      ]),
    };
    mocks.getDb.mockResolvedValue(db);

    const result = await getVisibleBranch("conversation-1");

    expect(result.messages).toHaveLength(2);
    const asst = result.messages.find((m) => m.id === "asst-1");
    expect(asst?.toolCalls).toEqual([
      { toolName: "search", status: "done", args: { q: "nekosora" } },
      { toolName: "read_file", status: "calling", args: { path: "/a" } },
      { toolName: "write_file", status: "error", args: { path: "/b" } },
      { toolName: "pending_tool", status: "calling" },
    ]);
    // 不暴露 output/error 字段
    for (const tc of asst?.toolCalls as Record<string, unknown>[]) {
      expect(tc).not.toHaveProperty("outputJson");
      expect(tc).not.toHaveProperty("errorJson");
      expect(tc).not.toHaveProperty("toolCallId");
    }
    // 查询必须 join runs 并用 conversationId 限定
    expect(mocks.eq).toHaveBeenCalledWith(schema.runs.conversationId, "conversation-1");
    expect(mocks.inArray).toHaveBeenCalledWith(schema.toolCalls.runId, ["run_a"]);
  });

  it("跨会话隔离:tool_calls 查询带 runs.conversationId,不串入外会话数据", async () => {
    // mock 只返回本会话 join 结果;断言 where 约束含 conversationId + runIds
    const db = {
      select: selectQueue([
        [{ id: "conversation-1", userId: "user-1" }],
        baseMsgs,
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
    const select = selectQueue([
      [currentMsg],
      [{ id: "conversation-1", userId: "user-1" }],
      siblingRows,
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
      reasoning: "think-1",
      branchReason: null,
      toolCalls: [{ toolName: "search", status: "done", args: { q: "v1" } }],
    });
    expect(result.siblings[1]).toEqual({
      publicId: "pub-v2",
      content: "v2 answer",
      reasoning: "think-2",
      branchReason: "retry",
      toolCalls: [
        { toolName: "read_file", status: "error", args: { path: "/v2" } },
        { toolName: "search", status: "calling", args: { q: "v2" } },
      ],
    });
    // 消息 + 会话 + 兄弟 + tool_calls + feedback
    expect(select).toHaveBeenCalledTimes(5);
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
      { publicId: "pub-1", content: "a", reasoning: null, branchReason: null },
      { publicId: "pub-2", content: "b", reasoning: null, branchReason: "retry" },
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
