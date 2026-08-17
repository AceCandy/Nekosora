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
    vi.setSystemTime(new Date("2026-08-15T16:30:00.000Z"));
    mocks.generateChat.mockResolvedValue({ text: "```text\n最新 Gemini 代理空响应原因\n```" });

    try {
      await expect(rewriteSearchQuery({
        userId: "user-1",
        userContent: "为什么今天网关调用 Gemini 没有响应？",
        ctx: { userId: "user-1", keyKind: null, source: "chat" },
        runId: "run-1",
        signal: new AbortController().signal,
      })).resolves.toBe("最新 Gemini 代理空响应原因");
    } finally {
      vi.useRealTimers();
    }

    expect(mocks.generateChat).toHaveBeenCalledWith(expect.objectContaining({
      modelId: "rewrite-1",
      taskKind: "web_search_query",
      request: expect.objectContaining({
        model: "rewrite-model",
        temperature: 0,
        max_tokens: 128,
        messages: [
          expect.objectContaining({
            role: "system",
            content: expect.stringContaining("当前日期是 2026-08-16，当前时间是 00:30:00，时区是 Asia/Shanghai"),
          }),
          expect.objectContaining({ role: "user" }),
        ],
      }),
    }));
    expect(mocks.generateChat.mock.calls[0]?.[0].request.messages[0].content)
      .toContain("禁止根据“最近/最新”自行添加用户未指定的历史年份或宽泛年份范围");
    expect(mocks.generateChat.mock.calls[0]?.[0].request.messages[0].content)
      .toContain("保留相对时间原意，不要转换成具体年份或时间范围");
  });

  it("模型擅自添加来源中不存在的年份时回退", async () => {
    mocks.generateChat.mockResolvedValue({ text: "DeepSeek 模型最新价格 2025" });

    await expect(rewriteSearchQuery({
      userId: "user-1",
      userContent: "看下 DeepSeek 模型最新的价格",
      ctx: { userId: "user-1", keyKind: null, source: "chat" },
      runId: "run-1",
      signal: new AbortController().signal,
    })).resolves.toBeNull();
  });

  it("用户问题或上下文明确给出的年份可以保留", async () => {
    mocks.generateChat.mockResolvedValue({ text: "DeepSeek 2025 模型价格" });

    await expect(rewriteSearchQuery({
      userId: "user-1",
      userContent: "DeepSeek 2025 年的模型价格",
      ctx: { userId: "user-1", keyKind: null, source: "chat" },
      runId: "run-1",
      signal: new AbortController().signal,
    })).resolves.toBe("DeepSeek 2025 模型价格");

    await expect(rewriteSearchQuery({
      userId: "user-1",
      userContent: "那时的模型价格呢？",
      context: "user: 看一下 DeepSeek 2025 年的情况",
      ctx: { userId: "user-1", keyKind: null, source: "chat" },
      runId: "run-2",
      signal: new AbortController().signal,
    })).resolves.toBe("DeepSeek 2025 模型价格");
  });

  it("拒答式输出回退到原始用户问题", async () => {
    mocks.generateChat.mockResolvedValue({ text: "抱歉，我无法按照这个时间告诉你其他家的新模型。" });

    await expect(rewriteSearchQuery({
      userId: "user-1",
      userContent: "按照今天的时间告诉我其他家的新模型",
      ctx: { userId: "user-1", keyKind: null, source: "chat" },
      runId: "run-1",
      signal: new AbortController().signal,
    })).resolves.toBeNull();
  });

  it("把历史上下文和当前问题分开交给提炼模型", async () => {
    mocks.generateChat.mockResolvedValue({ text: "Gemini 3.2 最新发布" });

    await rewriteSearchQuery({
      userId: "user-1",
      userContent: "那其他厂商呢？",
      context: "user: 介绍一下最近的 Gemini 新模型\nassistant: Gemini 3.2 已发布。",
      ctx: { userId: "user-1", keyKind: null, source: "chat" },
      runId: "run-1",
      signal: new AbortController().signal,
    });

    expect(mocks.generateChat).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.stringMatching(/对话上下文[\s\S]*当前用户问题：\n那其他厂商呢？/),
          }),
        ]),
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
