import { describe, expect, it } from "vitest";
import { buildResearchStatus } from "./researchProcess";

describe("buildResearchStatus", () => {
  it("把内部步骤合并为用户语义并隐藏 prompt 与 sources", () => {
    const result = buildResearchStatus({
      phase: "completed",
      canonicalSteps: [
        { id: "memory", kind: "memory", status: "completed" },
        { id: "prompt", kind: "prompt", status: "completed" },
        { id: "search", kind: "web_search", status: "completed", data: { toolCallId: "search-1", citationCount: 4 } },
        { id: "sources", kind: "sources", status: "completed", data: { count: 4 } },
      ],
      toolCalls: [{ toolCallId: "search-1", toolName: "web_search", status: "done", args: { query: "latest news" } }],
      sourceCount: 4,
      hasReasoning: false,
      startedAt: "2026-08-08T00:00:00.000Z",
      firstContentAt: "2026-08-08T00:00:01.600Z",
      endedAt: "2026-08-08T00:00:04.200Z",
    });

    expect(result.steps.map((step) => step.type)).toEqual(["understand", "context", "search", "read"]);
    expect(result.query).toBe("latest news");
    expect(result.durationMs).toBe(1600);
  });

  it("把部分搜索失败收敛为 warning 并保留可用来源", () => {
    const result = buildResearchStatus({
      phase: "completed",
      canonicalSteps: [],
      toolCalls: [
        { toolName: "web_search", status: "error" },
        { toolName: "web_search", status: "done" },
      ],
      sourceCount: 4,
      hasReasoning: false,
    });

    expect(result.partialSourceFailure).toBe(true);
    expect(result.steps.find((step) => step.type === "search")?.status).toBe("warning");
    expect(result.status).toBe("completed");
  });

  it("运行时只选择当前用户语义阶段", () => {
    const result = buildResearchStatus({
      phase: "processing",
      canonicalSteps: [{ id: "search", kind: "web_search", status: "running", data: { toolCallId: "search-1" } }],
      toolCalls: [{ toolCallId: "search-1", toolName: "web_search", status: "calling", args: { query: "current query" } }],
      sourceCount: 0,
      hasReasoning: false,
    });

    expect(result.currentStage).toBe("search");
    expect(result.steps.filter((step) => step.status === "running")).toHaveLength(1);
  });

  it("隐藏的 prompt 运行中保持最后一个可见阶段", () => {
    const result = buildResearchStatus({
      phase: "preparing",
      canonicalSteps: [{ id: "prompt", kind: "prompt", status: "running" }],
      sourceCount: 0,
      hasReasoning: false,
    });

    expect(result.currentStage).toBe("understand");
    expect(result.steps.map((step) => step.type)).toEqual(["understand"]);
  });

  it("正文开始前完成研究并停止计时", () => {
    const result = buildResearchStatus({
      phase: "answering",
      canonicalSteps: [{ id: "search", kind: "web_search", status: "completed" }],
      toolCalls: [{ toolCallId: "search-1", toolName: "web_search", status: "done" }],
      sourceCount: 3,
      hasReasoning: false,
      startedAt: "2026-08-08T00:00:00.000Z",
      firstContentAt: "2026-08-08T00:00:01.500Z",
    });

    expect(result.status).toBe("completed");
    expect(result.currentStage).toBeUndefined();
    expect(result.durationMs).toBe(1500);
    expect(result.steps.map((step) => step.type)).toEqual(["understand", "search", "read"]);
  });
});
