import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateChat: vi.fn(),
  loadConfig: vi.fn(),
  listWebSearchQueryModelCandidates: vi.fn(),
}));

vi.mock("@/lib/stream", () => ({ generateChat: mocks.generateChat }));
vi.mock("@/lib/web-search/registry", () => ({
  loadConfig: mocks.loadConfig,
  listWebSearchQueryModelCandidates: mocks.listWebSearchQueryModelCandidates,
}));

import { rewriteSearchQuery } from "./query-rewrite";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadConfig.mockResolvedValue({ version: 2, providers: [], backends: [], queryRewriteModelId: "rewrite-1" });
  mocks.listWebSearchQueryModelCandidates.mockResolvedValue([{
    id: "rewrite-1",
    name: "rewrite-model",
    displayName: "Rewrite model",
  }]);
});

describe("rewriteSearchQuery", () => {
  it("使用配置模型并清理纯文本查询输出", async () => {
    mocks.generateChat.mockResolvedValue({ text: "```text\n最新 Gemini 代理空响应原因\n```" });

    await expect(rewriteSearchQuery({
      userId: "user-1",
      userContent: "为什么网关调用 Gemini 没有响应？",
      ctx: { userId: "user-1", keyKind: null, source: "chat" },
      runId: "run-1",
      signal: new AbortController().signal,
    })).resolves.toBe("最新 Gemini 代理空响应原因");

    expect(mocks.generateChat).toHaveBeenCalledWith(expect.objectContaining({
      modelId: "rewrite-1",
      taskKind: "web_search_query",
      request: expect.objectContaining({
        model: "rewrite-model",
        temperature: 0,
        max_tokens: 128,
      }),
    }));
  });

  it("未配置或模型不可用时不调用模型", async () => {
    mocks.loadConfig.mockResolvedValue({ version: 2, providers: [], backends: [] });

    await expect(rewriteSearchQuery({
      userId: "user-1",
      userContent: "问题",
      ctx: { userId: "user-1", keyKind: null, source: "chat" },
      runId: "run-1",
      signal: new AbortController().signal,
    })).resolves.toBeNull();
    expect(mocks.generateChat).not.toHaveBeenCalled();
  });
});
