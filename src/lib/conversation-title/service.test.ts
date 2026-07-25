import { beforeEach, describe, expect, it, vi } from "vitest";

const mockData = vi.hoisted(() => ({
  conversations: [] as Record<string, unknown>[],
  models: [] as Record<string, unknown>[],
  settings: {} as Record<string, string | null>,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ type: "eq", col, val }),
  and: (...conds: unknown[]) => ({ type: "and", conds }),
  or: (...conds: unknown[]) => ({ type: "or", conds }),
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
    models: {
      __table: "models",
      id: "id",
      name: "name",
      visibility: "visibility",
      enabled: "enabled",
    },
  };

  return {
    getSchema: () => schema,
    getDb: async () => ({
      select: (fields?: Record<string, string>) => ({
        from: (table: { __table: string }) =>
          query(table.__table === "models" ? mockData.models : mockData.conversations, fields),
      }),
      update: (table: { __table: string }) => ({
        set: (patch: Record<string, unknown>) => ({
          where: (cond: unknown) => ({
            returning: async (fields: Record<string, string>) => {
              const rows = table.__table === "models" ? mockData.models : mockData.conversations;
              const matched = rows.filter((row) => matches(row, cond));
              for (const row of matched) Object.assign(row, patch);
              return project(matched, fields);
            },
          }),
        }),
      }),
    }),
  };
});

import { generateChat } from "@/lib/stream";
import { generateConversationTitle, writeFallbackTitle } from "./service";

beforeEach(() => {
  mockData.conversations = [{ id: "c1", userId: "u1", title: "新会话" }];
  mockData.models = [{
    id: "m1",
    name: "configured-model",
    visibility: "public",
    enabled: true,
  }];
  mockData.settings = { "task.title_model_id": "m1" };
  vi.mocked(generateChat).mockClear();
});

describe("conversation title service", () => {
  it("首条消息写 fallback，worker 按配置 modelId 生成最终标题", async () => {
    const fallbackTitle = await writeFallbackTitle("u1", "c1", "这是一个用于测试标题生成的很长问题");
    expect(fallbackTitle).toBe("这是一个用于测试标题生成的很长问…");

    const title = await generateConversationTitle({
      userId: "u1",
      conversationId: "c1",
      firstUserMessage: "这是一个用于测试标题生成的很长问题",
      fallbackTitle: fallbackTitle!,
      chatModel: "chat-model",
      chatModelId: "chat-id",
    });

    expect(title).toBe("最终标题");
    expect(mockData.conversations[0].title).toBe("最终标题");
    expect(generateChat).toHaveBeenCalledWith(expect.objectContaining({
      modelId: "m1",
      taskKind: "title",
      request: expect.objectContaining({ model: "configured-model" }),
    }));
  });

  it("用户手动改名后，迟到 worker 不调用模型也不覆盖", async () => {
    mockData.conversations[0].title = "用户标题";

    const title = await generateConversationTitle({
      userId: "u1",
      conversationId: "c1",
      firstUserMessage: "问题",
      fallbackTitle: "问题",
    });

    expect(title).toBeNull();
    expect(generateChat).not.toHaveBeenCalled();
    expect(mockData.conversations[0].title).toBe("用户标题");
  });
});
