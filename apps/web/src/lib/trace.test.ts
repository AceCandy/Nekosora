import { describe, it, expect } from "vitest";
import { buildTrace } from "@/lib/trace";
import { estimateTokens } from "@/lib/tokens";

describe("buildTrace", () => {
  it("mode 固定为 standard", () => {
    const trace = buildTrace([{ role: "user", content: "你好" }]);
    expect(trace.mode).toBe("standard");
  });

  it("sentMessageCount = 消息总数", () => {
    const trace = buildTrace([
      { role: "system", content: "系统提示" },
      { role: "user", content: "问题" },
      { role: "assistant", content: "回答" },
    ]);
    expect(trace.sentMessageCount).toBe(3);
  });

  it("fullMessageCount 默认等于 sentMessageCount(无压缩)", () => {
    const trace = buildTrace([{ role: "user", content: "你好" }]);
    expect(trace.fullMessageCount).toBe(1);
  });

  it("fullMessageCount 用 originalMessageCount 回填(压缩前总数)", () => {
    const trace = buildTrace([{ role: "user", content: "你好" }], 10);
    expect(trace.fullMessageCount).toBe(10);
  });

  it("token 估算 = 各消息 estimateTokens 之和", () => {
    const userText = "你好世界";
    const trace = buildTrace([{ role: "user", content: userText }]);
    expect(trace.sentTokenEstimate).toBe(estimateTokens(userText));
    expect(trace.totalTokenEstimate).toBe(estimateTokens(userText));
  });
});

describe("buildTrace 块推断(inferBlock)", () => {
  it("[先前对话摘要] 前缀 → compaction 块", () => {
    const trace = buildTrace([{ role: "system", content: "[先前对话摘要]\n摘要内容" }]);
    const block = trace.blocks[0];
    expect(block.kind).toBe("compaction");
    expect(block.title).toBe("上下文压缩摘要");
    expect(block.cacheable).toBe(false);
  });

  it("[用户偏好] 前缀 → memory_preference 块", () => {
    const trace = buildTrace([{ role: "system", content: "[用户偏好]\n喜欢简洁回答" }]);
    expect(trace.blocks[0].kind).toBe("memory_preference");
  });

  it("[用户画像] 前缀 → memory_profile 块", () => {
    const trace = buildTrace([{ role: "system", content: "[用户画像]\n前端开发者" }]);
    expect(trace.blocks[0].kind).toBe("memory_profile");
  });

  it("文件参考前缀 → file_context 块(cacheable)", () => {
    const trace = buildTrace([{ role: "system", content: "以下是与当前问题相关的文件参考\n片段..." }]);
    const block = trace.blocks[0];
    expect(block.kind).toBe("file_context");
    expect(block.cacheable).toBe(true);
  });

  it("无标记的 system → system 块(cacheable)", () => {
    const trace = buildTrace([{ role: "system", content: "你是一个助手" }]);
    const block = trace.blocks[0];
    expect(block.kind).toBe("system");
    expect(block.cacheable).toBe(true);
  });

  it("system 内多 slot(---分隔)拆成多个 block", () => {
    const trace = buildTrace([
      { role: "system", content: "系统提示\n\n---\n\n[用户偏好]\n偏好A" },
    ]);
    expect(trace.blocks).toHaveLength(2);
    expect(trace.blocks[0].kind).toBe("system");
    expect(trace.blocks[1].kind).toBe("memory_preference");
  });

  it("user 消息 → kind=user,title=用户消息", () => {
    const trace = buildTrace([{ role: "user", content: "问题" }]);
    expect(trace.blocks[0].kind).toBe("user");
    expect(trace.blocks[0].title).toBe("用户消息");
  });

  it("assistant 消息 → kind=assistant,title=助手消息", () => {
    const trace = buildTrace([{ role: "assistant", content: "回答" }]);
    expect(trace.blocks[0].kind).toBe("assistant");
    expect(trace.blocks[0].title).toBe("助手消息");
  });
});
