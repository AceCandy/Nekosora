import { beforeEach, describe, expect, it, vi } from "vitest";

const mockData = vi.hoisted(() => ({
  conversations: [] as Record<string, unknown>[],
  titleJobs: [] as Record<string, unknown>[],
  models: [] as Record<string, unknown>[],
  settings: {} as Record<string, string | null>,
  jobInsertError: null as Error | null,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ type: "eq", col, val }),
  and: (...conds: unknown[]) => ({ type: "and", conds }),
  or: (...conds: unknown[]) => ({ type: "or", conds }),
  sql: (strings: TemplateStringsArray) => strings.join(""),
}));

vi.mock("@/lib/system-settings/service", () => ({
  getSetting: vi.fn(async (namespace: string, key: string) =>
    mockData.settings[namespace + "." + key] ?? null),
}));

vi.mock("@/lib/stream", () => ({
  generateChat: vi.fn(async () => ({ text: "最终标题", usage: {} })),
}));

vi.mock("@/lib/infra/db", () => {
  function matches(row: Record<string, unknown>, cond: unknown): boolean {
    const c = cond as { type?: string; col?: string; val?: unknown; conds?: unknown[] } | undefined;
    if (!c?.type) return true;
    if (c.type === "eq") return row[c.col!] === c.val;
    if (c.type === "and") return c.conds!.every((item) => matches(row, item));
    if (c.type === "or") return c.conds!.some((item) => matches(row, item));
    return true;
  }

  function project(rows: Record<string, unknown>[], fields?: Record<string, string>) {
    return fields
      ? rows.map((row) => Object.fromEntries(
          Object.entries(fields).map(([key, col]) => [key, row[col]]),
        ))
      : rows;
  }

  function query(rows: Record<string, unknown>[], fields?: Record<string, string>) {
    const chain = {
      where(cond: unknown) {
        return query(rows.filter((row) => matches(row, cond)), fields);
      },
      limit(n: number) {
        return query(rows.slice(0, n), fields);
      },
      for() {
        return chain;
      },
      then(resolve: (value: unknown[]) => void, reject: (error: unknown) => void) {
        return Promise.resolve(project(rows, fields)).then(resolve, reject);
      },
    };
    return chain;
  }

  const schema = {
    conversations: {
      __table: "conversations",
      id: "id",
      userId: "userId",
      title: "title",
    },
    conversationTitleJobs: {
      __table: "conversationTitleJobs",
      id: "id",
      conversationId: "conversationId",
      userId: "userId",
      firstUserMessage: "firstUserMessage",
      fallbackTitle: "fallbackTitle",
      chatModel: "chatModel",
      chatModelId: "chatModelId",
      dispatchAfter: "dispatchAfter",
      createdAt: "createdAt",
    },
    models: {
      __table: "models",
      id: "id",
      name: "name",
      visibility: "visibility",
      enabled: "enabled",
    },
  };

  function rowsFor(table: { __table: string }) {
    if (table.__table === "models") return mockData.models;
    if (table.__table === "conversationTitleJobs") return mockData.titleJobs;
    return mockData.conversations;
  }

  function makeDb() {
    const db = {
      select: (fields?: Record<string, string>) => ({
        from: (table: { __table: string }) =>
          query(rowsFor(table), fields),
      }),
      update: (table: { __table: string }) => ({
        set: (patch: Record<string, unknown>) => ({
          where: (cond: unknown) => ({
            returning: async (fields: Record<string, string>) => {
              const rows = rowsFor(table);
              const matched = rows.filter((row) => matches(row, cond));
              for (const row of matched) Object.assign(row, patch);
              return project(matched, fields);
            },
          }),
        }),
      }),
      insert: (table: { __table: string }) => ({
        values: (value: Record<string, unknown>) => ({
          onConflictDoUpdate: async () => {
            if (mockData.jobInsertError) throw mockData.jobInsertError;
            const rows = rowsFor(table);
            const existing = rows.find((row) => row.conversationId === value.conversationId);
            if (existing) Object.assign(existing, value);
            else rows.push({ ...value });
          },
        }),
      }),
      delete: (table: { __table: string }) => ({
        where: async (cond: unknown) => {
          const rows = rowsFor(table);
          const retained = rows.filter((row) => !matches(row, cond));
          rows.splice(0, rows.length, ...retained);
        },
      }),
      transaction: async <T>(callback: (tx: typeof db) => Promise<T>) => {
        const conversations = structuredClone(mockData.conversations);
        const titleJobs = structuredClone(mockData.titleJobs);
        try {
          return await callback(db);
        } catch (error) {
          mockData.conversations = conversations;
          mockData.titleJobs = titleJobs;
          throw error;
        }
      },
    };
    return db;
  }

  return {
    getSchema: () => schema,
    getDb: async () => makeDb(),
  };
});

import { generateChat } from "@/lib/stream";
import {
  generateConversationTitle,
  getConversationTitleState,
  maybeGenerateTitle,
  processConversationTitleJob,
  writeFallbackTitle,
} from "./service";

const titleJob = {
  id: "job-1",
  userId: "u1",
  conversationId: "c1",
  firstUserMessage: "问题",
  fallbackTitle: "问题",
};

async function captureTitleError(): Promise<unknown> {
  return generateConversationTitle(titleJob).catch((cause) => cause);
}

beforeEach(() => {
  mockData.conversations = [{ id: "c1", userId: "u1", title: "新会话" }];
  mockData.models = [{
    id: "m1",
    name: "configured-model",
    visibility: "public",
    enabled: true,
  }];
  mockData.titleJobs = [{ ...titleJob }];
  mockData.settings = { "task.title_model_id": "m1" };
  mockData.jobInsertError = null;
  vi.mocked(generateChat).mockReset().mockResolvedValue({ text: "最终标题", usage: {} });
});

describe("conversation title service", () => {
  it("按属主返回 pending fallback", async () => {
    mockData.conversations[0].title = "问题";

    await expect(getConversationTitleState("u1", "c1")).resolves.toEqual({
      title: "问题",
      pending: true,
    });
  });

  it("任务完成后返回 settled 最终标题", async () => {
    mockData.conversations[0].title = "最终标题";
    mockData.titleJobs = [];

    await expect(getConversationTitleState("u1", "c1")).resolves.toEqual({
      title: "最终标题",
      pending: false,
    });
  });

  it("人工改名后即使 outbox 尚在也返回 settled", async () => {
    mockData.conversations[0].title = "用户标题";

    await expect(getConversationTitleState("u1", "c1")).resolves.toEqual({
      title: "用户标题",
      pending: false,
    });
  });

  it("会话不存在或不属于当前用户时不返回状态", async () => {
    await expect(getConversationTitleState("u2", "c1")).resolves.toBeNull();
    await expect(getConversationTitleState("u1", "missing")).resolves.toBeNull();
  });

  it("事务写 fallback 与 outbox，worker 按配置 modelId 生成并清理任务", async () => {
    mockData.titleJobs = [];
    const job = await writeFallbackTitle(
      "u1",
      "c1",
      "这是一个用于测试标题生成的很长问题",
      "chat-model",
      "chat-id",
    );
    expect(job).toMatchObject({
      id: expect.any(String),
      fallbackTitle: "这是一个用于测试标题生成的很长问…",
      chatModel: "chat-model",
      chatModelId: "chat-id",
    });
    expect(mockData.titleJobs).toEqual([expect.objectContaining({ id: job!.id })]);

    const title = await generateConversationTitle(job!);

    expect(title).toBe("最终标题");
    expect(mockData.conversations[0].title).toBe("最终标题");
    expect(mockData.titleJobs).toEqual([]);
    expect(generateChat).toHaveBeenCalledWith(expect.objectContaining({
      modelId: "m1",
      taskKind: "title",
      request: expect.objectContaining({ model: "configured-model" }),
    }));
  });

  it("id-only processor 从 outbox 水合任务并返回 completed", async () => {
    await expect(processConversationTitleJob("job-1")).resolves.toBe("completed");

    expect(mockData.conversations[0].title).toBe("最终标题");
    expect(mockData.titleJobs).toEqual([]);
  });

  it("id-only processor 遇到缺失任务时明确 no-op", async () => {
    mockData.titleJobs = [];

    await expect(processConversationTitleJob("missing")).resolves.toBe("noop");

    expect(generateChat).not.toHaveBeenCalled();
  });

  it("id-only processor 遇到人工改名时 no-op 并清理旧任务", async () => {
    mockData.conversations[0].title = "用户标题";

    await expect(processConversationTitleJob("job-1")).resolves.toBe("noop");

    expect(generateChat).not.toHaveBeenCalled();
    expect(mockData.conversations[0].title).toBe("用户标题");
    expect(mockData.titleJobs).toEqual([]);
  });

  it("id-only processor 生成失败时拒绝并保留 durable row", async () => {
    mockData.conversations[0].title = "问题";
    vi.mocked(generateChat).mockRejectedValueOnce(new Error("provider-secret"));

    await expect(processConversationTitleJob("job-1")).rejects.toMatchObject({
      message: "会话标题生成失败",
    });

    expect(mockData.titleJobs).toEqual([expect.objectContaining({ id: "job-1" })]);
  });

  it("outbox 写入失败时回滚 fallback", async () => {
    mockData.titleJobs = [];
    mockData.jobInsertError = new Error("insert failed");

    await expect(writeFallbackTitle("u1", "c1", "问题")).rejects.toThrow("insert failed");

    expect(mockData.conversations[0].title).toBe("新会话");
    expect(mockData.titleJobs).toEqual([]);
  });

  it("fallback 更新未命中时不创建 outbox", async () => {
    mockData.conversations[0].title = "用户标题";
    mockData.titleJobs = [];

    await expect(writeFallbackTitle("u1", "c1", "问题")).resolves.toBeNull();

    expect(mockData.titleJobs).toEqual([]);
  });

  it("用户手动改名后，迟到 worker 不调用模型也不覆盖", async () => {
    mockData.conversations[0].title = "用户标题";

    const title = await generateConversationTitle(titleJob);

    expect(title).toBeNull();
    expect(generateChat).not.toHaveBeenCalled();
    expect(mockData.conversations[0].title).toBe("用户标题");
    expect(mockData.titleJobs).toEqual([]);
  });

  it("旧 job id 不调用模型且不能删除新 job", async () => {
    mockData.titleJobs = [{ ...titleJob, id: "job-new" }];

    await expect(generateConversationTitle(titleJob)).resolves.toBeNull();

    expect(generateChat).not.toHaveBeenCalled();
    expect(mockData.titleJobs).toEqual([expect.objectContaining({ id: "job-new" })]);
  });

  it("模型生成期间 job 被替换时不写标题也不删除新 job", async () => {
    mockData.conversations[0].title = "问题";
    vi.mocked(generateChat).mockImplementationOnce(async () => {
      mockData.titleJobs = [{ ...titleJob, id: "job-new" }];
      return { text: "迟到标题", usage: {} };
    });

    await expect(generateConversationTitle(titleJob)).resolves.toBeNull();

    expect(mockData.conversations[0].title).toBe("问题");
    expect(mockData.titleJobs).toEqual([expect.objectContaining({ id: "job-new" })]);
  });

  it("会话不存在时正常完成且不调用模型", async () => {
    mockData.conversations = [];

    const title = await generateConversationTitle(titleJob);

    expect(title).toBeNull();
    expect(generateChat).not.toHaveBeenCalled();
  });

  it("模型调用抛错时以通用错误拒绝并保留 fallback", async () => {
    mockData.conversations[0].title = "问题";
    vi.mocked(generateChat).mockRejectedValueOnce(new Error("provider-secret"));

    const error = await captureTitleError();

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ message: "会话标题生成失败" });
    expect(mockData.conversations[0].title).toBe("问题");
    expect(mockData.titleJobs).toEqual([expect.objectContaining({ id: "job-1" })]);
  });

  it.each([
    ["模型返回错误结果时拒绝任务而不是确认完成", {
      text: "不应使用的标题",
      usage: {},
      error: "provider-secret",
    }],
    ["模型未返回文本时拒绝任务", { text: "", usage: {} }],
    ["模型文本清洗后为空时拒绝任务", { text: " \n ", usage: {} }],
  ])("%s", async (_caseName, result) => {
    mockData.conversations[0].title = "问题";
    vi.mocked(generateChat).mockResolvedValueOnce(result);

    const error = await captureTitleError();

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ message: "会话标题生成失败" });
    expect(mockData.conversations[0].title).toBe("问题");
    expect(mockData.titleJobs).toEqual([expect.objectContaining({ id: "job-1" })]);
  });

  it("兼容入口在模型失败时保留 fallback 并正常完成", async () => {
    vi.mocked(generateChat).mockRejectedValueOnce(new Error("provider-secret"));
    const onTitle = vi.fn();

    await expect(maybeGenerateTitle("u1", "c1", "问题", undefined, onTitle))
      .resolves.toBeUndefined();

    expect(mockData.conversations[0].title).toBe("问题");
    expect(onTitle).toHaveBeenCalledOnce();
    expect(onTitle).toHaveBeenCalledWith("问题");
    expect(mockData.titleJobs).toEqual([expect.objectContaining({ id: expect.any(String) })]);
  });
});
